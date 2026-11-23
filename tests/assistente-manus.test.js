'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { createAssistenteService, mountAssistenteRoutes } = require('../netlify/lib/assistente');
const ENV = { FT_ASSISTENTE_AI_PROVIDER: 'manus', FT_ASSISTENTE_MANUS_API_KEY: 'synthetic-manus-key' };
const USER = { username: 'operador', id: 1, admin: false };
const TASK = 'AbCdEfGhIjKlMnOpQrStUv';
const extraction = extras => ({ nome_pessoa: 'João da Oficina', nome_lista: null, categoria: null, destino: 'Oficina', uso: null, descricao: null, observacoes: null, link_produto: null, itens: [{ produto: 'Luva M', quantidade: 2, unidade: 'pares' }], pergunta: 'Exigir link e categoria', transcricao: null, ...extras });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fakePool() {
  const jobs = new Map(); const statements = [];
  const query = async (sql, params = []) => {
    sql = sql.trim();
    statements.push(sql);
    if (/^SELECT id FROM usuarios/.test(sql)) return { rows: [{ id: 1 }] };
    if (/^SELECT \* FROM ft_assistente_processamentos/.test(sql)) {
      const row = jobs.get(params[0]); return { rows: row?.username === params[1] ? [{ ...row }] : [] };
    }
    if (/^INSERT INTO ft_assistente_processamentos/.test(sql)) {
      if (jobs.has(params[0])) return { rows: [] };
      const row = { id: params[0], username: params[1], usuario_id: params[2], payload_hash: params[3], estado: 'criando', rascunho: JSON.parse(params[4]), tem_audio: params[5], tamanho_texto: params[6], expires_at: params[7], pergunta_guiada: params[8] ? JSON.parse(params[8]) : null };
      jobs.set(row.id, row); return { rows: [{ ...row }] };
    }
    if (/^UPDATE ft_assistente_processamentos/.test(sql)) {
      if (/WHERE expires_at<NOW\(\)/.test(sql)) return { rows: [] };
      const row = jobs.get(params[0]); if (!row) return { rows: [] };
      const condition = sql.match(/AND estado='([^']+)'/);
      if (condition && row.estado !== condition[1]) return { rows: [] };
      const status = sql.match(/SET (?:task_id=\$2,)?estado='([^']+)'/);
      if (status) row.estado = status[1];
      if (/task_id=\$2/.test(sql)) row.task_id = params[1];
      if (/resultado=\$2/.test(sql)) row.resultado = JSON.parse(params[1]);
      if (/rascunho=NULL/.test(sql)) row.rascunho = null;
      if (/resultado=NULL/.test(sql)) row.resultado = null;
      if (/erro_codigo=\$2/.test(sql)) { row.erro_codigo = params[1]; row.erro_status = params[2]; }
      return { rows: [{ ...row }] };
    }
    if (/CREATE TABLE IF NOT EXISTS ft_assistente_processamentos/.test(sql)) return { rows: [] };
    assert.fail('Unexpected SQL: ' + sql);
  };
  return { jobs, statements, query, connect: async () => ({ query: async sql => {
    statements.push(sql);
    assert.match(sql.trim(), /^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT pg_advisory_xact_lock|CREATE TABLE IF NOT EXISTS ft_assistente_pedidos|INSERT INTO ft_assistente_ai_limites)/);
    return { rows: [{ chamadas: 1 }] };
  }, release() {} }) };
}
function setup() {
  const pool = fakePool(); const calls = []; const queue = [];
  const fetchImpl = async (url, options) => {
    assert.match(url, /^https:\/\/api\.manus\.ai\/v2\/task\.(create|detail|listMessages|stop)(\?|$)/);
    assert.equal(options.headers['x-manus-api-key'], 'synthetic-manus-key');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.redirect, 'error');
    calls.push({ url, options });
    if (url.endsWith('task.stop')) return json({ ok: true });
    assert.ok(queue.length, 'Each provider call needs an explicit fixture'); return queue.shift();
  };
  const service = createAssistenteService({ pool, env: ENV, fetchImpl });
  return { pool, calls, queue, fetchImpl, service };
}
async function start(s, extras = {}) {
  s.queue.push(json({ ok: true, task_id: TASK, share_visibility: 'private' }));
  return s.service.interpretar({ texto: 'Sou João, preciso de 2 pares de luvas M para a Oficina.', consentimento_ia: true, ...extras }, USER);
}
function finished(s, value = extraction(), background = false) {
  s.queue.push(json({ ok: true, task: { id: TASK, status: 'stopped', has_running_background_jobs: background } }));
  if (background === false) s.queue.push(json({ ok: true, task_id: TASK, messages: [{ type: 'structured_output_result', structured_output_result: { success: true, value } }] }));
}

test('Manus configuration is explicit and never falls back to OpenAI or sandbox keys', () => {
  const s = setup(); assert.equal(s.service.getStatus().provedor, 'manus'); assert.equal(s.service.getStatus().processamento_assincrono, true);
  const missing = createAssistenteService({ pool: s.pool, env: { FT_ASSISTENTE_AI_PROVIDER: 'manus', FT_ASSISTENTE_AI_API_KEY: 'wrong-provider-key', OPENAI_API_KEY: 'sandbox-key' } });
  assert.equal(missing.getStatus().configurado, false); assert.equal(s.calls.length, 0);
});
test('Manus creates only a private draft task with bare supported schema and no images or account identity', async () => {
  const s = setup(); const pending = await start(s); assert.equal(pending.estado, 'processando');
  const body = JSON.parse(s.calls[0].options.body);
  assert.equal(body.share_visibility, 'private'); assert.equal(body.interactive_mode, false); assert.equal(body.agent_profile, 'lite'); assert.deepEqual(body.message.connectors, []);
  assert.equal(body.structured_output_schema.additionalProperties, false);
  assert.ok(body.structured_output_schema.required.includes('transcricao'));
  assert.doesNotMatch(JSON.stringify(body.structured_output_schema), /maxLength|minimum|maxItems/);
  assert.match(body.message.content[0].text, /Não confirme pedidos, não crie compras/);
  assert.match(body.message.content[0].text, /Nunca infira nome_pessoa/);
  assert.doesNotMatch(body.message.content[0].text, /"username"|synthetic-manus-key/);
  assert.doesNotMatch(JSON.stringify(pending), /task_id|task_url|synthetic/);
  assert.equal(s.pool.statements.some(sql => /^INSERT INTO compras/.test(sql)), false);
});
test('audio is a private voice data URI with matching MIME; photo URLs cannot enter interpretation', async () => {
  const s = setup(); const audio = { base64: Buffer.from('RIFFxxxxWAVEdata').toString('base64'), mime_type: 'audio/wav' };
  const pending = await start(s, { audio });
  const voice = JSON.parse(s.calls[0].options.body).message.content[1]; assert.equal(voice.type, 'voice'); assert.equal(voice.file_data, 'data:audio/wav;base64,' + audio.base64); assert.equal(voice.filename, 'pedido.wav');
  finished(s, extraction({ transcricao: 'Sou João. Preciso de dois pares de luvas M para a oficina.' }));
  const result = await s.service.consultarProcessamento(pending.processamento_id, USER); assert.match(result.transcricao, /Sou João/); assert.equal(result.rascunho.itens[0].unidade, 'par');
  await assert.rejects(() => s.service.interpretar({ texto: 'A', consentimento_ia: true, fotos: [] }, USER), error => error.code === 'DADOS_INVALIDOS');
});
test('ready output is validated, normalized, kept editable and never creates a purchase', async () => {
  const s = setup(); const pending = await start(s); finished(s);
  const result = await s.service.consultarProcessamento(pending.processamento_id, USER);
  assert.equal(result.rascunho.nome_pessoa, 'João da Oficina'); assert.equal(result.rascunho.itens[0].unidade, 'par'); assert.equal(result.pergunta, null);
  assert.match(result.avisos[0], /revise e corrija antes de confirmar/);
  assert.equal(s.pool.jobs.get(pending.processamento_id).rascunho, null);
  const before = s.calls.length; assert.deepEqual(await s.service.consultarProcessamento(pending.processamento_id, USER), result); assert.equal(s.calls.length, before);
  assert.equal(s.pool.statements.some(sql => /^INSERT INTO compras/.test(sql)), false);
});
test('a stopped Agent with unknown/active background jobs and delayed extraction stays pending', async () => {
  for (const background of [true, undefined]) {
    const s = setup(); const pending = await start(s);
    s.queue.push(json({ ok: true, task: { id: TASK, status: 'stopped', ...(background === undefined ? {} : { has_running_background_jobs: background }) } }));
    const result = await s.service.consultarProcessamento(pending.processamento_id, USER); assert.equal(result.estado, 'processando'); assert.equal(s.calls.length, 2);
  }
  const s = setup(); const pending = await start(s);
  s.queue.push(json({ ok: true, task: { id: TASK, status: 'stopped', has_running_background_jobs: false } }), json({ ok: true, task_id: TASK, messages: [{ type: 'assistant_message', assistant_message: { content: JSON.stringify(extraction()) } }] }));
  assert.equal((await s.service.consultarProcessamento(pending.processamento_id, USER)).estado, 'processando');
});
test('initial waiting state is not treated as a user authorization request', async () => {
  const s = setup(); const pending = await start(s);
  s.queue.push(json({ ok: true, task: { id: TASK, status: 'waiting' } }), json({ ok: true, task_id: TASK, messages: [] }));
  assert.equal((await s.service.consultarProcessamento(pending.processamento_id, USER)).estado, 'processando');
});
test('real authorization requests are not accepted automatically', async () => {
  const s = setup(); const pending = await start(s);
  s.queue.push(json({ ok: true, task: { id: TASK, status: 'waiting' } }), json({ ok: true, task_id: TASK, messages: [{ type: 'status_update', status_update: { agent_status: 'waiting', status_detail: { waiting_for_event_type: 'apiHighCreditNotice' } } }] }));
  await assert.rejects(() => s.service.consultarProcessamento(pending.processamento_id, USER), error => error.code === 'IA_REQUER_CONFIRMACAO');
  assert.equal(s.calls.some(call => call.url.includes('confirmAction')), false);
});
test('process UUID ownership, authenticated account ID and replay hash prevent leaks/duplicate tasks', async () => {
  const s = setup(); const id = randomUUID(); const pending = await start(s, { processamento_id: id });
  const again = await s.service.interpretar({ texto: 'Sou João, preciso de 2 pares de luvas M para a Oficina.', consentimento_ia: true, processamento_id: id }, USER); assert.deepEqual(again, pending); assert.equal(s.calls.length, 1);
  await assert.rejects(() => s.service.interpretar({ texto: 'Pedido diferente', consentimento_ia: true, processamento_id: id }, USER), error => error.code === 'REQUEST_ID_CONFLITO');
  for (const user of [{ ...USER, username: 'outro', admin: true }, { ...USER, id: 2 }]) {
    await assert.rejects(() => s.service.consultarProcessamento(id, user), error => error.status === 404);
    await assert.rejects(() => s.service.cancelarProcessamento(id, user), error => error.status === 404);
  }
});
test('cancel/expiry clear draft/result, request task stop and never allow late output', async () => {
  const s = setup(); const pending = await start(s); assert.deepEqual(await s.service.cancelarProcessamento(pending.processamento_id, USER), { ok: true, cancelado: true });
  assert.equal(s.pool.jobs.get(pending.processamento_id).rascunho, null);
  await assert.rejects(() => s.service.consultarProcessamento(pending.processamento_id, USER), error => error.code === 'PROCESSAMENTO_CANCELADO');
  const other = setup(); const job = await start(other); other.pool.jobs.get(job.processamento_id).expires_at = new Date(0);
  await assert.rejects(() => other.service.consultarProcessamento(job.processamento_id, USER), error => error.code === 'TEMPO_IA_EXCEDIDO');
  assert.equal(other.pool.jobs.get(job.processamento_id).rascunho, null);
});
test('invalid extraction, incomplete audio and unknown fields are rejected without saving partial drafts', async () => {
  for (const value of [extraction({ role: 'admin' }), extraction({ itens: [{ produto: 'Luva', quantidade: true, unidade: 'par' }] }), extraction({ nome_pessoa: 'x'.repeat(241) })]) {
    const s = setup(); const pending = await start(s); finished(s, value);
    await assert.rejects(() => s.service.consultarProcessamento(pending.processamento_id, USER), error => error.code === 'RESPOSTA_IA_INVALIDA');
  }
  const s = setup(); const pending = await start(s); s.queue.push(json({ ok: true, task: { id: TASK, status: 'stopped', has_running_background_jobs: false } }), json({ ok: true, task_id: TASK, messages: [{ type: 'structured_output_result', structured_output_result: { success: false, value: extraction(), error: 'SECRET UPSTREAM' } }] }));
  await assert.rejects(() => s.service.consultarProcessamento(pending.processamento_id, USER), error => error.code === 'RESPOSTA_IA_INVALIDA' && !error.message.includes('SECRET'));
});
test('Manus upstream access/rate/config errors never log the employee out or expose provider details', async () => {
  for (const [status, code, expected] of [[401,'unauthenticated','IA_ACESSO_NEGADO'],[403,'permission_denied','IA_ACESSO_NEGADO'],[429,'rate_limited','IA_MUITAS_REQUISICOES'],[400,'invalid_argument','IA_CONFIGURACAO_INVALIDA']]) {
    const s = setup(); s.queue.push(json({ ok: false, error: { code, message: 'SECRET TOKEN PRIVATE AUDIO' } }, status));
    await assert.rejects(() => s.service.interpretar({ texto: 'Teste', consentimento_ia: true }, USER), error => error.code === expected && error.status !== 401 && !error.message.includes('SECRET'));
  }
});
test('Manus cannot bypass essential fields/photo, and numeric/generic person labels are rejected before the DB', async () => {
  const s = setup(); const complete = { nome_pessoa: 'João', destino: 'Oficina', itens: [{ produto: 'Luva', quantidade: 2, unidade: 'par' }] };
  for (const rascunho of [complete, { ...complete, nome_pessoa: '123' }, { ...complete, nome_pessoa: 'Responsável' }, { ...complete, destino: '' }, { ...complete, itens: [{ produto: '', quantidade: 2, unidade: 'par' }] }]) {
    await assert.rejects(() => s.service.confirmar({ request_id: randomUUID(), rascunho, fotos: [] }, USER), error => error.code === 'PEDIDO_INCOMPLETO');
  }
  assert.equal(s.calls.length, 0); assert.equal(s.pool.statements.length, 0);
});
test('HTTP creation/poll/cancellation remain authenticated and return private 202 responses', async t => {
  const s = setup(); const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers.authorization === 'Bearer synthetic-app-session') req.user = { ...USER, role: 'funcionario' }; next(); });
  mountAssistenteRoutes(app, { pool: s.pool, env: ENV, fetchImpl: s.fetchImpl });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.close(); server.closeAllConnections(); });
  const base = 'http://127.0.0.1:' + server.address().port + '/assistente';
  assert.equal((await fetch(base + '/processamentos/' + randomUUID())).status, 401);
  s.queue.push(json({ ok: true, task_id: TASK, share_visibility: 'private' }));
  const r = await fetch(base + '/interpretar', { method: 'POST', headers: { Authorization: 'Bearer synthetic-app-session', 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Teste', consentimento_ia: true }) });
  assert.equal(r.status, 202); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const body = await r.json(); assert.doesNotMatch(JSON.stringify(body), /synthetic|task_url|task_id/);
  const cancelled = await fetch(base + '/processamentos/' + body.processamento_id + '/cancelar', { method: 'POST', headers: { Authorization: 'Bearer synthetic-app-session' } });
  assert.equal(cancelled.status, 200);
});

test('guided answers affect only the selected field/item and remain drafts for human review', async () => {
  for (const pergunta_guiada of [{ campo: 'nome_pessoa' }, { campo: 'destino' }, { campo: 'produto', indice_item: 1 }, { campo: 'quantidade', indice_item: 1 }, { campo: 'unidade', indice_item: 1 }]) {
    const s = setup(); const original = { nome_pessoa: 'Maria Original', destino: 'Estufa Original', nome_lista: 'Lista Preservada', itens: [{ produto: 'Produto 1', quantidade: 1, unidade: 'un' }, { produto: 'Produto 2', quantidade: 3, unidade: 'caixa' }] };
    const pending = await start(s, { pergunta_guiada, rascunho: original });
    const changed = extraction({ nome_pessoa: 'João', destino: 'Oficina', nome_lista: 'Não alterar', itens: [{ produto: 'Luva', quantidade: 5, unidade: 'pares' }] });
    finished(s, changed);
    const result = await s.service.consultarProcessamento(pending.processamento_id, USER);
    assert.equal(result.campo_guiado, pergunta_guiada.campo);
    assert.equal(result.rascunho.nome_lista, original.nome_lista);
    assert.equal(result.rascunho.itens[0].produto, original.itens[0].produto);
    assert.equal(result.rascunho.nome_pessoa, pergunta_guiada.campo === 'nome_pessoa' ? 'João' : original.nome_pessoa);
    assert.equal(result.rascunho.destino, pergunta_guiada.campo === 'destino' ? 'Oficina' : original.destino);
    if (pergunta_guiada.indice_item === 1) {
      const expected = { ...original.itens[1], [pergunta_guiada.campo]: { produto:'Luva',quantidade:5,unidade:'par' }[pergunta_guiada.campo] };
      assert.deepEqual(result.rascunho.itens[1], expected);
    }
    assert.equal(s.pool.statements.some(sql => /^INSERT INTO compras/.test(sql)), false);
  }
});
test('guided target is allowlisted and must refer to an existing draft item', async () => {
  const s = setup();
  for (const pergunta_guiada of [{campo:'role'},{campo:'produto',indice_item:-1},{campo:'unidade',indice_item:30},{campo:'quantidade',indice_item:0},{campo:'nome_pessoa',url:'https://evil.invalid'}]) {
    await assert.rejects(()=>s.service.interpretar({texto:'Resposta',consentimento_ia:true,pergunta_guiada},USER),error=>error.code==='DADOS_INVALIDOS');
  }
  assert.equal(s.calls.length,0);assert.equal(s.pool.statements.length,0);
});

test('duplicate AI items are rejected rather than silently summed, removed or saved', async () => {
  const s=setup();const pending=await start(s);
  const item={produto:'Luva M',quantidade:2,unidade:'par'};
  finished(s,extraction({itens:[item,{...item,produto:'luva m'}]}));
  await assert.rejects(()=>s.service.consultarProcessamento(pending.processamento_id,USER),error=>error.code==='IA_ITENS_REPETIDOS');
  assert.equal(s.pool.statements.some(sql=>/^INSERT INTO compras/.test(sql)),false);
});
