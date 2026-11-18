'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const enabled = process.env.WHATSAPP_TEST_DB === '1';
test('Assistente no aplicativo: autenticação, alternativa manual, compra única e anexos privados', { skip: !enabled }, async () => {
  for (const key of Object.keys(process.env)) {
    if (/^(DATABASE_URL|SMTP_|ADMIN_WHATSAPP|CALLMEBOT|WHATSAPP_|FT_ASSISTENTE_)/.test(key)) delete process.env[key];
  }
  process.env.PGHOST = '/var/run/postgresql';
  process.env.PGUSER = 'ubuntu';
  process.env.PGDATABASE = 'ft_flow_assistente_http_test';
  process.env.JWT_SECRET = 'assistente-http-local-only';
  process.env.FT_WHATSAPP_ENABLED = 'false';
  const { _test } = require('../netlify/functions/api');
  const server = _test.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, token, method = 'GET', body) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers };
  }
  const login = (username) => call('/auth/login', null, 'POST', { username, password: '123' });
  try {
    const admin = await login('admin'), operator = await login('operador');
    assert.equal(admin.status, 200); assert.equal(operator.status, 200);
    const a = admin.data.token, b = operator.data.token;
    await _test.pool.query(`INSERT INTO usuarios(username,password,nome,role) VALUES('operador-assistente-teste',$1,'Outro operador','funcionario') ON CONFLICT(username) DO UPDATE SET password=EXCLUDED.password`, [await bcrypt.hash('123', 10)]);
    const another = await login('operador-assistente-teste');
    assert.equal(another.status, 200);
    assert.equal((await call('/assistente/status')).status, 401);
    assert.equal((await call('/assistente/interpretar', null, 'POST', { texto: 'Duas luvas' })).status, 401);
    const status = await call('/assistente/status', b);
    assert.equal(status.status, 200); assert.equal(status.data.configurado, false);
    const unavailable = await call('/assistente/interpretar', b, 'POST', { texto: 'Preciso de duas luvas para a oficina', consentimento_ia: true });
    assert.equal(unavailable.status, 503, 'missing AI key must not pretend to understand the request');
    const requestId = crypto.randomUUID(), name = `Solicitação manual ${requestId}`;
    const draft = {
      nome_lista: name, categoria: 'Outros', destino: 'Oficina', uso: 'Proteção durante o trabalho', observacoes: 'Teste somente local',
      itens: [
        { produto: 'Luva de proteção M', quantidade: 2, unidade: 'par' },
        { produto: 'Protetor auricular', quantidade: 3, unidade: 'un' },
      ],
    };
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA5sAAAAASUVORK5CYII=';
    const body = { request_id: requestId, rascunho: draft, transcricao: 'Solicitação de teste, revisada pelo operador.', fotos: [{ base64: png, mime_type: 'image/png' }] };
    const noDecision = await call('/assistente/confirmar', b, 'POST', { ...body, rascunho: { ...draft, itens: [{ produto: 'Luva', quantidade: null, unidade: 'par' }] } });
    assert.equal(noDecision.status, 400, 'missing quantity must not be assumed');
    assert.equal((await _test.pool.query('SELECT COUNT(*)::int n FROM compras WHERE item=$1', [name])).rows[0].n, 0);
    const confirmed = await Promise.all([call('/assistente/confirmar', b, 'POST', body), call('/assistente/confirmar', b, 'POST', body)]);
    for (const response of confirmed) assert.ok([200, 201].includes(response.status), JSON.stringify(response.data));
    assert.equal(confirmed[0].data.compra_id, confirmed[1].data.compra_id);
    const id = confirmed[0].data.compra_id;
    assert.ok(id);
    assert.equal((await _test.pool.query('SELECT COUNT(*)::int n FROM compras WHERE item=$1', [name])).rows[0].n, 1);
    const purchase = await call(`/compras/${id}?leves=1`, a);
    assert.equal(purchase.status, 200); assert.equal(purchase.data.origem, 'assistente');
    assert.equal(purchase.data.status, 'Em cotação'); assert.equal(purchase.data.tipo_solicitacao, 'lista');
    assert.equal(purchase.data.categoria, 'Outros'); assert.equal(purchase.data.destino, 'Oficina');
    assert.equal(JSON.stringify(purchase.data).includes(png), false, 'light purchase data must never contain image bytes');
    const items = await call(`/compras/${id}/itens`, a);
    assert.equal(items.status, 200); assert.equal(items.data.length, 2);
    assert.deepEqual(items.data.map((x) => [x.quantidade, x.unidade]), [[2, 'par'], [3, 'un']]);
    const details = await call(`/assistente/compras/${id}`, b);
    assert.equal(details.status, 200); assert.equal(details.data.origem, 'assistente');
    assert.equal(details.data.fotos.length, 1); assert.match(details.data.transcricao, /revisada/);
    assert.deepEqual(details.data.itens.map((item) => [item.produto, item.quantidade, item.unidade]), draft.itens.map((item) => [item.produto, item.quantidade, item.unidade]));
    assert.ok(details.data.solicitante);
    assert.equal((await call(`/assistente/compras/${id}`, a)).status, 200);
    assert.ok([403, 404].includes((await call(`/assistente/compras/${id}`, another.data.token)).status));
    const photo = details.data.fotos[0].id;
    assert.equal((await call(`/assistente/midias/${photo}`)).status, 401);
    assert.ok([403, 404].includes((await call(`/assistente/midias/${photo}`, another.data.token)).status));
    const privatePhoto = await call(`/assistente/midias/${photo}`, a);
    assert.equal(privatePhoto.status, 200); assert.match(privatePhoto.headers.get('content-type'), /^image\/png/);
    assert.match(privatePhoto.headers.get('cache-control'), /no-store/);
    assert.deepEqual(privatePhoto.data, Buffer.from(png, 'base64'));
    assert.equal((await call('/whatsapp/status', a)).status, 410);
    assert.equal((await call('/whatsapp/webhook', null, 'POST', {})).status, 410);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await _test.pool.end();
  }
});
