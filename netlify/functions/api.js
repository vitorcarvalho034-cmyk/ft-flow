const express = require("express");
const serverless = require("serverless-http");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json({ limit: "20mb" }));

const JWT_SECRET = process.env.JWT_SECRET || "ft-flow-secret-key-change-in-production";

// Middleware para remover /api do URL
app.use((req, res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.replace("/api", "");
  }
  next();
});

// ENDPOINT DE DEBUG (SEM AUTENTICACAO)
app.get("/auth/debug", async (req, res) => {
  try {
    const pool2 = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
    });
    const c = await pool2.connect();
    try {
      const usuarios = await c.query(`SELECT id, username, password FROM usuarios`);
      const debug = {
        DATABASE_URL_SET: !!process.env.DATABASE_URL,
        DATABASE_URL_PREVIEW: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 50) + "..." : "NOT SET",
        JWT_SECRET_SET: !!process.env.JWT_SECRET,
        usuarios: usuarios.rows.map(u => ({
          id: u.id,
          username: u.username,
          password_hash_preview: u.password ? u.password.substring(0, 30) + "..." : "NULL",
          password_length: u.password ? u.password.length : 0
        })),
        bcrypt_test: {}
      };
      
      for (const user of usuarios.rows) {
        const result = await bcrypt.compare("123", user.password);
        debug.bcrypt_test[user.username] = result;
      }
      
      res.json(debug);
    } finally { c.release(); }
    pool2.end();
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ENDPOINT RESET USUARIOS (SEM AUTENTICACAO)
app.post("/auth/reset-usuarios-temp", async (req, res) => {
  try {
    const senhaAdmin = await bcrypt.hash("123", 10);
    const senhaOperador = await bcrypt.hash("123", 10);
    const pool2 = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
    });
    const c = await pool2.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, nome VARCHAR(100), role VARCHAR(20) DEFAULT 'funcionario', criado_em TIMESTAMP DEFAULT NOW())`);
      await c.query("DELETE FROM usuarios");
      await c.query(
        `INSERT INTO usuarios (username, password, nome, role) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        ["admin", senhaAdmin, "Administrador", "admin", "operador", senhaOperador, "Operador", "funcionario"]
      );
    } finally { c.release(); }
    pool2.end();
    res.json({ ok: true, message: "Usuarios resetados com sucesso. Use admin/123 e operador/123" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Middleware de autenticação (exceto login)
function autenticar(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token && req.path !== "/auth/login" && req.path !== "/auth/reset-usuarios-temp" && req.path !== "/auth/debug") {
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

let ready = false;
async function q(sql, params=[]) {
  const c = await pool.connect();
  try { return await c.query(sql, params); }
  finally { c.release(); }
}

async function ensureDb(){
  if(ready) return;
  await q(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, nome TEXT, role TEXT DEFAULT 'funcionario')`);
  await q(`CREATE TABLE IF NOT EXISTS manutencoes (id SERIAL PRIMARY KEY, solicitante TEXT, data_ocorrencia TEXT, tipo TEXT, local_item TEXT, defeito TEXT, urgencia TEXT, status TEXT DEFAULT 'Aberto', responsavel TEXT, solucao TEXT, precisa_compra INTEGER DEFAULT 0, item_compra TEXT, quantidade_compra REAL, categoria_compra TEXT, destino_compra TEXT, created_at TIMESTAMP DEFAULT NOW(), concluido_at TIMESTAMP)`);
  await q(`CREATE TABLE IF NOT EXISTS estoque (id SERIAL PRIMARY KEY, nome TEXT, categoria TEXT, unidade TEXT, quantidade REAL DEFAULT 0, minimo REAL DEFAULT 0)`);
  await q(`CREATE TABLE IF NOT EXISTS fornecedores (id SERIAL PRIMARY KEY, nome TEXT, contato TEXT, telefone TEXT, tipo_produto TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS compras (id SERIAL PRIMARY KEY, manutencao_id INTEGER, item TEXT, quantidade REAL, categoria TEXT, destino TEXT, status TEXT DEFAULT 'Em cotação', fornecedor_escolhido TEXT, valor_escolhido REAL, solicitante TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS cotacoes (id SERIAL PRIMARY KEY, compra_id INTEGER, fornecedor TEXT, valor REAL, observacao TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS notificacoes (id SERIAL PRIMARY KEY, titulo TEXT, mensagem TEXT, tipo TEXT, destino_role TEXT DEFAULT 'admin', lida INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  
  const u = await q(`SELECT COUNT(*)::int total FROM usuarios`);
  if(u.rows[0].total===0) {
    const adminPass = await bcrypt.hash("123", 10);
    const operadorPass = await bcrypt.hash("123", 10);
    await q(`INSERT INTO usuarios (username,password,nome,role) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)`,
      ["admin", adminPass, "Administrador", "admin", "operador", operadorPass, "Operador", "funcionario"]
    );
  }
  
  const e = await q(`SELECT COUNT(*)::int total FROM estoque`);
  if(e.rows[0].total===0) await q(`INSERT INTO estoque (nome,categoria,unidade,quantidade,minimo) VALUES
  ('Caixa de Papelão 48','Embalagens','un',18,30),('Caixa de Papelão 58','Embalagens','un',65,40),('Adubo 04-14-08','Adubo','kg',120,50),('Defensivo Preventivo','Defensivo','L',8,10),('Bion','Defensivo','g',1000,100),('Nativo','Defensivo','ml',2000,200),('Agree','Defensivo','g',1000,100),('Vertimec','Defensivo','ml',1000,100),('Capone','Defensivo','ml',3000,300),('Delegate','Defensivo','g',1000,100)`);
  ready = true;
}
app.use(async (req,res,next)=>{try{await ensureDb(); next();}catch(e){console.error(e); res.status(500).json({error:e.message});}});

async function email(titulo,dados={}){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS||!process.env.ADMIN_ALERT_EMAIL) return;
  const html = `<div style="font-family:Arial;background:#f3f7f4;padding:24px"><div style="max-width:700px;margin:auto;background:white;border-radius:18px;overflow:hidden"><div style="background:#052e16;color:white;padding:22px"><h2>FT FLOW</h2></div><div style="padding:22px"><h3>${titulo}</h3>${Object.entries(dados).map(([k,v])=>`<p><b>${k}:</b> ${v||"-"}</p>`).join("")}</div></div></div>`;
  const t = nodemailer.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await t.sendMail({from:process.env.SMTP_USER,to:String(process.env.ADMIN_ALERT_EMAIL).split(",").map(e=>e.trim()),subject:titulo,html});
}

async function notify(titulo,msg,tipo="sistema",dados={}){
  await q(`INSERT INTO notificacoes (titulo,mensagem,tipo,destino_role) VALUES ($1,$2,$3,$4)`,[titulo,msg,tipo,"admin"]);
  try{await email(titulo,dados)}catch(e){console.log(e.message)}
}

// LOGIN COM JWT
app.post("/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    }

    const r = await q(
      `SELECT id, username, password, nome, role FROM usuarios WHERE username = $1`,
      [username]
    );

    if (!r.rows[0]) {
      console.log(`[LOGIN] Usuário '${username}' não encontrado`);
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    console.log(`[LOGIN] Usuário '${username}' encontrado. Testando bcrypt...`);
    const senhaValida = await bcrypt.compare(password, r.rows[0].password);
    console.log(`[LOGIN] bcrypt.compare result: ${senhaValida}`);
    
    if (!senhaValida) {
      console.log(`[LOGIN] Senha inválida para '${username}'`);
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const token = jwt.sign(
      { id: r.rows[0].id, username: r.rows[0].username, role: r.rows[0].role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`[LOGIN] Login bem-sucedido para '${username}'`);
    res.json({
      id: r.rows[0].id,
      username: r.rows[0].username,
      nome: r.rows[0].nome,
      role: r.rows[0].role,
      token: token
    });
  } catch (e) {
    console.error(`[LOGIN ERROR]`, e);
    res.status(500).json({ error: e.message });
  }
});

// DASHBOARD
app.get("/dashboard",async(req,res)=>{
  const a=await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status!='Concluído'`);
  const u=await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE urgencia='Alta (parou a operação)' AND status!='Concluído'`);
  const p=await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status='Aguardando peça'`);
  const c=await q(`SELECT COUNT(*)::int total FROM compras WHERE status!='Recebido'`);
  const e=await q(`SELECT COUNT(*)::int total FROM estoque WHERE quantidade<=minimo`);
  res.json({manutencoesAbertas:a.rows[0].total,urgentes:u.rows[0].total,aguardandoPeca:p.rows[0].total,comprasPendentes:c.rows[0].total,estoqueBaixo:e.rows[0].total});
});

// MANUTENCOES
app.get("/manutencoes",async(req,res)=>{
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const total = await q(`SELECT COUNT(*)::int total FROM manutencoes`);
  const data = await q(`SELECT * FROM manutencoes ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({data:data.rows, total:total.rows[0].total, page, limit, pages:Math.ceil(total.rows[0].total/limit)});
});

app.post("/manutencoes",async(req,res)=>{
  const b=req.body;
  if(!b.solicitante || !b.local_item || !b.defeito) return res.status(400).json({error:"Campos obrigatórios faltando"});
  const precisa=String(b.precisa_compra)==="1"?1:0;
  const status=precisa?"Aguardando peça":"Aberto";
  const r=await q(`INSERT INTO manutencoes (solicitante,data_ocorrencia,tipo,local_item,defeito,urgencia,status,responsavel,solucao,precisa_compra,item_compra,quantidade_compra,categoria_compra,destino_compra) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[b.solicitante,b.data_ocorrencia,b.tipo,b.local_item,b.defeito,b.urgencia,status,b.responsavel||"",b.solucao||"",precisa,b.item_compra||"",b.quantidade_compra||0,b.categoria_compra||"",b.destino_compra||""]);
  await notify(precisa?"Nova manutenção com solicitação de compra":"Nova manutenção criada",`Solicitante: ${b.solicitante||"-"}\nLocal: ${b.local_item||"-"}`,"manutencao",{Solicitante:b.solicitante,Local:b.local_item,Problema:b.defeito});
  if(precisa)await q(`INSERT INTO compras (manutencao_id,item,quantidade,categoria,destino,status,solicitante) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[r.rows[0].id,b.item_compra||"Item não informado",b.quantidade_compra||1,b.categoria_compra||"Peças",b.destino_compra||b.local_item||"Não informado","Em cotação",b.solicitante||"Não informado"]);
  res.json({id:r.rows[0].id});
});

app.put("/manutencoes/:id",async(req,res)=>{
  await q(`UPDATE manutencoes SET status=$1,responsavel=$2,solucao=$3,concluido_at=$4 WHERE id=$5`,[req.body.status,req.body.responsavel||"",req.body.solucao||"",req.body.status==="Concluído"?new Date():null,req.params.id]);
  res.json({ok:true});
});

// ESTOQUE
app.get("/estoque",async(req,res)=>res.json((await q(`SELECT *, CASE WHEN quantidade<=minimo THEN 1 ELSE 0 END baixo FROM estoque ORDER BY categoria,nome`)).rows));

app.post("/estoque",async(req,res)=>{
  const b=req.body;
  const r=await q(`INSERT INTO estoque (nome,categoria,unidade,quantidade,minimo) VALUES ($1,$2,$3,$4,$5) RETURNING id`,[b.nome,b.categoria,b.unidade,b.quantidade,b.minimo]);
  res.json({id:r.rows[0].id});
});

app.delete("/estoque/:id",async(req,res)=>{
  await q(`DELETE FROM estoque WHERE id=$1`,[req.params.id]);
  res.json({ok:true});
});

// COMPRAS
app.get("/compras",async(req,res)=>{
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const total = await q(`SELECT COUNT(*)::int total FROM compras`);
  const data = await q(`SELECT * FROM compras ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({data:data.rows, total:total.rows[0].total, page, limit, pages:Math.ceil(total.rows[0].total/limit)});
});

app.post("/compras",async(req,res)=>{
  const b=req.body;
  const r=await q(`INSERT INTO compras (item,quantidade,categoria,destino,solicitante,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,[b.item,b.quantidade,b.categoria,b.destino,b.solicitante||"Não informado",b.status||"Em cotação"]);
  await notify("Nova solicitação de compra",`Item: ${b.item}`,"compra",{Item:b.item,Quantidade:b.quantidade,Solicitante:b.solicitante});
  res.json({id:r.rows[0].id});
});

app.get("/compras/:id/cotacoes",async(req,res)=>res.json((await q(`SELECT * FROM cotacoes WHERE compra_id=$1 ORDER BY valor ASC`,[req.params.id])).rows));

app.post("/compras/:id/cotacoes",async(req,res)=>{
  const b=req.body;
  const r=await q(`INSERT INTO cotacoes (compra_id,fornecedor,valor,observacao) VALUES ($1,$2,$3,$4) RETURNING id`,[req.params.id,b.fornecedor,b.valor,b.observacao||""]);
  res.json({id:r.rows[0].id});
});

app.put("/compras/:id/escolher-fornecedor",async(req,res)=>{
  await q(`UPDATE compras SET fornecedor_escolhido=$1,valor_escolhido=$2,status='Aprovado' WHERE id=$3`,[req.body.fornecedor,req.body.valor,req.params.id]);
  res.json({ok:true});
});

// FORNECEDORES
app.get("/fornecedores",async(req,res)=>res.json((await q(`SELECT * FROM fornecedores ORDER BY nome`)).rows));

app.post("/fornecedores",async(req,res)=>{
  const b=req.body;
  const r=await q(`INSERT INTO fornecedores (nome,contato,telefone,tipo_produto) VALUES ($1,$2,$3,$4) RETURNING id`,[b.nome,b.contato,b.telefone,b.tipo_produto]);
  res.json({id:r.rows[0].id});
});

// NOTIFICACOES
app.get("/notificacoes",async(req,res)=>res.json((await q(`SELECT * FROM notificacoes ORDER BY created_at DESC LIMIT 50`)).rows));

app.put("/notificacoes/marcar-lidas",async(req,res)=>{
  await q(`UPDATE notificacoes SET lida=1`);
  res.json({ok:true});
});

module.exports.handler = serverless(app);
