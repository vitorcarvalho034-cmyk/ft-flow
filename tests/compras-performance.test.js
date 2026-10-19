'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

// Opt-in: this suite refuses any database other than its dedicated local sandbox DB.
const enabled = process.env.WHATSAPP_TEST_DB === '1';
const DB_NAME = 'ft_flow_performance_test';
const pgConfig = { host: '/var/run/postgresql', user: 'ubuntu', database: DB_NAME };

async function resetDatabase() {
  const client = new Client(pgConfig);
  await client.connect();
  try {
    const identity = (await client.query('SELECT current_database() AS name, inet_server_addr() AS address')).rows[0];
    assert.equal(identity.name, DB_NAME, 'reset is restricted to ft_flow_performance_test');
    assert.equal(identity.address, null, 'reset requires local Unix socket only');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

test('compras leves: payload sem blobs, escopos, cotações e foto inline protegida', { skip: !enabled }, async () => {
  await resetDatabase();
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  process.env.PGHOST = '/var/run/postgresql';
  process.env.PGUSER = 'ubuntu';
  process.env.PGDATABASE = DB_NAME;
  process.env.JWT_SECRET = 'compras-performance-test-jwt';
  process.env.FT_WHATSAPP_ENABLED = 'false';
  process.env.WHATSAPP_VERIFY_TOKEN = 'performance-test-verify';
  process.env.WHATSAPP_APP_SECRET = 'performance-test-secret';
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
    return { response, status: response.status, data: await response.json() };
  }
  try {
    const admin = await call('/auth/login', 'POST', { username: 'admin', password: '123' });
    assert.equal(admin.status, 200);
    const token = admin.data.token;
    // Simulate the additive columns from the separately mounted WhatsApp feature
    // without making this performance suite depend on that channel or any network.
    await query(`ALTER TABLE compras ADD COLUMN origem TEXT DEFAULT 'app'`);
    await query(`ALTER TABLE compras ADD COLUMN whatsapp_transcricao TEXT`);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64');
    const inlineJpeg = `data:image/jpeg;base64,${jpeg}`;
    const inlinePng = `data:image/png;base64,${png}`;
    const inserted = await query(`
      INSERT INTO compras
        (item,quantidade,unidade,categoria,destino,status,solicitante,descricao,foto_url,tipo_solicitacao,origem,whatsapp_transcricao)
      VALUES
        ('Inline seguro',1,'un','Teste','Oficina','Em cotação','Teste','descrição',$1,'compra','app','blob de transcrição que não deve ir à lista'),
        ('URL externa',2,'un','Teste','Estufa','Em cotação','Teste','externa','https://cdn.example.test/foto.jpg','lista','app',NULL),
        ('Status desconhecido',3,'un','Teste','Oficina','NovoFluxo','Teste','desconhecido',NULL,'compra','app',NULL),
        ('Histórico',1,'un','Teste','Oficina','Recebido','Teste','histórico',NULL,'compra','app',NULL),
        ('Comprado aguardando recebimento',1,'un','Teste','Oficina',' Comprado ','Teste','a caminho',NULL,'compra','app',NULL),
        ('Aprovado para comprar',1,'un','Teste','Oficina','Aprovado','Teste','autorizado',NULL,'compra','app',NULL),
        ('Origem WhatsApp',1,'un','Teste','Estufa','Em cotação','Líder','whatsapp',$2,'compra','whatsapp','transcrição confidencial'),
        ('Foto legada com rótulo incorreto',1,'un','Teste','Estufa','Em cotação','Teste','png com rótulo jpeg',$3,'compra','app',NULL),
        ('Inline inválido',1,'un','Teste','Estufa','Em cotação','Teste','inválida','data:image/jpeg;base64,SGVsbG8=','compra','app',NULL)
      RETURNING id,item`, [inlineJpeg, inlinePng, `data:image/jpeg;base64,${png}`]);
    const ids = Object.fromEntries(inserted.rows.map((row) => [row.item, row.id]));
    await query(`INSERT INTO cotacoes (compra_id,fornecedor,valor,observacao) VALUES ($1,'Fornecedor teste',42.5,'proposta')`, [ids['Inline seguro']]);

    // Legacy remains byte-for-byte conceptually compatible: the stored inline data
    // and transcript remain available only without leves=1.
    const legacy = await call('/compras?limit=2000', 'GET', undefined, token);
    assert.equal(legacy.status, 200);
    const legacyInline = legacy.data.data.find((row) => row.id === ids['Inline seguro']);
    assert.equal(legacyInline.foto_url, inlineJpeg);
    assert.match(legacyInline.origem, /app/);
    assert.equal(legacy.data.limit, 2000);

    const light = await call('/compras?leves=1&escopo=ativas&limit=-100&page=-3', 'GET', undefined, token);
    assert.equal(light.status, 200);
    assert.equal(light.data.limit, 20, 'negative limit falls back safely');
    assert.equal(light.data.page, 1, 'invalid page falls back safely');
    assert.ok(light.data.data.some((row) => row.id === ids['Status desconhecido']), 'unknown status stays in active scope');
    assert.ok(!light.data.data.some((row) => row.id === ids.Histórico), 'closed status is absent from active scope');
    assert.ok(light.data.data.some((row) => row.id === ids['Comprado aguardando recebimento']), 'purchased orders remain active until received');
    assert.ok(light.data.data.some((row) => row.id === ids['Aprovado para comprar']), 'approved orders remain active');
    const lightInline = light.data.data.find((row) => row.id === ids['Inline seguro']);
    const lightExternal = light.data.data.find((row) => row.id === ids['URL externa']);
    const lightWhatsApp = light.data.data.find((row) => row.id === ids['Origem WhatsApp']);
    assert.equal(lightInline.foto_url, null);
    assert.equal(lightInline.tem_foto, true);
    assert.equal(lightExternal.foto_url, 'https://cdn.example.test/foto.jpg');
    assert.equal(lightExternal.tem_foto, true);
    assert.equal(lightWhatsApp.foto_url, null);
    assert.equal(lightWhatsApp.tem_foto, true);
    assert.equal(lightWhatsApp.origem, 'whatsapp', 'origin is retained for list UI');
    assert.ok(!Object.hasOwn(lightInline, 'whatsapp_transcricao'), 'light summary never serializes transcript/blob column');

    const history = await call('/compras?leves=1&escopo=historico', 'GET', undefined, token);
    assert.deepEqual(history.data.data.map((row) => row.id), [ids.Histórico]);
    const detail = await call(`/compras/${ids['Inline seguro']}?leves=1`, 'GET', undefined, token);
    assert.equal(detail.data.foto_url, null);
    assert.equal(detail.data.tem_foto, true);
    assert.ok(!Object.hasOwn(detail.data, 'whatsapp_transcricao'));

    const open = await call('/cotacoes/abertas?leves=1&incluir_aprovadas=1', 'GET', undefined, token);
    assert.equal(open.status, 200);
    assert.ok(open.data.compras.some((row) => row.id === ids['Origem WhatsApp'] && row.origem === 'whatsapp'));
    assert.ok(open.data.compras.some((row) => row.id === ids['Aprovado para comprar']));
    assert.ok(!open.data.compras.some((row) => row.id === ids['Comprado aguardando recebimento']), 'purchased belongs to receiving queue, not quotes');
    assert.ok(open.data.compras.every((row) => !Object.hasOwn(row, 'whatsapp_transcricao')));
    assert.equal(open.data.compras.find((row) => row.id === ids['Inline seguro']).foto_url, null);
    assert.equal(open.data.cotacoes.length, 1, 'quotation rows remain in the combined response');

    let photo = await fetch(base + `/compras/${ids['Inline seguro']}/foto`);
    assert.equal(photo.status, 401, 'inline image requires a session');
    photo = await fetch(base + `/compras/${ids['Inline seguro']}/foto`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.match(photo.headers.get('cache-control'), /private.*no-store/);
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    photo = await fetch(base + `/compras/${ids['Foto legada com rótulo incorreto']}/foto`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(photo.status, 200, 'legacy image with wrong MIME label remains viewable');
    assert.equal(photo.headers.get('content-type'), 'image/png', 'real bytes determine the safe content type');
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), Buffer.from(png, 'base64'));
    photo = await fetch(base + `/compras/${ids['URL externa']}/foto`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(photo.status, 404, 'external URLs are never fetched/proxied');
    photo = await fetch(base + `/compras/${ids['Origem WhatsApp']}/foto`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(photo.status, 404, 'WhatsApp media has its own protected endpoint');
    photo = await fetch(base + `/compras/${ids['Inline inválido']}/foto`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(photo.status, 404, 'invalid image bytes are rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await _test.pool.end();
  }
});
