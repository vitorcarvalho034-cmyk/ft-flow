'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// This suite is opt-in and can only use the dedicated local sandbox test database.
const enabled = process.env.WHATSAPP_TEST_DB === '1';
test('Express app + PostgreSQL: login, leaders, private media and unchanged purchase flow', { skip: !enabled }, async () => {
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.ADMIN_WHATSAPP;
  delete process.env.ADMIN_WHATSAPP_NUMBERS;
  delete process.env.CALLMEBOT_API_KEY;
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
    assert.equal((await call('/whatsapp/status', 'GET', undefined, operator.data.token)).status, 403);
    const status = await call('/whatsapp/status', 'GET', undefined, token);
    assert.equal(status.status, 200); assert.equal(status.data.enabled, false);
    assert.ok(status.data.missing.includes('WHATSAPP_ACCESS_TOKEN'));
    assert.equal(JSON.stringify(status.data).includes('local-test-meta-secret'), false);
    const body = { nome: 'Líder de teste HTTP', telefone: '+55 (11) 99666-2222', setor: 'Estufa', destino_padrao: 'Estufa 3', ativo: true };
    // Re-runnable suite, isolated local data only.
    await query('DELETE FROM ft_whatsapp_lideres WHERE telefone=$1', ['5511996662222']);
    const leader = await call('/whatsapp/lideres', 'POST', body, token);
    assert.equal(leader.status, 201); assert.equal(leader.data.telefone, '5511996662222');
    assert.equal((await call('/whatsapp/lideres', 'POST', body, token)).status, 400);
    const paused = await call(`/whatsapp/lideres/${leader.data.id}`, 'PUT', { ...body, ativo: false }, token);
    assert.equal(paused.status, 200); assert.equal(paused.data.ativo, false);
    assert.equal((await call('/whatsapp/lideres', 'POST', body, operator.data.token)).status, 403);
    assert.equal((await call('/whatsapp/reprocessar', 'POST', undefined, token)).status, 409);
    const purchase = await call('/compras', 'POST', { item: 'Peça do teste regular', quantidade: 2, unidade: 'un', categoria: 'Outros', destino: 'Oficina', solicitante: 'Teste' }, operator.data.token);
    assert.equal(purchase.status, 200); assert.ok(purchase.data.id);
    const readPurchase = await call(`/compras/${purchase.data.id}`, 'GET', undefined, token);
    assert.equal(readPurchase.data.status, 'Em cotação'); assert.equal(readPurchase.data.origem, 'app');
    const requestId = crypto.randomUUID(), photoId = crypto.randomUUID();
    await query(`INSERT INTO ft_whatsapp_media (id,telefone,request_id,mime_type,conteudo) VALUES ($1,$2,$3,'image/jpeg',$4)`, [photoId, '5511996662222', requestId, Buffer.from([255,216,255,0])]);
    assert.equal((await call(`/whatsapp/midias/${photoId}`, 'GET', undefined, token)).status, 404, 'unconfirmed draft images are not exposed');
    const created = await query(`INSERT INTO compras(item,quantidade,unidade,destino,status,solicitante,origem,whatsapp_lider_id,whatsapp_request_id,whatsapp_transcricao) VALUES ('Válvula',2,'un','Estufa','Em cotação','Teste','whatsapp',$1,$2,'Preciso de duas válvulas') RETURNING id`, [leader.data.id, requestId]);
    const details = await call(`/whatsapp/compras/${created.rows[0].id}`, 'GET', undefined, operator.data.token);
    assert.equal(details.status, 200); assert.equal(details.data.fotos[0].id, photoId); assert.match(details.data.transcricao, /válvulas/);
    let response = await fetch(base + `/whatsapp/midias/${photoId}`);
    assert.equal(response.status, 401);
    response = await fetch(base + `/whatsapp/midias/${photoId}`, { headers: { Authorization: `Bearer ${operator.data.token}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([255,216,255,0]));
    response = await fetch(base + '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=local-test-verify&hub.challenge=123');
    assert.equal(response.status, 200); assert.equal(await response.text(), '123');
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    response = await fetch(base + '/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'local-test-meta-secret').update(raw).digest('hex') }, body: raw });
    assert.equal(response.status, 503, 'disabled channel cannot process or acknowledge live messages');
    response = await fetch(base + '/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid json' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'JSON inválido' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await _test.pool.end();
  }
});
