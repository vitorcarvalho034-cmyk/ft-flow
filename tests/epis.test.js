'use strict';

/**
 * Real PostgreSQL integration, opt-in using the existing project flag:
 * WHATSAPP_TEST_DB=1 node --test tests/epis.test.js
 * Fixed local socket + fixed ft_flow_epi_test database; no DATABASE_URL fallback.
 * Never imports the production api.js or changes any other database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { mountEpiRoutes } = require('../netlify/lib/epis');

const enabled = process.env.WHATSAPP_TEST_DB === '1';
const dbConfig = Object.freeze({ host: '/var/run/postgresql', database: 'ft_flow_epi_test', user: 'ubuntu', ssl: false });
const identities = {
  admin: { id: 1, username: 'admin', role: 'admin' },
  operator: { id: 2, username: 'operador', role: 'funcionario' },
  other: { id: 3, username: 'outro', role: 'funcionario' },
};
function makeApp(pool) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.user = identities[req.get('x-test-user')];
    next();
  });
  app.get('/unrelated', (_req, res) => res.json({ ok: true }));
  mountEpiRoutes(app, { pool });
  return app;
}
async function listen(app, t) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function call(base, method, path, data, user = 'admin') {
  const headers = { 'content-type': 'application/json' };
  if (user) headers['x-test-user'] = user;
  const response = await fetch(`${base}${path}`, { method, headers,
    body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, value: await response.json() };
}
function good(result, expected = 200) {
  assert.equal(result.status, expected, JSON.stringify(result.value));
  return result.value;
}
function bad(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.value));
  assert.equal(typeof result.value.error, 'string');
  return result.value;
}
async function resetDatabase(pool) {
  assert.equal(pool.options.host, '/var/run/postgresql');
  assert.equal(pool.options.database, 'ft_flow_epi_test');
  assert.equal(pool.options.user, 'ubuntu');
  const identity = (await pool.query(`SELECT current_database() AS name, current_user AS username, inet_server_addr() AS address`)).rows[0];
  assert.equal(identity.name, 'ft_flow_epi_test', 'destructive setup is limited to the dedicated EPI test database');
  assert.equal(identity.username, 'ubuntu');
  assert.equal(identity.address, null, 'test reset requires a local Unix socket');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  // Minimal host tables. EPI migration must never alter estoque/compras definitions.
  await pool.query(`CREATE TABLE usuarios (id SERIAL PRIMARY KEY, username TEXT, nome TEXT, role TEXT);
    INSERT INTO usuarios (id,username,nome,role) VALUES
      (1,'admin','Administrador Real','admin'),(2,'operador','Operador Compartilhado','funcionario'),(3,'outro','Outro Operador','funcionario');
    CREATE TABLE notificacoes (id SERIAL PRIMARY KEY,titulo TEXT,mensagem TEXT,tipo TEXT,destino_role TEXT,lida INTEGER DEFAULT 0,created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE estoque (id SERIAL PRIMARY KEY,nome TEXT,quantidade REAL);
    INSERT INTO estoque (nome,quantidade) VALUES ('Estoque intocável',123);
    CREATE TABLE compras (id SERIAL PRIMARY KEY,item TEXT,quantidade REAL,unidade TEXT,categoria TEXT,
      destino TEXT,status TEXT DEFAULT 'Em cotação',solicitante TEXT,descricao TEXT,tipo_solicitacao TEXT,status_lista TEXT,
      valor_unitario REAL DEFAULT 0,valor_total REAL DEFAULT 0,received_at TIMESTAMP,purchased_at TIMESTAMP,approved_at TIMESTAMP);
    CREATE TABLE lista_compras_itens (id SERIAL PRIMARY KEY,compra_id INTEGER REFERENCES compras(id),produto TEXT,
      quantidade REAL,unidade TEXT,fornecedor TEXT,preco REAL DEFAULT 0,created_at TIMESTAMP DEFAULT NOW());`);
}

// Cheap default-suite coverage: auth and unrelated requests never migrate or query DB.
test('EPI mounting is lazy; anonymous requests and unrelated routes do not access PostgreSQL', async t => {
  let queries = 0;
  const pool = { connect: async () => { queries++; throw new Error('must not connect'); },
    query: async () => { queries++; throw new Error('must not query'); } };
  const base = await listen(makeApp(pool), t);
  good(await call(base, 'GET', '/unrelated'));
  bad(await call(base, 'GET', '/epis/resumo', undefined, null), 401);
  bad(await call(base, 'POST', '/epis/itens', { nome: 'Teste' }, null), 401);
  assert.equal(queries, 0);
});

test('EPI PostgreSQL: stock, requests, audit, permissions, concurrency, snapshots and purchase linkage', { skip: !enabled }, async t => {
  const pool = new Pool(dbConfig);
  t.after(async () => { await pool.end(); });
  await resetDatabase(pool);
  const base = await listen(makeApp(pool), t);
  const secondBase = await listen(makeApp(pool), t);
  const api = (method, path, data, user) => call(base, method, path, data, user);
  const count = async (table, where = 'TRUE', params = []) =>
    (await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;
  const balance = async id => (await pool.query('SELECT saldo FROM ft_epi_itens WHERE id=$1', [id])).rows[0].saldo;
  const create = async (name, saldo = 0, extra = {}) => good(await api('POST', '/epis/itens',
    { nome: name, tamanho: '', unidade: 'un', minimo: 0, saldo_inicial: saldo, chave: randomUUID(), ...extra }), 201);
  const order = async (itens, extra = {}, user = 'operator') => good(await api('POST', '/epis/solicitacoes',
    { funcionario: 'Colaborador da Equipe', setor: 'Jardins', motivo: 'Reposição', itens, chave: randomUUID(), ...extra }, user), 201);
  const detail = async (id, user = 'admin') => good(await api('GET', `/epis/solicitacoes/${id}`, undefined, user));
  const approve = async id => good(await api('POST', `/epis/solicitacoes/${id}/aprovar`, {}));
  const deliver = async id => api('POST', `/epis/solicitacoes/${id}/entregar`, { observacao: 'Entrega física confirmada' });
  let gloves, boots, primary;

  await t.test('parallel cold starts migrate additively; only authenticated EPI initializes its schema', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      call(i % 2 ? base : secondBase, 'GET', '/epis/resumo')));
    for (const result of results) assert.deepEqual(good(result), { itens_ativos: 0, estoque_baixo: 0, pendentes: 0, aprovadas: 0, entregues: 0 });
    const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ft_epi_%'`)).rows;
    assert.equal(tables.length, 7);
    assert.equal((await pool.query('SELECT quantidade FROM estoque')).rows[0].quantidade, 123);
    assert.equal(await count('compras'), 0);
  });

  await t.test('explicit admin permissions, strict integers, mandatory UUID and duplicate identity', async () => {
    bad(await api('POST', '/epis/itens', { nome: 'Sem permissão', chave: randomUUID() }, 'operator'), 403);
    for (const saldo of [true, null, '2', '', -1, 0.5, 1_000_001, 1e100]) {
      bad(await api('POST', '/epis/itens', { nome: 'Inválido', saldo_inicial: saldo, chave: randomUUID() }), 400);
    }
    bad(await api('POST', '/epis/itens', { nome: 'Sem chave' }), 400);
    bad(await api('POST', '/epis/itens', { nome: 'Data inválida', validade: '2026-02-30', chave: randomUUID() }), 400);
    bad(await api('POST', '/epis/itens', { nome: 'Unidade inválida', unidade: 'kg', chave: randomUUID() }), 400);
    bad(await api('POST', '/epis/itens', { nome: 'Booleano inválido', ativo: 'true', chave: randomUUID() }), 400);
    gloves = await create('Luva de proteção', 10, { tamanho: 'M', unidade: 'par', ca: 'CA-123', validade: '2028-01-31', minimo: 3 });
    assert.equal(gloves.saldo, 10);
    assert.equal(gloves.validade, '2028-01-31');
    const key = randomUUID(), payload = { nome: 'Bota', tamanho: '42', unidade: 'par', saldo_inicial: 3, chave: key };
    const retries = await Promise.all(Array.from({ length: 4 }, () => api('POST', '/epis/itens', payload)));
    boots = good(retries[0], 201);
    retries.forEach(result => assert.equal(good(result, 201).id, boots.id));
    assert.equal(await count('ft_epi_movimentacoes', 'item_id=$1', [boots.id]), 1);
    bad(await api('POST', '/epis/itens', { ...payload, saldo_inicial: 4 }), 409);
    bad(await api('POST', '/epis/itens', { ...payload, nome: ' bOTA ', chave: randomUUID() }), 409);
    bad(await api('PUT', `/epis/itens/${gloves.id}`, { unidade: 'un' }), 409);
    assert.equal(await balance(gloves.id), 10);
    assert.equal(good(await api('GET', '/epis/itens')).find(item => item.id === gloves.id).unidade, 'par');
    assert.equal((await pool.query('SELECT ator_nome,ator_id FROM ft_epi_movimentacoes WHERE item_id=$1', [gloves.id])).rows[0].ator_nome, 'Administrador Real');
    good(await api('GET', '/epis/itens', undefined, 'operator'));
    bad(await api('GET', '/epis/itens?incluir_inativos=1', undefined, 'operator'), 403);
  });

  await t.test('initial item+movement+audit+idempotency commits atomically and retries after rollback', async () => {
    await pool.query(`CREATE FUNCTION epi_test_fail_initial() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.tipo='inicial' AND NEW.quantidade=77777 THEN RAISE EXCEPTION 'sensitive SQL synthetic failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER epi_test_fail_initial BEFORE INSERT ON ft_epi_movimentacoes FOR EACH ROW EXECUTE FUNCTION epi_test_fail_initial()`);
    const key = randomUUID(), payload = { nome: 'Inicial rollback', saldo_inicial: 77777, chave: key };
    const error = bad(await api('POST', '/epis/itens', payload), 500);
    assert.equal(error.error, 'Não foi possível concluir a operação de EPI');
    assert.equal(await count('ft_epi_itens', 'nome=$1', [payload.nome]), 0);
    assert.equal(await count('ft_epi_chaves', 'chave=$1', [key]), 0);
    await pool.query('DROP TRIGGER epi_test_fail_initial ON ft_epi_movimentacoes; DROP FUNCTION epi_test_fail_initial()');
    assert.equal(good(await api('POST', '/epis/itens', payload), 201).saldo, 77777);
  });

  await t.test('shared operator can order for a named colleague without debit; validation and owner boundaries', async () => {
    const invalids = [true, null, '2', 0, -1, 1.2, 1_000_001, 1e100];
    for (const quantidade of invalids) bad(await api('POST', '/epis/solicitacoes', {
      funcionario: 'Nome', itens: [{ item_id: gloves.id, quantidade }], chave: randomUUID() }, 'operator'), 400);
    for (const item_id of [String(gloves.id), true, null, 0]) bad(await api('POST', '/epis/solicitacoes', {
      funcionario: 'Nome', itens: [{ item_id, quantidade: 1 }], chave: randomUUID() }, 'operator'), 400);
    bad(await api('POST', '/epis/solicitacoes', { funcionario: ' ', itens: [{ item_id: gloves.id, quantidade: 1 }], chave: randomUUID() }, 'operator'), 400);
    bad(await api('POST', '/epis/solicitacoes', { funcionario: 'Nome', itens: [], chave: randomUUID() }, 'operator'), 400);
    bad(await api('POST', '/epis/solicitacoes', { funcionario: 'Nome', itens: Array.from({ length: 31 }, () => ({ item_id: gloves.id, quantidade: 1 })), chave: randomUUID() }, 'operator'), 400);
    bad(await api('POST', '/epis/solicitacoes', { funcionario: 'Nome', itens: [{ item_id: gloves.id, quantidade: 1 }, { item_id: gloves.id, quantidade: 2 }], chave: randomUUID() }, 'operator'), 400);
    bad(await api('POST', '/epis/solicitacoes', { funcionario: 'Nome', itens: [{ item_id: 999999, quantidade: 1 }], chave: randomUUID() }, 'operator'), 404);
    const key = randomUUID(), payload = { funcionario: 'Maria da Equipe', setor: 'Jardins Norte', motivo: 'Troca por desgaste', observacao: 'Turno manhã',
      itens: [{ item_id: gloves.id, quantidade: 4 }, { item_id: boots.id, quantidade: 2 }], chave: key };
    const notificationBefore = await count('notificacoes');
    primary = good(await api('POST', '/epis/solicitacoes', payload, 'operator'), 201);
    const repeated = good(await api('POST', '/epis/solicitacoes', payload, 'operator'), 201);
    assert.equal(repeated.id, primary.id);
    bad(await api('POST', '/epis/solicitacoes', { ...payload, funcionario: 'Outra' }, 'operator'), 409);
    assert.equal(await balance(gloves.id), 10);
    assert.equal(await balance(boots.id), 3);
    assert.equal(await count('notificacoes'), notificationBefore + 1);
    const record = await detail(primary.id, 'operator');
    assert.equal(record.funcionario, 'Maria da Equipe');
    assert.equal(record.criado_por_nome, 'Operador Compartilhado');
    assert.equal(record.status, 'pendente');
    assert.equal(record.itens.length, 2);
    assert.equal(record.eventos.length, 1);
    assert.equal(record.eventos[0].ator_nome, 'Operador Compartilhado');
    bad(await api('GET', `/epis/solicitacoes/${primary.id}`, undefined, 'other'), 404);
    assert.equal(good(await api('GET', '/epis/solicitacoes', undefined, 'other')).total, 0);
    assert.equal(good(await api('GET', '/epis/resumo', undefined, 'other')).pendentes, 0);
    for (const action of ['aprovar', 'rejeitar', 'entregar', 'gerar-compra']) bad(await api('POST', `/epis/solicitacoes/${primary.id}/${action}`, { observacao: 'Teste' }, 'operator'), 403);
    bad(await api('POST', `/epis/solicitacoes/${primary.id}/cancelar`, { observacao: 'Teste' }, 'other'), 404);
    bad(await api('POST', `/epis/itens/${gloves.id}/movimentacoes`, { tipo: 'entrada', quantidade: 1, chave: randomUUID() }, 'operator'), 403);
    bad(await api('PUT', `/epis/itens/${gloves.id}`, { nome: 'Alteração' }, 'operator'), 403);
    bad(await api('GET', `/epis/itens/${gloves.id}/historico`, undefined, 'operator'), 403);
  });

  await t.test('editing preserves snapshot; approving never debits and delivery debits exactly once', async () => {
    good(await api('PUT', `/epis/itens/${gloves.id}`, { nome: 'Luva modelo novo', tamanho: 'G', ca: 'CA-NOVO', minimo: 5 }));
    bad(await api('PUT', `/epis/itens/${gloves.id}`, { saldo: 900 }), 400);
    const snapshot = (await detail(primary.id)).itens.find(item => item.item_id === gloves.id);
    assert.equal(snapshot.nome, 'Luva de proteção');
    assert.equal(snapshot.tamanho, 'M');
    assert.equal(snapshot.ca, 'CA-123');
    assert.equal((await pool.query('SELECT validade::text AS validade FROM ft_epi_solicitacao_itens WHERE solicitacao_id=$1 AND item_id=$2', [primary.id, gloves.id])).rows[0].validade, '2028-01-31');
    bad(await deliver(primary.id), 409);
    const approved = await approve(primary.id);
    assert.equal(approved.status, 'aprovado');
    assert.ok(approved.approved_at);
    await approve(primary.id);
    assert.equal(await balance(gloves.id), 10);
    assert.equal(await balance(boots.id), 3);
    assert.equal((await detail(primary.id)).eventos.filter(event => event.acao === 'aprovar').length, 1);
    bad(await api('POST', `/epis/solicitacoes/${primary.id}/cancelar`, { observacao: 'Eu quero cancelar' }, 'operator'), 409);
    const deliveries = await Promise.all(Array.from({ length: 5 }, () => deliver(primary.id)));
    const delivered = good(deliveries[0]);
    assert.equal(delivered.status, 'entregue');
    deliveries.forEach(result => assert.deepEqual(good(result), delivered));
    assert.equal(await balance(gloves.id), 6);
    assert.equal(await balance(boots.id), 1);
    assert.equal(await count('ft_epi_movimentacoes', 'solicitacao_id=$1', [primary.id]), 2);
    assert.equal((await detail(primary.id)).eventos.filter(event => event.acao === 'entregar').length, 1);
    await approve(primary.id); // Approval retry after physical delivery remains harmless.
    for (const action of ['rejeitar', 'cancelar']) bad(await api('POST', `/epis/solicitacoes/${primary.id}/${action}`, { observacao: 'Terminal' }), 409);
    const history = good(await api('GET', `/epis/itens/${gloves.id}/historico`));
    assert.equal(history.movimentacoes[0].tipo, 'entrega');
    assert.equal(history.movimentacoes[0].quantidade, -4);
    assert.equal(history.movimentacoes[0].saldo_antes, 10);
    assert.equal(history.movimentacoes[0].saldo_depois, 6);
    assert.equal(history.movimentacoes[0].solicitacao_id, primary.id);
  });

  await t.test('competing deliveries lock items and cannot make stock negative', async () => {
    const helmet = await create('Capacete concorrência', 5);
    const first = await order([{ item_id: helmet.id, quantidade: 4 }]);
    const second = await order([{ item_id: helmet.id, quantidade: 4 }]);
    await Promise.all([approve(first.id), approve(second.id)]);
    const results = await Promise.all([deliver(first.id), deliver(second.id)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(await balance(helmet.id), 1);
    assert.equal(await count('ft_epi_movimentacoes', "item_id=$1 AND tipo='entrega'", [helmet.id]), 1);
    const statuses = await Promise.all([detail(first.id), detail(second.id)]);
    assert.deepEqual(statuses.map(request => request.status).sort(), ['aprovado', 'entregue']);
  });

  await t.test('multi-line shortage and mid-delivery database failure roll back all debits', async () => {
    const enough = await create('Rollback primeiro', 8), short = await create('Rollback segundo', 0);
    const request = await order([{ item_id: enough.id, quantidade: 3 }, { item_id: short.id, quantidade: 2 }]);
    await approve(request.id);
    bad(await deliver(request.id), 409);
    assert.equal(await balance(enough.id), 8);
    assert.equal(await balance(short.id), 0);
    assert.equal(await count('ft_epi_movimentacoes', 'solicitacao_id=$1', [request.id]), 0);
    assert.equal((await detail(request.id)).status, 'aprovado');
    good(await api('POST', `/epis/itens/${short.id}/movimentacoes`, { tipo: 'entrada', quantidade: 2, chave: randomUUID() }));
    await pool.query(`CREATE FUNCTION epi_test_fail_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.tipo='entrega' AND NEW.item_id=${short.id} THEN RAISE EXCEPTION 'synthetic delivery failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER epi_test_fail_delivery BEFORE INSERT ON ft_epi_movimentacoes FOR EACH ROW EXECUTE FUNCTION epi_test_fail_delivery()`);
    bad(await deliver(request.id), 500);
    assert.equal(await balance(enough.id), 8);
    assert.equal(await balance(short.id), 2);
    assert.equal(await count('ft_epi_movimentacoes', 'solicitacao_id=$1', [request.id]), 0);
    assert.equal((await detail(request.id)).eventos.filter(event => event.acao === 'entregar').length, 0);
    await pool.query('DROP TRIGGER epi_test_fail_delivery ON ft_epi_movimentacoes; DROP FUNCTION epi_test_fail_delivery()');
    good(await deliver(request.id));
    assert.equal(await balance(enough.id), 5);
    assert.equal(await balance(short.id), 0);
  });

  await t.test('stock entries/adjustments are strict, atomic, idempotent by actor+route and never negative', async () => {
    const item = await create('Ajustes', 2);
    const route = `/epis/itens/${item.id}/movimentacoes`;
    for (const quantidade of [true, null, '1', 0, -1, 0.2, 1_000_001]) bad(await api('POST', route, { tipo: 'entrada', quantidade, chave: randomUUID() }), 400);
    bad(await api('POST', route, { tipo: 'ajuste', quantidade: -1, chave: randomUUID() }), 400);
    bad(await api('POST', route, { tipo: 'ajuste', quantidade: 0, observacao: 'Motivo', chave: randomUUID() }), 400);
    const key = randomUUID(), payload = { tipo: 'entrada', quantidade: 3, observacao: 'Recebimento físico', chave: key };
    const retries = await Promise.all(Array.from({ length: 6 }, () => api('POST', route, payload)));
    const response = good(retries[0]);
    retries.forEach(result => assert.deepEqual(good(result), response));
    assert.equal(await balance(item.id), 5);
    bad(await api('POST', route, { ...payload, quantidade: 4 }), 409);
    assert.equal(await count('ft_epi_movimentacoes', 'item_id=$1', [item.id]), 2);
    const other = await create('Ajustes outro item', 1);
    good(await api('POST', `/epis/itens/${other.id}/movimentacoes`, payload)); // key is route-scoped
    assert.equal(await balance(other.id), 4);
    bad(await api('POST', route, { tipo: 'ajuste', quantidade: -6, observacao: 'Contagem', chave: randomUUID() }), 409);
    good(await api('POST', route, { tipo: 'ajuste', quantidade: -5, observacao: 'Contagem física', chave: randomUUID() }));
    assert.equal(await balance(item.id), 0);
    const concurrent = await Promise.all(Array.from({ length: 2 }, () => api('POST', `/epis/itens/${other.id}/movimentacoes`,
      { tipo: 'ajuste', quantidade: -3, observacao: 'Correção simultânea', chave: randomUUID() })));
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    assert.equal(await balance(other.id), 1);
  });

  await t.test('archiving preserves history and snapshot, blocks orders/delivery; inactive identity can coexist', async () => {
    const item = await create('Óculos arquivado', 5);
    const request = await order([{ item_id: item.id, quantidade: 1 }]);
    await approve(request.id);
    good(await api('PUT', `/epis/itens/${item.id}`, { ativo: false, observacoes: 'Modelo retirado' }));
    assert.ok(!good(await api('GET', '/epis/itens')).some(row => row.id === item.id));
    assert.ok(good(await api('GET', '/epis/itens?incluir_inativos=1')).some(row => row.id === item.id && row.ativo === false));
    assert.equal((await detail(request.id)).itens[0].ativo, false);
    assert.equal(good(await api('GET', `/epis/itens/${item.id}/historico`)).total, 1);
    bad(await api('POST', '/epis/solicitacoes', { funcionario: 'Nome', itens: [{ item_id: item.id, quantidade: 1 }], chave: randomUUID() }, 'operator'), 409);
    bad(await deliver(request.id), 409);
    assert.equal(await balance(item.id), 5);
    bad(await api('POST', `/epis/itens/${item.id}/movimentacoes`, { tipo: 'entrada', quantidade: 1, chave: randomUUID() }), 409);
    const replacement = await create('Óculos arquivado', 0);
    assert.notEqual(replacement.id, item.id);
    bad(await api('PUT', `/epis/itens/${item.id}`, { ativo: true }), 409);
    good(await api('PUT', `/epis/itens/${item.id}`, { nome: 'Óculos antigo', ativo: true }));
    good(await deliver(request.id));
    assert.equal((await detail(request.id)).itens[0].nome, 'Óculos arquivado');
  });

  await t.test('rejection/cancellation require reasons, enforce transition rules, and audit only once', async () => {
    const first = await order([{ item_id: gloves.id, quantidade: 1 }]);
    bad(await api('POST', `/epis/solicitacoes/${first.id}/rejeitar`, {}), 400);
    const rejection = { observacao: 'Modelo inadequado' };
    good(await api('POST', `/epis/solicitacoes/${first.id}/rejeitar`, rejection));
    good(await api('POST', `/epis/solicitacoes/${first.id}/rejeitar`, rejection));
    assert.equal((await detail(first.id)).eventos.filter(event => event.acao === 'rejeitar').length, 1);
    bad(await approveResult(first.id), 409);
    const second = await order([{ item_id: gloves.id, quantidade: 1 }]);
    bad(await api('POST', `/epis/solicitacoes/${second.id}/cancelar`, {}, 'operator'), 400);
    good(await api('POST', `/epis/solicitacoes/${second.id}/cancelar`, { observacao: 'Não preciso mais' }, 'operator'));
    assert.equal((await detail(second.id)).status, 'cancelado');
    const third = await order([{ item_id: gloves.id, quantidade: 1 }]);
    await approve(third.id);
    good(await api('POST', `/epis/solicitacoes/${third.id}/rejeitar`, rejection));
    const fourth = await order([{ item_id: gloves.id, quantidade: 1 }]);
    await approve(fourth.id);
    good(await api('POST', `/epis/solicitacoes/${fourth.id}/cancelar`, { observacao: 'Cancelamento administrativo' }));
    const rows = (await pool.query('SELECT rejected_at,rejected_by FROM ft_epi_solicitacoes WHERE id=$1', [first.id])).rows[0];
    assert.ok(rows.rejected_at);
    assert.equal(rows.rejected_by, '1');
    function approveResult(id) { return api('POST', `/epis/solicitacoes/${id}/aprovar`, {}); }
  });

  await t.test('history searches snapshot/employee/sector/ID, paginates consistently and remains owner-scoped', async () => {
    const primarySearch = good(await api('GET', '/epis/solicitacoes?busca=Maria%20da%20Equipe&limit=1'));
    assert.equal(primarySearch.total, 1);
    assert.equal(primarySearch.data[0].id, primary.id);
    const snapshotSearch = good(await api('GET', '/epis/solicitacoes?busca=Luva%20de%20prote%C3%A7%C3%A3o'));
    assert.ok(snapshotSearch.data.some(row => row.id === primary.id));
    assert.ok(good(await api('GET', '/epis/solicitacoes?busca=Jardins%20Norte')).data.some(row => row.id === primary.id));
    assert.ok(good(await api('GET', `/epis/solicitacoes?busca=${primary.id}`)).data.some(row => row.id === primary.id));
    const otherOrder = await order([{ item_id: boots.id, quantidade: 1 }], { funcionario: 'Outro dono paginado' }, 'other');
    const own = good(await api('GET', '/epis/solicitacoes?status=todas', undefined, 'other'));
    assert.equal(own.total, 1);
    assert.equal(own.data[0].id, otherOrder.id);
    assert.equal(good(await api('GET', '/epis/resumo', undefined, 'other')).pendentes, 1);
    const first = good(await api('GET', '/epis/solicitacoes?page=1&limit=2'));
    const second = good(await api('GET', '/epis/solicitacoes?page=2&limit=2'));
    assert.equal(first.total, second.total);
    assert.equal(first.pages, Math.ceil(first.total / 2));
    assert.equal(first.page, 1);
    assert.equal(second.page, 2);
    assert.ok(first.data.every(a => second.data.every(b => a.id !== b.id)));
    const empty = good(await api('GET', '/epis/solicitacoes?page=100&limit=2'));
    assert.equal(empty.total, first.total);
    assert.deepEqual(empty.data, []);
    const quoted = await order([{ item_id: boots.id, quantidade: 1 }], { funcionario: "O'Brien 50% _ Equipe" });
    assert.equal(good(await api('GET', '/epis/solicitacoes?busca=50%25%20_')).data[0].id, quoted.id);
    assert.equal(good(await api('GET', '/epis/solicitacoes?busca=%27%20OR%201%3D1--')).total, 0);
    bad(await api('GET', '/epis/solicitacoes?status=qualquer'), 400);
    bad(await api('GET', '/epis/solicitacoes?page=0'), 400);
    bad(await api('GET', '/epis/solicitacoes?limit=1.5'), 400);
    assert.ok(good(await api('GET', '/epis/solicitacoes?limit=100000')).data.length <= 100);
    assert.equal(good(await api('GET', '/epis/solicitacoes?status=entregue')).data.every(row => row.status === 'entregue'), true);
    const history = good(await api('GET', `/epis/itens/${gloves.id}/historico?page=2&limit=1`));
    assert.equal(history.page, 2);
    assert.equal(history.movimentacoes.length, 1);
    assert.equal(history.pages, history.total);
    bad(await api('GET', '/epis/itens/999999/historico'), 404);
    bad(await api('GET', '/epis/solicitacoes/abc'), 400);
  });

  await t.test('ADM manually generates one snapshot-based purchase, never stock/debit/status change or external notification', async () => {
    const item = await create('Protetor compra original', 0, { tamanho: 'P', unidade: 'caixa', ca: '111' });
    const request = await order([{ item_id: item.id, quantidade: 3 }], { funcionario: 'João Compras', setor: 'Oficina', motivo: 'Sem estoque' });
    const path = `/epis/solicitacoes/${request.id}/gerar-compra`;
    bad(await api('POST', path, { itens: [{ item_id: item.id, quantidade: 0 }] }), 400);
    bad(await api('POST', path, { itens: [{ item_id: item.id, quantidade: '2' }] }), 400);
    bad(await api('POST', path, { itens: [{ item_id: boots.id, quantidade: 2 }] }), 400);
    bad(await api('POST', path, { itens: [{ item_id: item.id, quantidade: 1 }, { item_id: item.id, quantidade: 1 }] }), 400);
    bad(await api('POST', path, { itens: [{ item_id: item.id, quantidade: 2 }] }, 'operator'), 403);
    bad(await api('PUT', `/epis/itens/${item.id}`, { nome: 'Protetor alterado', tamanho: 'G', ca: '222', unidade: 'un' }), 409);
    good(await api('PUT', `/epis/itens/${item.id}`, { nome: 'Protetor alterado', tamanho: 'G', ca: '222' }));
    const beforeNotifications = await count('notificacoes');
    const payload = { itens: [{ item_id: item.id, quantidade: 7 }], observacao: 'ADM decidiu comprar margem adicional' };
    const retries = await Promise.all(Array.from({ length: 4 }, () => api('POST', path, payload)));
    const purchaseId = good(retries[0]).compra_id;
    retries.forEach(result => assert.equal(good(result).compra_id, purchaseId));
    assert.equal(await count('compras'), 1);
    assert.equal(await count('lista_compras_itens', 'compra_id=$1', [purchaseId]), 1);
    assert.equal(await count('notificacoes'), beforeNotifications + 1);
    const purchase = (await pool.query('SELECT * FROM compras WHERE id=$1', [purchaseId])).rows[0];
    assert.equal(purchase.item, `Reposição de EPI — solicitação #${request.id}`);
    assert.equal(purchase.status, 'Em cotação');
    assert.equal(purchase.status_lista, 'pronta');
    assert.equal(purchase.tipo_solicitacao, 'lista');
    assert.equal(purchase.categoria, 'EPI');
    assert.equal(purchase.destino, 'Estoque de EPI');
    assert.equal(purchase.solicitante, 'Administrador Real');
    assert.match(purchase.descricao, /João Compras/);
    assert.match(purchase.descricao, /Oficina/);
    assert.equal(purchase.received_at, null);
    const line = (await pool.query('SELECT * FROM lista_compras_itens WHERE compra_id=$1', [purchaseId])).rows[0];
    assert.equal(line.produto, 'Protetor compra original — P — CA 111');
    assert.equal(line.unidade, 'caixa');
    assert.equal(line.quantidade, 7);
    assert.equal(line.preco, 0);
    assert.equal(line.fornecedor, '');
    assert.equal(await balance(item.id), 0);
    assert.equal((await detail(request.id)).status, 'pendente');
    assert.equal((await detail(request.id)).compra_id, purchaseId);
    assert.equal((await detail(request.id)).eventos.filter(event => event.acao === 'compra_solicitada').length, 1);
    assert.match((await detail(request.id)).eventos.find(event => event.acao === 'compra_solicitada').observacao, new RegExp(`#${purchaseId}`));
    assert.equal(good(await api('GET', `/epis/solicitacoes?busca=Jo%C3%A3o%20Compras`)).data[0].compra_id, purchaseId);
    await approve(request.id);
    const changedRetry = good(await api('POST', path, { itens: [{ item_id: item.id, quantidade: 8 }] }));
    assert.equal(changedRetry.ja_existente, true);
    assert.equal(changedRetry.compra_id, purchaseId);
    good(await api('POST', `/epis/solicitacoes/${request.id}/rejeitar`, { observacao: 'Pedido substituído' }));
    assert.equal(good(await api('POST', path, payload)).compra_id, purchaseId); // terminal existing retry is harmless
    bad(await api('POST', `/epis/solicitacoes/${primary.id}/gerar-compra`, { itens: [{ item_id: gloves.id, quantidade: 1 }] }), 409);
    assert.equal(await count('compras'), 1);
    assert.equal((await pool.query('SELECT quantidade FROM estoque')).rows[0].quantidade, 123);
  });

  await t.test('purchase failure atomically rolls back linked compra/list/event/notification, allowing retry', async () => {
    const request = await order([{ item_id: boots.id, quantidade: 1 }]);
    const path = `/epis/solicitacoes/${request.id}/gerar-compra`, payload = { itens: [{ item_id: boots.id, quantidade: 4 }], observacao: 'Falha controlada' };
    const beforePurchases = await count('compras'), beforeNotifications = await count('notificacoes');
    await pool.query(`CREATE FUNCTION epi_test_fail_purchase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic purchase line failure'; END $$;
      CREATE TRIGGER epi_test_fail_purchase BEFORE INSERT ON lista_compras_itens FOR EACH ROW EXECUTE FUNCTION epi_test_fail_purchase()`);
    bad(await api('POST', path, payload), 500);
    assert.equal(await count('compras'), beforePurchases);
    assert.equal(await count('notificacoes'), beforeNotifications);
    assert.equal((await detail(request.id)).compra_id, null);
    assert.equal((await detail(request.id)).eventos.filter(event => event.acao === 'compra_solicitada').length, 0);
    await pool.query('DROP TRIGGER epi_test_fail_purchase ON lista_compras_itens; DROP FUNCTION epi_test_fail_purchase()');
    good(await api('POST', path, payload));
    assert.equal(await count('compras'), beforePurchases + 1);
    assert.equal(await count('ft_epi_itens', 'saldo<0'), 0);
  });
});
