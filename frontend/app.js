// FT FLOW V3 - Completo com Estoque, Compras Rápidas, Cotações e Aprovação
const API = "/api";
let usuario = null;
let tela = "dashboard";
let token = localStorage.getItem('ft_flow_token');

function hoje(){ return new Date().toISOString().slice(0,10); }
function dinheiro(v){ return `R$ ${Number(v||0).toFixed(2)}`; }
function esc(s){ return String(s ?? "").replace(/'/g,"\\'" ).replace(/`/g,"\\`"); }

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
    userName.innerText = usuario.nome || usuario.username;
    userRole.innerText = usuario.role === "admin" ? "Administrador" : "Funcionário";
    if(usuario.role !== "admin") document.querySelectorAll(".admin-only").forEach(e=>e.style.display="none");
    await trocarTela("dashboard", document.querySelector(".nav"));
    atualizarContadorNotificacoes();
    setInterval(atualizarContadorNotificacoes,15000);
  }catch(e){ mostrarErro("Erro ao conectar: "+e.message); }
}

function trocarTela(n,b){
  tela=n;
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  if(b) b.classList.add("active");
  const titles={dashboard:"Dashboard",manutencoes:"Manutenções",estoque:"Estoque",compras:"Compras",cotacoes:"Cotações",recomendacoes:"Recomendações",adubacao:"Adubação",relatorios:"Relatórios",fornecedores:"Fornecedores"};
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
    if(tela==="cotacoes") return cotacoesGerais();
    if(tela==="recomendacoes") return recomendacoesPDF();
    if(tela==="adubacao") return adubacaoSemanal();
    if(tela==="relatorios") return relatoriosMensais();
    if(tela==="fornecedores") return fornecedores();
  }catch(e){ content.innerHTML=`<div class="panel"><h3>Erro</h3><p>${e.message}</p></div>`; }
}

function st(s){
  if(s==="Concluído"||s==="Recebido"||s==="Confirmada")return `<span class="badge done">${s}</span>`;
  if(s==="Aguardando peça"||s==="Em cotação"||s==="Aberta"||s==="Pendente")return `<span class="badge wait">${s}</span>`;
  return `<span class="badge open">${s||"-"}</span>`;
}

function urg(u){ 
  if((u||"").startsWith("Alta"))return `<span class="badge high">${u}</span>`; 
  if((u||"").startsWith("Média"))return `<span class="badge mid">${u}</span>`; 
  return `<span class="badge low">${u||""}</span>`; 
}

async function dashboard(){
  try{
    const d = await apiJson(API+"/dashboard");
    content.innerHTML=`
      <div class="dashboard-grid">
        <div class="card">
          <h3>📋 Manutenções Abertas</h3>
          <p class="big">${d.manutencoesAbertas}</p>
        </div>
        <div class="card">
          <h3>⚠️ Urgentes</h3>
          <p class="big">${d.urgentes}</p>
        </div>
        <div class="card">
          <h3>📦 Aguardando Peça</h3>
          <p class="big">${d.aguardandoPeca}</p>
        </div>
        <div class="card">
          <h3>🛒 Compras Pendentes</h3>
          <p class="big">${d.comprasPendentes}</p>
        </div>
        <div class="card">
          <h3>⚡ Estoque Baixo</h3>
          <p class="big">${d.estoqueBaixo}</p>
        </div>
      </div>
    `;
  }catch(e){ mostrarErro(e.message); }
}

async function manutencoes(){
  try{
    const d = await apiJson(API+"/manutencoes?page=1&limit=20");
    let html = `<div class="panel"><button class="primary" onclick="abrirModal()">+ Nova Manutenção</button>`;
    html += `<table class="table"><thead><tr><th>ID</th><th>Local/Item</th><th>Tipo</th><th>Urgência</th><th>Status</th><th>Ações</th></tr></thead><tbody>`;
    d.data.forEach(m=>{
      html+=`<tr><td>#${m.id}</td><td><b>${m.local_item||"-"}</b><br><small>${m.defeito||""}</small></td><td>${m.tipo||"-"}</td><td>${urg(m.urgencia)}</td><td>${st(m.status)}</td><td>${m.status==="Concluído"?"✅ Finalizada":`<button class="secondary" onclick="abrirConcluir(${m.id})">Concluir</button>`}</td></tr>`;
    });
    html+=`</tbody></table></div>`;
    content.innerHTML=html;
  }catch(e){ mostrarErro(e.message); }
}

async function estoque(){
  try{
    const d = await apiJson(API+"/estoque");
    const baixo = d.filter(e=>e.baixo);
    let html = `<div class="panel"><button class="primary" onclick="abrirAdicionarEstoque()">+ Adicionar Produto</button>`;
    
    if(baixo.length > 0){
      html += `<div class="alert"><strong>⚠️ ${baixo.length} produtos com estoque baixo!</strong></div>`;
      html += `<table class="table"><thead><tr><th>Produto</th><th>Categoria</th><th>Quantidade</th><th>Mínimo</th><th>Ações</th></tr></thead><tbody>`;
      baixo.forEach(e=>{
        html+=`<tr><td><b>${e.nome}</b></td><td>${e.categoria}</td><td>${e.quantidade} ${e.unidade}</td><td>${e.minimo}</td><td><button class="secondary" onclick="abrirEditarEstoque(${e.id})">Editar</button></td></tr>`;
      });
      html += `</tbody></table>`;
    }
    
    html += `<h3>Todos os Produtos</h3>`;
    html += `<table class="table"><thead><tr><th>Produto</th><th>Categoria</th><th>Quantidade</th><th>Mínimo</th><th>Ações</th></tr></thead><tbody>`;
    d.forEach(e=>{
      html+=`<tr><td><b>${e.nome}</b></td><td>${e.categoria}</td><td>${e.quantidade} ${e.unidade}</td><td>${e.minimo}</td><td><button class="secondary" onclick="abrirEditarEstoque(${e.id})">Editar</button> <button class="danger" onclick="deletarEstoque(${e.id})">Deletar</button></td></tr>`;
    });
    html+=`</tbody></table></div>`;
    content.innerHTML=html;
  }catch(e){ mostrarErro(e.message); }
}

async function compras(){
  try{
    const d = await apiJson(API+"/compras?page=1&limit=20");
    let html = `<div class="panel"><button class="primary" onclick="abrirAdicionarCompra()">+ Nova Compra</button>`;
    html += `<table class="table"><thead><tr><th>ID</th><th>Item</th><th>Quantidade</th><th>Status</th><th>Valor</th><th>Ações</th></tr></thead><tbody>`;
    d.data.forEach(c=>{
      html+=`<tr><td>#${c.id}</td><td>${c.item}</td><td>${c.quantidade}</td><td>${st(c.status)}</td><td>${dinheiro(c.valor_escolhido)}</td><td><button class="secondary" onclick="abrirDetalheCompra(${c.id})">Detalhes</button></td></tr>`;
    });
    html+=`</tbody></table></div>`;
    content.innerHTML=html;
  }catch(e){ mostrarErro(e.message); }
}

async function cotacoesGerais(){
  try{
    const d = await apiJson(API+"/compras?page=1&limit=20");
    let html = `<div class="panel"><h3>Cotações Pendentes</h3>`;
    const pendentes = d.data.filter(c=>c.status==="Em cotação");
    if(pendentes.length===0){
      html+=`<p>Nenhuma cotação pendente</p>`;
    }else{
      html+=`<table class="table"><thead><tr><th>ID</th><th>Item</th><th>Quantidade</th><th>Ações</th></tr></thead><tbody>`;
      pendentes.forEach(c=>{
        html+=`<tr><td>#${c.id}</td><td>${c.item}</td><td>${c.quantidade}</td><td><button class="secondary" onclick="abrirComparadorCotacoes(${c.id})">Comparar</button></td></tr>`;
      });
      html+=`</tbody></table>`;
    }
    html+=`</div>`;
    content.innerHTML=html;
  }catch(e){ mostrarErro(e.message); }
}

async function recomendacoesPDF(){
  try{
    content.innerHTML=`<div class="panel"><p>Funcionalidade em desenvolvimento</p></div>`;
  }catch(e){ mostrarErro(e.message); }
}

async function adubacaoSemanal(){
  try{
    content.innerHTML=`<div class="panel"><p>Funcionalidade em desenvolvimento</p></div>`;
  }catch(e){ mostrarErro(e.message); }
}

async function relatoriosMensais(){
  try{
    content.innerHTML=`<div class="panel"><p>Funcionalidade em desenvolvimento</p></div>`;
  }catch(e){ mostrarErro(e.message); }
}

async function fornecedores(){
  try{
    const d = await apiJson(API+"/fornecedores");
    let html = `<div class="panel"><button class="primary" onclick="abrirAdicionarFornecedor()">+ Novo Fornecedor</button>`;
    html += `<table class="table"><thead><tr><th>Nome</th><th>Contato</th><th>Telefone</th><th>Tipo</th></tr></thead><tbody>`;
    d.forEach(f=>{
      html+=`<tr><td>${f.nome}</td><td>${f.contato}</td><td>${f.telefone}</td><td>${f.tipo_produto}</td></tr>`;
    });
    html+=`</tbody></table></div>`;
    content.innerHTML=html;
  }catch(e){ mostrarErro(e.message); }
}

function abrirModal(){
  formManutencao.reset();
  formManutencao.data_ocorrencia.value = hoje();
  modal.classList.remove("hidden");
}

function fecharModal(){
  modal.classList.add("hidden");
}

async function salvarManutencao(e){
  e.preventDefault();
  try{
    const fd = new FormData(formManutencao);
    const r = await apiJson(API+"/manutencoes",{
      method:"POST",
      body:JSON.stringify({
        solicitante:fd.get("solicitante"),
        data_ocorrencia:fd.get("data_ocorrencia"),
        tipo:fd.get("tipo"),
        local_item:fd.get("local_item"),
        defeito:fd.get("defeito"),
        urgencia:fd.get("urgencia"),
        responsavel:fd.get("responsavel"),
        solucao:fd.get("solucao"),
        precisa_compra:precisaCompra.checked?1:0,
        item_compra:fd.get("item_compra"),
        quantidade_compra:fd.get("quantidade_compra"),
        categoria_compra:fd.get("categoria_compra"),
        destino_compra:fd.get("destino_compra")
      }),
      headers:{"Content-Type":"application/json"}
    });
    mostrarSucesso("Manutenção criada!");
    fecharModal();
    manutencoes();
  }catch(e){ mostrarErro(e.message); }
}

function abrirConcluir(id){
  concluirId.value = id;
  concluirModal.classList.remove("hidden");
}

function fecharConcluir(){
  concluirModal.classList.add("hidden");
}

async function salvarConclusao(){
  try{
    await apiJson(API+"/manutencoes/"+concluirId.value,{
      method:"PUT",
      body:JSON.stringify({
        status:"Concluído",
        responsavel:concluirResponsavel.value,
        solucao:concluirSolucao.value
      }),
      headers:{"Content-Type":"application/json"}
    });
    mostrarSucesso("Manutenção concluída!");
    fecharConcluir();
    manutencoes();
  }catch(e){ mostrarErro(e.message); }
}

function toggleCompra(){
  camposCompra.classList.toggle("hidden", !precisaCompra.checked);
}

function abrirAdicionarEstoque(){
  adicionarEstoqueForm.reset();
  adicionarEstoqueModal.classList.remove("hidden");
}

function fecharAdicionarEstoque(){
  adicionarEstoqueModal.classList.add("hidden");
}

async function salvarNovoEstoque(){
  try{
    const r = await apiJson(API+"/estoque",{
      method:"POST",
      body:JSON.stringify({
        nome:estoqueNome.value,
        categoria:estoqueCategoria.value,
        unidade:estoqueUnidade.value,
        quantidade:Number(estoqueQuantidade.value),
        minimo:Number(estoqueMinimo.value)
      }),
      headers:{"Content-Type":"application/json"}
    });
    mostrarSucesso("Produto adicionado!");
    fecharAdicionarEstoque();
    estoque();
  }catch(e){ mostrarErro(e.message); }
}

function abrirEditarEstoque(id){
  // Implementar edição
  mostrarErro("Edição em desenvolvimento");
}

async function deletarEstoque(id){
  if(!confirm("Tem certeza?")) return;
  try{
    await apiJson(API+"/estoque/"+id,{method:"DELETE"});
    mostrarSucesso("Produto deletado!");
    estoque();
  }catch(e){ mostrarErro(e.message); }
}

function abrirAdicionarCompra(){
  adicionarCompraForm.reset();
  adicionarCompraModal.classList.remove("hidden");
}

function fecharAdicionarCompra(){
  adicionarCompraModal.classList.add("hidden");
}

async function salvarNovaCompra(){
  try{
    const valor = Number(compraValor.value);
    if(valor < 2000){
      // Compra rápida - sem cotação
      const r = await apiJson(API+"/compras",{
        method:"POST",
        body:JSON.stringify({
          item:compraItem.value,
          quantidade:Number(compraQuantidade.value),
          categoria:compraCategoria.value,
          destino:compraDestino.value,
          solicitante:usuario.nome,
          status:"Aprovado"
        }),
        headers:{"Content-Type":"application/json"}
      });
      mostrarSucesso("Compra rápida criada!");
    }else{
      // Compra normal - precisa cotação
      const r = await apiJson(API+"/compras",{
        method:"POST",
        body:JSON.stringify({
          item:compraItem.value,
          quantidade:Number(compraQuantidade.value),
          categoria:compraCategoria.value,
          destino:compraDestino.value,
          solicitante:usuario.nome
        }),
        headers:{"Content-Type":"application/json"}
      });
      mostrarSucesso("Compra criada! Aguardando cotações...");
    }
    fecharAdicionarCompra();
    compras();
  }catch(e){ mostrarErro(e.message); }
}

function abrirDetalheCompra(id){
  // Implementar detalhes
  mostrarErro("Detalhes em desenvolvimento");
}

async function abrirComparadorCotacoes(compraId){
  try{
    const cotacoes = await apiJson(API+"/compras/"+compraId+"/cotacoes");
    let html = `<div class="modal hidden" id="comparadorModal"><div class="modal-card"><div class="modal-head"><h3>Comparador de Cotações</h3><button onclick="fecharComparador()">×</button></div>`;
    html += `<table class="table"><thead><tr><th>Fornecedor</th><th>Valor</th><th>Observação</th><th>Ação</th></tr></thead><tbody>`;
    cotacoes.forEach(c=>{
      html+=`<tr><td>${c.fornecedor}</td><td>${dinheiro(c.valor)}</td><td>${c.observacao}</td><td><button class="primary" onclick="escolherFornecedor(${compraId},${c.id},'${c.fornecedor}',${c.valor})">Escolher</button></td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<button class="secondary" onclick="abrirAprovacao(${compraId})">Enviar para Aprovação</button>`;
    html+=`</div></div>`;
    document.body.insertAdjacentHTML("beforeend",html);
    comparadorModal.classList.remove("hidden");
  }catch(e){ mostrarErro(e.message); }
}

function fecharComparador(){
  const m = document.getElementById("comparadorModal");
  if(m) m.remove();
}

async function escolherFornecedor(compraId, cotacaoId, fornecedor, valor){
  try{
    await apiJson(API+"/compras/"+compraId+"/escolher-fornecedor",{
      method:"PUT",
      body:JSON.stringify({fornecedor,valor}),
      headers:{"Content-Type":"application/json"}
    });
    mostrarSucesso("Fornecedor escolhido!");
    fecharComparador();
    cotacoesGerais();
  }catch(e){ mostrarErro(e.message); }
}

async function abrirAprovacao(compraId){
  // Implementar aprovação com email
  mostrarErro("Aprovação em desenvolvimento");
}

function abrirAdicionarFornecedor(){
  mostrarErro("Funcionalidade em desenvolvimento");
}

async function atualizarContadorNotificacoes(){
  try{
    const n = await apiJson(API+"/notificacoes");
    const naoLidas = n.filter(x=>!x.lida).length;
    notifCount.classList.toggle("hidden", naoLidas===0);
    notifCount.innerText = naoLidas;
  }catch(e){}
}

function abrirNotificacoes(){
  notifPanel.classList.toggle("hidden");
}

function fecharNotificacoes(){
  notifPanel.classList.add("hidden");
}

async function marcarTodasNotificacoes(){
  try{
    await apiJson(API+"/notificacoes/marcar-lidas",{method:"PUT"});
    atualizarContadorNotificacoes();
  }catch(e){}
}
