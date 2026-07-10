
// FT FLOW V2.9 - Otimizado
const APP_VERSION = "v37";

const UNIDADES_MEDIDA = [
  { grupo: "Comprimento", opcoes: [{ v: "m", l: "Metro (m)" }, { v: "cm", l: "Centímetro (cm)" }] },
  { grupo: "Massa (Peso)", opcoes: [{ v: "kg", l: "Quilograma (kg)" }, { v: "g", l: "Grama (g)" }] },
  { grupo: "Volume / Capacidade", opcoes: [{ v: "L", l: "Litro (L)" }, { v: "mL", l: "Mililitro (mL)" }] },
  { grupo: "Quantidade", opcoes: [{ v: "un", l: "Unidade (un)" }] }
];
const UNIDADES_VALIDAS = UNIDADES_MEDIDA.flatMap(g => g.opcoes.map(o => o.v));

function htmlOpcoesUnidade(selecionada = "") {
  let html = '<option value="">Selecione a unidade...</option>';
  for (const g of UNIDADES_MEDIDA) {
    html += `<optgroup label="${htmlEsc(g.grupo)}">`;
    for (const o of g.opcoes) {
      html += `<option value="${htmlEsc(o.v)}"${selecionada === o.v ? " selected" : ""}>${htmlEsc(o.l)}</option>`;
    }
    html += "</optgroup>";
  }
  return html;
}

function initSelectsUnidade() {
  ["compUnidadeModal", "crUnidade", "manUnidadeCompra"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = htmlOpcoesUnidade();
  });
}

function unidadeMedidaValida(unidade) {
  return UNIDADES_VALIDAS.includes(String(unidade || "").trim());
}

function toggleSolicitanteOutro(selectEl) {
  const box = document.getElementById("solicitanteOutroBox");
  const input = document.getElementById("manSolicitanteOutro");
  if (!box || !selectEl) return;
  const isOutro = selectEl.value === "Outro";
  box.classList.toggle("hidden", !isOutro);
  if (input) {
    input.required = isOutro;
    if (!isOutro) input.value = "";
  }
}
const API = "/api";
let usuario = null;
let tela = "dashboard";

let token = localStorage.getItem('ft_flow_token');

const STATUS_ATIVOS_COMPRAS = [
  "pendente",
  "em cotação",
  "pendente_aprovacao",
  "aguardando aprovação",
  "em andamento"
];

const STATUS_HISTORICO_COMPRAS = [
  "aprovada",
  "aprovado",
  "comprado",
  "recebido",
  "entregue",
  "concluído",
  "concluido",
  "rejeitado",
  "cancelado"
];

function normalizarStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function statusEhAtivo(status) {
  return STATUS_ATIVOS_COMPRAS.includes(normalizarStatus(status));
}

function statusEhHistorico(status) {
  return STATUS_HISTORICO_COMPRAS.includes(normalizarStatus(status));
}

function atualizarInfosUsuario() {
  const nome = usuario?.nome || usuario?.user || "Usuário";
  const role = usuario?.role || "";

  const userNameDesktop = document.getElementById("userNameDesktop");
  const userRoleDesktop = document.getElementById("userRoleDesktop");
  const userNameMobile = document.getElementById("userNameMobile");
  const userRoleMobile = document.getElementById("userRoleMobile");

  if (userNameDesktop) userNameDesktop.innerText = nome;
  if (userRoleDesktop) userRoleDesktop.innerText = role;
  if (userNameMobile) userNameMobile.innerText = nome;
  if (userRoleMobile) userRoleMobile.innerText = role;
}

const loginScreen = document.getElementById("loginScreen");
const app = document.getElementById("app");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");

function hoje(){ return new Date().toISOString().slice(0,10); }
function dinheiro(v){ return `R$ ${Number(v||0).toFixed(2)}`; }
function esc(s){ return String(s ?? "").replace(/'/g,"\\'" ).replace(/`/g,"\\`"); }
function htmlEsc(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function cardPedidoCompra(c, options = {}) {
  const isAdmin = options.admin ?? false;
  const modo = options.modo || "full";
  const unidadeTxt = c.unidade ? htmlEsc(c.unidade) : "não informada";
  const descricaoTxt = c.descricao
    ? htmlEsc(c.descricao)
    : "<em class=\"pedido-vazio\">Sem descrição</em>";
  const link = c.link_produto
    ? `<a href="${htmlEsc(c.link_produto)}" target="_blank" rel="noopener" class="pedido-link">🔗 Ver link do produto</a>`
    : "";
  const foto = c.foto_url
    ? `<img src="${htmlEsc(c.foto_url)}" class="pedido-foto" alt="Foto do produto">`
    : "";
  const valor = c.valor_total ? `<div class="pedido-linha"><span>Valor total</span><b>${dinheiro(c.valor_total)}</b></div>` : "";
  const fornecedor = c.fornecedor_escolhido
    ? `<div class="pedido-linha"><span>Fornecedor</span><b>${htmlEsc(c.fornecedor_escolhido)} • ${dinheiro(c.valor_escolhido)}</b></div>`
    : "";

  let acoes = "";
  if (modo === "cotacao") {
    acoes = `<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirModalCotacaoComparacao(${c.id})">Ver cotações</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`;
  } else if (modo === "full" && isAdmin) {
    acoes = `<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirModalCotacaoComparacao(${c.id})">Cotação</button><button class="primary" onclick="statusCompra(${c.id},'Aprovado')">Aprovar</button><button class="primary" onclick="statusCompra(${c.id},'Recebido')">Recebido</button><button class="danger" onclick="excluirCompra(${c.id})">🗑️ Excluir</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`;
  }

  return `<div class="card pedido-card">
    <div class="pedido-top">
      <b class="pedido-titulo">#${c.id} — ${htmlEsc(c.item)}</b>
      <span class="pedido-status-wrap">${st(c.status)}</span>
    </div>
    ${foto}
    <div class="pedido-detalhes">
      <div class="pedido-linha"><span>Solicitante</span><b>${htmlEsc(c.solicitante || "-")}</b></div>
      <div class="pedido-linha"><span>Quantidade</span><b>${c.quantidade ?? "-"}</b></div>
      <div class="pedido-linha"><span>Unidade</span><b>${unidadeTxt}</b></div>
      <div class="pedido-linha"><span>Categoria</span><b>${htmlEsc(c.categoria || "-")}</b></div>
      <div class="pedido-linha"><span>Destino</span><b>${htmlEsc(c.destino || "Não informado")}</b></div>
      ${valor}${fornecedor}
    </div>
    <div class="pedido-descricao-box">
      <span class="pedido-label">Descrição do produto</span>
      <p class="pedido-descricao-texto">${descricaoTxt}</p>
    </div>
    ${link}
    ${acoes}
  </div>`;
}

async function apiJson(url, options={}){
  const headers = options.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
  options.headers = headers;
  const r = await fetch(url, options);
  const txt = await r.text();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if(r.status === 401){ localStorage.removeItem('ft_flow_token'); location.reload(); }
  if(!r.ok){ throw new Error(data.error || data.message || txt || "Erro na API"); }
  return data;
}
async function js(u,o){ return apiJson(u,o); }

// Funções de feedback visual
function mostrarSucesso(msg = "Operação realizada com sucesso!") {
  const toast = document.createElement("div");
  toast.className = "success-toast";
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function mostrarErro(msg = "Erro ao realizar operação") {
  const toast = document.createElement("div");
  toast.className = "error-toast";
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function fazerLogin(){
  try{
    const r = await fetch(API+"/auth/login",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:loginUser.value,password:loginPass.value})
    });
    if(!r.ok) return mostrarErro("Usuário ou senha inválidos");
    const data = await r.json();
    token = data.token;
    localStorage.setItem('ft_flow_token', token);
    usuario = data;
    loginScreen.classList.add("hidden");
    app.classList.remove("hidden");
    atualizarInfosUsuario();
    if(usuario.role !== "admin") document.querySelectorAll(".admin-only").forEach(e=>e.style.display="none");
    await trocarTela("dashboard", document.querySelector(".nav"));
    atualizarContadorNotificacoes();
    setInterval(atualizarContadorNotificacoes,15000);
  }catch(e){ mostrarErro("Erro ao conectar com servidor: "+e.message); }
}

function trocarTela(n,b){
  tela=n;
  // Sidebar desktop
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  if(b) b.classList.add("active");
  // Drawer mobile — marca item ativo
  document.querySelectorAll(".drawer-nav-item").forEach(x=>{
    x.classList.toggle("active", x.dataset.tela===n);
  });
  const titles={dashboard:"Dashboard",manutencoes:"Manutenções",estoque:"Estoque",compras:"Compras",historico:"Histórico",cotacoes:"Cotações",relatorios:"Relatórios",fornecedores:"Fornecedores"};
  pageTitle.innerText=titles[n]||"FT FLOW";
  carregar();
}

async function carregar(){
  try{
    content.innerHTML='<div class="panel"><div class="spinner"></div> Carregando...</div>';
    if(tela==="dashboard") return dashboard();
    if(tela==="manutencoes") return manutencoes();
    if(tela==="estoque") return estoque();
    if(tela==="compras") return compras();
    if(tela==="historico") return historico();
    if(tela==="cotacoes") return cotacoesGerais();

    if(tela==="relatorios") return relatoriosMensais();
    if(tela==="fornecedores") return fornecedores();
  }catch(e){ content.innerHTML=`<div class="panel"><h3>Erro</h3><p>${e.message}</p></div>`; }
}

function st(s){
  if(s==="Concluído"||s==="Recebido"||s==="Confirmada")return `<span class="badge done">${s}</span>`;
  if(s==="Aguardando peça"||s==="Em cotação"||s==="Aberta"||s==="Pendente")return `<span class="badge wait">${s}</span>`;
  return `<span class="badge open">${s||"-"}</span>`;
}
function urg(u){ if((u||"").startsWith("Alta"))return `<span class="badge high">${u}</span>`; if((u||"").startsWith("Média"))return `<span class="badge mid">${u}</span>`; return `<span class="badge low">${u||""}</span>`; }

function tabelaMan(data){
  return `<table class="table"><thead><tr><th>ID</th><th>Local/Item</th><th>Tipo</th><th>Urgência</th><th>Status</th><th>Ações</th></tr></thead><tbody>${data.map(m=>`<tr><td>#${m.id}</td><td><b>${m.local_item||"-"}</b><br><small>${m.defeito||""}</small></td><td>${m.tipo||"-"}</td><td>${urg(m.urgencia)}</td><td>${st(m.status)}</td><td>${m.status==="Concluído"?"✅ Finalizada":`<button class="secondary" onclick="abrirConcluir(${m.id})">Concluir</button>`}</td></tr>`).join("")}</tbody></table>`;
}

async function dashboard(){
  // Carrega dados em paralelo para melhor performance
  const [d, man, est] = await Promise.all([
    js(API+"/dashboard"),
    js(API+"/manutencoes?limit=5"),
    js(API+"/estoque")
  ]);
  
  const manData = man.data || man;
  const estoqueBaixo = est.filter(i=>i.baixo);
  content.innerHTML=`<div class="cards"><div class="kpi"><small>Manutenções abertas</small><strong>${d.manutencoesAbertas}</strong></div><div class="kpi"><small>Urgentes</small><strong>${d.urgentes}</strong></div><div class="kpi"><small>Aguardando peça</small><strong>${d.aguardandoPeca}</strong></div><div class="kpi"><small>Compras pendentes</small><strong>${d.comprasPendentes}</strong></div><div class="kpi"><small>Estoque baixo</small><strong>${d.estoqueBaixo}</strong></div></div><div class="panel"><h3>Últimas manutenções</h3>${tabelaMan(manData.slice(0,5))}</div><div class="panel"><h3>Itens com estoque baixo</h3>${estoqueBaixo.map(i=>{
    let limiteInfo = '';
    if (i.data_limite) {
      const dias = i.dias_restantes;
      const icone = dias <= 7 ? '🔴' : dias <= 15 ? '🟡' : '🟢';
      limiteInfo = ` — ${icone} ${dias <= 0 ? 'ESGOTADO' : `acaba em ${dias} dias`}`;
    }
    return `<div class="card stock-low"><b>${i.nome}</b><br>${i.quantidade} ${i.unidade} | mínimo ${i.minimo}${limiteInfo}</div>`;
  }).join("")||"Nenhum item crítico."}</div>`;
}

async function manutencoes(){
  const data=await js(API+"/manutencoes");
  const manData = data.data || data;
  content.innerHTML=`<div class="panel"><div class="actions"><button class="primary" onclick="abrirModalManutencao()">+ Nova Solicitação</button><button class="secondary" onclick="carregar()">Atualizar</button></div></div><div class="panel">${tabelaMan(manData)}</div>`;
}

function abrirModalManutencao() {
  modal.classList.remove("hidden");
  formManutencao.reset();
  document.querySelector("[name=data_ocorrencia]").value = hoje();
  camposCompra.classList.add("hidden");
  const manSol = document.getElementById("manSolicitante");
  if (manSol) toggleSolicitanteOutro(manSol);
}
function fecharModal(){ modal.classList.add("hidden"); }
function toggleCompra(){
  const show = precisaCompra.checked;
  camposCompra.classList.toggle("hidden", !show);
  const unidadeEl = document.getElementById("manUnidadeCompra");
  if (unidadeEl) unidadeEl.required = show;
}

async function salvarManutencao(e){
  e.preventDefault();
  try {
    const fd=new FormData(formManutencao);
    const dados=Object.fromEntries(fd.entries());
    dados.precisa_compra=precisaCompra.checked?"1":"0";
    delete dados.foto;

    if (dados.solicitante === "Outro") {
      dados.solicitante = (dados.solicitante_outro || "").trim();
      if (!dados.solicitante) return mostrarErro("Informe o nome do solicitante");
    }
    delete dados.solicitante_outro;

    if(!dados.solicitante?.trim()) return mostrarErro("Selecione um solicitante");
    if(!dados.local_item?.trim()) return mostrarErro("Informe o local/item");
    if(!dados.defeito?.trim()) return mostrarErro("Descreva o problema");

    if (precisaCompra.checked) {
      if (!dados.item_compra?.trim()) return mostrarErro("Informe o item da compra");
      if (!dados.quantidade_compra || Number(dados.quantidade_compra) <= 0) return mostrarErro("Informe a quantidade da compra");
      if (!unidadeMedidaValida(dados.unidade_compra)) return mostrarErro("Selecione a unidade de medida da compra");
    } else {
      delete dados.unidade_compra;
    }
    
    await js(API+"/manutencoes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(dados)});
    mostrarSucesso("Manutenção criada com sucesso!");
    formManutencao.reset(); 
    fecharModal(); 
    carregar(); 
    atualizarContadorNotificacoes();
  } catch(e) {
    mostrarErro(e.message || "Erro ao salvar manutenção");
  }
}

function abrirConcluir(id){ concluirId.value=id; concluirResponsavel.value=""; concluirSolucao.value=""; concluirModal.classList.remove("hidden"); }
function fecharConcluir(){ concluirModal.classList.add("hidden"); }
async function salvarConclusao(){
  if(!concluirSolucao.value.trim())return mostrarErro("Informe a solução aplicada.");
  await js(API+`/manutencoes/${concluirId.value}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"Concluído",responsavel:concluirResponsavel.value,solucao:concluirSolucao.value})});
  mostrarSucesso("Manutenção concluída com sucesso!");
  fecharConcluir(); 
  carregar(); 
  atualizarContadorNotificacoes();
}

// ===== ESTOQUE V6 =====
const EMOJI_CATEGORIA = {
  "Flor de Corte": "🌹",
  "Adubo": "🧪",
  "Defensivo": "🌿",
  "Peças": "🔧",
  "Embalagens": "📦",
  "Outros": "📋"
};

function emojiProduto(item) {
  const cat = item.categoria || "Outros";
  if (cat === "Flor de Corte") {
    const n = (item.nome || "").toLowerCase();
    if (n.includes("girassol")) return "🌻";
    if (n.includes("rosa")) return "🌹";
    if (n.includes("cravo")) return "💐";
    return "🌸";
  }
  return EMOJI_CATEGORIA[cat] || "📦";
}

function statusEstoqueV6(item) {
  const q = Number(item.quantidade || 0);
  const m = Number(item.minimo || 0);
  if (q <= 0 || (m > 0 && q <= m * 0.5)) return { cls: "stock-critico", icon: "🔴", label: "Crítico" };
  if (m > 0 && q <= m) return { cls: "stock-baixo", icon: "🟡", label: "Baixo" };
  return { cls: "stock-normal", icon: "🟢", label: "Normal" };
}

async function estoque() {
  const data = await js(API + "/estoque");
  const cats = [...new Set(data.map(i => i.categoria || "Sem categoria"))];
  const baixo = data.filter(i => i.baixo).length;
  content.innerHTML = `
    <div class="estoque-header">
      <div class="estoque-stats">
        <span class="estoque-stat">${data.length} produtos</span>
        ${baixo ? `<span class="estoque-stat warn">${baixo} em alerta</span>` : ""}
      </div>
      <button class="primary estoque-add-btn" onclick="abrirModalEstoque()">+ Novo produto</button>
    </div>
    <div class="panel estoque-categorias-panel">
      <div class="category-grid estoque-cat-scroll">
        <button class="cat-btn" onclick="filtrarEstoque('Todos')">Todos <b>${data.length}</b></button>
        ${cats.map(c => `<button class="cat-btn" onclick="filtrarEstoque('${esc(c)}')">${esc(c)} <b>${data.filter(i => (i.categoria || "Sem categoria") === c).length}</b></button>`).join("")}
      </div>
    </div>
    <div class="panel estoque-lista-panel">
      <h3 id="tituloListaEstoque">Produtos</h3>
      <div id="listaEstoque" class="estoque-grid"></div>
    </div>
    <button class="fab estoque-fab" onclick="abrirModalEstoque()" title="Novo produto">+</button>`;
  window._estoqueData = data;
  renderEstoque(data);
}

function renderEstoque(lista) {
  const titulo = document.getElementById("tituloListaEstoque");
  const listaEl = document.getElementById("listaEstoque");
  if (!titulo || !listaEl) return;

  const comAlerta = lista.filter(i => statusEstoqueV6(i).cls !== "stock-normal");
  const semAlerta = lista.filter(i => statusEstoqueV6(i).cls === "stock-normal");
  const ordenado = [...comAlerta, ...semAlerta];

  titulo.innerText = `Produtos (${lista.length})`;
  listaEl.innerHTML = ordenado.map(i => {
    const st = statusEstoqueV6(i);
    return `
      <button type="button" class="estoque-card ${st.cls}" onclick="abrirDetalheProduto(${i.id})">
        <span class="estoque-card-status" title="${st.label}">${st.icon}</span>
        <span class="estoque-card-emoji">${emojiProduto(i)}</span>
        <span class="estoque-card-nome">${esc(i.nome)}</span>
        <span class="estoque-card-qtd">Qtd: <b>${i.quantidade}</b> ${esc(i.unidade || "")}</span>
      </button>`;
  }).join("") || `<p class="estoque-vazio">Nenhum produto cadastrado.</p>`;
}

function filtrarEstoque(c) {
  const data = window._estoqueData || [];
  renderEstoque(c === "Todos" ? data : data.filter(i => (i.categoria || "Sem categoria") === c));
}

async function abrirDetalheProduto(id) {
  try {
    const [produto, historico] = await Promise.all([
      js(API + `/estoque/${id}`),
      js(API + `/estoque/${id}/historico`)
    ]);
    window._produtoDetalhe = produto;
    const st = statusEstoqueV6(produto);
    const fotoHtml = produto.foto_url
      ? `<img src="${esc(produto.foto_url)}" class="detalhe-foto" alt="${esc(produto.nome)}">`
      : `<div class="detalhe-foto-placeholder">${emojiProduto(produto)}</div>`;

    document.getElementById("detalheProdutoConteudo").innerHTML = `
      ${fotoHtml}
      <div class="detalhe-status ${st.cls}">${st.icon} Estoque ${st.label.toLowerCase()}</div>
      <div class="detalhe-info">
        <div class="detalhe-row"><span>Nome</span><strong>${esc(produto.nome)}</strong></div>
        <div class="detalhe-row"><span>Categoria</span><strong>${esc(produto.categoria || "-")}</strong></div>
        <div class="detalhe-row"><span>Quantidade</span><strong id="detalheQtd">${produto.quantidade}</strong></div>
        <div class="detalhe-row"><span>Unidade</span><strong>${esc(produto.unidade || "-")}</strong></div>
        <div class="detalhe-row"><span>Mínimo</span><strong>${produto.minimo ?? "-"}</strong></div>
        <div class="detalhe-row"><span>Fornecedor</span><strong>${esc(produto.fornecedor || "-")}</strong></div>
        <div class="detalhe-row"><span>Local</span><strong>${esc(produto.local || "-")}</strong></div>
        ${produto.observacoes ? `<div class="detalhe-obs"><span>Observações</span><p>${esc(produto.observacoes)}</p></div>` : ""}
      </div>
      <div class="detalhe-acoes">
        <button class="primary" onclick="abrirEntradaEstoque(${produto.id})">➕ Entrada</button>
        <button class="secondary" onclick="abrirBaixaEstoqueModal(${produto.id}, '${esc(produto.nome)}', ${Number(produto.quantidade || 0)}, '${esc(produto.unidade)}')">➖ Baixa</button>
        <button class="secondary" onclick="editarProdutoDetalhe(${produto.id})">✏️ Editar</button>
        <button class="danger" onclick="excluirProdutoDetalhe(${produto.id})">🗑️ Excluir</button>
      </div>
      <div class="detalhe-historico">
        <h4>Histórico de movimentação</h4>
        <div class="historico-lista">${renderHistoricoProduto(historico)}</div>
      </div>`;

    document.getElementById("modalDetalheProduto").classList.remove("hidden");
  } catch (e) {
    mostrarErro(e.message || "Erro ao carregar produto");
  }
}

function renderHistoricoProduto(movs) {
  if (!movs || !movs.length) return `<p class="historico-vazio">Sem movimentações registradas.</p>`;
  return movs.map(m => {
    const dt = new Date(m.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const entrada = m.tipo === "entrada";
    const sinal = entrada ? "+" : "-";
    const cls = entrada ? "hist-entrada" : "hist-saida";
    const extra = m.destino || m.observacao || m.origem || "";
    return `<div class="historico-item ${cls}"><span class="hist-data">${dt}</span><span class="hist-qtd">${sinal}${m.quantidade}</span>${extra ? `<span class="hist-info">${esc(extra)}</span>` : ""}</div>`;
  }).join("");
}

function fecharDetalheProduto() {
  document.getElementById("modalDetalheProduto").classList.add("hidden");
}

function abrirEntradaEstoque(id) {
  const p = window._produtoDetalhe;
  if (!p || p.id !== id) return;
  document.getElementById("entradaEstoqueId").value = id;
  document.getElementById("entradaEstoqueNome").innerText = p.nome;
  document.getElementById("entradaEstoqueSaldo").innerText = `Saldo atual: ${p.quantidade} ${p.unidade || ""}`;
  document.getElementById("entradaQtd").value = "";
  document.getElementById("entradaFornecedor").value = p.fornecedor || "";
  document.getElementById("entradaObs").value = "";
  document.getElementById("modalEntradaEstoque").classList.remove("hidden");
}

function fecharEntradaEstoque() {
  document.getElementById("modalEntradaEstoque").classList.add("hidden");
}

async function salvarEntradaEstoque(e) {
  e.preventDefault();
  const id = document.getElementById("entradaEstoqueId").value;
  const quantidade = Number(document.getElementById("entradaQtd").value);
  const fornecedor = document.getElementById("entradaFornecedor").value.trim();
  const observacao = document.getElementById("entradaObs").value.trim();
  if (!quantidade || quantidade <= 0) return mostrarErro("Quantidade inválida.");
  try {
    const r = await js(API + `/estoque/${id}/entrada`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantidade, fornecedor, observacao })
    });
    mostrarSucesso(`Entrada registrada! Novo saldo: ${r.quantidade}`);
    fecharEntradaEstoque();
    fecharDetalheProduto();
    if (tela === "estoque") estoque();
    else carregar();
  } catch (err) {
    mostrarErro(err.message);
  }
}

function abrirBaixaEstoqueModal(id, nome, disponivel, unidade) {
  document.getElementById("baixaEstoqueId").value = id;
  document.getElementById("baixaEstoqueNome").innerText = nome;
  document.getElementById("baixaEstoqueSaldo").innerText = `Disponível: ${disponivel} ${unidade}`;
  document.getElementById("baixaQtd").value = "";
  document.getElementById("baixaQtd").max = disponivel;
  document.getElementById("baixaDestino").value = "";
  document.getElementById("baixaObs").value = "";
  document.getElementById("modalBaixaEstoque").classList.remove("hidden");
}

function fecharBaixaEstoque() {
  document.getElementById("modalBaixaEstoque").classList.add("hidden");
}

async function salvarBaixaEstoque(e) {
  e.preventDefault();
  const id = document.getElementById("baixaEstoqueId").value;
  const quantidade = Number(document.getElementById("baixaQtd").value);
  const destino = document.getElementById("baixaDestino").value.trim();
  const observacao = document.getElementById("baixaObs").value.trim();
  if (!quantidade || quantidade <= 0) return mostrarErro("Quantidade inválida.");
  try {
    const r = await js(API + `/estoque/${id}/baixa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantidade, destino, observacao, usuario: usuario?.nome || usuario?.username || "Usuário" })
    });
    mostrarSucesso(`Baixa realizada! Saldo: ${r.quantidade}`);
    fecharBaixaEstoque();
    fecharDetalheProduto();
    if (tela === "estoque") estoque();
    else carregar();
    atualizarContadorNotificacoes();
  } catch (err) {
    mostrarErro(err.message);
  }
}

function editarProdutoDetalhe(id) {
  fecharDetalheProduto();
  abrirModalEstoque(id);
}

async function excluirProdutoDetalhe(id) {
  if (!confirm("Tem certeza que deseja excluir este produto?")) return;
  try {
    await js(API + `/estoque/${id}`, { method: "DELETE" });
    mostrarSucesso("Produto excluído!");
    fecharDetalheProduto();
    if (tela === "estoque") estoque();
    else carregar();
  } catch (e) {
    mostrarErro(e.message);
  }
}

function escolherFotoEstoque(modo) {
  const input = document.getElementById("estoqueFoto");
  input.value = "";
  if (modo === "camera") input.setAttribute("capture", "environment");
  else input.removeAttribute("capture");
  input.onchange = () => previewFotoEstoque(input.files[0]);
  input.click();
}

function previewFotoEstoque(file) {
  if (!file) return;
  window._estoqueFotoPendente = file;
  const preview = document.getElementById("estoqueFotoPreview");
  const img = document.getElementById("estoqueFotoPreviewImg");
  img.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
}

async function abrirAdicionarEstoqueComFoto() {
  abrirModalEstoque();
}

// ===== UPLOAD DE FOTO (via API → Cloudinary) =====
function fileParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem"));
    reader.readAsDataURL(file);
  });
}

async function redimensionarImagem(file, maxPx = 1200, qualidade = 0.82) {
  if (!file?.type?.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const maior = Math.max(bmp.width, bmp.height);
    if (maior <= maxPx && file.size <= 900000) {
      bmp.close();
      return file;
    }
    const escala = Math.min(1, maxPx / maior);
    const w = Math.max(1, Math.round(bmp.width * escala));
    const h = Math.max(1, Math.round(bmp.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
    const nome = (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function uploadFotoCloudinary(file) {
  if (!file) return null;
  try {
    const preparada = await redimensionarImagem(file);
    const base64 = await fileParaBase64(preparada);
    const data = await js(API + "/upload/foto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, filename: preparada.name || "foto.jpg" })
    });
    return data.url || null;
  } catch (e) {
    mostrarErro("Erro ao fazer upload da foto: " + e.message);
    return null;
  }
}

function previewFotoCompra(file) {
  const box = document.getElementById("compFotoPreview");
  const img = document.getElementById("compFotoPreviewImg");
  if (!box || !img) return;
  if (!file) {
    img.removeAttribute("src");
    box.classList.add("hidden");
    return;
  }
  img.src = URL.createObjectURL(file);
  box.classList.remove("hidden");
}

function limparPreviewFotoCompra() {
  previewFotoCompra(null);
  if (compFotoModal) compFotoModal.value = "";
}

// Legacy alias
function abrirBaixaEstoque(id, nome, disponivel, unidade) {
  abrirBaixaEstoqueModal(id, nome, disponivel, unidade);
}


// ===== COMPRAS RÁPIDAS (<R$2000) =====
async function abrirCompraRapida() {
  // Limpar os campos do modal
  document.getElementById("compSolicitanteModal").value = usuario?.nome || "";
  document.getElementById("compItemModal").value = "";
  document.getElementById("compCatModal").value = "";
  document.getElementById("compDestModal").value = "";
  document.getElementById("compQtdModal").value = "";
  document.getElementById("compUnidadeModal").value = "";
  document.getElementById("compValorUnitModal").value = "";
  document.getElementById("compValorTotalModal").value = "";
  document.getElementById("compLinkModal").value = "";
  document.getElementById("compDescricaoModal").value = "";
  limparPreviewFotoCompra();
  
  // Mudar o título do modal
  document.querySelector("#modalCompra .modal-head h3").innerText = "Compra Rápida (< R$2.000)";
  
  // Mudar o botão de submit
  document.querySelector("#formCompra button[type='submit']").innerText = "Registrar Compra Rápida";
  
  // Abrir o modal
  modalCompra.classList.remove("hidden");
  
  // Marcar que é compra rápida
  formCompra.dataset.tipoCompra = "rapida";
}

async function verRelatorioSemanal() {
  try {
    const relatorio = await js(API + "/compras/relatorio/semanal");
    const html = `
      <div class="panel">
        <h3>📊 Relatório Semanal - Compras Rápidas</h3>
        <p><b>Período:</b> ${relatorio.periodo}</p>
        <p><b>Total gasto:</b> <span style="color: #10b981; font-size: 20px; font-weight: bold;">R$ ${relatorio.total}</span></p>
        <p><b>Quantidade de compras:</b> ${relatorio.quantidade}</p>
        <h4>Detalhes:</h4>
        ${relatorio.compras.map(c => `
          <div class="card">
            <b>${c.item}</b><br>
            Quantidade: ${c.quantidade} | Total: R$ ${Number(c.valor_total || 0).toFixed(2)}<br>
            Solicitante: ${c.solicitante}
          </div>
        `).join("")}
      </div>
    `;
    content.innerHTML = html;
  } catch (e) {
    mostrarErro(e.message);
  }
}

// ===== COTAÇÕES LADO A LADO =====
async function verComparativoCotacoes(cotacaoId) {
  try {
    const dados = await js(API + `/cotacoes/${cotacaoId}/comparacao`);
    
    let html = `
      <div class="panel">
        <h3>📊 Comparativo de Cotações</h3>
        <p><b>Cotação:</b> ${dados.cotacao?.titulo || "Sem título"}</p>
        <table class="table" style="overflow-x: auto;">
          <thead>
            <tr>
              <th>Produto</th>
              ${dados.fornecedores.map(f => `<th>${f.nome}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${dados.itens.map(item => `
              <tr>
                <td><b>${item.descricao}</b><br><small>${item.quantidade} ${item.unidade}</small></td>
                ${dados.fornecedores.map(forn => {
                  const preco = dados.matriz[item.id]?.[forn.id];
                  return `<td>${preco ? `R$ ${Number(preco).toFixed(2)}` : "-"}</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    content.innerHTML = html;
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function compras(){
  const data=await js(API+"/compras");
  const compData = data.data || data;
  const comprasAtivas = compData.filter(c => statusEhAtivo(c.status));
  const isAdmin=usuario&&usuario.role==="admin";
  content.innerHTML=`<div class="panel"><h3>${isAdmin?"Compras e solicitações":"Nova solicitação de compra"}</h3><p style="color:#647066">${isAdmin?"Acompanhe pedidos avulsos e de manutenção.":"Use quando precisar solicitar compra sem abrir manutenção."}</p><div class="actions"><button class="primary" onclick="abrirModalCompra()">+ Nova Solicitação de Compra</button><button class="primary" onclick="abrirCompraRapida()">Compra Rápida (<R$2000)</button><button class="secondary" onclick="verRelatorioSemanal()">Relatório Semanal</button><button class="secondary" onclick="carregar()">Atualizar</button></div></div><div class="panel"><h3>${isAdmin?"Pedidos de compra":"Solicitações enviadas"}</h3><p class="app-version">Versão ${APP_VERSION} — unidade de medida obrigatória (m, cm, kg, g, L, mL, un)</p>${comprasAtivas.map(c=>cardPedidoCompra(c,{admin:isAdmin})).join("")||"Nenhuma solicitação."}</div>`;
}
function abrirModalCompra() {
  modalCompra.classList.remove("hidden");
  formCompra.reset();
  limparPreviewFotoCompra();
  delete formCompra.dataset.tipoCompra;
  document.querySelector("#modalCompra .modal-head h3").innerText = "Nova Solicitação de Compra";
  document.querySelector("#formCompra button[type='submit']").innerText = "Enviar Solicitação";
}

function fecharModalCompra() {
  modalCompra.classList.add("hidden");
  limparPreviewFotoCompra();
}

async function salvarCompraDetalhada(e) {
  e.preventDefault();
  try {
    const solicitante = compSolicitanteModal.value.trim();
    const item = compItemModal.value.trim();
    const quantidade = compQtdModal.value;
    const unidade = compUnidadeModal.value.trim();
    const categoria = compCatModal.value;
    const destino = compDestModal.value.trim();
    const valorUnitario = compValorUnitModal.value;
    const valorTotal = compValorTotalModal.value;
    const link = compLinkModal.value.trim();
    const descricao = compDescricaoModal.value.trim();
    const foto = compFotoModal.files[0];
    
    if(!solicitante) return mostrarErro("Informe o solicitante");
    if(!item) return mostrarErro("Informe o item");
    if(!quantidade) return mostrarErro("Informe a quantidade");
    if(!unidadeMedidaValida(unidade)) return mostrarErro("Selecione a unidade de medida");
    
    let fotoUrl = null;
    if (foto) {
      fotoUrl = await uploadFotoCloudinary(foto);
      if (!fotoUrl) return;
    }
    
    await js(API+"/compras",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        solicitante,
        item,
        quantidade,
        unidade,
        categoria,
        destino,
        valor_unitario: Number(valorUnitario) || 0,
        valor_total: Number(valorTotal) || 0,
        link_produto: link,
        descricao_detalhada: descricao,
        foto_url: fotoUrl
      })
    });
    
    mostrarSucesso("Solicitação enviada com sucesso!");
    formCompra.reset();
    compUnidadeModal.value = '';
    compCatModal.value = '';
    carregar();
    atualizarContadorNotificacoes();
  } catch(e) {
    mostrarErro(e.message);
  }
}

async function addCompra(){
  if(!compSolicitante.value.trim())return mostrarErro("Informe o nome do solicitante."); 
  if(!compItem.value.trim())return mostrarErro("Informe o item."); 
  if(!compQtd.value)return mostrarErro("Informe a quantidade.");
  try {
    await js(API+"/compras",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({solicitante:compSolicitante.value,item:compItem.value,quantidade:compQtd.value,categoria:compCat.value,destino:compDest.value})});
    mostrarSucesso("Solicitação enviada com sucesso!");
    carregar(); 
    atualizarContadorNotificacoes();
  } catch(e) {
    mostrarErro(e.message);
  }
}
async function statusCompra(id,status){ 
  try {
    await js(API+`/compras/${id}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}); 
    mostrarSucesso("Status atualizado!");
    carregar();
  } catch(e) {
    mostrarErro(e.message);
  }
}

async function excluirCompra(id) {
  if (!confirm("Tem certeza que deseja excluir esta compra? Esta ação não pode ser desfeita.")) return;
  try {
    await js(API + `/compras/${id}`, { method: "DELETE" });
    mostrarSucesso("Compra excluída com sucesso!");
    carregar();
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function abrirCotacao(id){
  const box=document.getElementById(`cotacoes-${id}`);
  if(box.classList.contains("hidden")){
    const cotacoes=await js(API+`/compras/${id}/cotacoes`);
    box.innerHTML=`<div style="margin-top:10px"><h4>Cotações</h4>${cotacoes.map(c=>`<div class="card"><b>${c.fornecedor}</b> - ${dinheiro(c.valor)}<br><small>${c.observacao||""}</small></div>`).join("")}<div class="grid"><input id="cot-forn-${id}" placeholder="Fornecedor"><input id="cot-valor-${id}" type="number" placeholder="Valor"></div><button class="primary full" onclick="salvarCotacao(${id})">Adicionar cotação</button></div>`;
    box.classList.remove("hidden");
  }else box.classList.add("hidden");
}
async function salvarCotacao(id){
  const forn=document.getElementById(`cot-forn-${id}`).value;
  const valor=document.getElementById(`cot-valor-${id}`).value;
  if(!forn||!valor)return mostrarErro("Preencha fornecedor e valor.");
  try {
    await js(API+`/compras/${id}/cotacoes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fornecedor:forn,valor})});
    mostrarSucesso("Cotação adicionada!");
    abrirCotacao(id);
  } catch(e) {
    mostrarErro(e.message);
  }
}

async function historico(){
  const data = await js(API + "/compras");
  const compData = data.data || data;
  const historicoData = compData.filter(c => statusEhHistorico(c.status));

  content.innerHTML = `
    <div class="panel">
      <h3>Histórico</h3>
      <p style="color:#647066">Itens aprovados, comprados, concluídos, rejeitados ou cancelados.</p>

      ${
        historicoData.length
          ? historicoData.map(c => cardPedidoCompra(c)).join("")
          : `<div class="card"><small>Nenhum item no histórico.</small></div>`
      }
    </div>
  `;
}

async function cotacoesGerais(){
  const data=await js(API+"/compras");
  const compData = data.data || data;
  const comCotacao = compData.filter(c => {
  const status = normalizarStatus(c.status);
  return status.includes("cotação") || status.includes("pendente");
});
  
  let html = `<div class="panel"><h3>Cotações em aberto</h3>`;
  
  if (comCotacao.length === 0) {
    html += `<p>Nenhuma cotação em aberto.</p></div>`;
    content.innerHTML = html;
    return;
  }
  
  for (const compra of comCotacao) {
    const cotacoes = await js(API+`/compras/${compra.id}/cotacoes`);
    
    html += `<div class="card" style="margin-bottom: 20px;">
      <div style="margin-bottom: 15px;">
        <b style="font-size: 16px;">#${compra.id} — ${htmlEsc(compra.item)}</b>
        <span class="pedido-status-wrap" style="margin-left: 10px;">${st(compra.status)}</span>
      </div>
      <div style="margin-bottom: 10px; color: #666; font-size: 14px;">
        Qtd: ${compra.quantidade} ${compra.unidade || 'un'} | Solicitante: ${htmlEsc(compra.solicitante || '-')}
      </div>`;
    
    if (cotacoes && cotacoes.length > 0) {
      html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px;">`;
      
      cotacoes.forEach(cot => {
        const selecionado = compra.fornecedor_escolhido === cot.fornecedor;
        const bgColor = selecionado ? '#e8f5e9' : '#f9f9f9';
        const borderStyle = selecionado ? '2px solid green' : '1px solid #ddd';
        
        html += `<div style="border: ${borderStyle}; background-color: ${bgColor}; padding: 12px; border-radius: 6px; text-align: center; display: flex; flex-direction: column;">
          <div style="font-weight: bold; margin-bottom: 8px; word-wrap: break-word; overflow-wrap: break-word;">${htmlEsc(cot.fornecedor)}</div>
          <div style="font-size: 18px; color: green; font-weight: bold; margin-bottom: 8px;">R$ ${Number(cot.valor).toFixed(2)}</div>
          <div style="font-size: 12px; color: #666; margin-bottom: 10px; word-wrap: break-word; overflow-wrap: break-word; max-height: 60px; overflow-y: auto;">${cot.observacao || '-'}</div>
          <button class="primary small" onclick="selecionarFornecedorCotacao(${compra.id}, '${htmlEsc(cot.fornecedor)}', ${cot.valor})" style="width: 100%; margin-bottom: 6px;">
            ${selecionado ? '✓ SELECIONADO' : 'Aprovar'}
          </button>
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button class="secondary small" onclick="editarCotacao(${cot.id})" style="flex: 1; font-size: 12px;">✏️ Editar</button>
            <button class="danger small" onclick="deletarCotacao(${compra.id}, ${cot.id})" style="flex: 1; font-size: 12px;">🗑️ Deletar</button>
          </div>
        </div>`;
      });
      
      html += `</div>`;
    } else {
      html += `<p style="color: #999; margin: 10px 0;">Nenhuma cotação adicionada ainda.</p>
        <button class="primary" onclick="abrirModalAdicionarFornecedor(${compra.id})">+ Adicionar Fornecedor</button>`;
    }
    
    html += `</div>`;
  }
  
  html += `</div>`;
  content.innerHTML = html;
}


async function relatoriosMensais(){
  const mesAtual=new Date().toISOString().slice(0,7);
  content.innerHTML=`<div class="panel"><h3>Relatórios Mensais</h3><p>Selecione o mês para gerar o relatório de consumo e estoque.</p><div class="grid"><label>Mês<input type="month" id="relMes" value="${mesAtual}"></label></div><div class="actions" style="margin-top:12px"><button class="primary" onclick="abrirRelatorio()">📊 Gerar Relatório</button></div></div><div id="relatorioContainer"></div>`;
}

function abrirRelatorio(){
  const mes=document.getElementById("relMes").value;
  if(!mes)return mostrarErro("Selecione um mês");
  window.open(API+`/relatorios/mensal/html?month=${mes}`,'_blank');
}

async function fornecedores(){
  const data=await js(API+"/fornecedores");
  content.innerHTML=`<div class="panel"><h3>Cadastro de Fornecedores</h3><div class="grid"><input id="fornNome" placeholder="Nome"><input id="fornContato" placeholder="Contato"><input id="fornTel" placeholder="Telefone"><input id="fornTipo" placeholder="Tipo de produto"></div><button class="primary full" onclick="addFornecedor()">Salvar fornecedor</button></div><div class="panel"><h3>Fornecedores cadastrados</h3>${data.length?`<table class="table"><thead><tr><th>Nome</th><th>Contato</th><th>Telefone</th><th>Tipo</th></tr></thead><tbody>${data.map(f=>`<tr><td><b>${f.nome}</b></td><td>${f.contato||"-"}</td><td>${f.telefone||"-"}</td><td>${f.tipo_produto||"-"}</td></tr>`).join("")}</tbody></table>`:"<p>Nenhum fornecedor cadastrado.</p>"}</div>`;
}

async function addFornecedor(){
  const nome=document.getElementById("fornNome").value;
  if(!nome)return mostrarErro("Informe o nome do fornecedor");
  try{
    await js(API+"/fornecedores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome,contato:document.getElementById("fornContato").value,telefone:document.getElementById("fornTel").value,tipo_produto:document.getElementById("fornTipo").value})});
    mostrarSucesso("Fornecedor cadastrado!");
    fornecedores();
  }catch(e){mostrarErro(e.message);}
}

async function deletarFornecedor(cotacaoId, fornecedorNome) {
  if (!confirm("Tem certeza que quer deletar este fornecedor?")) return;
  try {
    const precos = await js(`${API}/compras/${cotacaoId}/cotacoes`);
    const preco = precos.find(p => p.fornecedor === fornecedorNome);
    if (!preco) { mostrarErro("Fornecedor não encontrado!"); return; }
    await js(`${API}/compras/${cotacaoId}/cotacoes/${preco.id}`, { method: 'DELETE' });
    mostrarSucesso("Fornecedor deletado com sucesso!");
    setTimeout(() => { abrirModalCotacaoComparacao(parseInt(cotacaoId)); }, 500);
  } catch (e) { mostrarErro("Erro ao deletar: " + e.message); }
}

function abrirNotificacoes(){
  notifPanel.classList.toggle("hidden");
  if(!notifPanel.classList.contains("hidden")){
    js(API+"/notificacoes").then(notifs=>{
      notifList.innerHTML=notifs.map(n=>`<div class="notif-item ${n.lida?'':'unread'}"><div class="notif-type">${n.tipo}</div><p>${n.mensagem}</p><small class="notif-date">${new Date(n.criada_em).toLocaleString()}</small></div>`).join("")||"Sem notificações.";
    });
  }
}
function fecharNotificacoes(){ notifPanel.classList.add("hidden"); }
function marcarTodasNotificacoes(){ js(API+"/notificacoes/marcar-todas/lidas",{method:"PUT"}); atualizarContadorNotificacoes(); }
async function atualizarContadorNotificacoes(){
  try{
    const notifs=await js(API+"/notificacoes");
    const naoLidas=notifs.filter(n=>!n.lida).length;
    notifCount.innerText=naoLidas;
    notifCount.classList.toggle("hidden",naoLidas===0);
  }catch(e){}
}


// ===== ESTOQUE: INCLUIR/EDITAR PRODUTOS =====
function abrirModalEstoque(id = null) {
  const modal = document.getElementById("modalEstoque");
  const titulo = document.getElementById("tituloModalEstoque");
  const preview = document.getElementById("estoqueFotoPreview");
  window._estoqueFotoPendente = null;

  document.getElementById("formEstoque").reset();
  document.getElementById("estoqueId").value = "";
  if (preview) preview.classList.add("hidden");

  if (id) {
    titulo.innerText = "Editar Produto";
    js(API + `/estoque/${id}`).then(p => {
      document.getElementById("estoqueId").value = p.id;
      document.getElementById("estoqueName").value = p.nome || "";
      document.getElementById("estoqueCat").value = p.categoria || "Outros";
      document.getElementById("estoqueUnit").value = p.unidade || "";
      document.getElementById("estoqueQtd").value = p.quantidade ?? "";
      document.getElementById("estoqueMin").value = p.minimo ?? "";
      document.getElementById("estoqueFornecedor").value = p.fornecedor || "";
      document.getElementById("estoqueLocal").value = p.local || "";
      document.getElementById("estoqueObs").value = p.observacoes || "";
      if (p.foto_url && preview) {
        document.getElementById("estoqueFotoPreviewImg").src = p.foto_url;
        preview.classList.remove("hidden");
      }
    });
  } else {
    titulo.innerText = "Novo Produto";
  }
  modal.classList.remove("hidden");
}

function fecharModalEstoque() {
  document.getElementById("modalEstoque").classList.add("hidden");
  window._estoqueFotoPendente = null;
}

async function salvarProdutoEstoque(e) {
  e.preventDefault();
  try {
    const id = document.getElementById("estoqueId").value;
    const dados = {
      nome: document.getElementById("estoqueName").value.trim(),
      categoria: document.getElementById("estoqueCat").value,
      unidade: document.getElementById("estoqueUnit").value.trim(),
      quantidade: parseFloat(document.getElementById("estoqueQtd").value) || 0,
      minimo: parseFloat(document.getElementById("estoqueMin").value) || 0,
      fornecedor: document.getElementById("estoqueFornecedor").value.trim(),
      local: document.getElementById("estoqueLocal").value.trim(),
      observacoes: document.getElementById("estoqueObs").value.trim()
    };

    const fotoFile = window._estoqueFotoPendente || document.getElementById("estoqueFoto")?.files[0];
    if (fotoFile) {
      const fotoUrl = await uploadFotoCloudinary(fotoFile);
      if (!fotoUrl) return;
      dados.foto_url = fotoUrl;
      window._estoqueFotoPendente = null;
    } else if (id) {
      const atual = await js(API + `/estoque/${id}`);
      if (atual.foto_url) dados.foto_url = atual.foto_url;
    }

    const url = id ? `${API}/estoque/${id}` : `${API}/estoque`;
    const method = id ? "PUT" : "POST";

    await js(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
    mostrarSucesso("Produto salvo com sucesso!");
    fecharModalEstoque();
    if (tela === "estoque") estoque();
    else carregar();
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function excluirProdutoEstoque(id) {
  if (confirm("Tem certeza que deseja excluir este produto?")) {
    try {
      await js(`${API}/estoque/${id}`, { method: "DELETE" });
      mostrarSucesso("Produto excluído!");
      if (tela === "estoque") estoque();
      else carregar();
    } catch (e) {
      mostrarErro(e.message);
    }
  }
}

// ===== COMPRA RÁPIDA (< R$2000) =====
function abrirModalCompraRapida() {
  document.getElementById("modalCompraRapida").classList.remove("hidden");
  document.getElementById("formCompraRapida").reset();
}

function fecharModalCompraRapida() {
  document.getElementById("modalCompraRapida").classList.add("hidden");
}

async function salvarCompraRapida(e) {
  e.preventDefault();
  try {
    const valorTotal = parseFloat(document.getElementById("crValor").value);
    const unidade = document.getElementById("crUnidade").value.trim();
    const fotoFile = document.getElementById("crFoto")?.files?.[0];
    
    if (valorTotal > 2000) {
      mostrarErro("Valor máximo para compra rápida é R$ 2000!");
      return;
    }
    if (!unidadeMedidaValida(unidade)) {
      mostrarErro("Selecione a unidade de medida");
      return;
    }

    let fotoUrl = null;
    if (fotoFile) {
      fotoUrl = await uploadFotoCloudinary(fotoFile);
      if (!fotoUrl) return;
    }
    
    const dados = {
      solicitante: document.getElementById("crSolicitante").value.trim(),
      item: document.getElementById("crProduto").value.trim(),
      quantidade: parseFloat(document.getElementById("crQtd").value),
      unidade,
      categoria: document.getElementById("crCategoria").value,
      destino: document.getElementById("crDestino").value.trim(),
      valor_unitario: parseFloat(document.getElementById("crValorUnit").value) || 0,
      valor_total: valorTotal,
      descricao: document.getElementById("crDescricao").value.trim(),
      link_produto: document.getElementById("crLink").value.trim(),
      foto_url: fotoUrl
    };
    
    await js(`${API}/compras/rapida`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados)
    });
    mostrarSucesso("Compra rápida registrada! Será incluída no relatório semanal.");
    fecharModalCompraRapida();
  } catch (e) {
    mostrarErro(e.message);
  }
}

// ===== COTAÇÕES: COMPARAÇÃO DE FORNECEDORES =====
let fornecedorSelecionado = null;

function abrirModalCotacaoComparacao(compraId) {
  try {
    Promise.all([
      js(`${API}/compras/${compraId}`),
      js(`${API}/compras/${compraId}/cotacoes`)
    ]).then(([compra, cotacoes]) => {
      const modal = document.getElementById("modalCotacaoComparacao");
      const container = document.getElementById("cotacaoComparacaoContainer");
      
      if (!cotacoes || cotacoes.length === 0) {
        container.innerHTML = `<div class="card"><p>Nenhuma cotação adicionada ainda.</p><button class="primary" onclick="abrirModalAdicionarFornecedor(${compraId})" style="margin-top: 10px;">+ Adicionar Fornecedor</button></div>`;
        modal.classList.remove("hidden");
        return;
      }
      
      const fornecedoresUnicos = [...new Set(cotacoes.map(c => c.fornecedor))];
      
      let html = `<div style="overflow-x: auto; width: 100%;"><table style="width: 100%; border-collapse: collapse; font-size: 14px;"><thead><tr style="background-color: #052e16; color: white;"><th style="padding: 12px; text-align: left; border: 1px solid #ddd;"><strong>Fornecedor</strong></th><th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>Valor</strong></th><th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>Observação</strong></th><th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>Ações</strong></th></tr></thead><tbody>`;
      
      fornecedoresUnicos.forEach((fornecedor) => {
        const cot = cotacoes.find(c => c.fornecedor === fornecedor);
        const selecionado = fornecedorSelecionado?.nome === fornecedor && fornecedorSelecionado?.compraId === compraId;
        const bgColor = selecionado ? '#e8f5e9' : 'white';
        const borderStyle = selecionado ? '2px solid green' : '1px solid #ddd';
        
        html += `<tr style="background-color: ${bgColor};"><td style="padding: 12px; border: ${borderStyle};"><strong>${htmlEsc(fornecedor)}</strong></td><td style="padding: 12px; text-align: center; border: ${borderStyle}; color: green; font-weight: bold;">R$ ${Number(cot.valor).toFixed(2)}</td><td style="padding: 12px; border: ${borderStyle};"><small>${cot.observacao || '-'}</small></td><td style="padding: 12px; text-align: center; border: ${borderStyle};"><button class="small ${selecionado ? 'primary' : 'secondary'}" onclick="selecionarFornecedor(${compraId}, '${htmlEsc(fornecedor)}', ${cot.valor})" style="margin-right: 4px;">${selecionado ? '✓ SELECIONADO' : 'Selecionar'}</button><button class="small danger" onclick="deletarFornecedor(${compraId}, '${htmlEsc(fornecedor)}')">Deletar</button></td></tr>`;
      });
      
      html += `</tbody></table></div><div style="margin-top: 15px; text-align: center;"><button class="primary" onclick="abrirModalAdicionarFornecedor(${compraId})" style="margin-right: 10px;">+ Adicionar Fornecedor</button>${fornecedorSelecionado && fornecedorSelecionado.compraId === compraId ? `<button class="primary" onclick="enviarParaAprovacao(${compraId})">Enviar para Aprovação</button>` : ''}</div>`;
      
      container.innerHTML = html;
      modal.classList.remove("hidden");
    });
  } catch (e) {
    mostrarErro(e.message);
  }
}

function selecionarFornecedor(cotacaoId, indice, nome, valor) {
  fornecedorSelecionado = { id: indice, nome, valor, cotacaoId };
  mostrarSucesso(`Fornecedor "${nome}" selecionado! (R$ ${valor.toFixed(2)})`);
  abrirModalCotacaoComparacao(cotacaoId);
}

async function selecionarFornecedorCotacao(compraId, fornecedor, valor) {
  // Armazena os dados selecionados
  window._cotacaoSelecionada = {compraId, fornecedor, valor};
  
  // Abre modal para enviar para aprovação
  const modal = document.getElementById("modalEnviarAprovacao");
  document.getElementById("envioAprovacaoCompra").value = compraId;
  document.getElementById("envioAprovacaoFornecedor").value = fornecedor;
  document.getElementById("envioAprovacaoValor").value = valor.toFixed(2);
  document.getElementById("envioAprovacaoEmail").value = localStorage.getItem("patroa_email") || "dorian@floresdaterra.com.br";
  modal.classList.remove("hidden");
}

function fecharModalCotacaoComparacao() {
  document.getElementById("modalCotacaoComparacao").classList.add("hidden");
}

async function editarCotacao(cotacaoId) {
  try {
    const cot = await js(`${API}/cotacoes/${cotacaoId}`);
    document.getElementById("editCotacaoId").value = cot.id;
    document.getElementById("editFornecedor").value = cot.fornecedor;
    document.getElementById("editValor").value = cot.valor;
    document.getElementById("editObservacao").value = cot.observacao || '';
    document.getElementById("modalEditarCotacao").classList.remove("hidden");
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function deletarCotacao(compraId, cotacaoId) {
  if (confirm("Excluir esta cotação?")) {
    try {
      await js(`${API}/compras/${compraId}/cotacoes/${cotacaoId}`, { method: "DELETE" });
      mostrarSucesso("Cotação excluída!");
      cotacoesGerais();
    } catch (e) {
      mostrarErro(e.message);
    }
  }
}

function fecharModalEditarCotacao() {
  document.getElementById("modalEditarCotacao").classList.add("hidden");
}

async function salvarEdicaoCotacao() {
  const id = document.getElementById("editCotacaoId").value;
  const fornecedor = document.getElementById("editFornecedor").value;
  const valor = document.getElementById("editValor").value;
  const observacao = document.getElementById("editObservacao").value;
  
  if (!fornecedor || !valor) {
    return mostrarErro("Preencha fornecedor e valor");
  }
  
  try {
    await js(`${API}/cotacoes/${id}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({fornecedor, valor: Number(valor), observacao})
    });
    mostrarSucesso("Cotação atualizada!");
    fecharModalEditarCotacao();
    cotacoesGerais();
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function excluirCotacao(id) {
  if (confirm("Excluir esta cotação?")) {
    try {
      await js(`${API}/cotações/${id}`, { method: "DELETE" });
      mostrarSucesso("Cotação excluída!");
      fecharModalCotacaoComparacao();
    } catch (e) {
      mostrarErro(e.message);
    }
  }
}


// ===== APROVAÇÃO DE COTAÇÕES =====
let cotacaoAtualId = null;

function enviarParaAprovacao(cotacaoId) {
  cotacaoAtualId = cotacaoId;
  const modal = document.getElementById("modalAprovacaoCotacao");
  document.getElementById("aprovacaoCotacaoId").value = cotacaoId;
  document.getElementById("aprovacaoEmail").value = localStorage.getItem("patroa_email") || "dorian@floresdaterra.com.br";
  modal.classList.remove("hidden");
}

function fecharModalAprovacao() {
  document.getElementById("modalAprovacaoCotacao").classList.add("hidden");
}

function fecharModalEnviarAprovacao() {
  document.getElementById("modalEnviarAprovacao").classList.add("hidden");
}

async function confirmarEnvioAprovacaoCotacao(e) {
  e.preventDefault();
  try {
    const compraId = document.getElementById("envioAprovacaoCompra").value;
    const fornecedor = document.getElementById("envioAprovacaoFornecedor").value;
    const valor = document.getElementById("envioAprovacaoValor").value;
    const email = document.getElementById("envioAprovacaoEmail").value;
    const obs = document.getElementById("envioAprovacaoObs").value;
    const urgente = document.getElementById("envioAprovacaoUrgente").checked;
    
    // Salvar email da patroa no localStorage
    localStorage.setItem("patroa_email", email);
    
    // Enviar para aprovação
    await js(API+`/compras/${compraId}/enviar-aprovacao`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({fornecedor, valor, email, obs, urgente})
    });
    
    mostrarSucesso(`Cotação enviada para aprovação de ${email}!`);
    fecharModalEnviarAprovacao();
    cotacoesGerais();
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function confirmarEnvioAprovacao(e) {
  e.preventDefault();
  try {
    const cotacaoId = document.getElementById("aprovacaoCotacaoId").value;
    const email = document.getElementById("aprovacaoEmail").value;
    const obs = document.getElementById("aprovacaoObs").value;
    const urgente = document.getElementById("aprovacaoUrgente").checked;
    
    // Salvar email da patroa para próxima vez
    localStorage.setItem("patroa_email", email);
    
    const dados = {
      cotacao_id: cotacaoId,
      email_patroa: email,
      observacoes: obs,
      urgente: urgente,
      status: "pendente_aprovacao"
    };
    
    // Enviar para aprovação
    await js(`${API}/cotacoes/${cotacaoId}/enviar-aprovacao`, {
      method: "POST",
      body: JSON.stringify(dados)
    });
    
    mostrarSucesso(`Email enviado para ${email}! Aguardando aprovação...`);
    fecharModalAprovacao();
    fecharModalCotacaoComparacao();
    cotacoes(); // Recarregar lista
  } catch (e) {
    mostrarErro(e.message);
  }
}

// Função para aprovar cotação (chamada pelo link no email)
async function aprovarCotacao(cotacaoId) {
  try {
    await js(`${API}/cotacoes/${cotacaoId}/aprovar`, {
      method: "POST",
      body: JSON.stringify({ aprovado_por: usuario.nome })
    });
    mostrarSucesso("Cotação aprovada!");
    cotacoes();
  } catch (e) {
    mostrarErro(e.message);
  }
}

// Função para rejeitar cotação
async function rejeitarCotacao(cotacaoId, motivo = "") {
  try {
    await js(`${API}/cotacoes/${cotacaoId}/rejeitar`, {
      method: "POST",
      body: JSON.stringify({ motivo, rejeitado_por: usuario.nome })
    });
    mostrarSucesso("Cotação rejeitada!");
    cotacoes();
  } catch (e) {
    mostrarErro(e.message);
  }
}


// ===== ADICIONAR FORNECEDOR E PREÇO =====
let cotacaoIdAtual = null;

function abrirModalAdicionarFornecedor(cotacaoId) {
  cotacaoIdAtual = cotacaoId;
  document.getElementById("novoFornecedorCotacaoId").value = cotacaoId;
  document.getElementById("novoFornecedorNome").value = "";
  document.getElementById("novoFornecedorValor").value = "";
  document.getElementById("novoFornecedorObs").value = "";
  document.getElementById("modalAdicionarFornecedor").classList.remove("hidden");
}

function fecharModalAdicionarFornecedor() {
  document.getElementById("modalAdicionarFornecedor").classList.add("hidden");
  cotacaoIdAtual = null;
}

async function salvarNovoFornecedor(event) {
  event.preventDefault();
  
  const cotacaoId = document.getElementById("novoFornecedorCotacaoId").value;
  const fornecedor = document.getElementById("novoFornecedorNome").value;
  const valor = parseFloat(document.getElementById("novoFornecedorValor").value);
  const observacao = document.getElementById("novoFornecedorObs").value;
  
  try {
    const resultado = await js(`${API}/compras/${cotacaoId}/cotacoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fornecedor, valor, observacao })
    });
    
    mostrarSucesso("Fornecedor adicionado com sucesso!");
    fecharModalAdicionarFornecedor();
    
    // Aguardar um pouco e depois recarregar a tabela
    setTimeout(() => {
      abrirModalCotacaoComparacao(parseInt(cotacaoId));
    }, 500);
  } catch (e) {
    mostrarErro(e.message);
  }
}


// ===== DRAWER MENU MOBILE =====
function toggleMenu() {
  const drawer = document.getElementById("drawer");
  const isHidden = drawer.classList.contains("hidden");
  if (isHidden) {
    drawer.classList.remove("hidden");
    document.addEventListener("click", closeDrawerOnClickOutside);
    document.addEventListener("keydown", closeDrawerOnEscape);
  } else {
    fecharDrawer();
  }
}

function fecharDrawer() {
  const drawer = document.getElementById("drawer");
  drawer.classList.add("hidden");
  document.removeEventListener("click", closeDrawerOnClickOutside);
  document.removeEventListener("keydown", closeDrawerOnEscape);
}

function closeDrawerOnClickOutside(event) {
  const drawer = document.getElementById("drawer");
  const menuToggle = document.getElementById("menuToggle");
  if (!drawer.querySelector(".drawer-content").contains(event.target) && !menuToggle.contains(event.target)) {
    fecharDrawer();
  }
}

function closeDrawerOnEscape(event) {
  if (event.key === "Escape") fecharDrawer();
}

function trocarTelaDrawer(tela) {
  fecharDrawer();
  trocarTela(tela);
}

// ===== SCROLL MOBILE — evita travamento com modais/drawer abertos =====
let _scrollLockY = 0;

function temOverlayAberto() {
  return !!document.querySelector(".modal:not(.hidden), .drawer:not(.hidden), .notif-panel:not(.hidden)");
}

function atualizarScrollLock() {
  const aberto = temOverlayAberto();
  const body = document.body;
  if (aberto && !body.classList.contains("scroll-locked")) {
    _scrollLockY = window.scrollY || window.pageYOffset || 0;
    body.classList.add("scroll-locked");
    body.style.top = `-${_scrollLockY}px`;
  } else if (!aberto && body.classList.contains("scroll-locked")) {
    body.classList.remove("scroll-locked");
    body.style.top = "";
    window.scrollTo(0, _scrollLockY);
  }
}

function initScrollLockObserver() {
  document.querySelectorAll(".modal, .drawer, .notif-panel").forEach(el => {
    new MutationObserver(atualizarScrollLock).observe(el, {
      attributes: true,
      attributeFilter: ["class"]
    });
  });
  atualizarScrollLock();
}

function initAppUi() {
  initSelectsUnidade();
  initScrollLockObserver();
  const manSol = document.getElementById("manSolicitante");
  if (manSol) toggleSolicitanteOutro(manSol);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAppUi);
} else {
  initAppUi();
}
