'use strict';

/**
 * Real PostgreSQL coverage for the WhatsApp core.  It is intentionally opt-in:
 *   WHATSAPP_TEST_DB=1 node --test tests/whatsapp-integration.test.js
 * It never touches the shared ft_flow_whatsapp_test database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createWhatsAppService } = require('../netlify/lib/whatsapp');

const enabled = process.env.WHATSAPP_TEST_DB === '1';
const dbConfig = { host: '/var/run/postgresql', database: 'ft_flow_whatsapp_core_test', user: 'ubuntu' };
const phoneNumberId = 'test-phone-number-id';
const env = {
  FT_WHATSAPP_ENABLED: 'true',
  WHATSAPP_ACCESS_TOKEN: 'synthetic-access-token',
  WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
  WHATSAPP_APP_SECRET: 'synthetic-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'synthetic-verify-token',
  FT_WHATSAPP_AI_API_KEY: 'synthetic-ai-key',
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function message(id, from, type, timestamp, content = {}) {
  return { id, from, type, timestamp: String(timestamp), ...content };
}

function webhook(messages) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Untrusted profile name must not be stored' } }],
      messages,
    } }], }],
  };
}

function extraction(itens, extras = {}) {
  return {
    itens, destino: Object.hasOwn(extras, 'destino') ? extras.destino : 'Obra Alfa',
    uso: extras.uso ?? null, categoria: extras.categoria ?? null,
    observacoes: extras.observacoes ?? null, pergunta: extras.pergunta ?? null,
  };
}

async function resetDatabase(pool) {
  // Dedicated database only.  The production/shared test database is never dropped.
  const identity = (await pool.query('SELECT current_database() AS name, inet_server_addr() AS address')).rows[0];
  assert.equal(identity.name, 'ft_flow_whatsapp_core_test', 'reset is restricted to the dedicated test database');
  assert.equal(identity.address, null, 'reset requires a local Unix socket, never an external connection');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query(`CREATE TABLE compras (
    id SERIAL PRIMARY KEY, item TEXT, quantidade REAL, unidade TEXT, categoria TEXT,
    destino TEXT, status TEXT DEFAULT 'Em cotação', solicitante TEXT, descricao TEXT,
    tipo_solicitacao TEXT, status_lista TEXT, uso TEXT
  )`);
  await pool.query(`CREATE TABLE lista_compras_itens (
    id SERIAL PRIMARY KEY, compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE,
    produto TEXT, quantidade REAL, unidade TEXT, fornecedor TEXT, preco REAL DEFAULT 0
  )`);
  await pool.query(`CREATE TABLE notificacoes (
    id SERIAL PRIMARY KEY, titulo TEXT, mensagem TEXT, tipo TEXT, destino_role TEXT
  )`);
  await pool.query(`CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY, actor_id INTEGER, action TEXT, target_table TEXT,
    target_id INTEGER, meta JSONB
  )`);
}

function makeTransport({ extractions = [], failSends = 0 } = {}) {
  const sent = [];
  let graphId = 0;
  let failuresLeft = failSends;
  const fetchImpl = async (url, options = {}) => {
    const endpoint = String(url);
    if (endpoint.includes('/messages')) {
      if (failuresLeft > 0) { failuresLeft -= 1; return jsonResponse({ error: 'synthetic Meta outage' }, 503); }
      const payload = JSON.parse(options.body);
      sent.push(payload);
      graphId += 1;
      return jsonResponse({ messages: [{ id: `wamid.synthetic.${graphId}` }] });
    }
    if (endpoint.includes('graph.facebook.com') && endpoint.endsWith('/image_media')) {
      return jsonResponse({ url: 'https://lookaside.fbsbx.com/synthetic-image', mime_type: 'image/jpeg', file_size: 4 });
    }
    if (endpoint.includes('graph.facebook.com') && endpoint.endsWith('/audio_media')) {
      return jsonResponse({ url: 'https://lookaside.fbsbx.com/synthetic-audio', mime_type: 'audio/ogg', file_size: 8 });
    }
    if (endpoint === 'https://lookaside.fbsbx.com/synthetic-image') {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (endpoint === 'https://lookaside.fbsbx.com/synthetic-audio') {
      return new Response(Buffer.from('OggSsynthetic'), { status: 200, headers: { 'content-type': 'audio/ogg' } });
    }
    if (endpoint.includes('/audio/transcriptions')) return jsonResponse({ text: '2 sacos de cimento e 4 caixas de parafuso' });
    if (endpoint.includes('/chat/completions')) {
      const current = extractions.shift();
      assert.ok(current, 'test configured enough mocked extraction responses');
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(current) } }] });
    }
    throw new Error(`unexpected synthetic fetch URL: ${endpoint}`);
  };
  return { fetchImpl, sent, setFailSends(value) { failuresLeft = value; } };
}

async function insertLeader(service, telefone, nome, defaults = {}) {
  return service.saveLeader({ telefone, nome, setor: 'Teste', ativo: true, ...defaults });
}

async function inbox(service, phone, id, type, timestamp, content) {
  const result = await service.ingestWebhook(webhook([message(id, phone, type, timestamp, content)]));
  assert.deepEqual(result.phones, [phone]);
  return service.processPhone(phone);
}

async function currentButton(pool, phone) {
  const result = await pool.query(
    `SELECT payload FROM ft_whatsapp_outbox
     WHERE telefone=$1 AND payload->>'kind'='summary' ORDER BY id DESC LIMIT 1`, [phone],
  );
  const payload = result.rows[0].payload;
  return payload.buttons[0].id;
}

async function count(pool, table, where = 'TRUE', params = []) {
  const result = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return result.rows[0].n;
}

test('PostgreSQL core flow: authorization, drafts, confirmation, media, stale input, failures, and recovery', { skip: !enabled }, async (t) => {
  const pool = new Pool(dbConfig);
  t.after(async () => { await pool.end(); });
  await resetDatabase(pool);

  const base = Math.floor(Date.now() / 1000) + 120;
  const transport = makeTransport({
    extractions: [
      // Leader one: a conventional purchase and a no-purchase foreign button.
      extraction([{ produto: 'Tinta', quantidade: 3, unidade: 'L' }], { destino: null, categoria: null, observacoes: 'Entrega manhã' }),
      // Leader two: audio produces a one-request list with photo/transcription.
      extraction([{ produto: 'Cimento', quantidade: 2, unidade: 'saco' }, { produto: 'Parafuso', quantidade: 4, unidade: 'caixa' }], { destino: 'Obra Beta', categoria: 'Manutenção', observacoes: 'Urgente' }),
      // Transaction rollback leader.
      extraction([{ produto: 'Falha A', quantidade: 1, unidade: 'saco' }, { produto: 'Falha B', quantidade: 2, unidade: 'caixa' }]),
      // Outbox barrier leader.
      extraction([{ produto: 'Barreira', quantidade: 1, unidade: 'kg' }]),
      // 30-item summary; must be chunked without silently omitting item 30.
      extraction(Array.from({ length: 30 }, (_, i) => ({ produto: `Produto ${i + 1} ${'X'.repeat(170)}`, quantidade: i + 1, unidade: 'un' })), { destino: 'Obra Longa' }),
    ],
  });
  const service = createWhatsAppService({ pool, env: { ...env }, fetchImpl: transport.fetchImpl });
  await service.ensureDb();

  const leaderOne = '5511998765432';
  const leaderTwo = '5521998765432';
  const leaderFail = '5531998765432';
  const leaderBarrier = '5541998765432';
  const leaderLong = '5551998765432';
  await insertLeader(service, leaderOne, 'Líder Um', { destino_padrao: 'Depósito', categoria_padrao: 'Padrão' });
  await insertLeader(service, leaderTwo, 'Líder Dois');
  await insertLeader(service, leaderFail, 'Falha');
  await insertLeader(service, leaderBarrier, 'Barreira');
  await insertLeader(service, leaderLong, 'Resumo Longo');

  // An unknown interactive title/ID cannot fall back to the title "Confirmar pedido".
  await inbox(service, leaderOne, 'foreign-button', 'interactive', base, { interactive: { button_reply: { id: 'foreign:1', title: 'Confirmar pedido' } } });
  assert.equal(await count(pool, 'compras'), 0, 'foreign interactive title creates no purchase');
  assert.equal((await pool.query(`SELECT status FROM ft_whatsapp_inbox WHERE id='foreign-button'`)).rows[0].status, 'ignored');

  // Conventional order: no purchase before the provider-confirmed, current button click.
  await inbox(service, leaderOne, 'regular-text', 'text', base + 1, { text: { body: '3 litros de tinta para almoxarifado' } });
  assert.equal(await count(pool, 'compras'), 0, 'summary alone does not create a purchase');
  const regularButton = await currentButton(pool, leaderOne);
  await inbox(service, leaderOne, 'regular-stale', 'interactive', base + 2, { interactive: { button_reply: { id: regularButton.replace(/:\d+$/, ':0'), title: 'Confirmar pedido' } } });
  assert.equal(await count(pool, 'compras'), 0, 'stale revision cannot create a purchase');
  await inbox(service, leaderOne, 'regular-confirm', 'interactive', base + 3, { interactive: { button_reply: { id: regularButton, title: 'Confirmar pedido' } } });
  assert.equal(await count(pool, 'compras'), 1, 'valid current button creates exactly one purchase');
  const regular = (await pool.query(`SELECT * FROM compras WHERE origem='whatsapp' AND solicitante='Líder Um'`)).rows[0];
  assert.equal(regular.item, 'Tinta');
  assert.equal(regular.quantidade, 3);
  assert.equal(regular.destino, 'Depósito', 'leader default destination is preserved when extraction has none');
  assert.equal(regular.categoria, 'Padrão', 'leader default category is preserved when extraction has none');
  assert.match(regular.descricao, /Entrega manhã/);
  assert.equal(await count(pool, 'lista_compras_itens', 'compra_id=$1', [regular.id]), 0, 'regular purchase receives no list rows');
  // A provider retry with a different inbound ID remains exactly once.
  await inbox(service, leaderOne, 'regular-confirm-duplicate', 'interactive', base + 4, { interactive: { button_reply: { id: regularButton, title: 'Confirmar pedido' } } });
  assert.equal(await count(pool, 'compras', "solicitante='Líder Um'"), 1, 'unique request id proves duplicate confirmation exactly once');

  // Photo first persists a draft; no attachment is readable until a matching confirmed WhatsApp purchase exists.
  await inbox(service, leaderTwo, 'photo-first', 'image', base + 5, { image: { id: 'image_media' } });
  const photoConversation = (await pool.query(`SELECT draft FROM ft_whatsapp_conversas WHERE telefone=$1`, [leaderTwo])).rows[0].draft;
  assert.equal(photoConversation.media_ids.length, 1, 'photo persisted in the draft');
  assert.equal(await service.getMedia(photoConversation.media_ids[0]), null, 'draft-only media is not exposed');
  await inbox(service, leaderTwo, 'audio-list', 'audio', base + 6, { audio: { id: 'audio_media' } });
  const listButton = await currentButton(pool, leaderTwo);
  await inbox(service, leaderTwo, 'list-confirm', 'interactive', base + 7, { interactive: { button_reply: { id: listButton, title: 'Confirmar pedido' } } });
  const listPurchase = (await pool.query(`SELECT * FROM compras WHERE solicitante='Líder Dois'`)).rows[0];
  assert.match(listPurchase.item, /^Lista WhatsApp — Líder Dois$/);
  assert.equal(listPurchase.quantidade, 0);
  assert.equal(listPurchase.unidade, '');
  assert.match(listPurchase.descricao, /Observações: Urgente/);
  assert.equal(await count(pool, 'lista_compras_itens', 'compra_id=$1', [listPurchase.id]), 2, 'multi-item list gets exactly its list rows');
  const media = await service.getMedia(photoConversation.media_ids[0]);
  assert.deepEqual(media && [...media.buffer], [255, 216, 255, 0], 'media is readable only through the confirmed purchase join');
  const detail = await service.getPurchaseDetails(listPurchase.id);
  assert.match(detail.transcricao, /2 sacos/);
  assert.equal(detail.fotos.length, 1);

  // Transaction failure after compras insertion rolls the entire confirmation back.
  await pool.query(`CREATE FUNCTION reject_test_list_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic list write failure'; END $$`);
  await pool.query(`CREATE TRIGGER reject_test_list_item BEFORE INSERT ON lista_compras_itens FOR EACH ROW WHEN (NEW.produto LIKE 'Falha%') EXECUTE FUNCTION reject_test_list_item()`);
  await inbox(service, leaderFail, 'fail-text', 'text', base + 8, { text: { body: 'itens que falham' } });
  const failedButton = await currentButton(pool, leaderFail);
  await inbox(service, leaderFail, 'fail-confirm', 'interactive', base + 9, { interactive: { button_reply: { id: failedButton, title: 'Confirmar pedido' } } });
  assert.equal(await count(pool, 'compras', "solicitante='Falha'"), 0, 'failed list insert rolls back the purchase');
  assert.equal((await pool.query(`SELECT status FROM ft_whatsapp_inbox WHERE id='fail-confirm'`)).rows[0].status, 'pending', 'a first operational failure remains retryable');
  await pool.query('DROP TRIGGER reject_test_list_item ON lista_compras_itens');
  await pool.query('DROP FUNCTION reject_test_list_item()');

  // Failed outbox is a queue barrier: a newer inbound event cannot overtake it.
  transport.setFailSends(3);
  const ingestedBarrier = await service.ingestWebhook(webhook([
    message('barrier-one', leaderBarrier, 'text', base + 10, { text: { body: '1 kg barreira' } }),
  ]));
  assert.deepEqual(ingestedBarrier.phones, [leaderBarrier]);
  const blocked = await service.processPhone(leaderBarrier);
  assert.equal(blocked.blocked, true);
  const blockedConfirm = await currentButton(pool, leaderBarrier);
  await service.ingestWebhook(webhook([message('barrier-confirm', leaderBarrier, 'interactive', base + 11, {
    interactive: { button_reply: { id: blockedConfirm, title: 'Confirmar pedido' } },
  })]));
  assert.equal((await pool.query(`SELECT status FROM ft_whatsapp_inbox WHERE id='barrier-confirm'`)).rows[0].status, 'pending', 'confirmation queues behind a failed outbox');
  assert.equal(await count(pool, 'compras', "solicitante='Barreira'"), 0, 'blocked confirmation cannot create a purchase');
  assert.equal((await pool.query(`SELECT attempts FROM ft_whatsapp_outbox WHERE telefone=$1 ORDER BY id LIMIT 1`, [leaderBarrier])).rows[0].attempts, 1);
  await service.processPhone(leaderBarrier);
  await service.processPhone(leaderBarrier);
  assert.deepEqual((await pool.query(`SELECT status,attempts FROM ft_whatsapp_outbox WHERE telefone=$1 ORDER BY id LIMIT 1`, [leaderBarrier])).rows[0], { status: 'failed', attempts: 3 }, 'third unsuccessful delivery becomes a manual dead letter');
  const recovered = await service.retryFailures();
  assert.ok(recovered.includes(leaderBarrier), 'manual recovery returns blocked phone including failed rows');
  assert.equal((await pool.query(`SELECT attempts,status FROM ft_whatsapp_outbox WHERE telefone=$1 ORDER BY id LIMIT 1`, [leaderBarrier])).rows[0].attempts, 0, 'manual recovery resets outbox attempts');
  const afterRecovery = await service.processPhone(leaderBarrier);
  assert.equal(afterRecovery.blocked, false);
  assert.equal((await pool.query(`SELECT status FROM ft_whatsapp_inbox WHERE id='barrier-confirm'`)).rows[0].status, 'processed');
  assert.equal(await count(pool, 'compras', "solicitante='Barreira'"), 1, 'manual recovery releases the queued confirmation exactly once');

  // 30 long items require multiple <=4,000-character summary messages and retain the last item.
  await inbox(service, leaderLong, 'long-summary', 'text', base + 12, { text: { body: 'lista longa' } });
  const longTexts = transport.sent
    .filter((payload) => payload.to === leaderLong && payload.type === 'text')
    .map((payload) => payload.text.body);
  assert.ok(longTexts.filter((body) => body.includes('Produto ')).length >= 2, 'long summary was split into multiple text messages');
  assert.ok(longTexts.every((body) => body.length <= 4000), 'each summary chunk fits WhatsApp text bounds');
  assert.ok(longTexts.some((body) => body.includes('Produto 30')), 'last list item is not omitted by summary chunking');

  // Never silently truncate a 31-item model response into a confirmable partial list.
  const oversizedPhone = '5511976665555';
  const oversizedTransport = makeTransport({ extractions: [extraction(Array.from({ length: 31 }, (_, i) => ({ produto: `Item ${i + 1}`, quantidade: 1, unidade: 'un' })))] });
  const oversizedService = createWhatsAppService({ pool, env: { ...env }, fetchImpl: oversizedTransport.fetchImpl });
  await insertLeader(oversizedService, oversizedPhone, 'Limite seguro');
  await inbox(oversizedService, oversizedPhone, 'oversized-list', 'text', base + 13, { text: { body: '31 produtos' } });
  assert.equal(await count(pool, 'compras', "solicitante='Limite seguro'"), 0);
  assert.ok(oversizedTransport.sent.some(p => p.text?.body.includes('mais de 30 produtos')));
  assert.ok(oversizedTransport.sent.every(p => p.type !== 'interactive'));
  const oversizedDraft = (await pool.query('SELECT draft,status FROM ft_whatsapp_conversas WHERE telefone=$1', [oversizedPhone])).rows[0];
  assert.equal(oversizedDraft.draft.itens.length, 0, 'no partial draft was saved');
  assert.equal(oversizedDraft.status, 'collecting');

  // listConversations is bounded and exposes the frontend contract key, never ultimo_erro*.
  const conversations = await service.listConversations();
  assert.ok(conversations.length <= 100);
  assert.ok(conversations.every((row) => Object.hasOwn(row, 'last_error')));
  assert.ok(conversations.every((row) => !Object.hasOwn(row, 'ultimo_erro_inbox')));
});
