const express = require("express");
const serverless = require("serverless-http");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const pdf = require("pdf-parse");

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use((req, res, next) => {
  if (req.url.startsWith("/api/")) {
    req.url = req.url.replace("/api", "");
  }
  next();
});

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
  await q(`CREATE TABLE IF NOT EXISTS movimentacoes_estoque (id SERIAL PRIMARY KEY, produto TEXT, categoria TEXT, quantidade REAL, unidade TEXT, destino TEXT, tipo TEXT, origem TEXT, observacao TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS recomendacoes_pdf (id SERIAL PRIMARY KEY, arquivo TEXT, semana TEXT, status TEXT DEFAULT 'Pendente', created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS recomendacao_itens (id SERIAL PRIMARY KEY, recomendacao_id INTEGER, produto TEXT, quantidade REAL, unidade TEXT, destino TEXT, confirmado INTEGER DEFAULT 0)`);
  await q(`CREATE TABLE IF NOT EXISTS cotacoes_gerais (id SERIAL PRIMARY KEY, titulo TEXT, categoria TEXT, status TEXT DEFAULT 'Aberta', created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS cotacao_itens (id SERIAL PRIMARY KEY, cotacao_id INTEGER, descricao TEXT, quantidade REAL, unidade TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS cotacao_fornecedores (id SERIAL PRIMARY KEY, cotacao_id INTEGER, nome TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS cotacao_precos (id SERIAL PRIMARY KEY, cotacao_id INTEGER, item_id INTEGER, fornecedor_id INTEGER, valor REAL DEFAULT 0)`);
  await q(`CREATE TABLE IF NOT EXISTS aplicacoes_adubacao (id SERIAL PRIMARY KEY, titulo TEXT, status TEXT DEFAULT 'Confirmada', created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS aplicacao_adubacao_itens (id SERIAL PRIMARY KEY, aplicacao_id INTEGER, produto TEXT, quantidade_total REAL, unidade TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS aplicacao_adubacao_destinos (id SERIAL PRIMARY KEY, aplicacao_id INTEGER, produto TEXT, destino TEXT, quantidade REAL, unidade TEXT)`);
  const u = await q(`SELECT COUNT(*)::int total FROM usuarios`);
  if(u.rows[0].total===0) await q(`INSERT INTO usuarios (username,password,nome,role) VALUES ('admin','123','Administrador','admin'),('operador','123','Operador','funcionario')`);
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
app.post("/auth/login", async (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "")
    .trim();

  const r = await q(
    `SELECT id, username, nome, role
     FROM usuarios
     WHERE LOWER(TRIM(username)) = $1
     AND TRIM(password) = $2`,
    [username, password]
  );

  if (!r.rows[0]) {
    return res.status(401).json({
      error: "Usuário ou senha inválidos"
    });
  }

  res.json(r.rows[0]);
});
app.get("/dashboard",async(req,res)=>{const a=await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status!='Concluído'`),u=await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE urgencia='Alta (parou a operação)' AND status!='Concluído'`),p=await q(`SELECT COUNT(*)::int total FROM manutencoes WHERE status='Aguardando peça'`),c=await q(`SELECT COUNT(*)::int total FROM compras WHERE status!='Recebido'`),e=await q(`SELECT COUNT(*)::int total FROM estoque WHERE quantidade<=minimo`);res.json({manutencoesAbertas:a.rows[0].total,urgentes:u.rows[0].total,aguardandoPeca:p.rows[0].total,comprasPendentes:c.rows[0].total,estoqueBaixo:e.rows[0].total});});

app.get("/manutencoes",async(req,res)=>res.json((await q(`SELECT * FROM manutencoes ORDER BY id DESC`)).rows));
app.post("/manutencoes",async(req,res)=>{const b=req.body,precisa=String(b.precisa_compra)==="1"?1:0,status=precisa?"Aguardando peça":"Aberto";const r=await q(`INSERT INTO manutencoes (solicitante,data_ocorrencia,tipo,local_item,defeito,urgencia,status,responsavel,solucao,precisa_compra,item_compra,quantidade_compra,categoria_compra,destino_compra) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[b.solicitante,b.data_ocorrencia,b.tipo,b.local_item,b.defeito,b.urgencia,status,b.responsavel||"",b.solucao||"",precisa,b.item_compra||"",b.quantidade_compra||0,b.categoria_compra||"",b.destino_compra||""]);await notify(precisa?"Nova manutenção com solicitação de compra":"Nova manutenção criada",`Solicitante: ${b.solicitante||"-"}\nLocal: ${b.local_item||"-"}`,"manutencao",{Solicitante:b.solicitante,Local:b.local_item,Problema:b.defeito});if(precisa)await q(`INSERT INTO compras (manutencao_id,item,quantidade,categoria,destino,status,solicitante) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[r.rows[0].id,b.item_compra||"Item não informado",b.quantidade_compra||1,b.categoria_compra||"Peças",b.destino_compra||b.local_item||"Não informado","Em cotação",b.solicitante||"Não informado"]);res.json({id:r.rows[0].id});});
app.put("/manutencoes/:id",async(req,res)=>{await q(`UPDATE manutencoes SET status=$1,responsavel=$2,solucao=$3,concluido_at=$4 WHERE id=$5`,[req.body.status,req.body.responsavel||"",req.body.solucao||"",req.body.status==="Concluído"?new Date():null,req.params.id]);res.json({ok:true});});

app.get("/estoque",async(req,res)=>res.json((await q(`SELECT *, CASE WHEN quantidade<=minimo THEN 1 ELSE 0 END baixo FROM estoque ORDER BY categoria,nome`)).rows));
app.post("/estoque",async(req,res)=>{const b=req.body;const r=await q(`INSERT INTO estoque (nome,categoria,unidade,quantidade,minimo) VALUES ($1,$2,$3,$4,$5) RETURNING id`,[b.nome,b.categoria,b.unidade,b.quantidade,b.minimo]);res.json({id:r.rows[0].id});});
app.post("/estoque/:id/baixa",async(req,res)=>{const qtd=Number(req.body.quantidade||0);if(qtd<=0)return res.status(400).json({error:"Quantidade inválida"});const r=await q(`SELECT * FROM estoque WHERE id=$1`,[req.params.id]);const item=r.rows[0];if(!item)return res.status(404).json({error:"Item não encontrado"});if(Number(item.quantidade)<qtd)return res.status(400).json({error:"Quantidade maior que estoque disponível"});await q(`UPDATE estoque SET quantidade=quantidade-$1 WHERE id=$2`,[qtd,req.params.id]);await q(`INSERT INTO movimentacoes_estoque (produto,categoria,quantidade,unidade,destino,tipo,origem,observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[item.nome,item.categoria,qtd,item.unidade,req.body.destino||"","saida","baixa_manual",req.body.observacao||""]);res.json({ok:true});});

app.get("/compras",async(req,res)=>res.json((await q(`SELECT * FROM compras ORDER BY id DESC`)).rows));
app.post("/compras",async(req,res)=>{const b=req.body;const r=await q(`INSERT INTO compras (item,quantidade,categoria,destino,solicitante,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,[b.item,b.quantidade,b.categoria,b.destino,b.solicitante||"Não informado","Em cotação"]);await notify("Nova solicitação de compra",`Item: ${b.item}`,"compra",{Item:b.item,Quantidade:b.quantidade,Solicitante:b.solicitante});res.json({id:r.rows[0].id});});
app.get("/compras/:id/cotacoes",async(req,res)=>res.json((await q(`SELECT * FROM cotacoes WHERE compra_id=$1 ORDER BY valor ASC`,[req.params.id])).rows));
app.post("/compras/:id/cotacoes",async(req,res)=>{const b=req.body;const r=await q(`INSERT INTO cotacoes (compra_id,fornecedor,valor,observacao) VALUES ($1,$2,$3,$4) RETURNING id`,[req.params.id,b.fornecedor,b.valor,b.observacao||""]);res.json({id:r.rows[0].id});});
app.put("/compras/:id/status",async(req,res)=>{await q(`UPDATE compras SET status=$1 WHERE id=$2`,[req.body.status,req.params.id]);res.json({ok:true});});
app.put("/compras/:id/escolher-fornecedor",async(req,res)=>{await q(`UPDATE compras SET fornecedor_escolhido=$1,valor_escolhido=$2,status='Aprovado' WHERE id=$3`,[req.body.fornecedor,req.body.valor,req.params.id]);res.json({ok:true});});

app.get("/fornecedores",async(req,res)=>res.json((await q(`SELECT * FROM fornecedores ORDER BY nome`)).rows));
app.post("/fornecedores",async(req,res)=>{const b=req.body;const r=await q(`INSERT INTO fornecedores (nome,contato,telefone,tipo_produto) VALUES ($1,$2,$3,$4) RETURNING id`,[b.nome,b.contato,b.telefone,b.tipo_produto]);res.json({id:r.rows[0].id});});

app.get("/notificacoes",async(req,res)=>res.json((await q(`SELECT * FROM notificacoes ORDER BY id DESC LIMIT 50`)).rows));
app.get("/notificacoes/unread-count",async(req,res)=>res.json({total:(await q(`SELECT COUNT(*)::int total FROM notificacoes WHERE lida=0`)).rows[0].total}));
app.put("/notificacoes/:id/lida",async(req,res)=>{await q(`UPDATE notificacoes SET lida=1 WHERE id=$1`,[req.params.id]);res.json({ok:true});});
app.put("/notificacoes/marcar-todas/lidas",async(req,res)=>{await q(`UPDATE notificacoes SET lida=1`);res.json({ok:true});});

app.get("/cotacoes-gerais",async(req,res)=>res.json((await q(`SELECT * FROM cotacoes_gerais ORDER BY id DESC`)).rows));
app.post("/cotacoes-gerais",async(req,res)=>{const r=await q(`INSERT INTO cotacoes_gerais (titulo,categoria) VALUES ($1,$2) RETURNING id`,[req.body.titulo||"Cotação",req.body.categoria||""]);res.json({id:r.rows[0].id});});
app.get("/cotacoes-gerais/:id/detalhes",async(req,res)=>{const cot=await q(`SELECT * FROM cotacoes_gerais WHERE id=$1`,[req.params.id]);const itens=await q(`SELECT * FROM cotacao_itens WHERE cotacao_id=$1 ORDER BY id`,[req.params.id]);const fornecedores=await q(`SELECT * FROM cotacao_fornecedores WHERE cotacao_id=$1 ORDER BY id`,[req.params.id]);const precos=await q(`SELECT * FROM cotacao_precos WHERE cotacao_id=$1`,[req.params.id]);res.json({cotacao:cot.rows[0],itens:itens.rows,fornecedores:fornecedores.rows,precos:precos.rows});});
app.post("/cotacoes-gerais/:id/itens",async(req,res)=>{const r=await q(`INSERT INTO cotacao_itens (cotacao_id,descricao,quantidade,unidade) VALUES ($1,$2,$3,$4) RETURNING id`,[req.params.id,req.body.descricao,req.body.quantidade||1,req.body.unidade||"un"]);res.json({id:r.rows[0].id});});
app.post("/cotacoes-gerais/:id/fornecedores",async(req,res)=>{const r=await q(`INSERT INTO cotacao_fornecedores (cotacao_id,nome) VALUES ($1,$2) RETURNING id`,[req.params.id,req.body.nome]);res.json({id:r.rows[0].id});});
app.post("/cotacoes-gerais/:id/precos",async(req,res)=>{const b=req.body;const ex=await q(`SELECT id FROM cotacao_precos WHERE cotacao_id=$1 AND item_id=$2 AND fornecedor_id=$3`,[req.params.id,b.item_id,b.fornecedor_id]);if(ex.rows[0])await q(`UPDATE cotacao_precos SET valor=$1 WHERE id=$2`,[b.valor,ex.rows[0].id]);else await q(`INSERT INTO cotacao_precos (cotacao_id,item_id,fornecedor_id,valor) VALUES ($1,$2,$3,$4)`,[req.params.id,b.item_id,b.fornecedor_id,b.valor]);res.json({ok:true});});
app.put("/cotacoes-gerais/:id/fechar",async(req,res)=>{await q(`UPDATE cotacoes_gerais SET status='Fechada' WHERE id=$1`,[req.params.id]);res.json({ok:true});});

function semana(t){const m=t.match(/semana\s*[:\-]?\s*(\d{4,6}|\d{1,2})/i);return m?m[1]:"";}
function itensPdf(t){const linhas=t.split(/\r?\n/).map(l=>l.trim()).filter(Boolean),it=[];let cult="";for(const l of linhas){if(/^Cultura:/i.test(l)){cult=l.replace(/^Cultura:/i,"").trim();continue}const m=l.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(gr|g|kg|ml|l|lt|lts)\b/i);if(m&&!/^(Produto|Dosagem|Obs|Alvos|Produtor|Local|Data|Recomendações)/i.test(l)){let u=m[3].toLowerCase();if(u==="gr")u="g";if(u==="lt"||u==="lts")u="L";it.push({produto:m[1].trim(),quantidade:Number(m[2].replace(",",".")),unidade:u,destino:cult})}}return it}
app.get("/recomendacoes",async(req,res)=>res.json((await q(`SELECT * FROM recomendacoes_pdf ORDER BY id DESC`)).rows));
app.get("/recomendacoes/:id/itens",async(req,res)=>res.json((await q(`SELECT * FROM recomendacao_itens WHERE recomendacao_id=$1 ORDER BY id`,[req.params.id])).rows));
app.post("/recomendacoes/upload-base64",async(req,res)=>{const buf=Buffer.from(String(req.body.base64||"").split(",").pop(),"base64");const data=await pdf(buf);const its=itensPdf(data.text||""),sem=semana(data.text||"");const rec=await q(`INSERT INTO recomendacoes_pdf (arquivo,semana,status) VALUES ($1,$2,$3) RETURNING id`,[req.body.filename||"pdf",sem,"Pendente"]);for(const i of its)await q(`INSERT INTO recomendacao_itens (recomendacao_id,produto,quantidade,unidade,destino) VALUES ($1,$2,$3,$4,$5)`,[rec.rows[0].id,i.produto,i.quantidade,i.unidade,i.destino]);res.json({id:rec.rows[0].id,semana:sem,itens:its});});
app.post("/recomendacoes/:id/confirmar-baixa",async(req,res)=>{const itens=await q(`SELECT * FROM recomendacao_itens WHERE recomendacao_id=$1 AND confirmado=0`,[req.params.id]);const nf=[];for(const item of itens.rows){const est=await q(`SELECT * FROM estoque WHERE lower(nome)=lower($1)`,[item.produto]);if(est.rows[0]){await q(`UPDATE estoque SET quantidade=quantidade-$1 WHERE id=$2`,[item.quantidade,est.rows[0].id]);await q(`UPDATE recomendacao_itens SET confirmado=1 WHERE id=$1`,[item.id]);await q(`INSERT INTO movimentacoes_estoque (produto,categoria,quantidade,unidade,destino,tipo,origem,observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[item.produto,"Defensivo",item.quantidade,item.unidade,item.destino||"","saida","pdf_defensivo","Baixa por PDF"])}else nf.push(item.produto)}await q(`UPDATE recomendacoes_pdf SET status='Confirmada' WHERE id=$1`,[req.params.id]);res.json({ok:true,naoEncontrados:nf});});

const DEST=["Crisântemos (Estufas)","Limonium e Statice","Vinhedo","Área 5 (Folhagens)"];
app.get("/adubacao/adubos",async(req,res)=>res.json((await q(`SELECT * FROM estoque WHERE lower(categoria) LIKE '%adubo%' ORDER BY nome`)).rows));
app.get("/adubacao/destinos",(req,res)=>res.json(DEST));
app.post("/adubacao/aplicar",async(req,res)=>{const {titulo,itens,distribuicao}=req.body;for(const item of itens||[]){const soma=(distribuicao||[]).filter(d=>d.produto===item.produto).reduce((a,d)=>a+Number(d.quantidade||0),0);if(Math.abs(Number(item.quantidade||0)-soma)>0.001)return res.status(400).json({error:`Distribuição não confere para ${item.produto}`})}const ar=await q(`INSERT INTO aplicacoes_adubacao (titulo,status) VALUES ($1,$2) RETURNING id`,[titulo||"Adubação semanal","Confirmada"]);for(const item of itens||[]){await q(`INSERT INTO aplicacao_adubacao_itens (aplicacao_id,produto,quantidade_total,unidade) VALUES ($1,$2,$3,$4)`,[ar.rows[0].id,item.produto,item.quantidade,item.unidade||"kg"]);await q(`UPDATE estoque SET quantidade=quantidade-$1 WHERE nome=$2`,[item.quantidade,item.produto])}for(const d of distribuicao||[]){if(Number(d.quantidade||0)>0){await q(`INSERT INTO aplicacao_adubacao_destinos (aplicacao_id,produto,destino,quantidade,unidade) VALUES ($1,$2,$3,$4,$5)`,[ar.rows[0].id,d.produto,d.destino,d.quantidade,d.unidade||"kg"]);await q(`INSERT INTO movimentacoes_estoque (produto,categoria,quantidade,unidade,destino,tipo,origem,observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[d.produto,"Adubo",d.quantidade,d.unidade||"kg",d.destino,"saida","adubacao",titulo||"Adubação semanal"])}}res.json({ok:true,id:ar.rows[0].id});});

app.get("/relatorios/mensal/html",async(req,res)=>{const month=req.query.month||new Date().toISOString().slice(0,7);const movs=await q(`SELECT produto,categoria,unidade,destino,origem,SUM(quantidade) total FROM movimentacoes_estoque WHERE to_char(created_at,'YYYY-MM')=$1 GROUP BY produto,categoria,unidade,destino,origem ORDER BY categoria,produto`,[month]);const est=await q(`SELECT nome,categoria,unidade,quantidade,minimo FROM estoque ORDER BY categoria,nome`);res.setHeader("Content-Type","text/html; charset=utf-8");res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FT FLOW Relatório</title><style>body{font-family:Arial;background:#f3f7f4;padding:28px}.page{max-width:1000px;margin:auto;background:white;padding:30px;border-radius:22px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#ecfdf5}.btn{background:#15803d;color:white;padding:12px 18px;border:0;border-radius:12px}@media print{.btn{display:none}}</style></head><body><div class="page"><h1>🌿 FT FLOW - Relatório Mensal</h1><p>Mês: <b>${month}</b></p><button class="btn" onclick="window.print()">Salvar PDF</button><h2>Consumo</h2><table><tr><th>Produto</th><th>Categoria</th><th>Total</th><th>Destino</th><th>Origem</th></tr>${movs.rows.map(m=>`<tr><td>${m.produto}</td><td>${m.categoria||"-"}</td><td>${Number(m.total||0).toFixed(2)} ${m.unidade||""}</td><td>${m.destino||"-"}</td><td>${m.origem||"-"}</td></tr>`).join("")||"<tr><td colspan='5'>Sem consumo</td></tr>"}</table><h2>Estoque atual</h2><table><tr><th>Produto</th><th>Categoria</th><th>Atual</th><th>Mínimo</th></tr>${est.rows.map(e=>`<tr><td>${e.nome}</td><td>${e.categoria}</td><td>${e.quantidade} ${e.unidade}</td><td>${e.minimo}</td></tr>`).join("")}</table></div></body></html>`);});

module.exports.handler = serverless(app);
