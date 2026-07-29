
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
  "pendente aprovaçao",
  "aguardando aprovação",
  "em andamento",
  "rascunho"
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
    ? `<img src="${htmlEsc(c.foto_url)}" class="pedido-foto" alt="Foto do produto" onclick="abrirLightbox('${htmlEsc(c.foto_url)}')" style="cursor:zoom-in" title="Clique para ampliar">`
    : "";
  const valor = c.valor_total ? `<div class="pedido-linha"><span>Valor total</span><b>${dinheiro(c.valor_total)}</b></div>` : "";
  const fornecedor = c.fornecedor_escolhido
    ? `<div class="pedido-linha"><span>Fornecedor</span><b>${htmlEsc(c.fornecedor_escolhido)} • ${dinheiro(c.valor_escolhido)}</b></div>`
    : "";
  // Data de solicitação
  const dataSolicitacao = c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : "-";
  const linhaData = `<div class="pedido-linha"><span>Solicitado em</span><b>${dataSolicitacao}</b></div>`;

  let acoes = "";
  let statusBadge = "";
  
  // Para lista de compra, mostrar status
  if (c.tipo_solicitacao === 'lista') {
    const statusLista = c.status_lista || 'rascunho';
    const corStatus = statusLista === 'pronta' ? '#2e7d32' : '#ff9800';
    const textoStatus = statusLista === 'pronta' ? '✓ Pronta' : '📄 Rascunho';
    statusBadge = `<span style="background: ${corStatus}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${textoStatus}</span>`;
  }
  
  if (modo === "cotacao") {
    acoes = `<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirModalCotacaoComparacao(${c.id})">Ver cotações</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`;
  } else if (modo === "full" && isAdmin) {
    // Para lista de compra
    if (c.tipo_solicitacao === 'lista') {
      acoes = `<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirModalCotacaoComparacao(${c.id})">Cotação</button><button class="primary" onclick="abrirModalAprovacaoCompra(${c.id})">Enviar para Aprovação</button><button class="secondary" onclick="editarListaCompra(${c.id})">Editar</button><button class="danger" onclick="excluirCompra(${c.id})">🗑️ Excluir</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`;
    } else {
      // Para compra regular
      acoes = `<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirModalCotacaoComparacao(${c.id})">Cotação</button><button class="primary" onclick="abrirModalAprovacaoCompra(${c.id})">Enviar para Aprovação</button><button class="primary" onclick="statusCompra(${c.id},'Recebido')">Recebido</button><button class="danger" onclick="excluirCompra(${c.id})">🗑️ Excluir</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`;
    }
  }

  // Se for lista de compra, mostrar itens
  let itemsHtml = "";
  if (c.tipo_solicitacao === 'lista' && c.itens && Array.isArray(c.itens) && c.itens.length > 0) {
    itemsHtml = `
      <div class="pedido-lista-items" style="margin-top: 15px; padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <span class="pedido-label" style="display: block; margin-bottom: 10px;">Itens da Lista:</span>
        <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
          <thead>
            <tr style="background: #e8f5e9; border-bottom: 1px solid #ddd;">
              <th style="padding: 8px; text-align: left; color: #1b5e20;">Produto</th>
              <th style="padding: 8px; text-align: center; color: #1b5e20; width: 80px;">Qtd</th>
              <th style="padding: 8px; text-align: center; color: #1b5e20; width: 80px;">Un.</th>
            </tr>
          </thead>
          <tbody>
            ${c.itens.map(item => `
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px;">${htmlEsc(item.produto)}</td>
                <td style="padding: 8px; text-align: center;">${item.quantidade}</td>
                <td style="padding: 8px; text-align: center;">${htmlEsc(item.unidade)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `<div class="card pedido-card">
    <div class="pedido-top">
      <b class="pedido-titulo">#${c.id} — ${htmlEsc(c.item)}</b>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="pedido-status-wrap">${st(c.status)}</span>
        ${statusBadge}
      </div>
    </div>
    ${foto}
    <div class="pedido-detalhes">
      <div class="pedido-linha"><span>Solicitante</span><b>${htmlEsc(c.solicitante || "-")}</b></div>
      ${c.tipo_solicitacao !== 'lista' ? `<div class="pedido-linha"><span>Quantidade</span><b>${c.quantidade ?? "-"}</b></div>` : ''}
      ${c.tipo_solicitacao !== 'lista' ? `<div class="pedido-linha"><span>Unidade</span><b>${unidadeTxt}</b></div>` : ''}
      <div class="pedido-linha"><span>Categoria</span><b>${htmlEsc(c.categoria || "-")}</b></div>
      <div class="pedido-linha"><span>Destino</span><b>${htmlEsc(c.destino || "Não informado")}</b></div>
      ${linhaData}
      ${valor}${fornecedor}
    </div>
    ${itemsHtml}
    ${c.tipo_solicitacao !== 'lista' ? `<div class="pedido-descricao-box">
      <span class="pedido-label">Descrição do produto</span>
      <p class="pedido-descricao-texto">${descricaoTxt}</p>
    </div>` : ''}
    ${c.tipo_solicitacao !== 'lista' ? link : ''}
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
  const isAdmin = usuario && usuario.role === "admin";
  return `<table class="table"><thead><tr><th>ID</th><th>Local/Item</th><th>Especificação</th><th>Tipo</th><th>Urgência</th><th>Status</th><th>Data Conclusão</th><th>Ações</th></tr></thead><tbody>${data.map(m=>{
    const dataConclusao = m.data_conclusao ? new Date(m.data_conclusao).toLocaleDateString('pt-BR') : '-';
    const botoesAcao = m.status==="Concluído"?"✅ Finalizada":`<button class="secondary" onclick="abrirConcluir(${m.id})">Concluir</button> ${isAdmin ? `<button class="primary" onclick="abrirAtualizarStatus(${m.id})">Atualizar Status</button>` : ''} <button class="danger" onclick="excluirManutencao(${m.id})">🗑️ Excluir</button>`;
    return `<tr><td>#${m.id}</td><td><b>${m.local_item||"-"}</b><br><small>${m.defeito||""}</small></td><td>${m.especificacao||"-"}</td><td>${m.tipo||"-"}</td><td>${urg(m.urgencia)}</td><td>${st(m.status)}</td><td>${dataConclusao}</td><td><button class="secondary" onclick="verDetalhesManutencao(${m.id})">📋 Detalhes</button> ${botoesAcao}</td></tr>`;
  }).join("")}</tbody></table>`;
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

async function excluirManutencao(id){
  if(!confirm("Tem certeza que deseja excluir esta manutenção?")) return;
  try {
    await js(API+`/manutencoes/${id}`,{method:"DELETE"});
    mostrarSucesso("Manutenção excluída com sucesso!");
    carregar();
    atualizarContadorNotificacoes();
  } catch(e) {
    mostrarErro(e.message || "Erro ao excluir manutenção");
  }
}

async function verDetalhesManutencao(id) {
  try {
    const data = await js(API + `/manutencoes`);
    const manData = data.data || data;
    const m = manData.find(x => x.id === id);
    if (!m) return mostrarErro("Manutenção não encontrada");
    const fotoHtml = m.foto_url
      ? `<div style="margin-bottom:16px;text-align:center"><img src="${htmlEsc(m.foto_url)}" onclick="abrirLightbox('${htmlEsc(m.foto_url)}')" style="max-width:100%;max-height:350px;border-radius:8px;cursor:zoom-in;object-fit:contain" alt="Foto da manutenção"><br><small style="color:#666">Clique para ampliar</small></div>` : '';
    const campos = [
      ['Local / Item', m.local_item],
      ['Especificação', m.especificacao],
      ['Defeito / Problema', m.defeito],
      ['Tipo', m.tipo],
      ['Urgência', m.urgencia],
      ['Status', m.status],
      ['Solicitante', m.solicitante],
      ['Responsável', m.responsavel],
      ['Solução Aplicada', m.solucao],
      ['Data Ocorrência', m.data_ocorrencia ? new Date(m.data_ocorrencia).toLocaleDateString('pt-BR') : null],
      ['Data Conclusão', m.data_conclusao ? new Date(m.data_conclusao).toLocaleDateString('pt-BR') : null],
      ['Precisa Compra', m.precisa_compra == 1 ? 'Sim' : 'Não'],
      ['Item da Compra', m.item_compra],
      ['Quantidade', m.quantidade_compra ? `${m.quantidade_compra} ${m.unidade_compra || ''}` : null],
    ];
    const linhas = campos.filter(([,v]) => v).map(([k,v]) =>
      `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0"><span style="color:#666;font-size:13px">${k}</span><span style="font-weight:500;font-size:13px;text-align:right;max-width:60%">${htmlEsc(String(v))}</span></div>`
    ).join('');
    document.getElementById('modalDetalhesManutencaoConteudo').innerHTML = fotoHtml + linhas;
    document.getElementById('modalDetalhesManutencao').classList.remove('hidden');
  } catch(e) {
    mostrarErro(e.message);
  }
}

function abrirLightbox(url) {
  document.getElementById('lightboxFotoImg').src = url;
  document.getElementById('lightboxFoto').classList.remove('hidden');
}

// Abrir modal para atualizar status
async function abrirAtualizarStatus(id) {
  document.getElementById("atualizarStatusId").value = id;
  document.getElementById("atualizarStatusSelect").value = "";
  document.getElementById("atualizarStatusOutro").value = "";
  document.getElementById("atualizarStatusOutroBox").classList.add("hidden");
  document.getElementById("atualizarStatusModal").classList.remove("hidden");
}

function fecharAtualizarStatus() {
  document.getElementById("atualizarStatusModal").classList.add("hidden");
}

function toggleAtualizarStatusOutro() {
  const select = document.getElementById("atualizarStatusSelect");
  const outroBox = document.getElementById("atualizarStatusOutroBox");
  if (select.value === "Outros") {
    outroBox.classList.remove("hidden");
  } else {
    outroBox.classList.add("hidden");
  }
}

async function salvarAtualizarStatus(e) {
  e.preventDefault();
  try {
    const id = document.getElementById("atualizarStatusId").value;
    const select = document.getElementById("atualizarStatusSelect").value;
    const outro = document.getElementById("atualizarStatusOutro").value;
    
    if (!select) return mostrarErro("Selecione um status");
    
    const novoStatus = select === "Outros" ? outro : select;
    if (!novoStatus.trim()) return mostrarErro("Digite o status customizado");
    
    await js(`${API}/manutencoes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novoStatus })
    });
    
    mostrarSucesso("Status atualizado com sucesso!");
    fecharAtualizarStatus();
    carregar();
  } catch (e) {
    mostrarErro(e.message || "Erro ao atualizar status");
  }
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

async function redimensionarImagem(file, maxPx = 800, qualidade = 0.65) {
  if (!file?.type?.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const maior = Math.max(bmp.width, bmp.height);
    if (maior <= maxPx && file.size <= 500000) {
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
  content.innerHTML=`<div class="panel"><h3>${isAdmin?"Compras e solicitações":"Nova solicitação de compra"}</h3><p style="color:#647066">${isAdmin?"Acompanhe pedidos avulsos e de manutenção.":"Use quando precisar solicitar compra sem abrir manutenção."}</p><div class="actions"><button class="primary" onclick="abrirModalCompra()">+ Nova Solicitação de Compra</button><button class="primary" onclick="abrirModalListaCompra()">📋 Nova Lista de Compra</button><button class="primary" onclick="abrirCompraRapida()">Compra Rápida (<R$2000)</button><button class="secondary" onclick="verRelatorioSemanal()">Relatório Semanal</button><button class="secondary" onclick="carregar()">Atualizar</button></div></div><div class="panel"><h3>${isAdmin?"Pedidos de compra":"Solicitações enviadas"}</h3><p class="app-version">Versão ${APP_VERSION} — unidade de medida obrigatória (m, cm, kg, g, L, mL, un)</p>${comprasAtivas.map(c=>cardPedidoCompra(c,{admin:isAdmin})).join("")||"Nenhuma solicitação."}</div>`;
}
function abrirModalCompra() {
  modalCompra.classList.remove("hidden");
  formCompra.reset();
  limparPreviewFotoCompra();
  delete formCompra.dataset.tipoCompra;
  
  // Tentar atualizar título e botão (se existirem)
  const titulo = document.querySelector("#modalCompra .modal-head h3");
  if (titulo) titulo.innerText = "Nova Solicitação de Compra";
  
  const botao = document.querySelector("#formCompra button[type='submit']");
  if (botao) botao.innerText = "Enviar Solicitação";
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
      const uso = document.getElementById("compUsoModal").value.trim();
      const destinatario = document.getElementById("compDestinatarioModal").value.trim();

      const link = compLinkModal.value.trim();
      const descricao = compDescricaoModal.value.trim();
      const foto = compFotoModal.files[0];
      
      if(!solicitante) return mostrarErro("Informe o solicitante");
      if(!item) return mostrarErro("Informe o item");
      if(!quantidade) return mostrarErro("Informe a quantidade");
      if(!unidadeMedidaValida(unidade)) return mostrarErro("Selecione a unidade de medida");
      if(!destinatario) return mostrarErro("Selecione para quem enviar a solicitação");
      
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
          uso,
          destinatario,
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
      fecharModalCompra();
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
  const historicoData = compData.filter(c => statusEhHistorico(c.status)).sort((a, b) => {
    const dataA = new Date(a.received_at || a.updated_at || a.created_at || 0);
    const dataB = new Date(b.received_at || b.updated_at || b.created_at || 0);
    return dataB - dataA;
  });

  content.innerHTML = `
    <div class="panel">
      <h3>Histórico</h3>
      <p style="color:#647066">Itens aprovados, comprados, concluídos, rejeitados ou cancelados.</p>
      
      <div class="grid" style="margin-bottom: 15px;">
        <input type="text" id="historicoFiltro" placeholder="Buscar por ID, produto, fornecedor..." style="width: 100%;" onkeyup="filtrarHistorico()">
      </div>

      <div id="historicoContainer">
        ${
          historicoData.length
            ? historicoData.map(c => {
              const dataRecebimento = c.received_at ? new Date(c.received_at).toLocaleDateString('pt-BR', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : '-';
              const card = cardPedidoCompra(c);
              return card + `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 12px; color: #666;"><small><strong>Recebido em:</strong> ${dataRecebimento}</small></div>`;
            }).join("")
            : `<div class="card"><small>Nenhum item no histórico.</small></div>`
        }
      </div>
    </div>
  `;
  
  // Armazenar dados para filtro
  window._historicoData = historicoData;
}

function filtrarHistorico() {
  const filtro = document.getElementById('historicoFiltro')?.value?.toLowerCase() || '';
  const historicoContainer = document.getElementById('historicoContainer');
  
  if (!window._historicoData) return;
  
  const filtrados = window._historicoData.filter(c => {
    const texto = `${c.id} ${c.item} ${c.fornecedor_escolhido} ${c.solicitante}`.toLowerCase();
    return texto.includes(filtro);
  });
  
  historicoContainer.innerHTML = filtrados.length
    ? filtrados.map(c => cardPedidoCompra(c)).join('')
    : '<div class="card"><small>Nenhum resultado encontrado.</small></div>';
}

async function cotacoesGerais(){
  // Buscar TODAS as compras sem paginação (limit=1000 para pegar tudo)
  const data=await js(API+"/compras?limit=1000");
  const compData = data.data || data;
  const comCotacao = compData.filter(c => statusEhAtivo(c.status));
  
  // Armazenar dados para filtro
  window._cotacoesData = comCotacao;
  window._cotacoesDataFull = null; // Será preenchido com as cotações
  
  content.innerHTML = `
    <div class="panel">
      <h3>Cotações em aberto</h3>
      <div style="margin-bottom: 12px;">
        <input type="text" id="cotacoesBusca" placeholder="🔍 Buscar por produto, solicitante ou destino..." oninput="filtrarCotacoesPor(window._cotacoesFiltroAtivo||'todas')" style="width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; box-sizing: border-box; outline: none;">
      </div>
      <div class="grid" style="margin-bottom: 5px; gap: 8px; grid-template-columns: repeat(3, 1fr);">
        <button class="secondary" onclick="filtrarCotacoesPor('todas')" id="filtro-todas" style="background-color: #052e16; color: white; font-size: 13px;">Todas</button>
        <button class="secondary" onclick="filtrarCotacoesPor('pendente-cotacao')" id="filtro-pendente-cotacao" style="font-size: 13px;">Pendente Cotação</button>
        <button class="secondary" onclick="filtrarCotacoesPor('pendente-aprovacao')" id="filtro-pendente-aprovacao" style="font-size: 13px;">Pendente Aprovação</button>
      </div>
    </div>
    <div id="cotacoesContainer"></div>`;
  
  if (comCotacao.length === 0) {
    content.innerHTML += `<div class="panel"><p>Nenhuma cotação em aberto.</p></div>`;
    return;
  }
  
  // Carregar todas as cotações em paralelo para melhor performance
  const cotacoesMap = await Promise.all(
    comCotacao.map(c => js(API+`/compras/${c.id}/cotacoes`).then(cots => ({id: c.id, cotacoes: cots})))
  );
  
  // Armazenar cotações para filtro
  window._cotacoesDataFull = comCotacao.map(c => ({
    compra: c,
    cotacoes: cotacoesMap.find(m => m.id === c.id)?.cotacoes || []
  }));
  
  renderizarCotacoes(window._cotacoesDataFull, 'todas');
}

function renderizarCotacoes(cotacoesData, filtro = 'todas') {
  let container = document.getElementById('cotacoesContainer');
  if (!container) {
    content.innerHTML += `<div id="cotacoesContainer"></div>`;
    container = document.getElementById('cotacoesContainer');
  }
  
  // Obter texto de busca
  const busca = (document.getElementById('cotacoesBusca')?.value || '').toLowerCase().trim();
  
  let html = '';
  
  for (const item of cotacoesData) {
    const compra = item.compra;
    const cotacoes = item.cotacoes;
    
    // Aplicar filtro de status
    if (filtro === 'pendente-cotacao' && (compra.status === 'Pendente_aprovacao' || compra.status === 'aprovado' || compra.fornecedor_escolhido)) continue;
    if (filtro === 'pendente-aprovacao' && compra.status !== 'Pendente_aprovacao') continue;
    
    // Aplicar filtro de busca por texto
    if (busca) {
      const textoCompra = [
        compra.item || '',
        compra.solicitante || '',
        compra.destino || '',
        compra.categoria || '',
        String(compra.id)
      ].join(' ').toLowerCase();
      if (!textoCompra.includes(busca)) continue;
    }
    
    let cardHtml = `<div class="card" style="margin-bottom: 20px;">
      <div style="margin-bottom: 15px;">
        <b style="font-size: 16px;">#${compra.id} — ${htmlEsc(compra.item)}</b>
        <span class="pedido-status-wrap" style="margin-left: 10px;">${st(compra.status)}</span>
      </div>
      <div style="margin-bottom: 10px; color: #666; font-size: 14px;">
        Qtd: ${compra.quantidade} ${compra.unidade || 'un'} | Solicitante: ${htmlEsc(compra.solicitante || '-')}
      </div>`;
    
    if (cotacoes && cotacoes.length > 0) {
      cardHtml += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px;">`;
      
      cotacoes.forEach(cot => {
        const selecionado = compra.fornecedor_escolhido === cot.fornecedor;
        const bgColor = selecionado ? '#e8f5e9' : '#f9f9f9';
        const borderStyle = selecionado ? '2px solid green' : '1px solid #ddd';
        
        cardHtml += `<div style="border: ${borderStyle}; background-color: ${bgColor}; padding: 12px; border-radius: 6px; text-align: center; display: flex; flex-direction: column;">
          <div style="font-weight: bold; margin-bottom: 8px; word-wrap: break-word; overflow-wrap: break-word;">${htmlEsc(cot.fornecedor)}</div>
          <div style="font-size: 18px; color: green; font-weight: bold; margin-bottom: 8px;">R$ ${Number(cot.valor).toFixed(2)}</div>
          <div style="font-size: 12px; color: #666; margin-bottom: 10px; word-wrap: break-word; overflow-wrap: break-word; max-height: 60px; overflow-y: auto;">${cot.observacao || '-'}</div>
          <button class="primary small" onclick="selecionarFornecedorCotacao(${compra.id}, &quot;${htmlEsc(cot.fornecedor)}&quot;, ${cot.valor})" style="width: 100%; margin-bottom: 6px;">
            ${selecionado ? '✓ SELECIONADO' : 'Aprovar'}
          </button>
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button class="secondary small" onclick="editarCotacao(${cot.id})" style="flex: 1; font-size: 12px;">✏️ Editar</button>
            <button class="danger small" onclick="deletarCotacao(${compra.id}, ${cot.id})" style="flex: 1; font-size: 12px;">🗑️ Deletar</button>
          </div>
        </div>`;
      });
      
      cardHtml += `</div>`;
    } else {
      cardHtml += `<p style="color: #999; margin: 10px 0;">Nenhuma cotação adicionada ainda.</p>
        <button class="primary" onclick="abrirModalAdicionarFornecedor(${compra.id})">+ Adicionar Fornecedor</button>`;
    }
    
    cardHtml += `</div>`;
    html += cardHtml;
  }
  
  document.getElementById('cotacoesContainer').innerHTML = html || '<div class="card"><p>Nenhuma cotação encontrada.</p></div>';
  
  // Atualizar botões de filtro
  document.getElementById('filtro-todas').style.backgroundColor = filtro === 'todas' ? '#052e16' : '#e5e7eb';
  document.getElementById('filtro-todas').style.color = filtro === 'todas' ? 'white' : 'black';
  document.getElementById('filtro-pendente-cotacao').style.backgroundColor = filtro === 'pendente-cotacao' ? '#052e16' : '#e5e7eb';
  document.getElementById('filtro-pendente-cotacao').style.color = filtro === 'pendente-cotacao' ? 'white' : 'black';
  document.getElementById('filtro-pendente-aprovacao').style.backgroundColor = filtro === 'pendente-aprovacao' ? '#052e16' : '#e5e7eb';
  document.getElementById('filtro-pendente-aprovacao').style.color = filtro === 'pendente-aprovacao' ? 'white' : 'black';
}

function filtrarCotacoesPor(filtro) {
  window._cotacoesFiltroAtivo = filtro;
  if (window._cotacoesDataFull) {
    renderizarCotacoes(window._cotacoesDataFull, filtro);
  }
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
      notifList.innerHTML=notifs.map(n=>`<div class="notif-item ${n.lida?'':'unread'}" onclick="marcarNotificacaoLida(${n.id})"><div class="notif-type">${n.tipo}</div><p>${n.mensagem}</p><small class="notif-date">${new Date(n.created_at).toLocaleString()}</small></div>`).join("")||"Sem notificacoes.";
    });
  }
}
function fecharNotificacoes(){ notifPanel.classList.add("hidden"); }
function marcarTodasNotificacoes(){ js(API+"/notificacoes/marcar-todas-lidas",{method:"PUT"}); atualizarContadorNotificacoes(); }
function marcarNotificacaoLida(notifId){ js(API+`/notificacoes/${notifId}/marcar-lida`,{method:"PUT"}).then(()=>{ abrirNotificacoes(); atualizarContadorNotificacoes(); }).catch(e=>console.error(e)); }
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
    ]).then(async ([compra, cotacoes]) => {
      const modal = document.getElementById("modalCotacaoComparacao");
      const container = document.getElementById("cotacaoComparacaoContainer");
      
      // Se for lista de compra, buscar itens
      let itens = [];
      if (compra.tipo_solicitacao === 'lista') {
        try {
          itens = await js(`${API}/compras/${compraId}/itens`);
        } catch (e) {
          console.log('Erro ao buscar itens:', e);
        }
      }
      
      if (!cotacoes || cotacoes.length === 0) {
        container.innerHTML = `<div class="card"><p>Nenhuma cotação adicionada ainda.</p><button class="primary" onclick="abrirModalAdicionarFornecedor(${compraId})" style="margin-top: 10px;">+ Adicionar Fornecedor</button></div>`;
        modal.classList.remove("hidden");
        return;
      }
      
      // Se for lista de compra, mostrar tabela de cotação (Opção 2)
      if (compra.tipo_solicitacao === 'lista' && itens.length > 0) {
        // Pegar fornecedores únicos
        const fornecedoresUnicos = [...new Set(cotacoes.map(c => c.fornecedor))];
        
        let html = '<div style="overflow-x: auto; width: 100%;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
        html += '<thead><tr style="background-color: #052e16; color: white;">';
        html += '<th style="padding: 12px; text-align: left; border: 1px solid #ddd;"><strong>Produto</strong></th>';
        
        // Cabeçalho com fornecedores
        fornecedoresUnicos.forEach((fornecedor) => {
          html += `<th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>${htmlEsc(fornecedor)}</strong></th>`;
        });
        
        html += '</tr></thead><tbody>';
        
        // Linhas com produtos
        itens.forEach((item) => {
          html += `<tr style="border-bottom: 1px solid #ddd;">`;
          html += `<td style="padding: 12px; border: 1px solid #ddd; font-weight: bold; color: #1b5e20;">${htmlEsc(item.produto)} (${item.quantidade} ${htmlEsc(item.unidade)})</td>`;
          
          fornecedoresUnicos.forEach((fornecedor) => {
            const cot = cotacoes.find(c => c.item_id === item.id && c.fornecedor === fornecedor);
            const valor = cot ? `R$ ${Number(cot.valor).toFixed(2)}` : '-';
            const cor = cot ? 'green' : '#999';
            html += `<td style="padding: 12px; text-align: center; border: 1px solid #ddd; color: ${cor}; font-weight: bold;">${valor}</td>`;
          });
          
          html += '</tr>';
        });
        
        html += '</tbody></table></div>';
        // Para lista pronta, mostrar apenas botão de enviar para aprovação
        if (compra.status_lista === 'pronta') {
          html += `<div style="margin-top: 15px; text-align: center;"><button class="primary" onclick="enviarParaAprovacao(${compraId})">✓ Enviar para Aprovação</button></div>`;
        } else {
          // Para rascunho, mostrar botão de adicionar fornecedor
          html += `<div style="margin-top: 15px; text-align: center;"><button class="primary" onclick="abrirModalAdicionarFornecedor(${compraId})">+ Adicionar Fornecedor</button></div>`;
        }
        container.innerHTML = html;
      } else {
        // Compra regular
        const fornecedoresUnicos = [...new Set(cotacoes.map(c => c.fornecedor))];
        
        let html = `<div style="overflow-x: auto; width: 100%;"><table style="width: 100%; border-collapse: collapse; font-size: 14px;"><thead><tr style="background-color: #052e16; color: white;"><th style="padding: 12px; text-align: left; border: 1px solid #ddd;"><strong>Fornecedor</strong></th><th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>Valor</strong></th><th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>Observação</strong></th><th style="padding: 12px; text-align: center; border: 1px solid #ddd;"><strong>Ações</strong></th></tr></thead><tbody>`;
        
        fornecedoresUnicos.forEach((fornecedor) => {
          const cot = cotacoes.find(c => c.fornecedor === fornecedor);
          const selecionado = fornecedorSelecionado?.nome === fornecedor && fornecedorSelecionado?.compraId === compraId;
          const bgColor = selecionado ? '#e8f5e9' : 'white';
          const borderStyle = selecionado ? '2px solid green' : '1px solid #ddd';
          
          html += `<tr style="background-color: ${bgColor};"><td style="padding: 12px; border: ${borderStyle};"><strong>${htmlEsc(fornecedor)}</strong></td><td style="padding: 12px; text-align: center; border: ${borderStyle}; color: green; font-weight: bold;">R$ ${Number(cot.valor).toFixed(2)}</td><td style="padding: 12px; border: ${borderStyle};"><small>${cot.observacao || '-'}</small></td><td style="padding: 12px; text-align: center; border: ${borderStyle};"><button class="small ${selecionado ? 'primary' : 'secondary'}" onclick="selecionarFornecedor(${compraId}, '${htmlEsc(fornecedor)}', ${cot.valor})" style="margin-right: 4px;">${selecionado ? '✓ SELECIONADO' : 'Enviar para Aprovação'}</button><button class="small danger" onclick="deletarFornecedor(${compraId}, '${htmlEsc(fornecedor)}')">Deletar</button></td></tr>`;
        });
        
        html += `</tbody></table></div><div style="margin-top: 15px; text-align: center;"><button class="primary" onclick="abrirModalAdicionarFornecedor(${compraId})" style="margin-right: 10px;">+ Adicionar Fornecedor</button>${fornecedorSelecionado && fornecedorSelecionado.compraId === compraId ? `<button class="primary" onclick="enviarParaAprovacao(${compraId})">Enviar para Aprovação</button>` : ''}</div>`;
        
        container.innerHTML = html;
      }
      
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
  document.getElementById("envioAprovacaoDestinatario").value = "";
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

// Abrir modal de aprovação de compra (mesmo fluxo de cotações)
async function abrirModalAprovacaoCompra(compraId) {
  try {
    const compra = await js(`${API}/compras/${compraId}`);
    
    const modal = document.getElementById("modalEnviarAprovacao");
    document.getElementById("envioAprovacaoCompra").value = compraId;
    document.getElementById("envioAprovacaoFornecedor").value = compra.fornecedor_escolhido || "";
    document.getElementById("envioAprovacaoValor").value = compra.valor_escolhido ? compra.valor_escolhido.toFixed(2) : "";
    document.getElementById("envioAprovacaoDestinatario").value = compra.destinatario || "";
    modal.classList.remove("hidden");
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function confirmarEnvioAprovacaoCotacao(e) {
  e.preventDefault();
  try {
    const compraId = document.getElementById("envioAprovacaoCompra").value;
    const fornecedor = document.getElementById("envioAprovacaoFornecedor").value;
    const valor = document.getElementById("envioAprovacaoValor").value;
    const destinatario = document.getElementById("envioAprovacaoDestinatario").value;
    const obs = document.getElementById("envioAprovacaoObs").value;
    const urgente = document.getElementById("envioAprovacaoUrgente").checked;
    
    if (!destinatario) return mostrarErro("Selecione para quem enviar a aprovação");
    
    const DORIAN = 'dorian@floresdaterra.com.br';
    const FELIPE = 'felipe@floresdaterra.com.br';
    let emails = [];
    if (destinatario === 'dorian') emails = [DORIAN];
    else if (destinatario === 'felipe') emails = [FELIPE];
    else if (destinatario === 'ambos') emails = [DORIAN, FELIPE];
    
    // Enviar para aprovação
    await js(API+`/compras/${compraId}/enviar-aprovacao`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({fornecedor, valor, destinatario, obs, urgente})
    });
    
    const nomes = destinatario === 'ambos' ? 'Dorian e Felipe' : (destinatario === 'felipe' ? 'Felipe' : 'Dorian');
    mostrarSucesso(`Cotação enviada para aprovação de ${nomes}!`);
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

async function abrirModalAdicionarFornecedor(cotacaoId) {
  console.log('Abrindo modal para compra:', cotacaoId);
  cotacaoIdAtual = cotacaoId;
  document.getElementById("novoFornecedorCotacaoId").value = cotacaoId;
  document.getElementById("novoFornecedorNome").value = "";
  document.getElementById("novoFornecedorValor").value = "";
  document.getElementById("novoFornecedorObs").value = "";
  
  try {
    console.log('Buscando dados da compra...');
    const compra = await js(`${API}/compras/${cotacaoId}`);
    console.log('Compra recebida:', compra);
    
    if (compra.tipo_solicitacao === 'lista') {
      console.log('É lista de compra! Buscando itens...');
      const itens = await js(`${API}/compras/${cotacaoId}/itens`);
      console.log('Itens recebidos:', itens);
      const cotacoes = await js(`${API}/compras/${cotacaoId}/cotacoes`);
      console.log('Cotações recebidas:', cotacoes);
      
      let itemsHtml = '<div style="margin-bottom: 15px;"><label><strong>Selecione o produto:</strong></label><select id="novoFornecedorItem" onchange="mostrarFornecedoresItem(this.value)" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"><option value="">-- Selecione um produto --</option>';
      
      for (const item of itens) {
        itemsHtml += `<option value="${item.id}">${item.produto} (${item.quantidade} ${item.unidade})</option>`;
      }
      
      itemsHtml += '</select></div>';
      
      const container = document.getElementById("fornecedoresItemContainer");
      console.log('Container encontrado:', container);
      console.log('HTML a ser inserido:', itemsHtml);
      container.innerHTML = itemsHtml;
    } else {
      console.log('Não é lista de compra');
    }
  } catch (e) {
    console.log('Erro ao buscar compra:', e);
  }
  
  document.getElementById("modalAdicionarFornecedor").classList.remove("hidden");
}


async function mostrarFornecedoresItem(itemId) {
  if (!itemId) {
    document.getElementById("fornecedoresItemContainer").innerHTML = '';
    return;
  }
  
  try {
    const compraId = document.getElementById("novoFornecedorCotacaoId").value;
    const cotacoes = await js(`${API}/compras/${compraId}/cotacoes`);
    
    // Filtrar cotações para este item
    const cotacoesItem = cotacoes.filter(c => c.item_id == itemId);
    
    let html = '<div style="margin-bottom: 15px; padding: 10px; background: #f0f8f5; border-radius: 4px;">';
    html += '<p style="margin: 0 0 10px 0; font-weight: bold; color: #1b5e20;">Fornecedores já cotados:</p>';
    
    if (cotacoesItem.length === 0) {
      html += '<p style="margin: 5px 0; color: #999; font-size: 13px;">Nenhuma cotação ainda para este produto</p>';
    } else {
      for (const cot of cotacoesItem) {
        html += `<div style="padding: 8px; margin: 5px 0; background: white; border-radius: 4px; border-left: 3px solid #1b5e20;">
          <strong>${cot.fornecedor}</strong> - <span style="color: #2e7d32; font-weight: bold;">R$ ${Number(cot.valor).toFixed(2)}</span>
          <small style="color: #999;">${cot.observacao ? '(' + cot.observacao + ')' : ''}</small>
        </div>`;
      }
    }
    
    html += '</div>';
    document.getElementById("fornecedoresItemContainer").innerHTML = html;
  } catch (e) {
    console.log('Erro ao buscar fornecedores:', e);
    document.getElementById("fornecedoresItemContainer").innerHTML = '';
  }
}


function fecharModalAdicionarFornecedor() {
  document.getElementById("modalAdicionarFornecedor").classList.add("hidden");
  cotacaoIdAtual = null;
}

async function salvarNovoFornecedor(event) {
  event.preventDefault();
  
  const cotacaoId = document.getElementById("novoFornecedorCotacaoId").value;
  const itemId = document.getElementById("novoFornecedorItem")?.value;
  const fornecedor = document.getElementById("novoFornecedorNome").value;
  const valor = parseFloat(document.getElementById("novoFornecedorValor").value);
  const observacao = document.getElementById("novoFornecedorObs").value;
  
  try {
    const resultado = await js(`${API}/compras/${cotacaoId}/cotacoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fornecedor, valor, observacao, item_id: itemId })
    });
    
    mostrarSucesso("Fornecedor adicionado com sucesso!");
    
    // Limpar campos para adicionar outro fornecedor
    document.getElementById("novoFornecedorNome").value = "";
    document.getElementById("novoFornecedorValor").value = "";
    document.getElementById("novoFornecedorObs").value = "";
    
    // Atualizar a lista de fornecedores já cotados se tiver item selecionado
    if (itemId) {
      await mostrarFornecedoresItem(itemId);
    }
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

// ===== LISTA DE COMPRA (Fase 4) =====
let listaCompraItens = [];

function alterarTipoCompra() {
  const tipo = document.getElementById("compTipoModal").value;
  const compraRegularFields = document.getElementById("compraRegularFields");
  const listaCompraFields = document.getElementById("listaCompraFields");
  const listaCompraContainer = document.getElementById("listaCompraContainer");
  const compCatModal = document.getElementById("compCatModal");
  const compDestModal = document.getElementById("compDestModal");
  const compQtdModal = document.getElementById("compQtdModal");
  const compUnidadeModal = document.getElementById("compUnidadeModal");
  const compDescricaoModal = document.getElementById("compDescricaoModal");
  const compFotoModal = document.getElementById("compFotoModal");
  const compLinkModal = document.getElementById("compLinkModal");
  
  if (tipo === "lista") {
    // Mostrar campos de lista de compra
    compraRegularFields.classList.add("hidden");
    listaCompraFields.classList.remove("hidden");
    listaCompraContainer.classList.remove("hidden");
    document.getElementById("listaCompraButtons").classList.remove("hidden");
    document.getElementById("botaoCompraRegular").classList.add("hidden");
    
    // Desabilitar campos de compra regular
    compCatModal.removeAttribute("required");
    compDestModal.removeAttribute("required");
    compQtdModal.removeAttribute("required");
    compUnidadeModal.removeAttribute("required");
    compDescricaoModal.removeAttribute("required");
    compFotoModal.removeAttribute("required");
    compLinkModal.removeAttribute("required");
    
    // Limpar itens anteriores
    listaCompraItens = [];
    renderizarListaCompraItens();
  } else {
    // Mostrar campos de compra regular
    compraRegularFields.classList.remove("hidden");
    listaCompraFields.classList.add("hidden");
    listaCompraContainer.classList.add("hidden");
    document.getElementById("listaCompraButtons").classList.add("hidden");
    document.getElementById("botaoCompraRegular").classList.remove("hidden");
    
    // Reabilitar campos de compra regular
    compCatModal.setAttribute("required", "");
    compDestModal.setAttribute("required", "");
    compQtdModal.setAttribute("required", "");
    compUnidadeModal.setAttribute("required", "");
    compDescricaoModal.setAttribute("required", "");
    compFotoModal.setAttribute("required", "");
  }
}

function adicionarItemLista() {
  const produto = document.getElementById("listaCompraItemInput").value.trim();
  const quantidade = parseFloat(document.getElementById("listaCompraQtdInput").value);
  const unidade = document.getElementById("listaCompraUnidadeInput").value.trim();
  const fornecedor = document.getElementById("listaCompraFornecedorInput").value.trim();
  const preco = parseFloat(document.getElementById("listaCompraPrecoInput").value) || 0;
  
  if (!produto) return mostrarErro("Informe o nome do produto");
  if (!quantidade || quantidade <= 0) return mostrarErro("Informe uma quantidade válida");
  if (!unidade) return mostrarErro("Selecione a unidade de medida");
  if (!fornecedor) return mostrarErro("Informe o fornecedor");
  if (preco <= 0) return mostrarErro("Informe um preço válido");
  
  listaCompraItens.push({ produto, quantidade, unidade, fornecedor, preco, id: Date.now() });
  
  // Limpar campos
  document.getElementById("listaCompraItemInput").value = "";
  document.getElementById("listaCompraQtdInput").value = "";
  document.getElementById("listaCompraUnidadeInput").value = "";
  document.getElementById("listaCompraFornecedorInput").value = "";
  document.getElementById("listaCompraPrecoInput").value = "";
  
  renderizarListaCompraItens();
  mostrarSucesso("Item adicionado!");
}

function removerItemLista(id) {
  listaCompraItens = listaCompraItens.filter(item => item.id !== id);
  renderizarListaCompraItens();
}

function renderizarListaCompraItens() {
  const container = document.getElementById("listaCompraItensContainer");
  
  if (listaCompraItens.length === 0) {
    container.innerHTML = '<p style="color: #999; font-style: italic;">Nenhum item adicionado ainda</p>';
    return;
  }
  
  container.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="background: #e8f5e9; border-bottom: 2px solid #1b5e20;">
          <th style="padding: 8px; text-align: left; color: #1b5e20;">Produto</th>
          <th style="padding: 8px; text-align: center; color: #1b5e20; width: 80px;">Qtd</th>
          <th style="padding: 8px; text-align: center; color: #1b5e20; width: 70px;">Un.</th>
          <th style="padding: 8px; text-align: left; color: #1b5e20; width: 120px;">Fornecedor</th>
          <th style="padding: 8px; text-align: center; color: #1b5e20; width: 100px;">Preço</th>
          <th style="padding: 8px; text-align: center; color: #1b5e20; width: 60px;">Ação</th>
        </tr>
      </thead>
      <tbody>
        ${listaCompraItens.map(item => `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px;">${htmlEsc(item.produto)}</td>
            <td style="padding: 8px; text-align: center;">${item.quantidade}</td>
            <td style="padding: 8px; text-align: center;">${htmlEsc(item.unidade)}</td>
            <td style="padding: 8px;">${htmlEsc(item.fornecedor)}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold; color: #2e7d32;">R$ ${Number(item.preco).toFixed(2)}</td>
            <td style="padding: 8px; text-align: center;">
              <button type="button" class="danger" onclick="removerItemLista(${item.id})" style="padding: 4px 8px; font-size: 12px;">Remover</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function editarListaCompra(compraId) {
  try {
    // Buscar dados da lista
    const compra = await js(`${API}/compras/${compraId}`);
    const itens = await js(`${API}/compras/${compraId}/itens`);
    
    if (!compra || compra.tipo_solicitacao !== 'lista') {
      return mostrarErro("Esta não é uma lista de compra");
    }
    
    // Preencher modal com dados
    document.getElementById("listaCompraModalNome").value = compra.item || "";
    document.getElementById("listaCompraModalSolicitante").value = compra.solicitante || "";
    document.getElementById("listaCompraModalCategoria").value = compra.categoria || "";
    document.getElementById("listaCompraModalDestino").value = compra.destino || "";
    
    // Guardar ID da lista sendo editada
    listaCompraIdEditando = compraId;
    
    // Carregar itens com estrutura de múltiplos fornecedores
    listaCompraItensModal = itens.map(item => ({
      id: item.id || Date.now() + Math.random(),
      produto: item.produto,
      quantidade: item.quantidade,
      unidade: item.unidade,
      fornecedores: item.fornecedores && item.fornecedores.length > 0
        ? item.fornecedores
        : (item.fornecedor ? [{ id: Date.now(), fornecedor: item.fornecedor, preco: item.preco || 0 }] : []),
      expandido: false
    }));
    
    renderizarListaItensRows();
    abrirModalListaCompra();
  } catch(e) {
    mostrarErro(e.message);
  }
}

async function salvarListaRascunho(e) {
  e.preventDefault();
  try {
    const solicitante = document.getElementById("compListaSolicitanteModal").value.trim();
    if (!solicitante) return mostrarErro("Informe o solicitante");
    if (listaCompraItens.length === 0) return mostrarErro("Adicione pelo menos um item a lista");
    
    // Enviar como rascunho
    await js(API + "/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        solicitante,
        tipo_solicitacao: "lista",
        status_lista: "rascunho",
        itens: listaCompraItens
      })
    });
    
    mostrarSucesso(`Lista de compra salva como RASCUNHO com ${listaCompraItens.length} item(ns)!`);
    formCompra.reset();
    listaCompraItens = [];
    document.getElementById("compTipoModal").value = "compra";
    alterarTipoCompra();
    carregar();
    atualizarContadorNotificacoes();
    fecharModalCompra();
  } catch(e) {
    mostrarErro(e.message);
  }
}

async function salvarListaPronta(e) {
  e.preventDefault();
  try {
    const solicitante = document.getElementById("compListaSolicitanteModal").value.trim();
    if (!solicitante) return mostrarErro("Informe o solicitante");
    if (listaCompraItens.length === 0) return mostrarErro("Adicione pelo menos um item a lista");
    
    // Enviar como pronta
    await js(API + "/compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        solicitante,
        tipo_solicitacao: "lista",
        status_lista: "pronta",
        itens: listaCompraItens
      })
    });
    
    mostrarSucesso(`Lista de compra PRONTA com ${listaCompraItens.length} item(ns)! Pronta para cotação.`);
    formCompra.reset();
    listaCompraItens = [];
    document.getElementById("compTipoModal").value = "compra";
    alterarTipoCompra();
    carregar();
    atualizarContadorNotificacoes();
    fecharModalCompra();
  } catch(e) {
    mostrarErro(e.message);
  }
}

// =============================================
// NOVO MODAL DE LISTA DE COMPRA - TABELA EXPANSÍVEL
// =============================================
let listaCompraItensModal = []; // [{id, produto, quantidade, unidade, fornecedores: [{id, fornecedor, preco}], expandido}]
let listaCompraIdEditando = null;

function abrirModalListaCompra() {
  document.getElementById("modalListaCompra").classList.remove("hidden");
  renderizarListaItensRows();
}

function fecharModalListaCompra() {
  document.getElementById("modalListaCompra").classList.add("hidden");
  document.getElementById("formListaCompra").reset();
  listaCompraItensModal = [];
  listaCompraIdEditando = null;
  // Limpar linha de novo item
  const p = document.getElementById("novoItemProduto");
  const q = document.getElementById("novoItemQtd");
  const u = document.getElementById("novoItemUnidade");
  if (p) p.value = "";
  if (q) q.value = "";
  if (u) u.value = "";
  renderizarListaItensRows();
}

// Adicionar novo item pela linha inferior da tabela
function adicionarNovoItemLista() {
  const produto = (document.getElementById("novoItemProduto").value || "").trim();
  const quantidade = parseFloat(document.getElementById("novoItemQtd").value);
  const unidade = (document.getElementById("novoItemUnidade").value || "").trim();
  if (!produto) return mostrarErro("Informe o nome do produto");
  if (!quantidade || quantidade <= 0) return mostrarErro("Informe uma quantidade válida");
  if (!unidade) return mostrarErro("Selecione a unidade de medida");
  listaCompraItensModal.push({ id: Date.now(), produto, quantidade, unidade, fornecedores: [], expandido: true });
  document.getElementById("novoItemProduto").value = "";
  document.getElementById("novoItemQtd").value = "";
  document.getElementById("novoItemUnidade").value = "";
  renderizarListaItensRows();
  mostrarSucesso("Item adicionado!");
}

// Expandir/recolher linha de item
function toggleExpandirItem(id) {
  const item = listaCompraItensModal.find(i => i.id === id);
  if (item) { item.expandido = !item.expandido; renderizarListaItensRows(); }
}

// Remover item
function removerItemListaModal(id) {
  listaCompraItensModal = listaCompraItensModal.filter(i => i.id !== id);
  renderizarListaItensRows();
}

// Adicionar fornecedor a um item
function adicionarFornecedorItem(itemId) {
  const item = listaCompraItensModal.find(i => i.id === itemId);
  if (!item) return;
  const nomeForn = (document.getElementById(`forn_nome_${itemId}`).value || "").trim();
  const precoForn = parseFloat(document.getElementById(`forn_preco_${itemId}`).value) || 0;
  if (!nomeForn) return mostrarErro("Informe o nome do fornecedor");
  if (precoForn <= 0) return mostrarErro("Informe um preço válido");
  item.fornecedores.push({ id: Date.now(), fornecedor: nomeForn, preco: precoForn });
  document.getElementById(`forn_nome_${itemId}`).value = "";
  document.getElementById(`forn_preco_${itemId}`).value = "";
  renderizarListaItensRows();
}

// Remover fornecedor de um item
function removerFornecedorItem(itemId, fornId) {
  const item = listaCompraItensModal.find(i => i.id === itemId);
  if (!item) return;
  item.fornecedores = item.fornecedores.filter(f => f.id !== fornId);
  renderizarListaItensRows();
}

// Renderizar todas as linhas de itens na tabela
function renderizarListaItensRows() {
  const container = document.getElementById("listaItensRows");
  if (!container) return;
  if (listaCompraItensModal.length === 0) {
    container.innerHTML = '<div style="padding: 12px 10px; color: #999; font-style: italic; font-size: 13px;">Nenhum item adicionado ainda. Use a linha abaixo para adicionar.</div>';
    return;
  }
  container.innerHTML = listaCompraItensModal.map(item => {
    const fornecedores = item.fornecedores || [];
    const menorPreco = fornecedores.length > 0 ? Math.min(...fornecedores.map(f => f.preco)) : null;
    const resumoForn = fornecedores.length === 0
      ? '<span style="color:#999; font-size:12px;">Sem fornecedor</span>'
      : `<span style="color:#2e7d32; font-size:12px; font-weight:bold;">${fornecedores.length} fornecedor${fornecedores.length > 1 ? 'es' : ''}</span><br><span style="font-size:11px; color:#555;">Menor: R$ ${menorPreco.toFixed(2)}</span>`;
    const expandido = item.expandido;
    return `
      <div style="border-bottom: 1px solid #eee;">
        <!-- Linha principal do item -->
        <div style="display: grid; grid-template-columns: 32px 1fr 80px 70px 1fr 60px; padding: 8px 10px; align-items: center; background: ${expandido ? '#f1f8e9' : 'white'}; cursor: pointer;" onclick="toggleExpandirItem(${item.id})">
          <span style="text-align:center; color:#1b5e20; font-weight:bold; font-size:14px;">${expandido ? '▼' : '▶'}</span>
          <span style="font-size:13px; font-weight: ${expandido ? 'bold' : 'normal'}; color:#1b5e20;">${htmlEsc(item.produto)}</span>
          <span style="text-align:center; font-size:13px;">${item.quantidade}</span>
          <span style="text-align:center; font-size:13px;">${htmlEsc(item.unidade)}</span>
          <span>${resumoForn}</span>
          <span style="text-align:center;">
            <button type="button" onclick="event.stopPropagation(); removerItemListaModal(${item.id})" style="background:#ffebee; color:#d32f2f; border:none; border-radius:4px; padding:4px 8px; cursor:pointer; font-size:13px;">🗑️</button>
          </span>
        </div>
        <!-- Painel expandido com fornecedores -->
        ${expandido ? `
        <div style="background:#f9fbe7; border-top: 1px dashed #c5e1a5; padding: 10px 16px 10px 42px;">
          ${fornecedores.length > 0 ? `
          <table style="width:100%; font-size:12px; border-collapse:collapse; margin-bottom:8px;">
            <thead><tr style="background:#e8f5e9;">
              <th style="padding:5px 8px; text-align:left; color:#1b5e20;">Fornecedor</th>
              <th style="padding:5px 8px; text-align:right; color:#1b5e20; width:120px;">Preço (R$)</th>
              <th style="padding:5px 8px; width:40px;"></th>
            </tr></thead>
            <tbody>
              ${fornecedores.map(f => `
              <tr style="border-bottom:1px solid #ddd; ${f.preco === menorPreco ? 'background:#e8f5e9;' : ''}">
                <td style="padding:5px 8px; ${f.preco === menorPreco ? 'font-weight:bold; color:#1b5e20;' : ''}">${htmlEsc(f.fornecedor)} ${f.preco === menorPreco ? '✅' : ''}</td>
                <td style="padding:5px 8px; text-align:right; font-weight:bold; color:${f.preco === menorPreco ? '#2e7d32' : '#333'};">R$ ${Number(f.preco).toFixed(2)}</td>
                <td style="padding:5px 8px; text-align:center;">
                  <button type="button" onclick="removerFornecedorItem(${item.id}, ${f.id})" style="background:#ffebee; color:#d32f2f; border:none; border-radius:3px; padding:2px 6px; cursor:pointer; font-size:11px;">✕</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<p style="font-size:12px; color:#999; margin:0 0 8px;">Nenhum fornecedor adicionado ainda.</p>'}
          <!-- Linha para adicionar fornecedor -->
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="forn_nome_${item.id}" placeholder="Nome do fornecedor" onclick="event.stopPropagation()" style="flex:1; padding:5px 8px; border:1px solid #c5e1a5; border-radius:4px; font-size:12px;">
            <input id="forn_preco_${item.id}" type="number" placeholder="Preço" step="0.01" min="0" onclick="event.stopPropagation()" style="width:90px; padding:5px 8px; border:1px solid #c5e1a5; border-radius:4px; font-size:12px;">
            <button type="button" onclick="event.stopPropagation(); adicionarFornecedorItem(${item.id})" style="background:#1b5e20; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer; font-size:12px; white-space:nowrap;">+ Fornecedor</button>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');
}

async function salvarListaRascunhoModal(e) {
  e.preventDefault();
  try {
    const nome = document.getElementById("listaCompraModalNome").value.trim();
    const solicitante = document.getElementById("listaCompraModalSolicitante").value.trim();
    const categoria = document.getElementById("listaCompraModalCategoria").value.trim();
    const destino = document.getElementById("listaCompraModalDestino").value.trim();
    if (!nome) return mostrarErro("Informe o nome da lista");
    if (!solicitante) return mostrarErro("Informe o solicitante");
    if (listaCompraItensModal.length === 0) return mostrarErro("Adicione pelo menos um item a lista");
    
    // Se tá editando, fazer UPDATE. Senão, fazer POST
    if (listaCompraIdEditando) {
      // UPDATE
      await js(API + `/compras/${listaCompraIdEditando}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: nome,
          solicitante,
          categoria: categoria || "Lista de Compra",
          destino: destino || "Lista de Compra",
          status_lista: "rascunho",
          itens: listaCompraItensModal
        })
      });
    } else {
      // POST (nova lista)
      await js(API + "/compras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: nome,
          solicitante,
          categoria: categoria || "Lista de Compra",
          destino: destino || "Lista de Compra",
          tipo_solicitacao: "lista",
          status_lista: "rascunho",
          itens: listaCompraItensModal
        })
      });
    }
    
    mostrarSucesso(`Lista de compra salva como RASCUNHO com ${listaCompraItensModal.length} item(ns)!`);
    fecharModalListaCompra();
    carregar();
    atualizarContadorNotificacoes();
  } catch(e) {
    mostrarErro(e.message);
  }
}

async function salvarListaProntaModal(e) {
  e.preventDefault();
  try {
    const nome = document.getElementById("listaCompraModalNome").value.trim();
    const solicitante = document.getElementById("listaCompraModalSolicitante").value.trim();
    const categoria = document.getElementById("listaCompraModalCategoria").value.trim();
    const destino = document.getElementById("listaCompraModalDestino").value.trim();
    if (!nome) return mostrarErro("Informe o nome da lista");
    if (!solicitante) return mostrarErro("Informe o solicitante");
    if (listaCompraItensModal.length === 0) return mostrarErro("Adicione pelo menos um item a lista");
    
    // Validar que todos os itens têm pelo menos um fornecedor para Lista Pronta
    for (const item of listaCompraItensModal) {
      if (!item.fornecedores || item.fornecedores.length === 0) {
        return mostrarErro(`Adicione pelo menos um fornecedor para o item: ${item.produto}`);
      }
    }
    
    // Se tá editando, fazer UPDATE. Senão, fazer POST
    if (listaCompraIdEditando) {
      // UPDATE
      await js(API + `/compras/${listaCompraIdEditando}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: nome,
          solicitante,
          categoria: categoria || "Lista de Compra",
          destino: destino || "Lista de Compra",
          status_lista: "pronta",
          itens: listaCompraItensModal
        })
      });
    } else {
      // POST (nova lista)
      await js(API + "/compras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: nome,
          solicitante,
          categoria: categoria || "Lista de Compra",
          destino: destino || "Lista de Compra",
          tipo_solicitacao: "lista",
          status_lista: "pronta",
          itens: listaCompraItensModal
        })
      });
    }
    
    mostrarSucesso(`Lista de compra PRONTA com ${listaCompraItensModal.length} item(ns)! Pronta para cotação.`);
    fecharModalListaCompra();
    carregar();
    atualizarContadorNotificacoes();
  } catch(e) {
    mostrarErro(e.message);
  }
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

// ── Pull-to-Refresh para iOS/Safari ──
(function() {
  let startY = 0;
  let pulling = false;
  let indicator = null;

  function criarIndicador() {
    if (indicator) return;
    indicator = document.createElement('div');
    indicator.id = 'ptr-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 0;
      overflow: hidden;
      background: rgba(6,19,12,.95);
      color: #4ade80;
      font-size: 14px;
      font-weight: 600;
      transition: height 0.2s ease;
      padding-top: env(safe-area-inset-top, 0px);
    `;
    indicator.innerHTML = '↓ Puxe para atualizar';
    document.body.prepend(indicator);
  }

  document.addEventListener('touchstart', function(e) {
    // Só ativa se estiver no topo da página
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      criarIndicador();
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!pulling || !indicator) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0 && window.scrollY === 0) {
      const h = Math.min(dy * 0.4, 70);
      indicator.style.height = h + 'px';
      indicator.innerHTML = h > 50 ? '↑ Solte para atualizar' : '↓ Puxe para atualizar';
    }
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    if (!pulling || !indicator) return;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 120 && window.scrollY === 0) {
      indicator.innerHTML = '⟳ Atualizando...';
      indicator.style.height = '60px';
      setTimeout(() => {
        if (typeof carregar === 'function') carregar();
        if (typeof atualizarContadorNotificacoes === 'function') atualizarContadorNotificacoes();
        setTimeout(() => {
          if (indicator) indicator.style.height = '0';
        }, 800);
      }, 300);
    } else {
      if (indicator) indicator.style.height = '0';
    }
    pulling = false;
    startY = 0;
  }, { passive: true });
})();
