// FT FLOW V2.8 - Otimizado
const API = "/api";
let usuario = null;
let tela = "dashboard";
let adubacaoItens = [];
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
    userName.innerText = usuario.nome || usuario.username;
    userRole.innerText = usuario.role === "admin" ? "Administrador" : "Funcionário";
    if(usuario.role !== "admin") document.querySelectorAll(".admin-only").forEach(e=>e.style.display="none");
    await trocarTela("dashboard", document.querySelector(".nav"));
    atualizarContadorNotificacoes();
    setInterval(atualizarContadorNotificacoes,15000);
  }catch(e){ mostrarErro("Erro ao conectar com servidor: "+e.message); }
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
  content.innerHTML=`<div class="cards"><div class="kpi"><small>Manutenções abertas</small><strong>${d.manutencoesAbertas}</strong></div><div class="kpi"><small>Urgentes</small><strong>${d.urgentes}</strong></div><div class="kpi"><small>Aguardando peça</small><strong>${d.aguardandoPeca}</strong></div><div class="kpi"><small>Compras pendentes</small><strong>${d.comprasPendentes}</strong></div><div class="kpi"><small>Estoque baixo</small><strong>${d.estoqueBaixo}</strong></div></div><div class="panel"><h3>Últimas manutenções</h3>${tabelaMan(manData.slice(0,5))}</div><div class="panel"><h3>Itens com estoque baixo</h3>${est.filter(i=>i.baixo).map(i=>`<div class="card stock-low"><b>${i.nome}</b><br>${i.quantidade} ${i.unidade} | mínimo ${i.minimo}</div>`).join("")||"Nenhum item crítico."}</div>`;
}

async function manutencoes(){
  const data=await js(API+"/manutencoes");
  const manData = data.data || data;
  content.innerHTML=`<div class="panel"><div class="actions"><button class="primary" onclick="abrirModalManutencao()">+ Nova Solicitação</button><button class="secondary" onclick="carregar()">Atualizar</button></div></div><div class="panel">${tabelaMan(manData)}</div>`;
}

function abrirModalManutencao(){ modal.classList.remove("hidden"); document.querySelector("[name=data_ocorrencia]").value=hoje(); }
function fecharModal(){ modal.classList.add("hidden"); }
function toggleCompra(){ camposCompra.classList.toggle("hidden",!precisaCompra.checked); }

async function salvarManutencao(e){
  e.preventDefault();
  try {
    const fd=new FormData(formManutencao);
    const dados=Object.fromEntries(fd.entries());
    dados.precisa_compra=precisaCompra.checked?"1":"0";
    delete dados.foto;
    
    // Validação no frontend
    if(!dados.solicitante?.trim()) return mostrarErro("Selecione um solicitante");
    if(!dados.local_item?.trim()) return mostrarErro("Informe o local/item");
    if(!dados.defeito?.trim()) return mostrarErro("Descreva o problema");
    
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

async function estoque(){
  const data=await js(API+"/estoque");
  const cats=[...new Set(data.map(i=>i.categoria||"Sem categoria"))];
  content.innerHTML=`<div class="panel"><h3>Novo item de estoque</h3><div class="grid"><input id="estNome" placeholder="Nome"><input id="estCategoria" placeholder="Categoria"><input id="estUnidade" placeholder="Unidade"><input id="estQtd" type="number" placeholder="Quantidade"><input id="estMin" type="number" placeholder="Mínimo"></div><button class="primary full" onclick="addEstoque()">Salvar item</button><button class="secondary full" onclick="abrirAdicionarEstoqueComFoto()">+ Adicionar com Foto</button></div><div class="panel"><h3>Categorias</h3><div class="category-grid"><button class="cat-btn" onclick="filtrarEstoque('Todos')">Todos <b>${data.length}</b></button>${cats.map(c=>`<button class="cat-btn" onclick="filtrarEstoque('${esc(c)}')">${c} <b>${data.filter(i=>(i.categoria||"Sem categoria")===c).length}</b></button>`).join("")}</div></div><div class="panel"><h3 id="tituloEstoque">Itens</h3><div id="listaEstoque"></div></div>`;
  window._estoqueData=data; renderEstoque(data);
}
function renderEstoque(lista){
  const baixo=lista.filter(i=>i.baixo).length;
  tituloEstoque.innerText=`Itens ${baixo>0?`• ${baixo} em estoque mínimo`:""}`;
  const comAlerta=lista.filter(i=>i.baixo);const semAlerta=lista.filter(i=>!i.baixo);const ordenado=[...comAlerta,...semAlerta];listaEstoque.innerHTML=ordenado.map(i=>`<div class="card ${i.baixo?'stock-low':'stock-ok'}"><div class="stock-row">${i.foto_url?`<img src="${i.foto_url}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;margin-right:15px;">`:''}<div><b>${i.nome}</b><br>${i.categoria} • Estoque: <b>${i.quantidade} ${i.unidade}</b> • mínimo ${i.minimo}<br>${i.baixo?'<span class="badge high">⚠️ ALERTA</span>':'<span class="badge done">OK</span>'}</div><div class="actions"><button class="secondary" onclick="abrirBaixaEstoque(${i.id}, '${esc(i.nome)}', ${Number(i.quantidade||0)}, '${esc(i.unidade)}')">Dar baixa</button><button class="secondary" onclick="abrirEditarEstoque(${i.id}, '${esc(i.nome)}', '${esc(i.categoria)}', '${esc(i.unidade)}', ${i.quantidade}, ${i.minimo})">Editar</button><button class="danger" onclick="deletarEstoque(${i.id})">Deletar</button></div></div></div>`).join("")||"Nenhum item.";
}
function filtrarEstoque(c){const data=window._estoqueData||[];renderEstoque(c==="Todos"?data:data.filter(i=>(i.categoria||"Sem categoria")===c));}
async function addEstoque(){ 
  try {
    await js(API+"/estoque",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome:estNome.value,categoria:estCategoria.value,unidade:estUnidade.value,quantidade:estQtd.value,minimo:estMin.value})});
    mostrarSucesso("Item adicionado com sucesso!");
    carregar();
  } catch(e) {
    mostrarErro(e.message);
  }
}
function abrirBaixaEstoque(id,nome,disponivel,unidade){
  const qtd=prompt(`Baixa de estoque: ${nome}\nDisponível: ${disponivel} ${unidade}\n\nQuantidade a descontar:`); if(qtd===null)return;
  const quantidade=Number(String(qtd).replace(",",".")); if(!quantidade||quantidade<=0)return mostrarErro("Quantidade inválida."); if(quantidade>disponivel)return mostrarErro("Quantidade maior que estoque disponível.");
  const destino=prompt("Destino / uso da baixa:",""); if(destino===null)return; const observacao=prompt("Observação (opcional):","")||"";
  fetch(API+`/estoque/${id}/baixa`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quantidade,destino,observacao,usuario:(usuario?.nome||usuario?.username||"Usuário")})}).then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)return mostrarErro(data.error||"Erro ao dar baixa.");mostrarSucesso("Baixa realizada com sucesso!");carregar();atualizarContadorNotificacoes();});

// ===== ESTOQUE MELHORADO =====
async function abrirEditarEstoque(id, nome, categoria, unidade, qtd, minimo) {
  const novoNome = prompt("Nome do item:", nome);
  if (!novoNome) return;
  const novaCategoria = prompt("Categoria:", categoria);
  const novaUnidade = prompt("Unidade:", unidade);
  const novaQtd = prompt("Quantidade:", qtd);
  const novoMinimo = prompt("Mínimo:", minimo);
  
  try {
    await js(API + `/estoque/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: novoNome,
        categoria: novaCategoria,
        unidade: novaUnidade,
        quantidade: Number(novaQtd),
        minimo: Number(novoMinimo)
      })
    });
    mostrarSucesso("Item atualizado com sucesso!");
    carregar();
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function deletarEstoque(id) {
  if (!confirm("Tem certeza que deseja deletar este item?")) return;
  try {
    await js(API + `/estoque/${id}`, { method: "DELETE" });
    mostrarSucesso("Item deletado com sucesso!");
    carregar();
  } catch (e) {
    mostrarErro(e.message);
  }
}

// ===== UPLOAD DE FOTO COM CLOUDINARY =====
async function uploadFotoCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', 'ft_flow_unsigned');
  formData.append('cloud_name', 'dxvxkz8yd');
  
  try {
    const response = await fetch('https://api.cloudinary.com/v1_1/dxvxkz8yd/image/upload', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Erro ao fazer upload');
    return data.secure_url;
  } catch (e) {
    mostrarErro('Erro ao fazer upload da foto: ' + e.message);
    return null;
  }
}

async function abrirAdicionarEstoqueComFoto() {
  const nome = prompt('Nome do item:');
  if (!nome) return;
  const categoria = prompt('Categoria:');
  const unidade = prompt('Unidade:');
  const qtd = prompt('Quantidade:');
  const minimo = prompt('Mínimo:');
  
  // Criar input de arquivo
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    content.innerHTML = '<div class="panel"><div class="spinner"></div> Fazendo upload da foto...</div>';
    const fotoUrl = await uploadFotoCloudinary(file);
    
    if (!fotoUrl) {
      carregar();
      return;
    }
    
    try {
      await js(API + '/estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          categoria,
          unidade,
          quantidade: Number(qtd),
          minimo: Number(minimo),
          foto_url: fotoUrl
        })
      });
      mostrarSucesso('Item adicionado com foto com sucesso!');
      carregar();
    } catch (e) {
      mostrarErro(e.message);
      carregar();
    }
  };
  input.click();
}


// ===== COMPRAS RÁPIDAS (<R$2000) =====
async function abrirCompraRapida() {
  const item = prompt("Item:");
  if (!item) return;
  const qtd = prompt("Quantidade:");
  if (!qtd) return;
  const valorUnitario = prompt("Valor unitário (R$):");
  if (!valorUnitario) return;
  const categoria = prompt("Categoria:", "Diversos");
  const solicitante = prompt("Solicitante:", usuario?.nome || "");
  
  const valorTotal = Number(qtd) * Number(valorUnitario);
  if (valorTotal >= 2000) {
    return mostrarErro("Compra rápida deve ser menor que R$2.000");
  }
  
  try {
    await js(API + "/compras/rapida", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item,
        quantidade: Number(qtd),
        valor_unitario: Number(valorUnitario),
        categoria,
        solicitante
      })
    });
    mostrarSucesso(`Compra rápida criada! Total: R$ ${valorTotal.toFixed(2)}`);
    carregar();
  } catch (e) {
    mostrarErro(e.message);
  }
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
}

async function compras(){
  const data=await js(API+"/compras");
  const compData = data.data || data;
  const isAdmin=usuario&&usuario.role==="admin";
  content.innerHTML=`<div class="panel"><h3>${isAdmin?"Compras e solicitações":"Nova solicitação de compra"}</h3><p style="color:#647066">${isAdmin?"Acompanhe pedidos avulsos e de manutenção.":"Use quando precisar solicitar compra sem abrir manutenção."}</p><div class="grid"><input id="compSolicitante" placeholder="Nome do solicitante"><input id="compItem" placeholder="Item"><input id="compQtd" type="number" placeholder="Quantidade"><input id="compCat" placeholder="Categoria"><input id="compDest" placeholder="Destino / uso"></div><div class="actions"><button class="primary" onclick="abrirModalCompra()">+ Solicitação Detalhada</button><button class="primary" onclick="abrirCompraRapida()">Compra Rápida (<R$2000)</button><button class="secondary" onclick="verRelatorioSemanal()">Relatório Semanal</button><button class="secondary" onclick="carregar()">Atualizar</button></div><button class="primary full" onclick="addCompra()">Enviar solicitação rápida</button></div><div class="panel"><h3>${isAdmin?"Pedidos de compra":"Solicitações enviadas"}</h3>${compData.map(c=>`<div class="card"><b>#${c.id} - ${c.item}</b><br>Solicitante: ${c.solicitante||"-"}<br>Quantidade: ${c.quantidade} | Categoria: ${c.categoria||"-"}<br>Destino: <b>${c.destino||"Não informado"}</b><br>Status: ${st(c.status)}${c.valor_total?`<br>Total: ${dinheiro(c.valor_total)}`:""} ${c.fornecedor_escolhido?`<br><span class="chosen">Fornecedor escolhido: <b>${c.fornecedor_escolhido}</b> • ${dinheiro(c.valor_escolhido)}</span>`:""}${isAdmin?`<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirCotacao(${c.id})">Cotação</button><button class="primary" onclick="statusCompra(${c.id},'Aprovado')">Aprovar</button><button class="primary" onclick="statusCompra(${c.id},'Recebido')">Recebido</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`:""}</div>`).join("")||"Nenhuma solicitação."}</div>`;
}
function abrirModalCompra() {
  modalCompra.classList.remove("hidden");
  formCompra.reset();
}

function fecharModalCompra() {
  modalCompra.classList.add("hidden");
}

async function salvarCompraDetalhada(e) {
  e.preventDefault();
  try {
    const solicitante = compSolicitanteModal.value.trim();
    const item = compItemModal.value.trim();
    const quantidade = compQtdModal.value;
    const categoria = compCatModal.value;
    const destino = compDestModal.value.trim();
    const link = compLinkModal.value.trim();
    const descricao = compDescricaoModal.value.trim();
    const foto = compFotoModal.files[0];
    
    if(!solicitante) return mostrarErro("Informe o solicitante");
    if(!item) return mostrarErro("Informe o item");
    if(!quantidade) return mostrarErro("Informe a quantidade");
    
    // Se houver foto, fazer upload
    let fotoUrl = null;
    if(foto) {
      const formData = new FormData();
      formData.append('file', foto);
      const uploadRes = await fetch(API+"/upload", {method:"POST", body:formData});
      if(uploadRes.ok) {
        const uploadData = await uploadRes.json();
        fotoUrl = uploadData.url;
      }
    }
    
    await js(API+"/compras",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        solicitante,
        item,
        quantidade,
        categoria,
        destino,
        link_produto: link,
        descricao_detalhada: descricao,
        foto_url: fotoUrl
      })
    });
    
    mostrarSucesso("Solicitação enviada com sucesso!");
    fecharModalCompra();
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

async function cotacoesGerais(){
  const data=await js(API+"/compras");
  const compData = data.data || data;
  const comCotacao=compData.filter(c=>c.status==="Em cotação");
  content.innerHTML=`<div class="panel"><h3>Cotações em aberto</h3>${comCotacao.map(c=>`<div class="card"><b>#${c.id} - ${c.item}</b><br>Solicitante: ${c.solicitante}<br>Quantidade: ${c.quantidade} ${c.categoria}<br><button class="secondary" onclick="abrirCotacao(${c.id})">Ver cotações</button><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div></div>`).join("")||"Nenhuma cotação em aberto."}</div>`;
}

async function recomendacoesPDF(){
  content.innerHTML=`<div class="panel"><h3>Recomendações</h3><p>Carregando...</p></div>`;
}

async function adubacaoSemanal(){
  content.innerHTML=`<div class="panel"><h3>Adubação Semanal</h3><p>Carregando...</p></div>`;
}

async function relatoriosMensais(){
  content.innerHTML=`<div class="panel"><h3>Relatórios Mensais</h3><p>Carregando...</p></div>`;
}

async function fornecedores(){
  content.innerHTML=`<div class="panel"><h3>Fornecedores</h3><p>Carregando...</p></div>`;
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
function marcarTodasNotificacoes(){ js(API+"/notificacoes/marcar-lidas",{method:"POST"}); atualizarContadorNotificacoes(); }
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
  const titulo = document.getElementById("tituloEstoque");
  
  if (id) {
    titulo.innerText = "Editar Produto";
    // Carregar dados do produto
    js(API + `/estoque/${id}`).then(p => {
      document.getElementById("estoqueId").value = p.id;
      document.getElementById("estoqueName").value = p.nome;
      document.getElementById("estoqueCat").value = p.categoria;
      document.getElementById("estoqueUnit").value = p.unidade;
      document.getElementById("estoqueQtd").value = p.quantidade;
      document.getElementById("estoqueMin").value = p.minimo;
    });
  } else {
    titulo.innerText = "Novo Produto";
    document.getElementById("formEstoque").reset();
    document.getElementById("estoqueId").value = "";
  }
  modal.classList.remove("hidden");
}

function fecharModalEstoque() {
  document.getElementById("modalEstoque").classList.add("hidden");
}

async function salvarProdutoEstoque(e) {
  e.preventDefault();
  try {
    const id = document.getElementById("estoqueId").value;
    const dados = {
      nome: document.getElementById("estoqueName").value,
      categoria: document.getElementById("estoqueCat").value,
      unidade: document.getElementById("estoqueUnit").value,
      quantidade: parseFloat(document.getElementById("estoqueQtd").value),
      minimo: parseFloat(document.getElementById("estoqueMin").value)
    };
    
    const url = id ? `${API}/estoque/${id}` : `${API}/estoque`;
    const method = id ? "PUT" : "POST";
    
    await js(url, { method, body: JSON.stringify(dados) });
    mostrarSucesso("Produto salvo com sucesso!");
    fecharModalEstoque();
    estoque(); // Recarregar lista
  } catch (e) {
    mostrarErro(e.message);
  }
}

async function excluirProdutoEstoque(id) {
  if (confirm("Tem certeza que deseja excluir este produto?")) {
    try {
      await js(`${API}/estoque/${id}`, { method: "DELETE" });
      mostrarSucesso("Produto excluído!");
      estoque();
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
    const valor = parseFloat(document.getElementById("crValor").value);
    
    if (valor > 2000) {
      mostrarErro("Valor máximo para compra rápida é R$ 2000!");
      return;
    }
    
    const dados = {
      solicitante: document.getElementById("crSolicitante").value,
      produto: document.getElementById("crProduto").value,
      quantidade: parseFloat(document.getElementById("crQtd").value),
      valor: valor,
      descricao: document.getElementById("crDescricao").value,
      tipo: "rapida",
      status: "aprovada"
    };
    
    await js(`${API}/compras-rapidas`, { method: "POST", body: JSON.stringify(dados) });
    mostrarSucesso("Compra rápida registrada! Será incluída no relatório semanal.");
    fecharModalCompraRapida();
  } catch (e) {
    mostrarErro(e.message);
  }
}

// ===== COTAÇÕES: COMPARAÇÃO DE FORNECEDORES =====
function abrirModalCotacaoComparacao(cotacaoId) {
  try {
    js(`${API}/cotacoes/${cotacaoId}`).then(cotacao => {
      const modal = document.getElementById("modalCotacaoComparacao");
      const tbody = document.getElementById("cotacaoComparacaoBody");
      
      // Montar tabela com fornecedores lado a lado
      let html = `<tr>
        <td><strong>${cotacao.produto}</strong></td>`;
      
      cotacao.fornecedores.forEach((f, i) => {
        html += `<td>
          <strong>${f.nome}</strong><br>
          <span style="color: green; font-size: 16px;">R$ ${f.valor.toFixed(2)}</span><br>
          <small>${f.observacao || ""}</small>
        </td>`;
      });
      
      html += `<td>
        <button class="small" onclick="editarCotacao(${cotacaoId})">✏️ Editar</button>
        <button class="small danger" onclick="excluirCotacao(${cotacaoId})">🗑️ Excluir</button>
      </td></tr>`;
      
      tbody.innerHTML = html;
      modal.classList.remove("hidden");
    });
  } catch (e) {
    mostrarErro(e.message);
  }
}

function fecharModalCotacaoComparacao() {
  document.getElementById("modalCotacaoComparacao").classList.add("hidden");
}

async function editarCotacao(id) {
  // Abrir modal de edição
  mostrarSucesso("Modo edição ativado!");
}

async function excluirCotacao(id) {
  if (confirm("Excluir esta cotação?")) {
    try {
      await js(`${API}/cotacoes/${id}`, { method: "DELETE" });
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
