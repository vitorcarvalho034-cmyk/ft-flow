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
  const rotasPublicas = [
    '/auth/login',
    /^\/aprovar-cotacao\//,
    /^\/selecionar-fornecedores-lista\//,
    /^\/aprovar-lista-fornecedores\//,
    /^\/negar-cotacao\//,
    /^\/questionar-cotacao\//,
    /^\/enviar-questionamento\//,
    /^\/responder-questionamento\//,
    /^\/enviar-resposta-questionamento\//
  ];
  const ehRotaPublica = rotasPublicas.some(r => typeof r === 'string' ? req.path === r : r.test(req.path));
  if (!token && !ehRotaPublica) {
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
  await q(`ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS item_id INTEGER`).catch(e => console.log('item_id column already exists'));
  await q(`CREATE TABLE IF NOT EXISTS notificacoes (id SERIAL PRIMARY KEY, titulo TEXT, mensagem TEXT, tipo TEXT, destino_role TEXT DEFAULT 'admin', lida INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS estoque (id SERIAL PRIMARY KEY, nome TEXT, categoria TEXT, unidade TEXT, quantidade REAL DEFAULT 0, minimo REAL DEFAULT 0, foto_url TEXT, fornecedor TEXT, local TEXT, observacoes TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS manutencoes (id SERIAL PRIMARY KEY, solicitante TEXT, data_ocorrencia TEXT, tipo TEXT, local_item TEXT, defeito TEXT, urgencia TEXT, status TEXT DEFAULT 'Aberto', responsavel TEXT, solucao TEXT, precisa_compra INTEGER DEFAULT 0, item_compra TEXT, quantidade_compra REAL, categoria_compra TEXT, destino_compra TEXT, criado_em TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS fornecedores (id SERIAL PRIMARY KEY, nome TEXT UNIQUE, email TEXT, telefone TEXT, endereco TEXT, observacoes TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, actor_id INTEGER, action TEXT, target_table TEXT, target_id INTEGER, meta JSONB, created_at TIMESTAMP DEFAULT NOW())`);
  
  // Adicionar coluna received_at se nao existir
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS received_at TIMESTAMP`).catch(e => console.log('received_at column already exists'));
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS received_by INTEGER`).catch(e => console.log('received_by column already exists'));
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS questionamento TEXT`).catch(e => console.log('questionamento column already exists'));
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS resposta_admin TEXT`).catch(e => console.log('resposta_admin column already exists'));
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS status_questionamento VARCHAR(50)`).catch(e => console.log('status_questionamento column already exists'));
  await q(`CREATE TABLE IF NOT EXISTS lista_compras_itens (id SERIAL PRIMARY KEY, compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE, produto TEXT, quantidade REAL, unidade TEXT, fornecedor TEXT, preco REAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo_solicitacao VARCHAR(50) DEFAULT 'compra'`).catch(e => console.log('tipo_solicitacao column already exists'));
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS status_lista VARCHAR(50) DEFAULT 'rascunho'`).catch(e => console.log('status_lista column already exists'));
  await q(`ALTER TABLE lista_compras_itens ADD COLUMN IF NOT EXISTS fornecedor TEXT`).catch(e => console.log('fornecedor column already exists'));
  await q(`ALTER TABLE lista_compras_itens ADD COLUMN IF NOT EXISTS preco REAL DEFAULT 0`).catch(e => console.log('preco column already exists'));
  await q(`CREATE TABLE IF NOT EXISTS lista_compras_aprovacoes (id SERIAL PRIMARY KEY, compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE, item_id INTEGER REFERENCES lista_compras_itens(id) ON DELETE CASCADE, cotacao_id INTEGER REFERENCES cotacoes(id), fornecedor TEXT, valor REAL, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS uso TEXT`).catch(()=>{});
  await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS destinatario TEXT`).catch(()=>{});

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

async function email(titulo,dados={},destinatario=null,htmlCustomizado=null){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS) return;
  const html = htmlCustomizado || `<div style="font-family:Arial;background:#f3f7f4;padding:24px"><div style="max-width:700px;margin:auto;background:white;border-radius:18px;overflow:hidden"><div style="background:#052e16;padding:18px;color:white"><h2>${titulo}</h2></div><div style="padding:18px">${Object.entries(dados).map(([k,v])=>`<p><strong>${k}:</strong> ${String(v)}</p>`).join('')}</div></div></div>`;
  const t = nodemailer.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  const toEmail = destinatario || String(process.env.ADMIN_ALERT_EMAIL).split(",").map(e=>e.trim());
  await t.sendMail({from:process.env.SMTP_USER,to:toEmail,subject:titulo,html});
}

async function emailComFornecedoresLista(titulo, compraId, itens, cotacoes, appUrl="https://ft-flow.netlify.app", emailDest=null){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS) return;
  const approvalEmail = emailDest || process.env.APPROVAL_EMAIL || 'dorian@floresdaterra.com.br';
  
  // Agrupar cotações por item
  let itensHtml = '';
  for (const item of itens) {
    const cotacoesItem = cotacoes.filter(c => c.item_id === item.id);
    
    itensHtml += `
      <div style="background:#f0f8f5;padding:15px;border-radius:8px;margin-bottom:15px;border-left:4px solid #1b5e20">
        <h4 style="margin:0 0 10px 0;color:#1b5e20">${item.produto}</h4>
        <p style="margin:5px 0;font-size:13px;color:#555"><strong>Quantidade:</strong> ${item.quantidade} ${item.unidade}</p>
        
        <div style="margin-top:10px">
          <p style="margin:5px 0;font-size:12px;color:#666;font-weight:bold">Fornecedores:</p>
    `;
    
    if (cotacoesItem.length === 0) {
      itensHtml += `<p style="margin:5px 0;font-size:12px;color:#999">Nenhuma cotação disponível</p>`;
    } else {
      for (const cot of cotacoesItem) {
        itensHtml += `
          <div style="background:white;padding:10px;margin:8px 0;border-radius:4px;border:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px">${cot.fornecedor}</span>
            <span style="font-size:14px;font-weight:bold;color:#2e7d32">R$ ${Number(cot.valor).toFixed(2)}</span>
          </div>
        `;
      }
    }
    
    itensHtml += `
        </div>
      </div>
    `;
  }
  
  const html = `
    <div style="font-family:Arial;background:#f3f7f4;padding:24px">
      <div style="max-width:700px;margin:auto;background:white;border-radius:18px;overflow:hidden">
        <div style="background:#1b5e20;padding:30px;color:white;text-align:center">
          <h1 style="margin:0;font-size:24px">Lista de Compra #${compraId}</h1>
          <p style="margin:5px 0 0 0;opacity:0.9">Aguardando Aprovação</p>
        </div>
        <div style="padding:30px">
          <div style="background:#f9f9f9;padding:15px;border-radius:8px;margin:15px 0">
            <h3 style="margin:0 0 15px 0;color:#1b5e20">📋 Itens da Lista</h3>
            ${itensHtml}
          </div>
          
          <div style="text-align:center;margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <a href="${appUrl}/api/selecionar-fornecedores-lista/${Buffer.from('lista:'+compraId).toString('base64')}" style="display:inline-block;background:#2e7d32;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold">✅ Selecionar Fornecedores</a>
            <a href="${appUrl}/api/negar-cotacao/${Buffer.from(compraId+':0').toString('base64')}" style="display:inline-block;background:#d32f2f;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold">❌ Negar</a>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const t = nodemailer.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await t.sendMail({from:process.env.SMTP_USER,to:approvalEmail,subject:titulo,html});
}


async function emailComFornecedores(titulo, compraId, cotacoes, compra, appUrl="https://ft-flow.netlify.app", emailDest=null){
  if(!process.env.SMTP_USER||!process.env.SMTP_PASS) return;
  const approvalEmail = emailDest || process.env.APPROVAL_EMAIL || 'dorian@floresdaterra.com.br';
  
  // Construir cards de fornecedores com descrição completa
  let fornecedoresHtml = '';
  for (const cot of cotacoes) {
    const token = Buffer.from(`${compraId}:${cot.id}`).toString('base64');
    const linkAprovacao = `${appUrl}/api/aprovar-cotacao/${token}`;
    fornecedoresHtml += `
      <div style="border:1px solid #ddd;border-radius:6px;padding:15px;margin-bottom:15px;background-color:#f9f9f9">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #eee;padding-bottom:10px">
          <span style="font-size:16px;font-weight:bold;color:#1b5e20">${cot.fornecedor}</span>
          <span style="font-size:18px;font-weight:bold;color:#2e7d32">R$ ${Number(cot.valor).toFixed(2)}</span>
        </div>
        ${cot.observacao ? `<div style="font-size:13px;color:#555;line-height:1.5;margin-bottom:10px;padding:10px;background-color:#fff;border-left:3px solid #1b5e20"><strong>Descrição:</strong><br>${cot.observacao}</div>` : ''}
        <div style="text-align:center;margin-top:15px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="${linkAprovacao}" style="display:inline-block;background:#2e7d32;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold">✅ Selecionar</a>
          <a href="${appUrl}/api/negar-cotacao/${token}" style="display:inline-block;background:#d32f2f;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold">❌ Negar</a>
          <a href="${appUrl}/api/questionar-cotacao/${token}" style="display:inline-block;background:#ff9800;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold">❓ Questionar</a>
        </div>
      </div>
    `;
  }
  
  const infoCompra = `
    <div style="background:#f9f9f9;padding:15px;border-radius:8px;margin:15px 0">
      <h3 style="margin:0 0 10px 0;color:#1b5e20">📋 Detalhes da Compra</h3>
      <p style="margin:5px 0"><strong>Produto:</strong> ${compra.descricao || compra.item}</p>
      <p style="margin:5px 0"><strong>Quantidade:</strong> ${compra.quantidade} ${compra.unidade}</p>
      <p style="margin:5px 0"><strong>Destino/Uso:</strong> ${compra.destino}</p>
      <p style="margin:5px 0"><strong>Solicitante:</strong> ${compra.solicitante}</p>
    </div>
  `;
  
  // Verificar se ja foi aprovado
  const compraAtual = await q('SELECT status, fornecedor_escolhido, valor_escolhido FROM compras WHERE id=$1', [compraId]);
  const jaAprovado = compraAtual.rows[0]?.status === 'Aprovado';
  
  let conteudoEmail = '';
  if (jaAprovado) {
    conteudoEmail = `
      <div style="background:#e8f5e9;padding:15px;border-radius:8px;border-left:4px solid #4caf50;margin:15px 0">
        <p style="margin:0;color:#2e7d32"><strong>✅ JÁ APROVADO</strong></p>
      </div>
      <div style="background:#f9f9f9;padding:15px;border-radius:8px;margin:15px 0">
        <p style="margin:5px 0"><strong>Fornecedor:</strong> ${compraAtual.rows[0].fornecedor_escolhido}</p>
        <p style="margin:5px 0"><strong>Valor:</strong> R$ ${Number(compraAtual.rows[0].valor_escolhido).toFixed(2)}</p>
      </div>
    `;
  } else {
    conteudoEmail = `
      <div style="margin:15px 0">
        <h3 style="color:#1b5e20;margin-bottom:15px">🏪 Fornecedores Disponíveis</h3>
        <p style="font-size:13px;color:#666;margin-bottom:15px">Clique no fornecedor escolhido para confirmar automaticamente:</p>
        ${fornecedoresHtml}
      </div>
    `;
  }
  
  const html = `
    <div style="font-family:Arial;background:#f3f7f4;padding:24px">
      <div style="max-width:700px;margin:auto;background:white;border-radius:18px;overflow:hidden">
        <div style="background:#1b5e20;padding:30px;color:white;text-align:center">
          <h1 style="margin:0;font-size:24px">Cotação #${compraId}</h1>
          <p style="margin:5px 0 0 0;opacity:0.9">Aguardando Aprovação</p>
        </div>
        <div style="padding:30px">
          ${infoCompra}
          ${conteudoEmail}
        </div>
      </div>
    </div>
  `;
  
  const t = nodemailer.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await t.sendMail({from:process.env.SMTP_USER,to:approvalEmail,subject:titulo,html});
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
    
    // Se for lista de compra, salvar como um único pedido
    if (b.tipo_solicitacao === 'lista' && b.itens && Array.isArray(b.itens)) {
      // Salvar pedido principal sem item específico
      const r = await q(
        `INSERT INTO compras (item,quantidade,unidade,categoria,destino,solicitante,status,tipo_solicitacao,descricao,link_produto,foto_url,status_lista) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        ['Lista de Compra', 0, '', 'Lista de Compra', 'Lista de Compra', b.solicitante || 'Não informado', b.status_lista === 'pronta' ? 'Em cotação' : 'Rascunho', 'lista', 'Lista de compra', null, null, b.status_lista || 'rascunho']
      );
      const compraId = r.rows[0].id;
      
      // Salvar cada item da lista com múltiplos fornecedores
      for (const item of b.itens) {
        // Normalizar fornecedores: aceita array de fornecedores ou campo único legado
        const fornecedores = Array.isArray(item.fornecedores) && item.fornecedores.length > 0
          ? item.fornecedores
          : (item.fornecedor ? [{fornecedor: item.fornecedor, preco: item.preco}] : []);
        const primForn = fornecedores[0] || {};
        const itemResult = await q(
          `INSERT INTO lista_compras_itens (compra_id, produto, quantidade, unidade, fornecedor, preco) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [compraId, item.produto, item.quantidade, item.unidade, primForn.fornecedor || '', Number(primForn.preco) || 0]
        );
        const itemId = itemResult.rows[0].id;
        // Criar cotação para cada fornecedor do item (sempre, não só quando pronta)
        for (const forn of fornecedores) {
          if (forn.fornecedor && forn.preco) {
            await q(
              `INSERT INTO cotacoes (compra_id, item_id, fornecedor, valor) VALUES ($1, $2, $3, $4)`,
              [compraId, itemId, forn.fornecedor, Number(forn.preco)]
            );
          }
        }
      }
      
      // Notificar
      const itensTexto = b.itens.map(i => `${i.produto} (${i.quantidade} ${i.unidade})`).join(', ');
      await notify('Nova Lista de Compra', `Itens: ${itensTexto}`, 'compra', {
        ID: `#${compraId}`,
        Solicitante: b.solicitante,
        'Quantidade de itens': b.itens.length,
        Status: b.status_lista === 'pronta' ? 'Pronta para Cotação' : 'Rascunho',
        Itens: itensTexto.slice(0, 200)
      });
      
      return res.json({id: compraId});
    }
    
    // Compra regular
    if(!unidadeMedidaValida(b.unidade)) return res.status(400).json({error:"Selecione uma unidade de medida válida"});
    // Garantir colunas uso e destinatario existem
    await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS uso TEXT`).catch(()=>{});
    await q(`ALTER TABLE compras ADD COLUMN IF NOT EXISTS destinatario TEXT`).catch(()=>{});
    const r=await q(
      `INSERT INTO compras (item,quantidade,unidade,categoria,destino,uso,destinatario,solicitante,status,valor_unitario,valor_total,descricao,link_produto,foto_url,tipo_solicitacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [b.item,b.quantidade,b.unidade||null,b.categoria,b.destino,b.uso||null,b.destinatario||null,b.solicitante||"Não informado","Em cotação",Number(b.valor_unitario||0),Number(b.valor_total||0),b.descricao_detalhada||b.descricao||null,b.link_produto||null,b.foto_url||null,'compra']
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

app.get("/compras/:id/itens",async(req,res)=>{
  try{
    const compraId = req.params.id;
    const itens = await q(`SELECT * FROM lista_compras_itens WHERE compra_id=$1 ORDER BY id ASC`, [compraId]);
    const cotacoes = await q(`SELECT * FROM cotacoes WHERE compra_id=$1 ORDER BY item_id ASC, valor ASC`, [compraId]);
    // Agrupar cotações por item_id
    const result = itens.rows.map(item => {
      const fornecedoresItem = cotacoes.rows
        .filter(c => c.item_id === item.id)
        .map(c => ({ id: c.id, fornecedor: c.fornecedor, preco: c.valor }));
      return { ...item, fornecedores: fornecedoresItem };
    });
    res.json(result);
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.get("/compras/:id/aprovacoes",async(req,res)=>{
  try{
    const r = await q(`SELECT lca.*, lci.produto, lci.quantidade, lci.unidade FROM lista_compras_aprovacoes lca LEFT JOIN lista_compras_itens lci ON lca.item_id = lci.id WHERE lca.compra_id=$1 ORDER BY lca.id ASC`,[req.params.id]);
    res.json(r.rows);
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.get("/compras/:id/cotacoes",async(req,res)=>{
  try{
    const r = await q(`SELECT c.*, lci.produto as item_nome, lci.quantidade as item_qtd, lci.unidade as item_unidade FROM cotacoes c LEFT JOIN lista_compras_itens lci ON c.item_id = lci.id WHERE c.compra_id=$1 ORDER BY c.item_id ASC, c.valor ASC`,[req.params.id]);
    res.json(r.rows);
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.get("/cotacoes/:id",async(req,res)=>{
  try{
    const r = await q(`SELECT * FROM cotacoes WHERE id=$1`,[req.params.id]);
    res.json(r.rows[0] || {});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.post("/compras/:id/cotacoes",async(req,res)=>{
  try{
    const b=req.body;
    const r=await q(`INSERT INTO cotacoes (compra_id,fornecedor,valor,observacao,item_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,[req.params.id,b.fornecedor,b.valor,b.observacao,b.item_id||null]);
    res.json({id:r.rows[0].id});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

app.put("/cotacoes/:id",async(req,res)=>{
  try{
    const b=req.body;
    await q(`UPDATE cotacoes SET fornecedor=$1,valor=$2,observacao=$3 WHERE id=$4`,[b.fornecedor,b.valor,b.observacao,req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
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

// Aprovar lista de compra diretamente no app com seleções por item
app.post('/compras/:id/aprovar-lista-no-app', async (req, res) => {
  try {
    const id = req.params.id;
    const { aprovador, selecoes } = req.body;
    if (!aprovador) return res.status(400).json({ error: 'Informe o aprovador' });
    if (!selecoes || selecoes.length === 0) return res.status(400).json({ error: 'Nenhuma seleção fornecida' });
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [id]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    if (compra.rows[0].status !== 'Pendente_aprovacao') return res.status(400).json({ error: 'Esta lista não está pendente de aprovação' });
    
    // Salvar cada seleção
    for (const sel of selecoes) {
      await q('INSERT INTO lista_compras_aprovacoes (compra_id, item_id, cotacao_id, fornecedor, valor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [id, sel.item_id, sel.cotacao_id, sel.fornecedor, sel.valor]);
    }
    
    // Calcular total
    const totalValor = selecoes.reduce((s, sel) => s + Number(sel.valor || 0), 0);
    
    // Atualizar status
    await q(`UPDATE compras SET status='Aprovado', received_at=NOW() WHERE id=$1`, [id]);
    
    // Buscar itens para o email
    const itens = await q('SELECT * FROM lista_compras_itens WHERE compra_id=$1 ORDER BY id ASC', [id]);
    
    // Montar detalhes dos fornecedores por item
    const detalhes = selecoes.map(sel => {
      const item = itens.rows.find(i => i.id === sel.item_id);
      return `${item ? item.produto : 'Item'}: ${sel.fornecedor} — R$ ${Number(sel.valor).toFixed(2)}`;
    }).join('\n');
    
    const titulo = `✅ Lista #${id} - Aprovada por ${aprovador} (App)`;
    const dados = {
      'Lista': `#${id}`,
      'Aprovado por': `${aprovador} (via app)`,
      'Itens aprovados': selecoes.length,
      'Valor Total': `R$ ${totalValor.toFixed(2)}`,
      'Detalhes': detalhes
    };
    
    await notify(titulo, `Lista #${id} aprovada por ${aprovador}. ${selecoes.length} item(ns), total R$ ${totalValor.toFixed(2)}.`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.json({ ok: true, total: totalValor, aprovacoes: selecoes.length });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Aprovar compra diretamente no app com email ao admin
app.post('/compras/:id/aprovar-no-app', async (req, res) => {
  try {
    const id = req.params.id;
    const { aprovador } = req.body;
    if (!aprovador) return res.status(400).json({ error: 'Informe o aprovador' });
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [id]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    const c = compra.rows[0];
    
    // Só permite aprovar se estiver Pendente_aprovacao
    if (c.status !== 'Pendente_aprovacao') {
      return res.status(400).json({ error: `Esta compra não está pendente de aprovação (status atual: ${c.status})` });
    }
    
    const { fornecedor, valor } = req.body;
    let updateQuery = `UPDATE compras SET status='Aprovado', received_at=NOW()`;
    const updateParams = [];
    if (fornecedor) {
      updateQuery += `, fornecedor_escolhido=$${updateParams.length + 2}, valor_escolhido=$${updateParams.length + 3}`;
      updateParams.push(fornecedor, valor || 0);
    }
    updateQuery += ` WHERE id=$1`;
    await q(updateQuery, [id, ...updateParams]);
    
    const titulo = `✅ Compra #${id} - Aprovada por ${aprovador} (App)`;
    const dados = {
      'Compra': `#${id}`,
      'Produto': c.descricao || c.item,
      'Fornecedor': c.fornecedor_escolhido || 'Não informado',
      'Valor': c.valor_escolhido ? `R$ ${Number(c.valor_escolhido).toFixed(2)}` : '-',
      'Aprovado por': `${aprovador} (via app)`,
      'Data': new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
    
    await notify(titulo, `Compra #${id} (${c.item}) foi aprovada por ${aprovador} diretamente no app.`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Confirmar recebimento com email ao admin
app.post('/compras/:id/confirmar-recebimento', async (req, res) => {
  try {
    const id = req.params.id;
    const compra = await q('SELECT * FROM compras WHERE id=$1', [id]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    const c = compra.rows[0];
    const confirmedBy = req.user?.nome || req.user?.username || 'Admin';
    
    await q(`UPDATE compras SET status='Recebido', received_at=NOW() WHERE id=$1`, [id]);
    
    const titulo = `✅ Compra #${id} - Recebimento Confirmado`;
    const dados = {
      'Compra': `#${id}`,
      'Produto': c.descricao || c.item,
      'Fornecedor': c.fornecedor_escolhido || 'Não informado',
      'Valor': c.valor_escolhido ? `R$ ${Number(c.valor_escolhido).toFixed(2)}` : '-',
      'Confirmado por': confirmedBy,
      'Data': new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
    
    await notify(titulo, `Recebimento da compra #${id} (${c.item}) foi confirmado por ${confirmedBy}.`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Enviar cotação para aprovação
app.post("/compras/:id/enviar-aprovacao", async (req, res) => {
  try {
    const compraId = req.params.id;
    
    // Obter email de aprovação com base no destinatário da compra
    const DORIAN_EMAIL = process.env.APPROVAL_EMAIL || 'dorian@floresdaterra.com.br';
    const FELIPE_EMAIL = 'felipe@floresdaterra.com.br';
    
    // Buscar a compra e todos os fornecedores
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    const cotacoes = await q('SELECT * FROM cotacoes WHERE compra_id=$1 ORDER BY valor ASC', [compraId]);
    
    if (!cotacoes.rows.length) return res.status(400).json({ error: 'Nenhuma cotação adicionada' });
    
    // Determinar destinatário(s) do email - prioriza o body, depois o banco
    const destinatario = req.body?.destinatario || compra.rows[0].destinatario || 'dorian';
    
    // Atualizar destinatario no banco se veio no body
    if (req.body?.destinatario) {
      await q('UPDATE compras SET destinatario=$1 WHERE id=$2', [req.body.destinatario, compraId]);
    }
    let emailsDestinatarios = [];
    if (destinatario === 'dorian') emailsDestinatarios = [DORIAN_EMAIL];
    else if (destinatario === 'felipe') emailsDestinatarios = [FELIPE_EMAIL];
    else if (destinatario === 'ambos') emailsDestinatarios = [DORIAN_EMAIL, FELIPE_EMAIL];
    else emailsDestinatarios = [DORIAN_EMAIL];
    
    // Atualizar status para "Pendente_aprovacao"
    await q(`UPDATE compras SET status='Pendente_aprovacao' WHERE id=$1`, [compraId]);
    
    // Registrar no audit log
    await q('INSERT INTO audit_log (actor_id, action, target_table, target_id, meta) VALUES ($1,$2,$3,$4,$5)',
      [req.user?.id || 0, 'enviar_aprovacao', 'compras', compraId, JSON.stringify({
        total_fornecedores: cotacoes.rows.length,
        emails: emailsDestinatarios
      })]);
    
    const appUrl = process.env.APP_URL || 'https://ft-flow.netlify.app';
    
    // Se for lista de compra, enviar email diferente
    if (compra.rows[0].tipo_solicitacao === 'lista') {
      const itens = await q('SELECT * FROM lista_compras_itens WHERE compra_id=$1 ORDER BY id ASC', [compraId]);
      const titulo = `Lista de Compra #${compraId} - Aguardando Aprovação`;
      await notify(titulo, `Lista de compra #${compraId} pronta para aprovação. ${itens.rows.length} item(ns) com ${cotacoes.rows.length} cotação(ões).`, 'compra', {
        'ID': `#${compraId}`,
        'Itens': itens.rows.length,
        'Cotações': cotacoes.rows.length
      }).catch(e => console.log('Notify err', e.message));
      // Enviar para cada destinatário
      for (const emailDest of emailsDestinatarios) {
        await emailComFornecedoresLista(titulo, compraId, itens.rows, cotacoes.rows, appUrl, emailDest).catch(e => console.log('Email err', e.message));
      }
    } else {
      // Compra regular
      const titulo = `Cotação #${compraId} - ${compra.rows[0].item} - Aguardando Aprovação`;
      const dados = {
        'Produto': compra.rows[0].item,
        'Quantidade': `${compra.rows[0].quantidade} ${compra.rows[0].unidade||''}`,
        'Solicitante': compra.rows[0].solicitante,
        'Destino': compra.rows[0].destino,
        'Uso': compra.rows[0].uso || '-',
        'Total de Fornecedores': cotacoes.rows.length,
        'Melhor Preço': `R$ ${Number(cotacoes.rows[0].valor).toFixed(2)} (${cotacoes.rows[0].fornecedor})`
      };
      await notify(titulo, `Cotação #${compraId} pronta para aprovação. ${cotacoes.rows.length} fornecedor(es) disponível(is).`, 'compra', dados).catch(e => console.log('Notify err', e.message));
      // Enviar para cada destinatário
      for (const emailDest of emailsDestinatarios) {
        await emailComFornecedores(titulo, compraId, cotacoes.rows, compra.rows[0], appUrl, emailDest).catch(e => console.log('Email err', e.message));
      }
    }
    
    res.json({ ok: true, emails: emailsDestinatarios, fornecedores: cotacoes.rows.length });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// DELETE compra (admin only) - hard delete
// Aprovar fornecedor selecionado pela patroa
app.post("/compras/:id/aprovar-fornecedor", async (req, res) => {
  try {
    const compraId = req.params.id;
    const { fornecedor, valor } = req.body;
    
    if (!fornecedor || !valor) return res.status(400).json({ error: 'Fornecedor e valor obrigatórios' });
    
    // Atualizar status para "Aprovado" e salvar fornecedor escolhido
    await q(`UPDATE compras SET status='Aprovado', fornecedor_escolhido=$1, valor_escolhido=$2, received_at=NOW() WHERE id=$3`,
      [fornecedor, valor, compraId]);
    
    // Registrar no audit log
    await q('INSERT INTO audit_log (actor_id, action, target_table, target_id, meta) VALUES ($1,$2,$3,$4,$5)',
      [req.user?.id || 0, 'aprovar_fornecedor', 'compras', compraId, JSON.stringify({
        fornecedor,
        valor
      })]);
    
    // Buscar dados da compra para notificação
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    
    // Enviar notificação
    const titulo = `Cotação #${compraId} - Aprovada`;
    const dados = {
      'Produto': compra.rows[0].descricao,
      'Fornecedor Escolhido': fornecedor,
      'Valor': `R$ ${Number(valor).toFixed(2)}`
    };
    
    await notify(titulo, `Cotação #${compraId} foi aprovada. Fornecedor: ${fornecedor}`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
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
    const aguardandoPeca = await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status='Aguardando peça'`);
    const comprasPendentes = await q(`SELECT COUNT(*)::int total FROM compras WHERE status IN ('Em cotação','Aprovado')`);
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
      [b.solicitante || 'Não informado', b.data_ocorrencia || new Date().toISOString().split('T')[0], b.tipo, b.local_item, b.defeito, b.urgencia || 'Normal', 'Aberto']
    );
    
    // Se precisa de compra, criar automaticamente
    if (b.precisa_compra === '1' || b.precisa_compra === true) {
      const compra = await q(
        `INSERT INTO compras (item, quantidade, unidade, solicitante, categoria, destino, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [b.item_compra || 'Peça para manutenção', b.quantidade_compra || 1, b.unidade_compra || 'un', b.solicitante || 'Não informado', 'Peças de manutenção', 'Manutenção', 'Em cotação']
      );
      
      // Registrar no audit log
      await q('INSERT INTO audit_log (actor_id, action, target_table, target_id, meta) VALUES ($1,$2,$3,$4,$5)',
        [req.user?.id || 0, 'criar_compra_manutencao', 'compras', compra.rows[0].id, JSON.stringify({
          manutencao_id: r.rows[0].id,
          item: b.item_compra,
          quantidade: b.quantidade_compra
        })]
      );
    }
    
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

app.delete('/manutencoes/:id', async (req, res) => {
  try {
    await q(`DELETE FROM manutencoes WHERE id=$1`, [req.params.id]);
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

app.get('/estoque/:id/historico', async (req, res) => {
  try {
    const r = await q(`SELECT * FROM estoque_historico WHERE estoque_id=$1 ORDER BY data DESC`, [req.params.id]);
    res.json(r.rows || []);
  } catch (e) { console.error(e); res.json([]); }
});

app.put('/estoque/:id', async (req, res) => {
  try {
    const b = req.body;
    await q(`UPDATE estoque SET nome=$1, categoria=$2, unidade=$3, quantidade=$4, minimo=$5, foto_url=$6, fornecedor=$7, local=$8, observacoes=$9 WHERE id=$10`, 
      [b.nome, b.categoria, b.unidade, Number(b.quantidade || 0), Number(b.minimo || 0), b.foto_url || null, b.fornecedor || null, b.local || null, b.observacoes || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Rota para processar aprovacao via email (sem autenticacao)
// Página para Dorian selecionar fornecedores por item
app.get('/selecionar-fornecedores-lista/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const compraId = decoded.replace('lista:', '');
    
    if (!compraId) return res.status(400).json({ error: 'Token inválido' });
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    const aprovNomeLista = compra.rows[0].destinatario === 'felipe' ? 'Felipe' : 'Dorian';
    
    // Verificar se já foi processada
    if (compra.rows[0].status === 'Aprovado') {
      return res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.icon{font-size:48px;margin-bottom:20px}h1{color:#1565c0;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="icon">ℹ️</div><h1>Já Aprovada!</h1><p>Esta lista de compra já foi aprovada anteriormente por ${aprovNomeLista}.</p><p style="color:#999;font-size:12px;margin-top:30px">Nenhuma ação necessária.</p></div></body></html>`);
    }
    if (compra.rows[0].status === 'Negada') {
      return res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.icon{font-size:48px;margin-bottom:20px}h1{color:#c62828;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="icon">❌</div><h1>Já Negada!</h1><p>Esta lista de compra já foi negada anteriormente.</p><p style="color:#999;font-size:12px;margin-top:30px">Nenhuma ação necessária.</p></div></body></html>`);
    }
    
    const itens = await q('SELECT * FROM lista_compras_itens WHERE compra_id=$1 ORDER BY id ASC', [compraId]);
    const cotacoes = await q('SELECT * FROM cotacoes WHERE compra_id=$1 ORDER BY item_id ASC, valor ASC', [compraId]);
    
    // Construir HTML com checkboxes
    let itensHtml = '';
    for (const item of itens.rows) {
      const cotacoesItem = cotacoes.rows.filter(c => c.item_id === item.id);
      
      itensHtml += `
        <div style="background:#f0f8f5;padding:20px;border-radius:8px;margin-bottom:20px;border-left:4px solid #1b5e20">
          <h4 style="margin:0 0 15px 0;color:#1b5e20">${item.produto}</h4>
          <p style="margin:5px 0;font-size:13px;color:#555"><strong>Quantidade:</strong> ${item.quantidade} ${item.unidade}</p>
          
          <div style="margin-top:15px">
            <p style="margin:10px 0 10px 0;font-size:12px;color:#666;font-weight:bold">Selecione um fornecedor:</p>
      `;
      
      if (cotacoesItem.length === 0) {
        itensHtml += `<p style="margin:5px 0;font-size:12px;color:#999">Nenhuma cotação disponível</p>`;
      } else {
        for (const cot of cotacoesItem) {
          itensHtml += `
            <label style="display:flex;align-items:center;padding:10px;margin:8px 0;background:white;border:2px solid #ddd;border-radius:4px;cursor:pointer;transition:all 0.2s">
              <input type="radio" name="item_${item.id}" value="${cot.id}" style="margin-right:10px;cursor:pointer" />
              <span style="flex:1;font-size:13px">${cot.fornecedor}</span>
              <span style="font-size:14px;font-weight:bold;color:#2e7d32">R$ ${Number(cot.valor).toFixed(2)}</span>
            </label>
          `;
        }
      }
      
      itensHtml += `
          </div>
        </div>
      `;
    }
    
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f3f7f4;
              padding: 20px;
              margin: 0;
            }
            .container {
              max-width: 700px;
              margin: auto;
              background: white;
              border-radius: 12px;
              overflow: hidden;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .header {
              background: #1b5e20;
              padding: 30px;
              color: white;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
            }
            .header p {
              margin: 5px 0 0 0;
              opacity: 0.9;
            }
            .content {
              padding: 30px;
            }
            .total {
              background: #e8f5e9;
              padding: 15px;
              border-radius: 8px;
              margin-bottom: 20px;
              border-left: 4px solid #1b5e20;
            }
            .total p {
              margin: 5px 0;
              color: #1b5e20;
            }
            .actions {
              display: flex;
              gap: 10px;
              margin-top: 30px;
              justify-content: center;
              flex-wrap: wrap;
            }
            button {
              padding: 12px 24px;
              border: none;
              border-radius: 4px;
              font-weight: bold;
              cursor: pointer;
              font-size: 14px;
              transition: all 0.2s;
            }
            .btn-aprovar {
              background: #2e7d32;
              color: white;
            }
            .btn-aprovar:hover {
              background: #1b5e20;
            }
            .btn-cancelar {
              background: #ddd;
              color: #333;
            }
            .btn-cancelar:hover {
              background: #ccc;
            }
            .error {
              color: #d32f2f;
              padding: 10px;
              background: #ffebee;
              border-radius: 4px;
              margin-bottom: 15px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Lista de Compra #${compraId}</h1>
              <p>Selecione os fornecedores desejados</p>
            </div>
            <div class="content">
              <div class="total">
                <p><strong>Total de itens:</strong> ${itens.rows.length}</p>
              </div>
              
              <form id="formSelecao">
                ${itensHtml}
                
                <div class="actions">
                  <button type="submit" class="btn-aprovar">✅ Aprovar Selecionados</button>
                  <button type="button" class="btn-cancelar" onclick="window.close()">Cancelar</button>
                </div>
              </form>
            </div>
          </div>
          
          <script>
            document.getElementById('formSelecao').addEventListener('submit', async (e) => {
              e.preventDefault();
              
              const formData = new FormData(e.target);
              const selecoes = [];
              
              for (const [key, value] of formData.entries()) {
                if (key.startsWith('item_')) {
                  const itemId = key.replace('item_', '');
                  selecoes.push({ item_id: itemId, cotacao_id: value });
                }
              }
              
              if (selecoes.length === 0) {
                alert('Selecione pelo menos um fornecedor!');
                return;
              }
              
              try {
                const response = await fetch('${process.env.APP_URL || 'https://ft-flow.netlify.app'}/api/aprovar-lista-fornecedores/${compraId}', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ selecoes })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                  document.body.innerHTML = '<div style="font-family:Arial;text-align:center;padding:40px"><div style="background:white;padding:40px;border-radius:12px;max-width:500px;margin:auto;box-shadow:0 2px 8px rgba(0,0,0,0.1)"><div style="font-size:48px;color:#2e7d32;margin-bottom:20px">✅</div><h1 style="color:#052e16;margin:0 0 10px 0">Aprovação Confirmada!</h1><p style="color:#666">Sua seleção foi salva com sucesso.</p><p style="color:#999;font-size:12px;margin-top:30px">O admin foi notificado sobre as escolhas.</p></div></div>';
                } else {
                  alert('Erro: ' + (data.error || 'Falha ao aprovar'));
                }
              } catch (err) {
                alert('Erro ao enviar: ' + err.message);
              }
            });
          </script>
        </body>
      </html>
    `;
    
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`);
  }
});


app.get('/aprovar-cotacao/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [compraId, cotacaoId] = decoded.split(':');
    
    if (!compraId || !cotacaoId) return res.status(400).json({ error: 'Token inválido' });
    
    const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1 AND compra_id=$2', [cotacaoId, compraId]);
    if (!cotacao.rows[0]) return res.status(404).json({ error: 'Cotação não encontrada' });
    
    // Verificar se já foi processada
    const compraAtual = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    if (compraAtual.rows[0]?.status === 'Aprovado') {
      const aprovNome = compraAtual.rows[0].destinatario === 'felipe' ? 'Felipe' : 'Dorian';
      return res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.icon{font-size:48px;margin-bottom:20px}h1{color:#1565c0;margin:0 0 10px 0}p{color:#666;margin:10px 0}.details{background:#e3f2fd;padding:20px;border-radius:8px;margin:20px 0;text-align:left;border-left:4px solid #1565c0}.details p{margin:8px 0}strong{color:#1565c0}</style></head><body><div class="card"><div class="icon">ℹ️</div><h1>Já Aprovada!</h1><p>Esta cotação já foi aprovada anteriormente por ${aprovNome}.</p><div class="details"><p><strong>Compra:</strong> #${compraId}</p><p><strong>Fornecedor:</strong> ${compraAtual.rows[0].fornecedor_escolhido || '-'}</p><p><strong>Valor:</strong> R$ ${Number(compraAtual.rows[0].valor_escolhido||0).toFixed(2)}</p></div><p style="color:#999;font-size:12px;margin-top:30px">Nenhuma ação necessária.</p></div></body></html>`);
    }
    if (compraAtual.rows[0]?.status === 'Negada') {
      return res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.icon{font-size:48px;margin-bottom:20px}h1{color:#c62828;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="icon">❌</div><h1>Já Negada!</h1><p>Esta cotação já foi negada anteriormente.</p><p style="color:#999;font-size:12px;margin-top:30px">Nenhuma ação necessária.</p></div></body></html>`);
    }
    
    const { fornecedor, valor } = cotacao.rows[0];
    
    await q(`UPDATE compras SET status='Aprovado', fornecedor_escolhido=$1, valor_escolhido=$2, received_at=NOW() WHERE id=$3`,
      [fornecedor, valor, compraId]);
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    
    const aprovadorNome = compra.rows[0].destinatario === 'felipe' ? 'Felipe' : 'Dorian';
    
    const titulo = `Cotação #${compraId} - Aprovada por ${aprovadorNome}`;
    const dados = {
      'Produto': compra.rows[0].descricao || compra.rows[0].item,
      'Fornecedor Escolhido': fornecedor,
      'Valor': `R$ ${Number(valor).toFixed(2)}`,
      'Aprovado por': `${aprovadorNome} (via email)`
    };
    
    await notify(titulo, `Cotação #${compraId} foi aprovada por ${aprovadorNome}. Fornecedor: ${fornecedor}`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.success{color:#052e16;font-size:48px;margin-bottom:20px}h1{color:#052e16;margin:0 0 10px 0}p{color:#666;margin:10px 0}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;text-align:left}.details p{margin:8px 0}strong{color:#052e16}</style></head><body><div class="card"><div class="success">✅</div><h1>Aprovação Confirmada!</h1><p>A cotação foi aprovada com sucesso por ${aprovadorNome}.</p><div class="details"><p><strong>Cotação:</strong> #${compraId}</p><p><strong>Fornecedor:</strong> ${fornecedor}</p><p><strong>Valor:</strong> R$ ${Number(valor).toFixed(2)}</p></div><p style="color:#999;font-size:12px;margin-top:30px">O admin foi notificado sobre esta aprovação.</p></div></body></html>`);
  } catch (e) { console.error(e); res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`); }
});

// Negar cotação
// Aprovar seleções de fornecedores por item
app.post('/aprovar-lista-fornecedores/:compraId', async (req, res) => {
  try {
    const compraId = req.params.compraId;
    const { selecoes } = req.body;
    
    if (!selecoes || selecoes.length === 0) {
      return res.status(400).json({ error: 'Nenhuma seleção fornecida' });
    }
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    // Salvar cada seleção
    for (const sel of selecoes) {
      const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1', [sel.cotacao_id]);
      if (cotacao.rows[0]) {
        await q(
          'INSERT INTO lista_compras_aprovacoes (compra_id, item_id, cotacao_id, fornecedor, valor) VALUES ($1, $2, $3, $4, $5)',
          [compraId, sel.item_id, sel.cotacao_id, cotacao.rows[0].fornecedor, cotacao.rows[0].valor]
        );
      }
    }
    
    // Atualizar status para Aprovado
    await q('UPDATE compras SET status=$1 WHERE id=$2', ['Aprovado', compraId]);
    
    // Buscar itens para notificação
    const itens = await q('SELECT * FROM lista_compras_itens WHERE compra_id=$1', [compraId]);
    const aprovacoes = await q('SELECT * FROM lista_compras_aprovacoes WHERE compra_id=$1', [compraId]);
    
    // Calcular total
    let totalValor = 0;
    for (const apr of aprovacoes.rows) {
      totalValor += apr.valor;
    }
    
    // Notificar admin
    const aprovadorNome = compra.rows[0].destinatario === 'felipe' ? 'Felipe' : (compra.rows[0].destinatario === 'ambos' ? 'Dorian/Felipe' : 'Dorian');
    const titulo = `Lista de Compra #${compraId} - Aprovada por ${aprovadorNome}`;
    const dados = {
      'ID': `#${compraId}`,
      'Itens': itens.rows.length,
      'Fornecedores Selecionados': aprovacoes.rows.length,
      'Valor Total': `R$ ${totalValor.toFixed(2)}`,
      'Aprovado por': `${aprovadorNome} (via email)`
    };
    
    await notify(titulo, `Lista de compra #${compraId} foi aprovada por ${aprovadorNome} com ${aprovacoes.rows.length} fornecedor(es) selecionado(s).`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.json({ ok: true, aprovacoes: aprovacoes.rows.length, total: totalValor });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


app.get('/negar-cotacao/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [compraId, cotacaoId] = decoded.split(':');
    
    if (!compraId) return res.status(400).json({ error: 'Token inválido' });
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    const aprovadorNome = compra.rows[0].destinatario === 'felipe' ? 'Felipe' : 'Dorian';
    
    // Verificar se já foi processada
    if (compra.rows[0].status === 'Aprovado') {
      return res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.icon{font-size:48px;margin-bottom:20px}h1{color:#1565c0;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="icon">ℹ️</div><h1>Já Aprovada!</h1><p>Esta compra já foi aprovada anteriormente por ${aprovadorNome}.</p><p style="color:#999;font-size:12px;margin-top:30px">Nenhuma ação necessária.</p></div></body></html>`);
    }
    if (compra.rows[0].status === 'Negada') {
      return res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.icon{font-size:48px;margin-bottom:20px}h1{color:#c62828;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="icon">❌</div><h1>Já Negada!</h1><p>Esta compra já foi negada anteriormente.</p><p style="color:#999;font-size:12px;margin-top:30px">Nenhuma ação necessária.</p></div></body></html>`);
    }
    
    // Marcar compra como negada
    await q(`UPDATE compras SET status='Negada' WHERE id=$1`, [compraId]);
    
    // Se for lista de compra (cotacaoId = 0 ou não informado)
    let fornecedor = 'Lista de Compra';
    if (cotacaoId && cotacaoId !== '0') {
      const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1 AND compra_id=$2', [cotacaoId, compraId]);
      if (cotacao.rows[0]) fornecedor = cotacao.rows[0].fornecedor;
    }
    
    const titulo = `Cotação #${compraId} - Negada por ${aprovadorNome}`;
    const dados = {
      'Produto': compra.rows[0].descricao || compra.rows[0].item,
      'Fornecedor': fornecedor,
      'Negado por': `${aprovadorNome} (via email)`
    };
    
    await notify(titulo, `Cotação #${compraId} foi negada por ${aprovadorNome}.`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.warning{color:#d32f2f;font-size:48px;margin-bottom:20px}h1{color:#d32f2f;margin:0 0 10px 0}p{color:#666;margin:10px 0}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;text-align:left}.details p{margin:8px 0}strong{color:#d32f2f}</style></head><body><div class="card"><div class="warning">❌</div><h1>Compra Negada!</h1><p>A solicitação foi negada por ${aprovadorNome}.</p><div class="details"><p><strong>Compra:</strong> #${compraId}</p></div><p style="color:#999;font-size:12px;margin-top:30px">O admin foi notificado sobre esta negação.</p></div></body></html>`);
  } catch (e) { console.error(e); res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`); }
});

// Questionar cotação
app.get('/questionar-cotacao/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [compraId, cotacaoId] = decoded.split(':');
    
    if (!compraId || !cotacaoId) return res.status(400).json({ error: 'Token inválido' });
    
    const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1 AND compra_id=$2', [cotacaoId, compraId]);
    if (!cotacao.rows[0]) return res.status(404).json({ error: 'Cotação não encontrada' });
    
    // Mostrar formulário para Dorian digitar a questão
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial; background: #f3f7f4; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 600px; width: 100%; }
            .icon { color: #ff9800; font-size: 48px; margin-bottom: 20px; }
            h1 { color: #ff9800; margin: 0 0 10px 0; }
            p { color: #666; margin: 10px 0; }
            textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-family: Arial; font-size: 14px; resize: vertical; min-height: 120px; box-sizing: border-box; }
            button { background: #ff9800; color: white; padding: 12px 24px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; width: 100%; margin-top: 15px; }
            button:hover { background: #f57c00; }
            .info { background: #fff3e0; padding: 15px; border-radius: 4px; margin-bottom: 20px; color: #e65100; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">❓</div>
            <h1>Questionar Cotação</h1>
            <p>Descreva sua dúvida ou questão sobre esta cotação:</p>
            <div class="info">
              <strong>Fornecedor:</strong> ${cotacao.rows[0].fornecedor}<br>
              <strong>Valor:</strong> R$ ${Number(cotacao.rows[0].valor).toFixed(2)}
            </div>
            <form method="POST" action="/api/enviar-questionamento/${token}">
              <textarea name="questionamento" placeholder="Ex: Por que essa marca? Temos outras opções mais baratas?" required></textarea>
              <button type="submit">✅ Enviar Questão</button>
            </form>
          </div>
        </body>
      </html>
    `;
    res.send(html);
  } catch (e) { console.error(e); res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`); }
});

// Enviar questionamento
app.post('/enviar-questionamento/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { questionamento } = req.body;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [compraId, cotacaoId] = decoded.split(':');
    
    if (!compraId || !cotacaoId || !questionamento) return res.status(400).json({ error: 'Dados inválidos' });
    
    // Salvar questionamento
    await q(`UPDATE compras SET questionamento=$1, status_questionamento='Pendente' WHERE id=$2`, [questionamento, compraId]);
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1', [cotacaoId]);
    
    const titulo = `Cotação #${compraId} - Questionada por Dorian`;
    const dados = {
      'Produto': compra.rows[0].descricao || compra.rows[0].item,
      'Fornecedor': cotacao.rows[0].fornecedor,
      'Questão': questionamento
    };
    
    // Notificar no app
    await notify(titulo, `Dorian questionou a cotação #${compraId}. Questão: ${questionamento}`, 'compra', dados).catch(e => console.log('Notify err', e.message));
    
    // Enviar email para admin
    const appUrl = process.env.APP_URL || 'https://ft-flow.netlify.app';
    const linkResposta = `${appUrl}/api/responder-questionamento/${token}`;
    const emailAdmin = `
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial; background: #f3f7f4; margin: 0; padding: 20px; }
            .card { background: white; max-width: 600px; margin: 0 auto; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
            .header { background: #ff9800; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .section { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #ff9800; border-radius: 4px; }
            .label { color: #666; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
            .value { color: #333; font-size: 14px; margin-bottom: 10px; }
            .button { display: inline-block; background: #ff9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 15px; }
            .footer { background: #f3f7f4; padding: 15px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #ddd; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h2 style="margin: 0;">❓ Dorian Questionou uma Cotação</h2>
            </div>
            <div class="content">
              <div class="section">
                <div class="label">Produto</div>
                <div class="value">${compra.rows[0].descricao || compra.rows[0].item}</div>
              </div>
              <div class="section">
                <div class="label">Fornecedor</div>
                <div class="value">${cotacao.rows[0].fornecedor}</div>
              </div>
              <div class="section">
                <div class="label">Valor</div>
                <div class="value">R$ ${Number(cotacao.rows[0].valor).toFixed(2)}</div>
              </div>
              <div class="section">
                <div class="label">Questão de Dorian</div>
                <div class="value" style="font-style: italic; color: #ff9800;">${questionamento}</div>
              </div>
              <div style="text-align: center;">
                <a href="${linkResposta}" class="button">✍️ Responder</a>
              </div>
            </div>
            <div class="footer">
              <p>Clique no botão acima para responder a questão de Dorian.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    try {
      const tQ = nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
      await tQ.sendMail({
        from: process.env.SMTP_USER || process.env.SMTP_FROM || 'noreply@ftflow.com',
        to: process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL || 'admin@ftflow.com',
        subject: `❓ Dorian Questionou Cotação #${compraId}`,
        html: emailAdmin
      });
    } catch (e) {
      console.log('Erro ao enviar email para admin:', e.message);
    }
    
    res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.success{color:#ff9800;font-size:48px;margin-bottom:20px}h1{color:#ff9800;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="success">✅</div><h1>Questão Enviada!</h1><p>Sua questão foi enviada para o admin.</p><p style="color:#999;font-size:12px;margin-top:30px">Você receberá uma resposta em breve.</p></div></body></html>`);
  } catch (e) { console.error(e); res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`); }
});

// Responder questionamento
app.get('/responder-questionamento/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [compraId, cotacaoId] = decoded.split(':');
    
    if (!compraId || !cotacaoId) return res.status(400).json({ error: 'Token inválido' });
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1', [cotacaoId]);
    
    if (!compra.rows[0]) return res.status(404).json({ error: 'Compra não encontrada' });
    
    const html = `
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial; background: #f3f7f4; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 700px; width: 100%; }
            .icon { color: #2e7d32; font-size: 48px; margin-bottom: 20px; }
            h1 { color: #2e7d32; margin: 0 0 10px 0; }
            p { color: #666; margin: 10px 0; }
            .question-box { background: #fff3e0; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #ff9800; }
            .question-label { color: #e65100; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
            .question-text { color: #333; font-size: 14px; font-style: italic; }
            textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-family: Arial; font-size: 14px; resize: vertical; min-height: 120px; box-sizing: border-box; }
            button { background: #2e7d32; color: white; padding: 12px 24px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; width: 100%; margin-top: 15px; }
            button:hover { background: #1b5e20; }
            .info { background: #e8f5e9; padding: 15px; border-radius: 4px; margin-bottom: 20px; color: #1b5e20; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✍️</div>
            <h1>Responder Questão de Dorian</h1>
            <div class="info">
              <strong>Produto:</strong> ${compra.rows[0].descricao || compra.rows[0].item}<br>
              <strong>Fornecedor:</strong> ${cotacao.rows[0].fornecedor}<br>
              <strong>Valor:</strong> R$ ${Number(cotacao.rows[0].valor).toFixed(2)}
            </div>
            <div class="question-box">
              <div class="question-label">Questão de Dorian:</div>
              <div class="question-text">${compra.rows[0].questionamento || 'Sem questão registrada'}</div>
            </div>
            <form method="POST" action="/api/enviar-resposta-questionamento/${token}">
              <label style="display: block; margin-bottom: 10px; color: #333; font-weight: bold;">Sua Resposta:</label>
              <textarea name="resposta" placeholder="Escreva sua resposta para Dorian..." required></textarea>
              <button type="submit">✅ Enviar Resposta</button>
            </form>
          </div>
        </body>
      </html>
    `;
    res.send(html);
  } catch (e) { console.error(e); res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`); }
});

// Enviar resposta do questionamento
app.post('/enviar-resposta-questionamento/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { resposta } = req.body;
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [compraId, cotacaoId] = decoded.split(':');
    
    if (!compraId || !cotacaoId || !resposta) return res.status(400).json({ error: 'Dados inválidos' });
    
    // Salvar resposta
    await q(`UPDATE compras SET resposta_admin=$1, status_questionamento='Respondido' WHERE id=$2`, [resposta, compraId]);
    
    const compra = await q('SELECT * FROM compras WHERE id=$1', [compraId]);
    const cotacao = await q('SELECT * FROM cotacoes WHERE id=$1', [cotacaoId]);
    
    // Enviar email para Dorian com a resposta
    const emailDorian = `
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial; background: #f3f7f4; margin: 0; padding: 20px; }
            .card { background: white; max-width: 600px; margin: 0 auto; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
            .header { background: #2e7d32; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .section { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #2e7d32; border-radius: 4px; }
            .label { color: #666; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
            .value { color: #333; font-size: 14px; margin-bottom: 10px; }
            .resposta-box { background: #e8f5e9; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #2e7d32; }
            .footer { background: #f3f7f4; padding: 15px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #ddd; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h2 style="margin: 0;">✅ Sua Questão Foi Respondida!</h2>
            </div>
            <div class="content">
              <div class="section">
                <div class="label">Produto</div>
                <div class="value">${compra.rows[0].descricao || compra.rows[0].item}</div>
              </div>
              <div class="section">
                <div class="label">Fornecedor</div>
                <div class="value">${cotacao.rows[0].fornecedor}</div>
              </div>
              <div class="section">
                <div class="label">Valor</div>
                <div class="value">R$ ${Number(cotacao.rows[0].valor).toFixed(2)}</div>
              </div>
              <div class="section">
                <div class="label">Sua Questão</div>
                <div class="value" style="font-style: italic; color: #ff9800;">${compra.rows[0].questionamento}</div>
              </div>
              <div class="resposta-box">
                <div class="label" style="color: #1b5e20;">Resposta do Admin</div>
                <div class="value" style="color: #1b5e20;">${resposta}</div>
              </div>
            </div>
            <div class="footer">
              <p>Obrigado por usar o FT FLOW!</p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    try {
      const tR = nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||587),secure:false,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
      // Enviar para o destinatário correto (Dorian ou Felipe)
      const emailDestResp = compra.rows[0].destinatario === 'felipe' ? 'felipe@floresdaterra.com.br' : 'dorian@floresdaterra.com.br';
      await tR.sendMail({
        from: process.env.SMTP_USER || process.env.SMTP_FROM || 'noreply@ftflow.com',
        to: emailDestResp,
        subject: `✅ Resposta: Cotação #${compraId}`,
        html: emailDorian
      });
    } catch (e) {
      console.log('Erro ao enviar email para destinatário:', e.message);
    }
    
    res.send(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial;background:#f3f7f4;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:500px}.success{color:#2e7d32;font-size:48px;margin-bottom:20px}h1{color:#2e7d32;margin:0 0 10px 0}p{color:#666;margin:10px 0}</style></head><body><div class="card"><div class="success">✅</div><h1>Resposta Enviada!</h1><p>Dorian receberá a resposta por email.</p><p style="color:#999;font-size:12px;margin-top:30px">Obrigado!</p></div></body></html>`);
  } catch (e) { console.error(e); res.status(500).send(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Erro</h1><p>${e.message}</p></body></html>`); }
});

// Upload de foto
app.post('/upload/foto', async (req, res) => {
  try {
    const { base64, filename } = req.body;
    if (!base64 || !filename) {
      return res.status(400).json({ error: 'base64 e filename sao obrigatorios' });
    }
    
    // Converter base64 para buffer
    const buffer = Buffer.from(base64.split(',')[1] || base64, 'base64');
    
    // Gerar nome unico
    const timestamp = Date.now();
    const nomeUnico = `${timestamp}-${filename}`;
    
    // Retornar URL de dados (data URL)
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    
    res.json({ url: dataUrl, filename: nomeUnico });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao fazer upload: ' + e.message });
  }
});

// Basic fornecedores/notificacoes endpoints
app.get('/fornecedores', async (req, res) => { try{ const r = await q('SELECT * FROM fornecedores ORDER BY nome'); res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});
app.get('/notificacoes', async (req, res) => { try{ const r = await q('SELECT * FROM notificacoes ORDER BY id DESC LIMIT 50'); res.json(r.rows);}catch(e){res.status(500).json({error:e.message})}});
app.put('/notificacoes/:id/marcar-lida', async (req, res) => { try{ await q('UPDATE notificacoes SET lida=1 WHERE id=$1', [req.params.id]); res.json({ok:true});}catch(e){res.status(500).json({error:e.message})}});
app.put('/notificacoes/marcar-todas-lidas', async (req, res) => { try{ await q('UPDATE notificacoes SET lida=1'); res.json({ok:true});}catch(e){res.status(500).json({error:e.message})}});

// Atualizar lista de compra
app.put('/compras/:id', async (req, res) => {
  try {
    const b = req.body;
    const compraId = req.params.id;
    
    // Atualizar dados da compra
    await q(
      `UPDATE compras SET item=$1, solicitante=$2, categoria=$3, destino=$4, status_lista=$5 WHERE id=$6`,
      [b.item, b.solicitante, b.categoria, b.destino, b.status_lista, compraId]
    );
    
    // Remover itens e cotações antigas
    await q(`DELETE FROM cotacoes WHERE compra_id=$1`, [compraId]);
    await q(`DELETE FROM lista_compras_itens WHERE compra_id=$1`, [compraId]);
    
    // Adicionar novos itens com múltiplos fornecedores
    if (b.itens && Array.isArray(b.itens)) {
      for (const item of b.itens) {
        // Normalizar fornecedores: aceita array ou campo único legado
        const fornecedores = Array.isArray(item.fornecedores) && item.fornecedores.length > 0
          ? item.fornecedores
          : (item.fornecedor ? [{fornecedor: item.fornecedor, preco: item.preco}] : []);
        const primForn = fornecedores[0] || {};
        const itemResult = await q(
          `INSERT INTO lista_compras_itens (compra_id, produto, quantidade, unidade, fornecedor, preco) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [compraId, item.produto, item.quantidade, item.unidade, primForn.fornecedor || '', Number(primForn.preco) || 0]
        );
        const itemId = itemResult.rows[0].id;
        // Criar cotação para cada fornecedor
        for (const forn of fornecedores) {
          if (forn.fornecedor && forn.preco) {
            await q(
              `INSERT INTO cotacoes (compra_id, item_id, fornecedor, valor) VALUES ($1, $2, $3, $4)`,
              [compraId, itemId, forn.fornecedor, Number(forn.preco)]
            );
          }
        }
      }
    }
    // Atualizar status da compra conforme status_lista
    await q(`UPDATE compras SET status=$1 WHERE id=$2`,
      [b.status_lista === 'pronta' ? 'Em cotação' : 'Rascunho', compraId]);
    
    res.json({ok: true});
  } catch(e) {
    console.error(e);
    res.status(500).json({error: e.message});
  }
});

// Handler
module.exports.handler = serverless(app);
