const API="/api";let usuario=null,tela="dashboard";
function hoje(){return new Date().toISOString().slice(0,10)}
async function fazerLogin(){try{const r=await fetch(API+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:loginUser.value,password:loginPass.value})});if(!r.ok)return alert("Usuário ou senha inválidos");usuario=await r.json();loginScreen.classList.add("hidden");app.classList.remove("hidden");userName.innerText=usuario.nome||usuario.username;userRole.innerText=usuario.role==="admin"?"Administrador":"Funcionário";if(usuario.role!=="admin")document.querySelectorAll(".admin-only").forEach(e=>e.style.display="none");carregar();atualizarContadorNotificacoes();setInterval(atualizarContadorNotificacoes,15000)}catch(e){alert("Erro ao conectar com servidor.")}}
function trocarTela(n,b){tela=n;document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));if(b)b.classList.add("active");pageTitle.innerText={dashboard:"Dashboard",manutencoes:"Manutenções",estoque:"Estoque",compras:"Compras",cotacoes:"Cotações",recomendacoes:"Recomendações",adubacao:"Adubação",relatorios:"Relatórios",fornecedores:"Fornecedores"}[n];carregar()}
async function js(u,o){const r=await fetch(u,o);return await r.json()}async function carregar(){if(tela==="dashboard")return dashboard();if(tela==="manutencoes")return manutencoes();if(tela==="estoque")return estoque();if(tela==="compras")return compras();if(tela==="cotacoes")return cotacoesGerais();if(tela==="recomendacoes")return recomendacoesPDF();if(tela==="adubacao")return adubacaoSemanal();if(tela==="relatorios")return relatoriosMensais();if(tela==="fornecedores")return fornecedores()}
function st(s){if(s==="Concluído"||s==="Recebido")return `<span class="badge done">${s}</span>`;if(s==="Aguardando peça"||s==="Em cotação")return `<span class="badge wait">${s}</span>`;return `<span class="badge open">${s}</span>`}
function urg(u){if((u||"").startsWith("Alta"))return `<span class="badge high">${u}</span>`;if((u||"").startsWith("Média"))return `<span class="badge mid">${u}</span>`;return `<span class="badge low">${u||""}</span>`}
function tabelaMan(data){return `<table class="table"><thead><tr><th>ID</th><th>Local/Item</th><th>Tipo</th><th>Urgência</th><th>Status</th><th>Ações</th></tr></thead><tbody>${data.map(m=>`<tr><td>#${m.id}</td><td><b>${m.local_item||"-"}</b><br><small>${m.defeito||""}</small></td><td>${m.tipo||"-"}</td><td>${urg(m.urgencia)}</td><td>${st(m.status)}</td><td>${m.status==="Concluído"?"✅ Finalizada":`<button class="secondary" onclick="abrirConcluir(${m.id})">Concluir</button>`}</td></tr>`).join("")}</tbody></table>`}
async function dashboard(){const d=await js(API+"/dashboard"),man=await js(API+"/manutencoes"),est=await js(API+"/estoque");content.innerHTML=`<div class="cards"><div class="kpi"><small>Manutenções abertas</small><strong>${d.manutencoesAbertas}</strong></div><div class="kpi"><small>Urgentes</small><strong>${d.urgentes}</strong></div><div class="kpi"><small>Aguardando peça</small><strong>${d.aguardandoPeca}</strong></div><div class="kpi"><small>Compras pendentes</small><strong>${d.comprasPendentes}</strong></div><div class="kpi"><small>Estoque baixo</small><strong>${d.estoqueBaixo}</strong></div></div><div class="panel"><h3>Últimas manutenções</h3>${tabelaMan(man.slice(0,5))}</div><div class="panel"><h3>Itens com estoque baixo</h3>${est.filter(i=>i.baixo).map(i=>`<div class="card stock-low"><b>${i.nome}</b><br>${i.quantidade} ${i.unidade} | mínimo ${i.minimo}</div>`).join("")||"Nenhum item crítico."}</div>`}
async function manutencoes(){const data=await js(API+"/manutencoes");content.innerHTML=`<div class="panel"><div class="actions"><button class="primary" onclick="abrirModalManutencao()">+ Nova Solicitação</button><button class="secondary" onclick="carregar()">Atualizar</button></div></div><div class="panel">${tabelaMan(data)}</div>`}
function abrirModalManutencao(){modal.classList.remove("hidden");document.querySelector("[name=data_ocorrencia]").value=hoje()}function fecharModal(){modal.classList.add("hidden")}function toggleCompra(){camposCompra.classList.toggle("hidden",!precisaCompra.checked)}
async function salvarManutencao(e){e.preventDefault();const fd=new FormData(formManutencao);fd.set("precisa_compra",precisaCompra.checked?"1":"0");await fetch(API+"/manutencoes",{method:"POST",body:fd});formManutencao.reset();fecharModal();carregar();atualizarContadorNotificacoes()}
function abrirConcluir(id){concluirId.value=id;concluirResponsavel.value="";concluirSolucao.value="";concluirModal.classList.remove("hidden")}
function fecharConcluir(){concluirModal.classList.add("hidden")}
async function salvarConclusao(){if(!concluirSolucao.value.trim())return alert("Informe a solução aplicada.");await fetch(API+`/manutencoes/${concluirId.value}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"Concluído",responsavel:concluirResponsavel.value,solucao:concluirSolucao.value})});fecharConcluir();carregar();atualizarContadorNotificacoes();alert("Manutenção concluída e email enviado.")}
async function estoque(){const data=await js(API+"/estoque");const cats=[...new Set(data.map(i=>i.categoria||"Sem categoria"))];content.innerHTML=`<div class="panel"><h3>Novo item de estoque</h3><div class="grid"><input id="estNome" placeholder="Nome"><input id="estCategoria" placeholder="Categoria"><input id="estUnidade" placeholder="Unidade"><input id="estQtd" type="number" placeholder="Quantidade"><input id="estMin" type="number" placeholder="Mínimo"></div><button class="primary full" onclick="addEstoque()">Salvar item</button></div><div class="panel"><h3>Categorias</h3><div class="category-grid"><button class="cat-btn" onclick="filtrarEstoque('Todos')">Todos <b>${data.length}</b></button>${cats.map(c=>`<button class="cat-btn" onclick="filtrarEstoque('${c.replace(/'/g,"\\'")}')">${c} <b>${data.filter(i=>(i.categoria||"Sem categoria")===c).length}</b></button>`).join("")}</div></div><div class="panel"><h3 id="tituloEstoque">Itens</h3><div id="listaEstoque"></div></div>`;window._estoqueData=data;renderEstoque(data)}
function renderEstoque(lista){const baixo=lista.filter(i=>i.baixo).length;tituloEstoque.innerText=`Itens ${baixo>0?`• ${baixo} em estoque mínimo`:""}`;listaEstoque.innerHTML=lista.map(i=>`<div class="card ${i.baixo?'stock-low':'stock-ok'}"><div class="stock-row"><div><b>${i.nome}</b><br>${i.categoria} • ${i.quantidade} ${i.unidade} • mínimo ${i.minimo}</div>${i.baixo?'<span class="badge high">ALERTA</span>':'<span class="badge done">OK</span>'}</div></div>`).join("")||"Nenhum item."}
function filtrarEstoque(c){const data=window._estoqueData||[];renderEstoque(c==="Todos"?data:data.filter(i=>(i.categoria||"Sem categoria")===c))}
async function addEstoque(){await fetch(API+"/estoque",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome:estNome.value,categoria:estCategoria.value,unidade:estUnidade.value,quantidade:estQtd.value,minimo:estMin.value})});carregar();atualizarContadorNotificacoes()}
async function compras(){const data=await js(API+"/compras");content.innerHTML=`<div class="panel"><h3>Novo pedido</h3><div class="grid"><input id="compItem" placeholder="Item"><input id="compQtd" type="number" placeholder="Quantidade"><input id="compCat" placeholder="Categoria"><input id="compDest" placeholder="Destino"></div><button class="primary full" onclick="addCompra()">Criar pedido</button></div><div class="panel"><h3>Pedidos</h3>${data.map(c=>`<div class="card"><b>#${c.id} - ${c.item}</b><br>Quantidade: ${c.quantidade} | Categoria: ${c.categoria||"-"}<br>Destino: <b>${c.destino||"Não informado"}</b><br>Status: ${st(c.status)}<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirCotacao(${c.id})">Cotação</button><button class="primary" onclick="statusCompra(${c.id},'Aprovado')">Aprovar</button><button class="primary" onclick="statusCompra(${c.id},'Recebido')">Recebido</button></div></div>`).join("")}</div>`}
async function addCompra(){await fetch(API+"/compras",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item:compItem.value,quantidade:compQtd.value,categoria:compCat.value,destino:compDest.value})});carregar();atualizarContadorNotificacoes()}
async function statusCompra(id,status){await fetch(API+`/compras/${id}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});carregar()}
async function abrirCotacao(id){const fornecedor=prompt("Fornecedor:");if(!fornecedor)return;const valor=prompt("Valor:");await fetch(API+`/compras/${id}/cotacoes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fornecedor,valor})});alert("Cotação salva.")}
async function fornecedores(){const data=await js(API+"/fornecedores");content.innerHTML=`<div class="panel"><h3>Novo fornecedor</h3><div class="grid"><input id="forNome" placeholder="Empresa"><input id="forContato" placeholder="Contato"><input id="forTel" placeholder="Telefone"><input id="forTipo" placeholder="Tipo"></div><button class="primary full" onclick="addFornecedor()">Salvar</button></div><div class="panel"><h3>Fornecedores</h3>${data.map(f=>`<div class="card"><b>${f.nome}</b><br>${f.contato} • ${f.telefone}<br>${f.tipo_produto}</div>`).join("")}</div>`}
async function addFornecedor(){await fetch(API+"/fornecedores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome:forNome.value,contato:forContato.value,telefone:forTel.value,tipo_produto:forTipo.value})});carregar()}
async function atualizarContadorNotificacoes(){if(!usuario||usuario.role!=="admin")return;try{const r=await js(API+"/notificacoes/unread-count");if(r.total>0){notifCount.innerText=r.total;notifCount.classList.remove("hidden")}else notifCount.classList.add("hidden")}catch(e){}}
async function abrirNotificacoes(){if(!usuario||usuario.role!=="admin")return;notifPanel.classList.remove("hidden");const data=await js(API+"/notificacoes");notifList.innerHTML=data.map(n=>`<div class="notif-item ${n.lida?"":"unread"}" onclick="marcarNotificacao(${n.id})"><div class="notif-type">${n.tipo}</div><b>${n.titulo}</b><p>${n.mensagem}</p><div class="notif-date">${n.created_at}</div></div>`).join("")||"<p>Nenhuma notificação.</p>"}
function fecharNotificacoes(){notifPanel.classList.add("hidden")}async function marcarNotificacao(id){await fetch(API+`/notificacoes/${id}/lida`,{method:"PUT"});await abrirNotificacoes();await atualizarContadorNotificacoes()}async function marcarTodasNotificacoes(){await fetch(API+"/notificacoes/marcar-todas/lidas",{method:"PUT"});await abrirNotificacoes();await atualizarContadorNotificacoes()}

let adubacaoItens = [];

async function adubacaoSemanal(){
  const adubos = await js(API+"/adubacao/adubos");
  const destinos = await js(API+"/adubacao/destinos");

  content.innerHTML = `
    <div class="panel">
      <h3>Adubação semanal</h3>
      <p style="color:#647066">1) Selecione os adubos e quantidades. 2) Depois distribua por destino. 3) Confirme para baixar do estoque.</p>
      <div class="grid">
        <select id="aduboProduto">
          ${adubos.map(a=>`<option value="${a.nome}" data-unidade="${a.unidade||"kg"}" data-estoque="${a.quantidade||0}">${a.nome} — estoque: ${a.quantidade} ${a.unidade||""}</option>`).join("")}
        </select>
        <input id="aduboQtd" type="number" step="0.01" placeholder="Quantidade total">
      </div>
      <button class="secondary full" onclick="addAduboItem()">Adicionar adubo</button>
    </div>

    <div class="panel">
      <h3>Produtos selecionados</h3>
      <div id="aduboLista"></div>
    </div>

    <div class="panel">
      <h3>Distribuição por destino</h3>
      <div id="aduboDistribuicao"></div>
      <button class="primary full" onclick="confirmarAdubacao()">Confirmar baixa no estoque</button>
    </div>`;

  window._destinosAdubacao = destinos;
  renderAdubacao();
}

function addAduboItem(){
  const opt = aduboProduto.options[aduboProduto.selectedIndex];
  const produto = aduboProduto.value;
  const quantidade = Number(aduboQtd.value||0);
  const unidade = opt.dataset.unidade || "kg";
  const estoque = Number(opt.dataset.estoque||0);

  if(!produto || quantidade<=0) return alert("Selecione um adubo e informe a quantidade.");
  if(quantidade > estoque) return alert("Quantidade maior que o estoque disponível.");

  adubacaoItens.push({produto,quantidade,unidade,estoque});
  aduboQtd.value="";
  renderAdubacao();
}

function renderAdubacao(){
  const destinos = window._destinosAdubacao || [];
  if(!document.getElementById("aduboLista")) return;

  aduboLista.innerHTML = adubacaoItens.map((i,idx)=>`
    <div class="card"><b>${i.produto}</b><br>Total: ${i.quantidade} ${i.unidade}<br>Estoque atual: ${i.estoque} ${i.unidade}
    <button class="secondary" onclick="adubacaoItens.splice(${idx},1);renderAdubacao()">Remover</button></div>
  `).join("") || "Nenhum adubo selecionado.";

  aduboDistribuicao.innerHTML = adubacaoItens.map((item,idx)=>`
    <div class="card">
      <b>${item.produto}</b> — distribuir ${item.quantidade} ${item.unidade}
      <div class="grid">
        ${destinos.map(dest=>`
          <label>${dest}
            <input class="dist-input" data-produto="${item.produto}" data-unidade="${item.unidade}" data-destino="${dest}" type="number" step="0.01" placeholder="0">
          </label>
        `).join("")}
      </div>
    </div>
  `).join("") || "Adicione adubos para distribuir.";
}

async function confirmarAdubacao(){
  if(!adubacaoItens.length) return alert("Adicione ao menos um adubo.");

  const distribuicao = [...document.querySelectorAll(".dist-input")].map(inp=>({
    produto: inp.dataset.produto,
    destino: inp.dataset.destino,
    unidade: inp.dataset.unidade,
    quantidade: Number(inp.value || 0)
  })).filter(d=>d.quantidade>0);

  for(const item of adubacaoItens){
    const soma = distribuicao.filter(d=>d.produto===item.produto).reduce((a,d)=>a+d.quantidade,0);
    if(Math.abs(soma - item.quantidade) > 0.001){
      return alert(`Distribuição não confere para ${item.produto}. Total: ${item.quantidade}, distribuído: ${soma}`);
    }
  }

  await fetch(API+"/adubacao/aplicar",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({titulo:"Adubação semanal",itens:adubacaoItens,distribuicao})
  });

  alert("Adubação registrada e estoque atualizado.");
  adubacaoItens=[];
  carregar();
}

async function relatoriosMensais(){
  const hoje = new Date().toISOString().slice(0,7);
  content.innerHTML = `
    <div class="panel">
      <h3>Relatório mensal</h3>
      <p style="color:#647066">Gere um relatório com consumo mensal, compras e estoque atual. Você pode salvar como PDF pelo navegador.</p>
      <div class="grid">
        <input id="relMes" type="month" value="${hoje}">
      </div>
      <button class="primary full" onclick="abrirRelatorioMensal()">Gerar relatório mensal</button>
    </div>`;
}

function abrirRelatorioMensal(){
  const mes = relMes.value || new Date().toISOString().slice(0,7);
  window.open(API+`/relatorios/mensal/html?month=${mes}`, "_blank");
}

async function cotacoesGerais(){
  content.innerHTML = `<div class="panel"><h3>Cotações</h3><p>Use a aba Compras para cotações simples. A cotação em planilha será mantida em uma próxima atualização.</p></div>`;
}

async function recomendacoesPDF(){
 const data=await js(API+"/recomendacoes");
 content.innerHTML=`<div class="panel"><h3>Leitura de PDF - Defensivos</h3><p style="color:#647066">Envie o PDF de recomendação. O sistema identifica produto, dosagem e cultura. A baixa no estoque só acontece após confirmação.</p><input id="pdfRecomendacao" type="file" accept="application/pdf"><button class="primary full" onclick="uploadRecomendacaoPDF()">Ler PDF</button></div><div class="panel"><h3>Histórico de PDFs</h3>${data.map(r=>`<div class="card"><b>#${r.id} - ${r.arquivo}</b><br>Semana: ${r.semana||"-"}<br>Status: ${st(r.status==="Confirmada"?"Concluído":r.status)}<div class="actions" style="margin-top:10px"><button class="secondary" onclick="verItensRecomendacao(${r.id})">Ver itens</button><button class="primary" onclick="confirmarBaixaRecomendacao(${r.id})">Confirmar baixa no estoque</button></div><div id="rec-itens-${r.id}" class="cotacao-box hidden"></div></div>`).join("")||"Nenhum PDF enviado."}</div>`;
}
async function uploadRecomendacaoPDF(){
 const file=pdfRecomendacao.files[0];
 if(!file)return alert("Escolha um PDF.");
 const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
 const r=await fetch(API+"/recomendacoes/upload-base64",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,base64})});
 const data=await r.json();
 if(data.error)return alert(data.error);
 alert(`PDF lido. Itens encontrados: ${data.itens.length}`);
 carregar();
}
async function verItensRecomendacao(id){
 const box=document.getElementById("rec-itens-"+id);
 box.classList.toggle("hidden");if(box.classList.contains("hidden"))return;
 const itens=await js(API+`/recomendacoes/${id}/itens`);
 box.innerHTML=`<div class="quote-panel"><h4>Itens identificados</h4><table class="table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Cultura/Destino</th><th>Status</th></tr></thead><tbody>${itens.map(i=>`<tr><td>${i.produto}</td><td>${i.quantidade}</td><td>${i.unidade}</td><td>${i.destino||"-"}</td><td>${i.confirmado?'<span class="badge done">Baixado</span>':'<span class="badge wait">Pendente</span>'}</td></tr>`).join("")||'<tr><td colspan="5">Nenhum item identificado.</td></tr>'}</tbody></table></div>`;
}
async function confirmarBaixaRecomendacao(id){
 if(!confirm("Confirmar baixa automática desses itens no estoque?"))return;
 const r=await js(API+`/recomendacoes/${id}/confirmar-baixa`,{method:"POST"});
 if(r.naoEncontrados&&r.naoEncontrados.length)alert("Baixa feita, mas estes produtos não existem no estoque: "+r.naoEncontrados.join(", "));
 else alert("Baixa no estoque concluída.");
 carregar();
}


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
