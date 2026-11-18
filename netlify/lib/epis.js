'use strict';

const express = require('express');
const { createHash } = require('node:crypto');

const MAX_QUANTITY = 1_000_000;
const MAX_STOCK = 2_147_483_647;
const STATUSES = ['pendente', 'aprovado', 'entregue', 'rejeitado', 'cancelado'];
const ITEM_COLUMNS = 'id,nome,tamanho,unidade,ca,validade::text AS validade,minimo,saldo,ativo,observacoes';

class EpiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new EpiError(status, message); };

function integer(value, label, min = 0, max = MAX_QUANTITY) {
  // JSON numbers only: do not coerce strings, booleans, empty values, or decimals.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(400, `${label} deve ser um número inteiro entre ${min} e ${max}`);
  }
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) fail(400, 'ID inválido');
  return integer(Number(value), 'ID', 1, MAX_STOCK);
}
function text(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) fail(400, `${label} inválido`);
  value = value.trim();
  if (required && !value) fail(400, `${label} é obrigatório`);
  return value;
}
function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(400, 'Dados inválidos');
  return req.body;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    fail(400, 'chave deve ser um UUID válido');
  }
  return value.toLowerCase();
}
function date(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Validade deve ser uma data AAAA-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value.startsWith('0000')) {
    fail(400, 'Validade inválida');
  }
  return value;
}
function metadata(data, previous = null) {
  const get = (key, fallback) => data[key] === undefined ? (previous ? previous[key] : fallback) : data[key];
  const unidade = text(get('unidade', 'un'), 'Unidade', 10, true);
  if (!['un', 'par', 'caixa'].includes(unidade)) fail(400, 'Unidade deve ser un, par ou caixa');
  const ativo = get('ativo', true);
  if (typeof ativo !== 'boolean') fail(400, 'ativo deve ser booleano');
  return {
    nome: text(get('nome', ''), 'Nome', 200, true), tamanho: text(get('tamanho', ''), 'Tamanho', 80),
    unidade, ca: text(get('ca', ''), 'CA', 100), validade: date(get('validade', null)),
    minimo: integer(get('minimo', 0), 'Mínimo'), ativo,
    observacoes: text(get('observacoes', ''), 'Observações', 4000),
  };
}
function pagination(query) {
  const parse = (value, fallback, max, label) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) fail(400, `${label} inválido`);
    return Math.min(Number(value), max);
  };
  const page = parse(query.page, 1, 1_000_000, 'Página');
  const limit = parse(query.limit, 30, 100, 'Limite');
  return { page, limit, offset: (page - 1) * limit };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function actor(req) {
  const user = req.user;
  const id = user?.id;
  if (!user || !((typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
    (typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id))) || Number(id) > MAX_STOCK) fail(401, 'Autenticação obrigatória');
  if (!['admin', 'funcionario'].includes(user.role)) fail(403, 'Perfil sem acesso à área de EPI');
  return { id: String(id), nome: String(user.nome || user.username || `Usuário ${id}`).slice(0, 200), admin: user.role === 'admin' };
}
function requireAdmin(req, _res, next) {
  try { if (!req.epiActor.admin) fail(403, 'Apenas o ADM pode realizar esta ação'); next(); }
  catch (error) { next(error); }
}

// All DDL is additive and limited to ft_epi_* tables. The host owns notificacoes.
const MIGRATION = `
CREATE TABLE IF NOT EXISTS ft_epi_itens (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, tamanho TEXT NOT NULL DEFAULT '',
  unidade TEXT NOT NULL CHECK (unidade IN ('un','par','caixa')), ca TEXT NOT NULL DEFAULT '', validade DATE,
  minimo INTEGER NOT NULL DEFAULT 0 CHECK (minimo BETWEEN 0 AND 1000000),
  saldo INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0), ativo BOOLEAN NOT NULL DEFAULT TRUE,
  observacoes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ft_epi_itens_ativos_identidade
  ON ft_epi_itens (LOWER(BTRIM(nome)), LOWER(BTRIM(tamanho)), unidade) WHERE ativo;
CREATE TABLE IF NOT EXISTS ft_epi_solicitacoes (
  id SERIAL PRIMARY KEY, funcionario TEXT NOT NULL CHECK (LENGTH(BTRIM(funcionario)) > 0),
  setor TEXT NOT NULL DEFAULT '', motivo TEXT NOT NULL DEFAULT '', observacao TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','entregue','rejeitado','cancelado')),
  created_by TEXT NOT NULL, criado_por_nome TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ, approved_by TEXT, delivered_at TIMESTAMPTZ, delivered_by TEXT,
  rejected_at TIMESTAMPTZ, rejected_by TEXT, canceled_at TIMESTAMPTZ, canceled_by TEXT
);
ALTER TABLE ft_epi_solicitacoes ADD COLUMN IF NOT EXISTS compra_id INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ft_epi_solicitacoes'::regclass AND conname='ft_epi_solicitacoes_compra_fk') THEN
    ALTER TABLE ft_epi_solicitacoes ADD CONSTRAINT ft_epi_solicitacoes_compra_fk FOREIGN KEY (compra_id) REFERENCES compras(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ft_epi_solicitacoes_owner_status ON ft_epi_solicitacoes(created_by,status,id DESC);
CREATE INDEX IF NOT EXISTS ft_epi_solicitacoes_status ON ft_epi_solicitacoes(status,id DESC);
CREATE TABLE IF NOT EXISTS ft_epi_solicitacao_itens (
  id SERIAL PRIMARY KEY, solicitacao_id INTEGER NOT NULL REFERENCES ft_epi_solicitacoes(id),
  item_id INTEGER NOT NULL REFERENCES ft_epi_itens(id), nome TEXT NOT NULL, tamanho TEXT NOT NULL,
  unidade TEXT NOT NULL, ca TEXT NOT NULL, validade DATE,
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 1000000), UNIQUE(solicitacao_id,item_id)
);
CREATE TABLE IF NOT EXISTS ft_epi_eventos (
  id SERIAL PRIMARY KEY, solicitacao_id INTEGER NOT NULL REFERENCES ft_epi_solicitacoes(id),
  acao TEXT NOT NULL, ator_id TEXT NOT NULL, ator_nome TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(solicitacao_id,acao)
);
CREATE TABLE IF NOT EXISTS ft_epi_movimentacoes (
  id SERIAL PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES ft_epi_itens(id),
  solicitacao_id INTEGER REFERENCES ft_epi_solicitacoes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('inicial','entrada','ajuste','entrega')), quantidade INTEGER NOT NULL,
  saldo_antes INTEGER NOT NULL CHECK (saldo_antes >= 0), saldo_depois INTEGER NOT NULL CHECK (saldo_depois >= 0),
  observacao TEXT NOT NULL DEFAULT '', ator_id TEXT NOT NULL, ator_nome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (saldo_depois::bigint = saldo_antes::bigint + quantidade::bigint),
  CHECK ((tipo='inicial' AND quantidade>=0) OR (tipo='entrada' AND quantidade>0) OR
    (tipo='ajuste' AND quantidade<>0 AND LENGTH(BTRIM(observacao))>0) OR (tipo='entrega' AND quantidade<0)),
  UNIQUE(solicitacao_id,item_id)
);
CREATE INDEX IF NOT EXISTS ft_epi_movimentacoes_item ON ft_epi_movimentacoes(item_id,id DESC);
CREATE TABLE IF NOT EXISTS ft_epi_auditoria (
  id SERIAL PRIMARY KEY, item_id INTEGER REFERENCES ft_epi_itens(id), solicitacao_id INTEGER REFERENCES ft_epi_solicitacoes(id),
  acao TEXT NOT NULL, ator_id TEXT NOT NULL, ator_nome TEXT NOT NULL, observacao TEXT NOT NULL DEFAULT '',
  antes JSONB, depois JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ft_epi_chaves (
  ator_id TEXT NOT NULL, rota TEXT NOT NULL, chave UUID NOT NULL, payload_hash TEXT NOT NULL,
  resposta JSONB NOT NULL, http_status INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ator_id,rota,chave)
);`;

const REQUEST_COLUMNS = `s.id,s.funcionario,s.setor,s.motivo,s.observacao,s.status,s.criado_por_nome,
  s.created_at,s.approved_at,s.delivered_at,s.compra_id`;
// A single aggregate per SQL query, never a per-request application-side N+1.
const REQUEST_ITEMS = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'item_id',l.item_id,'nome',l.nome,'tamanho',l.tamanho,'unidade',l.unidade,'ca',l.ca,
  'quantidade',l.quantidade,'saldo_atual',i.saldo,'ativo',i.ativo) ORDER BY l.id)
  FROM ft_epi_solicitacao_itens l JOIN ft_epi_itens i ON i.id=l.item_id WHERE l.solicitacao_id=s.id),'[]'::jsonb) AS itens`;

function mountEpiRoutes(app, { pool }) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('pool PostgreSQL obrigatório');
  const router = express.Router();
  let readyPromise;
  async function transaction(work, readOnly = false) {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      // Finite database work, including lock waits; do not hang a serverless request.
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  function ensureDb() {
    if (!readyPromise) {
      readyPromise = transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock($1,$2)', [117993, 20261118]);
        await client.query(MIGRATION);
      }).catch(error => { readyPromise = undefined; throw error; });
    }
    return readyPromise;
  }
  async function audit(client, who, acao, itemId, requestId, observacao, antes, depois) {
    await client.query(`INSERT INTO ft_epi_auditoria
      (item_id,solicitacao_id,acao,ator_id,ator_nome,observacao,antes,depois) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [itemId, requestId, acao, who.id, who.nome, observacao || '', antes ? JSON.stringify(antes) : null, depois ? JSON.stringify(depois) : null]);
  }
  async function event(client, who, requestId, acao, observacao) {
    await client.query(`INSERT INTO ft_epi_eventos (solicitacao_id,acao,ator_id,ator_nome,observacao) VALUES ($1,$2,$3,$4,$5)`,
      [requestId, acao, who.id, who.nome, observacao]);
  }
  async function movement(client, who, item, tipo, delta, observacao, requestId = null) {
    const next = item.saldo + delta;
    if (next < 0) fail(409, `Estoque insuficiente para ${item.nome}`);
    if (next > MAX_STOCK) fail(409, 'Saldo excede o limite permitido');
    await client.query('UPDATE ft_epi_itens SET saldo=$1,updated_at=NOW() WHERE id=$2', [next, item.id]);
    const result = await client.query(`INSERT INTO ft_epi_movimentacoes
      (item_id,solicitacao_id,tipo,quantidade,saldo_antes,saldo_depois,observacao,ator_id,ator_nome)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [item.id, requestId, tipo, delta, item.saldo, next, observacao, who.id, who.nome]);
    return { id: result.rows[0].id, saldo_antes: item.saldo, saldo_depois: next };
  }
  async function idempotent(who, route, key, payload, work, httpStatus) {
    const hash = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
    return transaction(async client => {
      // Serializes same-key retries across all instances, with atomic response persistence.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([who.id, route, key])]);
      const previous = (await client.query('SELECT * FROM ft_epi_chaves WHERE ator_id=$1 AND rota=$2 AND chave=$3', [who.id, route, key])).rows[0];
      if (previous) {
        if (previous.payload_hash !== hash) fail(409, 'Chave já utilizada com dados diferentes');
        return { status: previous.http_status, value: previous.resposta };
      }
      const value = await work(client);
      await client.query(`INSERT INTO ft_epi_chaves (ator_id,rota,chave,payload_hash,resposta,http_status) VALUES ($1,$2,$3,$4,$5,$6)`,
        [who.id, route, key, hash, JSON.stringify(value), httpStatus]);
      return { status: httpStatus, value };
    });
  }
  const handler = work => (req, res, next) => Promise.resolve().then(() => work(req, res)).catch(next);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    try { req.epiActor = actor(req); next(); } catch (error) { next(error); }
  });
  // Only /epis reaches this migration; unauthenticated requests never reach the DB.
  router.use((req, res, next) => { ensureDb().then(() => next(), next); });
  router.use((req, _res, next) => {
    // The real JWT contains id/username/role, not nome. Resolve per request, no stale cache.
    pool.query('SELECT nome FROM usuarios WHERE id=$1', [req.epiActor.id]).then(result => {
      if (result.rows[0]?.nome) req.epiActor.nome = String(result.rows[0].nome).slice(0, 200);
      next();
    }, next);
  });

  router.get('/resumo', handler(async (req, res) => {
    const who = req.epiActor;
    const result = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM ft_epi_itens WHERE ativo) AS itens_ativos,
      (SELECT COUNT(*)::int FROM ft_epi_itens WHERE ativo AND saldo<=minimo) AS estoque_baixo,
      COUNT(*) FILTER (WHERE status='pendente')::int AS pendentes,
      COUNT(*) FILTER (WHERE status='aprovado')::int AS aprovadas,
      COUNT(*) FILTER (WHERE status='entregue')::int AS entregues
      FROM ft_epi_solicitacoes WHERE ($1::boolean OR created_by=$2)`, [who.admin, who.id]);
    res.json(result.rows[0]);
  }));

  router.get('/itens', handler(async (req, res) => {
    const include = req.query.incluir_inativos === '1';
    if (include && !req.epiActor.admin) fail(403, 'Apenas o ADM pode listar itens inativos');
    const result = await pool.query(`SELECT ${ITEM_COLUMNS} FROM ft_epi_itens WHERE ($1::boolean OR ativo) ORDER BY LOWER(nome),LOWER(tamanho),id`, [include]);
    res.json(result.rows);
  }));
  router.post('/itens', requireAdmin, handler(async (req, res) => {
    const data = body(req), who = req.epiActor, key = uuid(data.chave);
    const item = metadata(data);
    if (data.ativo !== undefined && data.ativo !== true) fail(400, 'Novos itens devem ser ativos');
    const saldo = integer(data.saldo_inicial === undefined ? 0 : data.saldo_inicial, 'Saldo inicial');
    const result = await idempotent(who, 'POST /epis/itens', key, { ...item, saldo_inicial: saldo }, async client => {
      const created = (await client.query(`INSERT INTO ft_epi_itens
        (nome,tamanho,unidade,ca,validade,minimo,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${ITEM_COLUMNS}`,
      [item.nome, item.tamanho, item.unidade, item.ca, item.validade, item.minimo, item.observacoes])).rows[0];
      await movement(client, who, created, 'inicial', saldo, 'Saldo inicial');
      created.saldo = saldo;
      await audit(client, who, 'criar_item', created.id, null, item.observacoes, null, created);
      return created;
    }, 201);
    res.status(result.status).json(result.value);
  }));
  router.put('/itens/:id', requireAdmin, handler(async (req, res) => {
    const id = identifier(req.params.id), data = body(req);
    if (Object.hasOwn(data, 'saldo') || Object.hasOwn(data, 'saldo_inicial')) fail(400, 'Altere o saldo somente por movimentações');
    const result = await transaction(async client => {
      const before = (await client.query(`SELECT ${ITEM_COLUMNS} FROM ft_epi_itens WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!before) fail(404, 'Item não encontrado');
      const item = metadata(data, before);
      if (item.unidade !== before.unidade) fail(409, 'A unidade de contagem não pode mudar após o cadastro. Cadastre outro EPI para usar uma unidade diferente');
      const after = (await client.query(`UPDATE ft_epi_itens SET nome=$1,tamanho=$2,unidade=$3,ca=$4,validade=$5,
        minimo=$6,ativo=$7,observacoes=$8,updated_at=NOW() WHERE id=$9 RETURNING ${ITEM_COLUMNS}`,
      [item.nome, item.tamanho, item.unidade, item.ca, item.validade, item.minimo, item.ativo, item.observacoes, id])).rows[0];
      await audit(client, req.epiActor, item.ativo === before.ativo ? 'editar_item' : (item.ativo ? 'reativar_item' : 'arquivar_item'), id, null, item.observacoes, before, after);
      return after;
    });
    res.json(result);
  }));
  router.post('/itens/:id/movimentacoes', requireAdmin, handler(async (req, res) => {
    const id = identifier(req.params.id), data = body(req), key = uuid(data.chave);
    if (!['entrada', 'ajuste'].includes(data.tipo)) fail(400, 'Tipo deve ser entrada ou ajuste');
    const quantidade = integer(data.quantidade, 'Quantidade', data.tipo === 'entrada' ? 1 : -MAX_QUANTITY);
    if (quantidade === 0) fail(400, 'Ajuste deve ser diferente de zero');
    const observacao = text(data.observacao, 'Observação', 4000, data.tipo === 'ajuste');
    const result = await idempotent(req.epiActor, `POST /epis/itens/${id}/movimentacoes`, key,
      { tipo: data.tipo, quantidade, observacao }, async client => {
        const item = (await client.query(`SELECT ${ITEM_COLUMNS} FROM ft_epi_itens WHERE id=$1 FOR UPDATE`, [id])).rows[0];
        if (!item) fail(404, 'Item não encontrado');
        if (!item.ativo) fail(409, 'Item inativo; reative antes de movimentar');
        const moved = await movement(client, req.epiActor, item, data.tipo, quantidade, observacao);
        return { ok: true, ...moved, item_id: id, saldo: moved.saldo_depois };
      }, 200);
    res.status(result.status).json(result.value);
  }));
  router.get('/itens/:id/historico', requireAdmin, handler(async (req, res) => {
    const id = identifier(req.params.id), { page, limit, offset } = pagination(req.query);
    const value = await transaction(async client => {
      const item = (await client.query(`SELECT ${ITEM_COLUMNS} FROM ft_epi_itens WHERE id=$1`, [id])).rows[0];
      if (!item) fail(404, 'Item não encontrado');
      const total = (await client.query('SELECT COUNT(*)::int AS total FROM ft_epi_movimentacoes WHERE item_id=$1', [id])).rows[0].total;
      const rows = await client.query(`SELECT id,tipo,quantidade,saldo_antes,saldo_depois,observacao,ator_nome,created_at,solicitacao_id
        FROM ft_epi_movimentacoes WHERE item_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3`, [id, limit, offset]);
      return { item, movimentacoes: rows.rows, total, page, pages: Math.ceil(total / limit) };
    }, true);
    res.json(value);
  }));

  router.post('/solicitacoes', handler(async (req, res) => {
    const data = body(req), key = uuid(data.chave), who = req.epiActor;
    const request = { funcionario: text(data.funcionario, 'Nome do funcionário', 200, true),
      setor: text(data.setor, 'Setor', 200), motivo: text(data.motivo, 'Motivo', 2000), observacao: text(data.observacao, 'Observação', 4000) };
    if (!Array.isArray(data.itens) || !data.itens.length || data.itens.length > 30) fail(400, 'Informe entre 1 e 30 itens');
    const seen = new Set();
    const lines = data.itens.map(line => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) fail(400, 'Item da solicitação inválido');
      const item_id = integer(line.item_id, 'ID do item', 1, MAX_STOCK);
      if (seen.has(item_id)) fail(400, 'Não repita itens na mesma solicitação');
      seen.add(item_id);
      return { item_id, quantidade: integer(line.quantidade, 'Quantidade', 1) };
    }).sort((a, b) => a.item_id - b.item_id);
    const result = await idempotent(who, 'POST /epis/solicitacoes', key, { ...request, itens: lines }, async client => {
      const items = (await client.query(`SELECT ${ITEM_COLUMNS} FROM ft_epi_itens WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE`, [lines.map(line => line.item_id)])).rows;
      if (items.length !== lines.length) fail(404, 'Item não encontrado');
      if (items.some(item => !item.ativo)) fail(409, 'A solicitação contém item inativo');
      const created = (await client.query(`INSERT INTO ft_epi_solicitacoes
        (funcionario,setor,motivo,observacao,created_by,criado_por_nome) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,status,created_at`,
      [request.funcionario, request.setor, request.motivo, request.observacao, who.id, who.nome])).rows[0];
      await client.query(`INSERT INTO ft_epi_solicitacao_itens (solicitacao_id,item_id,nome,tamanho,unidade,ca,validade,quantidade)
        SELECT $1,i.id,i.nome,i.tamanho,i.unidade,i.ca,i.validade,v.quantidade
        FROM jsonb_to_recordset($2::jsonb) AS v(item_id int,quantidade int) JOIN ft_epi_itens i ON i.id=v.item_id ORDER BY i.id`,
      [created.id, JSON.stringify(lines)]);
      await event(client, who, created.id, 'solicitar', request.observacao);
      await client.query(`INSERT INTO notificacoes (titulo,mensagem,tipo,destino_role) VALUES ($1,$2,$3,$4)`,
        ['Nova solicitação de EPI', `Solicitação #${created.id} para ${request.funcionario}, criada por ${who.nome}.`, 'epi', 'admin']);
      return { ok: true, ...created };
    }, 201);
    res.status(result.status).json(result.value);
  }));
  router.get('/solicitacoes', handler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query), who = req.epiActor;
    const status = req.query.status === undefined ? 'todas' : req.query.status;
    if (!STATUSES.includes(status) && status !== 'todas') fail(400, 'Status inválido');
    const search = text(req.query.busca, 'Busca', 200);
    // Escape LIKE wildcards: busca is a literal substring, including '%' and '_'.
    const pattern = `%${search.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const where = `($1::boolean OR s.created_by=$2) AND ($3='todas' OR s.status=$3) AND
      ($4='' OR s.funcionario ILIKE $5 OR s.setor ILIKE $5 OR s.id::text ILIKE $5 OR
        EXISTS (SELECT 1 FROM ft_epi_solicitacao_itens b WHERE b.solicitacao_id=s.id AND
          (b.nome ILIKE $5 OR b.tamanho ILIKE $5 OR b.unidade ILIKE $5 OR b.ca ILIKE $5)))`;
    const params = [who.admin, who.id, status, search, pattern];
    const value = await transaction(async client => {
      const total = (await client.query(`SELECT COUNT(*)::int AS total FROM ft_epi_solicitacoes s WHERE ${where}`, params)).rows[0].total;
      const rows = await client.query(`SELECT ${REQUEST_COLUMNS},${REQUEST_ITEMS} FROM ft_epi_solicitacoes s
        WHERE ${where} ORDER BY s.id DESC LIMIT $6 OFFSET $7`, [...params, limit, offset]);
      return { data: rows.rows, total, page, pages: Math.ceil(total / limit) };
    }, true);
    res.json(value);
  }));
  router.get('/solicitacoes/:id', handler(async (req, res) => {
    const id = identifier(req.params.id), who = req.epiActor;
    const result = await pool.query(`SELECT ${REQUEST_COLUMNS},${REQUEST_ITEMS},
      COALESCE((SELECT jsonb_agg(jsonb_build_object('acao',e.acao,'ator_nome',e.ator_nome,
        'observacao',e.observacao,'created_at',e.created_at) ORDER BY e.id) FROM ft_epi_eventos e WHERE e.solicitacao_id=s.id),'[]'::jsonb) AS eventos
      FROM ft_epi_solicitacoes s WHERE s.id=$1 AND ($2::boolean OR s.created_by=$3)`, [id, who.admin, who.id]);
    if (!result.rows[0]) fail(404, 'Solicitação não encontrada');
    res.json(result.rows[0]);
  }));

  router.post('/solicitacoes/:id/gerar-compra', requireAdmin, handler(async (req, res) => {
    const id = identifier(req.params.id), data = body(req), who = req.epiActor;
    const observacao = text(data.observacao, 'Observação', 4000);
    if (!Array.isArray(data.itens) || !data.itens.length || data.itens.length > 30) fail(400, 'Informe entre 1 e 30 itens para compra');
    const seen = new Set();
    const lines = data.itens.map(line => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) fail(400, 'Item de compra inválido');
      const item_id = integer(line.item_id, 'ID do item', 1, MAX_STOCK);
      if (seen.has(item_id)) fail(400, 'Não repita itens na compra');
      seen.add(item_id);
      return { item_id, quantidade: integer(line.quantidade, 'Quantidade', 1) };
    }).sort((a, b) => a.item_id - b.item_id);
    const result = await transaction(async client => {
      const request = (await client.query('SELECT * FROM ft_epi_solicitacoes WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!request) fail(404, 'Solicitação não encontrada');
      const snapshots = (await client.query('SELECT * FROM ft_epi_solicitacao_itens WHERE solicitacao_id=$1 ORDER BY item_id', [id])).rows;
      const byId = new Map(snapshots.map(item => [item.item_id, item]));
      if (lines.some(line => !byId.has(line.item_id))) fail(400, 'A compra deve conter somente itens desta solicitação');
      if (request.compra_id) return { ok: true, id, compra_id: request.compra_id, ja_existente: true };
      if (!['pendente', 'aprovado'].includes(request.status)) fail(409, 'Status da solicitação não permite gerar compra');
      const descricao = `Reposição vinculada à solicitação de EPI #${id}. Funcionário: ${request.funcionario}. Setor: ${request.setor || 'Não informado'}.` +
        (request.motivo ? ` Motivo: ${request.motivo}.` : '') + (observacao ? ` Observação: ${observacao}` : '');
      const purchase = (await client.query(`INSERT INTO compras
        (item,quantidade,unidade,categoria,destino,status,solicitante,descricao,tipo_solicitacao,status_lista)
        VALUES ($1,0,'','EPI','Estoque de EPI','Em cotação',$2,$3,'lista','pronta') RETURNING id`,
      [`Reposição de EPI — solicitação #${id}`, who.nome, descricao])).rows[0];
      const purchaseLines = lines.map(line => {
        const snapshot = byId.get(line.item_id);
        return { produto: snapshot.nome + (snapshot.tamanho ? ` — ${snapshot.tamanho}` : '') +
          (snapshot.ca ? ` — CA ${snapshot.ca}` : ''), quantidade: line.quantidade, unidade: snapshot.unidade };
      });
      await client.query(`INSERT INTO lista_compras_itens (compra_id,produto,quantidade,unidade,fornecedor,preco)
        SELECT $1,v.produto,v.quantidade,v.unidade,'',0 FROM jsonb_to_recordset($2::jsonb)
        AS v(produto text,quantidade int,unidade text)`, [purchase.id, JSON.stringify(purchaseLines)]);
      await client.query('UPDATE ft_epi_solicitacoes SET compra_id=$1 WHERE id=$2', [purchase.id, id]);
      const eventNote = `Compra #${purchase.id} solicitada.` + (observacao ? ` ${observacao}` : '');
      await event(client, who, id, 'compra_solicitada', eventNote);
      await audit(client, who, 'gerar_compra', null, id, observacao, null, { compra_id: purchase.id, itens: lines });
      await client.query(`INSERT INTO notificacoes (titulo,mensagem,tipo,destino_role) VALUES ($1,$2,'epi','admin')`,
        ['Compra de reposição de EPI solicitada', `Compra #${purchase.id} vinculada à solicitação de EPI #${id}, por ${who.nome}.`]);
      return { ok: true, id, compra_id: purchase.id, ja_existente: false };
    });
    res.json(result);
  }));

  function transition(action) {
    return handler(async (req, res) => {
      const id = identifier(req.params.id), who = req.epiActor, data = body(req);
      const observacao = text(data.observacao, 'Observação', 4000, action === 'rejeitar' || action === 'cancelar');
      const result = await transaction(async client => {
        const current = (await client.query('SELECT * FROM ft_epi_solicitacoes WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!current || (!who.admin && current.created_by !== who.id)) fail(404, 'Solicitação não encontrada');
        const target = { aprovar: 'aprovado', rejeitar: 'rejeitado', cancelar: 'cancelado', entregar: 'entregue' }[action];
        const response = row => ({ ok: true, id: row.id, status: row.status, approved_at: row.approved_at, delivered_at: row.delivered_at });
        if (current.status === target || (action === 'aprovar' && current.status === 'entregue')) return response(current);
        const allowed = action === 'aprovar' ? ['pendente'] : action === 'entregar' ? ['aprovado'] :
          action === 'cancelar' && !who.admin ? ['pendente'] : ['pendente', 'aprovado'];
        if (!allowed.includes(current.status)) fail(409, 'Status da solicitação não permite esta ação');
        if (action === 'entregar') {
          // Same lock order for every delivery: request, then ALL items sorted by ID.
          const items = (await client.query(`SELECT i.*,l.quantidade FROM ft_epi_itens i
            JOIN ft_epi_solicitacao_itens l ON l.item_id=i.id WHERE l.solicitacao_id=$1 ORDER BY i.id FOR UPDATE OF i`, [id])).rows;
          if (!items.length) fail(409, 'Solicitação sem itens');
          for (const item of items) {
            if (!item.ativo) fail(409, `Item inativo: ${item.nome}`);
            if (item.saldo < item.quantidade) fail(409, `Estoque insuficiente para ${item.nome}`);
          }
          for (const item of items) await movement(client, who, item, 'entrega', -item.quantidade, observacao, id);
        }
        // Columns are server-owned constants, never request input.
        const columns = { aprovar: 'approved_at=NOW(),approved_by=$2', entregar: 'delivered_at=NOW(),delivered_by=$2',
          rejeitar: 'rejected_at=NOW(),rejected_by=$2', cancelar: 'canceled_at=NOW(),canceled_by=$2' };
        const after = (await client.query(`UPDATE ft_epi_solicitacoes SET status=$1,${columns[action]} WHERE id=$3 RETURNING *`, [target, who.id, id])).rows[0];
        await event(client, who, id, action, observacao);
        return response(after);
      });
      res.json(result);
    });
  }
  router.post('/solicitacoes/:id/aprovar', requireAdmin, transition('aprovar'));
  router.post('/solicitacoes/:id/rejeitar', requireAdmin, transition('rejeitar'));
  router.post('/solicitacoes/:id/cancelar', transition('cancelar'));
  router.post('/solicitacoes/:id/entregar', requireAdmin, transition('entregar'));

  router.use((error, _req, res, _next) => {
    if (error instanceof EpiError) return res.status(error.status).json({ error: error.message });
    if (error.code === '23505' && error.constraint === 'ft_epi_itens_ativos_identidade') {
      return res.status(409).json({ error: 'Já existe item ativo com este nome, tamanho e unidade' });
    }
    if (['55P03', '57014', '40P01', '40001'].includes(error.code)) {
      return res.status(409).json({ error: 'Operação concorrente; tente novamente com a mesma chave' });
    }
    // Never expose SQL, connection strings, stack traces, or payloads to clients/logs.
    console.error('EPI: falha interna', typeof error.code === 'string' ? error.code : 'internal');
    return res.status(500).json({ error: 'Não foi possível concluir a operação de EPI' });
  });
  app.use('/epis', router);
  return router;
}

module.exports = { mountEpiRoutes };
