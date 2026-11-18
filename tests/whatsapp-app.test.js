'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createWhatsAppService } = require('../netlify/lib/whatsapp');

// Opt-in, dedicated local sandbox database only. Never use production credentials.
const enabled = process.env.WHATSAPP_TEST_DB === '1';
test('Express app + PostgreSQL: WhatsApp retired, historical media protected, regular purchases unchanged', { skip: !enabled }, async () => {
  for (const key of Object.keys(process.env)) {
    if (/^(DATABASE_URL|SMTP_|ADMIN_WHATSAPP|CALLMEBOT|FT_ASSISTENTE_)/.test(key)) delete process.env[key];
  }
  process.env.PGHOST = '/var/run/postgresql';
  process.env.PGUSER = 'ubuntu';
  process.env.PGDATABASE = 'ft_flow_whatsapp_http_test';
  process.env.JWT_SECRET = 'local-test-jwt-secret';
  process.env.FT_WHATSAPP_ENABLED = 'false';
  process.env.WHATSAPP_VERIFY_TOKEN = 'local-test-verify';
  process.env.WHATSAPP_APP_SECRET = 'local-test-meta-secret';
  const { _test } = require('../netlify/functions/api');
  const server = _test.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const query = (sql, params) => _test.pool.query(sql, params);
  async function call(path, method = 'GET', body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    const admin = await call('/auth/login', 'POST', { username: 'admin', password: '123' });
    const operator = await call('/auth/login', 'POST', { username: 'operador', password: '123' });
    assert.equal(admin.status, 200); assert.equal(operator.status, 200);
    const token = admin.data.token;
    assert.equal((await call('/whatsapp/status')).status, 401);
    for (const actor of [token, operator.data.token]) {
      assert.equal((await call('/whatsapp/status', 'GET', undefined, actor)).status, 410);
      assert.equal((await call('/whatsapp/lideres', 'POST', { nome: 'Não criar', telefone: '5511996662222' }, actor)).status, 410);
      assert.equal((await call('/whatsapp/conversas', 'GET', undefined, actor)).status, 410);
      assert.equal((await call('/whatsapp/reprocessar', 'POST', {}, actor)).status, 410);
    }
    const regular = await call('/compras', 'POST', { item: 'Peça do teste regular', quantidade: 2, unidade: 'un', categoria: 'Outros', destino: 'Oficina', solicitante: 'Teste' }, operator.data.token);
    assert.equal(regular.status, 200); assert.ok(regular.data.id);
    const readPurchase = await call(`/compras/${regular.data.id}`, 'GET', undefined, token);
    assert.equal(readPurchase.data.status, 'Em cotação'); assert.equal(readPurchase.data.origem, 'app');

    // Create only historical fixtures through the local database, never a retired API.
    const legacy = createWhatsAppService({ pool: _test.pool, env: { FT_WHATSAPP_ENABLED: 'false' } });
    await legacy.ensureDb();
    const leader = await query(`INSERT INTO ft_whatsapp_lideres(nome,telefone,setor,ativo) VALUES('Líder antigo','5511996662222','Estufa',TRUE) ON CONFLICT(telefone) DO UPDATE SET nome=EXCLUDED.nome RETURNING id`);
    const requestId = crypto.randomUUID(), photoId = crypto.randomUUID();
    await query(`INSERT INTO ft_whatsapp_media(id,telefone,request_id,mime_type,conteudo) VALUES($1,$2,$3,'image/jpeg',$4)`, [photoId, '5511996662222', requestId, Buffer.from([255,216,255,0])]);
    assert.equal((await call(`/whatsapp/midias/${photoId}`, 'GET', undefined, token)).status, 404, 'unconfirmed draft images are not exposed');
    const historical = await query(`INSERT INTO compras(item,quantidade,unidade,destino,status,solicitante,origem,whatsapp_lider_id,whatsapp_request_id,whatsapp_transcricao) VALUES('Válvula',2,'un','Estufa','Em cotação','Teste','whatsapp',$1,$2,'Preciso de duas válvulas') RETURNING id`, [leader.rows[0].id, requestId]);
    const details = await call(`/whatsapp/compras/${historical.rows[0].id}`, 'GET', undefined, operator.data.token);
    assert.equal(details.status, 200); assert.equal(details.data.fotos[0].id, photoId); assert.match(details.data.transcricao, /válvulas/);
    let response = await fetch(base + `/whatsapp/midias/${photoId}`);
    assert.equal(response.status, 401);
    response = await fetch(base + `/whatsapp/midias/${photoId}`, { headers: { Authorization: `Bearer ${operator.data.token}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([255,216,255,0]));

    const before = (await query('SELECT COUNT(*)::int total FROM ft_whatsapp_inbox')).rows[0].total;
    response = await fetch(base + '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=local-test-verify&hub.challenge=123');
    assert.equal(response.status, 410);
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    response = await fetch(base + '/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'local-test-meta-secret').update(raw).digest('hex') }, body: raw });
    assert.equal(response.status, 410, 'retired webhook cannot ingest even correctly signed traffic');
    assert.equal((await query('SELECT COUNT(*)::int total FROM ft_whatsapp_inbox')).rows[0].total, before);
    response = await fetch(base + '/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid json' });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'JSON inválido' });
    const retiredWorker = require('../netlify/functions/whatsapp-process-background');
    process.env.FT_WHATSAPP_ENABLED = 'true';
    const stopped = await retiredWorker.handler({ headers: { authorization: 'Bearer old-token' }, body: JSON.stringify({ phones: ['5511996662222'] }) });
    assert.equal(stopped.statusCode, 410, 'old worker is inert even if an obsolete enable flag survives');
    process.env.FT_WHATSAPP_ENABLED = 'false';
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await _test.pool.end();
  }
});
