const express = require("express");
const serverless = require("serverless-http");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json({ limit: "20mb" }));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || "ft-flow-secret-key-change-in-production";

// Middleware para remover /api do URL
app.use((req, res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.replace("/api", "");
  }
  next();
});

// Middleware de autenticação (exceto login)
function autenticar(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token && req.path !== "/auth/login") {
    return res.status(401).json({ error: "Token não fornecido" });
  }
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: "Token inválido" });
    }
  }
  next();
}
app.use(autenticar);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function q(sql, params = []) {
  const c = await pool.connect();
  try { return await c.query(sql, params); }
  finally { c.release(); }
}

let ready = false;
const UNIDADES_MEDIDA_VALIDAS = ["m", "cm", "kg", "g", "L", "mL", "un"];
function unidadeMedidaValida(u) {
  return UNIDADES_MEDIDA_VALIDAS.includes(String(u || "").trim());
}

async function ensureDb(){
  if(ready) return;
  // Create tables used by the app
  await q(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, nome TEXT, role TEXT DEFAULT 'funcionario')`);
  await q(`CREATE TABLE IF NOT EXISTS compras (id SERIAL PRIMARY KEY, manutencao_id INTEGER, item TEXT, quantidade REAL, unidade TEXT, categoria TEXT, destino TEXT, status TEXT DEFAULT 'Em cotação', solicitante TEXT, valor_unitario REAL DEFAULT 0, valor_total REAL DEFAULT 0, descricao TEXT, link_produto TEXT, foto_url TEXT, fornecedor_escolhido TEXT, valor_escolhido REAL, created_at TIMESTAMP DEFAULT NOW(), received_at TIMESTAMP, received_by INTEGER)`);
  await q(`CREATE TABLE IF NOT EXISTS cotacoes (id SERIAL PRIMARY KEY, compra_id INTEGER, fornecedor TEXT, valor REAL, observacao TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS notificacoes (id SERIAL PRIMARY KEY, titulo TEXT, mensagem TEXT, tipo TEXT, destino_role TEXT DEFAULT 'admin', lida INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS estoque (id SERIAL PRIMARY KEY, nome TEXT, categoria TEXT, unidade TEXT, quantidade REAL DEFAULT 0, minimo REAL DEFAULT 0, foto_url TEXT, fornecedor TEXT, local TEXT, observacoes TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS manutencoes (id SERIAL PRIMARY KEY, solicitante TEXT, data_ocorrencia TEXT, tipo TEXT, local_item TEXT, defeito TEXT, urgencia TEXT, status TEXT DEFAULT 'Aberto', responsavel TEXT, solucao TEXT, precisa_compra INTEGER DEFAULT 0, item_compra TEXT, quantidade_compra REAL, categoria_compra TEXT, destino_compra TEXT, criado_em TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS fornecedores (id SERIAL PRIMARY KEY, nome TEXT UNIQUE, email TEXT, telefone TEXT, endereco TEXT, observacoes TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, actor_id INTEGER, action TEXT, target_table TEXT, target_id INTEGER, meta JSONB, created_at TIMESTAMP DEFAULT NOW())`);

  // seed users if none
  const u = await q(`SELECT COUNT(*)::int total FROM usuarios`);
  if(u.rows[0].total===0) {
    const adminPass = await bcrypt.hash("123", 10);
    const operadorPass = await bcrypt.hash("123", 10);
    await q(`INSERT INTO usuarios (username,password,nome,role) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)`,
      ["admin", adminPass, "Administrador", "admin", "operador", operadorPass, "Operador", "funcionario"]
    );
  }
  ready = true;
}

app.use(async (req,res,next)=>{try{await ensureDb(); next();}catch(e){console.error(e); res.status(500).json({error:e.message});}});

async function email(titulo,dados={}){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS||!process.env.ADMIN_ALERT_EMAIL) return;
  const html = `<div style="font-family:Arial;background:#f3f7f4;padding:24px"><div style="max-width:700px;margin:auto;background:white;border-radius:18px;overflow:hidden"><div style="background:#052e16;padding:18px;color:white"><h2>${titulo}</h2></div><div style="padding:18px">${Object.entries(dados).map(([k,v])=>`<p><strong>${k}:</strong> ${String(v)}</p>`).join('')}</div></div></div>`;
  const t = nodemailer.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await t.sendMail({from:process.env.SMTP_USER,to:String(process.env.ADMIN_ALERT_EMAIL).split(",").map(e=>e.trim()),subject:titulo,html});
}

function normalizarTelefone(num) {
  let n = String(num || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (!n.startsWith("55") && n.length <= 11) n = "55" + n;
  return n;
}

function telefonesWhatsAppAdmin() {
  const raw = process.env.ADMIN_WHATSAPP || process.env.ADMIN_WHATSAPP_NUMBERS || "";
  return String(raw).split(",").map(normalizarTelefone).filter(Boolean);
}

function montarTextoWhatsApp(titulo, dados = {}, msgExtra = "") {
  let text = `*FT FLOW*\n*${titulo}*\n\n`;
  for (const [k, v] of Object.entries(dados)) {
    if (v != null && String(v).trim() !== "") text += `*${k}:* ${v}\n`;
  }
  if (msgExtra && !Object.keys(dados).length) text += `${msgExtra}\n`;
  const appUrl = process.env.APP_URL || "https://ft-flow.netlify.app";
  text += `\n${appUrl}`;
  return text.slice(0, 4000);
}

async function whatsappCallMeBot(phone, text) {
  const apikey = process.env.CALLMEBOT_API_KEY;
  if (!apikey) throw new Error("CALLMEBOT_API_KEY não configurada");
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  const r = await fetch(url);
  const body = await r.text();
  if (!r.ok || /error/i.test(body)) throw new Error(body.slice(0, 120) || `CallMeBot HTTP ${r.status}`);
}

async function whatsapp(phone, text) {
  const phones = telefonesWhatsAppAdmin();
  if (!phones.length) return;
  const provider = String(process.env.WHATSAPP_PROVIDER || "callmebot").toLowerCase();
  if (provider === 'callmebot') {
    await whatsappCallMeBot(phones[0], text);
    return;
  }
}

async function notify(titulo,msg,tipo="sistema",dados={}){
  await q(`INSERT INTO notificacoes (titulo,mensagem,tipo,destino_role) VALUES ($1,$2,$3,$4)`,[titulo,msg,tipo,"admin"]);
  // fire and forget optional channels
  email(titulo,dados).catch(e=>console.log('Email err',e.message));
  if (tipo === 'compra' || tipo === 'manutencao') whatsapp(titulo, montarTextoWhatsApp(titulo,dados,msg)).catch(e=>console.log('WA err',e.message));
}

// LOGIN
app.post("/auth/login", async (req, res) => {
  try{
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    if (!username || !password) return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    const r = await q(`SELECT id, username, password, nome, role FROM usuarios WHERE username = $1`, [username]);
    if (!r.rows[0]) return res.status(401).json({ error: "Usuário ou senha inválidos" });
    const senhaValida = await bcrypt.compare(password, r.rows[0].password);
    if (!senhaValida) return res.status(401).json({ error: "Usuário ou senha inválidos" });
    const token = jwt.sign({ id: r.rows[0].id, username: r.rows[0].username, role: r.rows[0].role }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ id: r.rows[0].id, username: r.rows[0].username, nome: r.rows[0].nome, role: r.rows[0].role, token });
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

// ADMIN: change password
app.post('/admin/change-password', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    const { userId, userRole, newPassword } = req.body;
    if (!newPassword || (!userId && !userRole)) return res.status(400).json({ error: 'Parâmetros inválidos' });
    let target;
    if (userId) {
      const r = await q('SELECT * FROM usuarios WHERE id=$1', [userId]);
      target = r.rows[0];
    } else {
      const r = await q('SELECT * FROM usuarios WHERE role=$1 ORDER BY id LIMIT 1', [userRole]);
      target = r.rows[0];
    }
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    const hash = await bcrypt.hash(newPassword, 10);
    await q('UPDATE usuarios SET password=$1 WHERE id=$2', [hash, target.id]);
    await q('INSERT INTO audit_log (actor_id, action, target_table, target_id, meta) VALUES ($1,$2,$3,$4,$5)', [req.user.id, 'change_password', 'usuarios', target.id, JSON.stringify({ by: req.user.username })]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// COMPRAS
app.get("/compras",async(req,res)=>{
  try{
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const total = await q(`SELECT COUNT(*)::int total FROM compras`);
    const data = await q(`SELECT * FROM compras ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({data:data.rows, total:total.rows[0].total, page, limit, pages:Math.ceil(total.rows[0].total/limit)});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.post("/compras",async(req,res)=>{
  try{
    const b=req.body;
    if(!unidadeMedidaValida(b.unidade)) return res.status(400).json({error:"Selecione uma unidade de medida válida"});
    const r=await q(
      `INSERT INTO compras (item,quantidade,unidade,categoria,destino,solicitante,status,valor_unitario,valor_total,descricao,link_produto,foto_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [b.item,b.quantidade,b.unidade||null,b.categoria,b.destino,b.solicitante||"Não informado","Em cotação",Number(b.valor_unitario||0),Number(b.valor_total||0),b.descricao_detalhada||b.descricao||null,b.link_produto||null,b.foto_url||null]
    );
    const unidadeTxt=b.unidade?` ${b.unidade}`:"";
    await notify("Nova solicitação de compra", `Item: ${b.item}`, "compra", {
      ID: `#${r.rows[0].id}`,
      Item: b.item,
      Quantidade: `${b.quantidade}${unidadeTxt}`,
      Solicitante: b.solicitante,
      Categoria: b.categoria,
      Destino: b.destino,
      ...(b.descricao_detalhada || b.descricao ? { Descrição: String(b.descricao_detalhada || b.descricao).slice(0, 200) } : {}),
      ...(b.foto_url ? { Foto: b.foto_url } : {})
    });
    res.json({id:r.rows[0].id});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.get("/compras/:id",async(req,res)=>{
  try{
    const r = await q(`SELECT * FROM compras WHERE id=$1`,[req.params.id]);
    res.json(r.rows[0] || {});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.get("/compras/:id/cotacoes",async(req,res)=>{
  try{
    const r = await q(`SELECT * FROM cotacoes WHERE compra_id=$1 ORDER BY valor ASC`,[req.params.id]);
    res.json(r.rows);
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.post("/compras/:id/cotacoes",async(req,res)=>{
  try{
    const b=req.body;
    const r=await q(`INSERT INTO cotacoes (compra_id,fornecedor,valor,observacao) VALUES ($1,$2,$3,$4) RETURNING id`,[req.params.id,b.fornecedor,b.valor,b.observacao]);
    res.json({id:r.rows[0].id});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.delete("/compras/:id/cotacoes/:preco_id", async (req, res) => {
  try {
    await q(`DELETE FROM cotacoes WHERE id=$1 AND compra_id=$2`, [req.params.preco_id, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/compras/:id/status",async(req,res)=>{try{await q(`UPDATE compras SET status=$1 WHERE id=$2`,[req.body.status,req.params.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.put("/compras/:id/escolher-fornecedor",async(req,res)=>{try{await q(`UPDATE compras SET fornecedor_escolhido=$1,valor_escolhido=$2,status='Aprovado' WHERE id=$3`,[req.body.fornecedor,req.body.valor,req.params.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

// Approve received (admin only)
app.post('/compras/:id/approve-received', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    const id = req.params.id;
    const r = await q('SELECT * FROM compras WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    await q('UPDATE compras SET status=$1, received_at=NOW(), received_by=$2 WHERE id=$3', ['recebido', req.user.id, id]);
    await q('INSERT INTO audit_log (actor_id, action, target_table, target_id, meta) VALUES ($1,$2,$3,$4,$5)', [req.user.id, 'approve_received', 'compras', id, JSON.stringify({ by: req.user.username })]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// DELETE compra (admin only) - hard delete
app.delete("/compras/:id", async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    await q(`DELETE FROM cotacoes WHERE compra_id=$1`, [req.params.id]);
    await q(`DELETE FROM compras WHERE id=$1`, [req.params.id]);
    await q('INSERT INTO audit_log (actor_id, action, target_table, target_id, meta) VALUES ($1,$2,$3,$4,$5)', [req.user.id, 'delete_compra', 'compras', req.params.id, JSON.stringify({ by: req.user.username })]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DASHBOARD
app.get('/dashboard', async (req, res) => {
  try {
    const manutencoesAbertas = await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status='Aberto'`);
    const urgentes = await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE urgencia='Alta'`);
    const aguardandoPeca = await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status='Aguardando peca'`);
    const comprasPendentes = await q(`SELECT COUNT(*)::int total FROM compras WHERE status IN ('Em cotacao','Aprovado')`);
    const estoqueBaixo = await q(`SELECT COUNT(*)::int total FROM estoque WHERE quantidade < minimo`);
    res.json({
      manutencoesAbertas: manutencoesAbertas.rows[0].total,
      urgentes: urgentes.rows[0].total,
      aguardandoPeca: aguardandoPeca.rows[0].total,
      comprasPendentes: comprasPendentes.rows[0].total,
      estoqueBaixo: estoqueBaixo.rows[0].total
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// MANUTENCOES
app.get('/manutencoes', async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const r = await q(`SELECT * FROM manutencoes ORDER BY id DESC LIMIT $1`, [limit]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/manutencoes', async (req, res) => {
  try {
    const b = req.body;
    const r = await q(
      `INSERT INTO manutencoes (solicitante, data_ocorrencia, tipo, local_item, defeito, urgencia, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.solicitante || 'Nao informado', b.data_ocorrencia || new Date().toISOString().split('T')[0], b.tipo, b.local_item, b.defeito, b.urgencia || 'Normal', 'Aberto']
    );
    await notify('Nova manutencao solicitada', `Tipo: ${b.tipo}`, 'manutencao', {
      ID: `#${r.rows[0].id}`,
      Tipo: b.tipo,
      Local: b.local_item,
      Defeito: b.defeito,
      Solicitante: b.solicitante,
      Urgencia: b.urgencia
    });
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/manutencoes/:id', async (req, res) => {
  try {
    const r = await q(`SELECT * FROM manutencoes WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0] || {});
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put('/manutencoes/:id', async (req, res) => {
  try {
    const b = req.body;
    await q(`UPDATE manutencoes SET status=$1, responsavel=$2, solucao=$3 WHERE id=$4`, [b.status, b.responsavel, b.solucao, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ESTOQUE
app.get('/estoque', async (req, res) => {
  try {
    const r = await q(`SELECT * FROM estoque ORDER BY nome`);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/estoque', async (req, res) => {
  try {
    const b = req.body;
    const r = await q(
      `INSERT INTO estoque (nome, categoria, unidade, quantidade, minimo, foto_url, fornecedor, local, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b.nome, b.categoria, b.unidade, Number(b.quantidade || 0), Number(b.minimo || 0), b.foto_url || null, b.fornecedor || null, b.local || null, b.observacoes || null]
    );
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/estoque/:id', async (req, res) => {
  try {
    const r = await q(`SELECT * FROM estoque WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0] || {});
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put('/estoque/:id', async (req, res) => {
  try {
    const b = req.body;
    await q(`UPDATE estoque SET nome=$1, categoria=$2, unidade=$3, quantidade=$4, minimo=$5, foto_url=$6, fornecedor=$7, local=$8, observacoes=$9 WHERE id=$10`, 
      [b.nome, b.categoria, b.unidade, Number(b.quantidade || 0), Number(b.minimo || 0), b.foto_url || null, b.fornecedor || null, b.local || null, b.observacoes || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Basic fornecedores/notificacoes endpoints
app.get('/fornecedores', async (req, res) => { try{ const r = await q('SELECT * FROM fornecedores ORDER BY nome'); res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});
app.get('/notificacoes', async (req, res) => { try{ const r = await q('SELECT * FROM notificacoes ORDER BY id DESC LIMIT 50'); res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});

// Handler
module.exports.handler = serverless(app);
