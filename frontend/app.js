const API = "/api";
let usuario = null;
let tela = "dashboard";
let adubacaoItens = [];

function hoje(){ return new Date().toISOString().slice(0,10); }
function dinheiro(v){ return `R$ ${Number(v||0).toFixed(2)}`; }
function esc(s){ return String(s ?? "").replace(/'/g,"\\'").replace(/`/g,"\\`"); }

async function apiJson(url, options={}){
  const r = await fetch(url, options);
  const txt = await r.text();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if(!r.ok){ throw new Error(data.error || data.message || txt || "Erro na API"); }
  return data;
}
async function js(u,o){ return apiJson(u,o); }

async function fazerLogin(){
  try{
    const r = await fetch(API+"/auth/login",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:loginUser.value,password:loginPass.value})
    });
    if(!r.ok) return alert("Usuário ou senha inválidos");
    usuario = await r.json();
    loginScreen.classList.add("hidden");
    app.classList.remove("hidden");
    userName.innerText = usuario.nome || usuario.username;
    userRole.innerText = usuario.role === "admin" ? "Administrador" : "Funcionário";
    if(usuario.role !== "admin") document.querySelectorAll(".admin-only").forEach(e=>e.style.display="none");
    trocarTela("dashboard", document.querySelector(".nav"));
    atualizarContadorNotificacoes();
    setInterval(atualizarContadorNotificacoes,15000);
  }catch(e){ alert("Erro ao conectar com servidor: "+e.message); }
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
  const d=await js(API+"/dashboard");
  const man=await js(API+"/manutencoes");
  const est=await js(API+"/estoque");
  content.innerHTML=`<div class="cards"><div class="kpi"><small>Manutenções abertas</small><strong>${d.manutencoesAbertas}</strong></div><div class="kpi"><small>Urgentes</small><strong>${d.urgentes}</strong></div><div class="kpi"><small>Aguardando peça</small><strong>${d.aguardandoPeca}</strong></div><div class="kpi"><small>Compras pendentes</small><strong>${d.comprasPendentes}</strong></div><div class="kpi"><small>Estoque baixo</small><strong>${d.estoqueBaixo}</strong></div></div><div class="panel"><h3>Últimas manutenções</h3>${tabelaMan(man.slice(0,5))}</div><div class="panel"><h3>Itens com estoque baixo</h3>${est.filter(i=>i.baixo).map(i=>`<div class="card stock-low"><b>${i.nome}</b><br>${i.quantidade} ${i.unidade} | mínimo ${i.minimo}</div>`).join("")||"Nenhum item crítico."}</div>`;
}

async function manutencoes(){
  const data=await js(API+"/manutencoes");
  content.innerHTML=`<div class="panel"><div class="actions"><button class="primary" onclick="abrirModalManutencao()">+ Nova Solicitação</button><button class="secondary" onclick="carregar()">Atualizar</button></div></div><div class="panel">${tabelaMan(data)}</div>`;
}
function abrirModalManutencao(){ modal.classList.remove("hidden"); document.querySelector("[name=data_ocorrencia]").value=hoje(); }
function fecharModal(){ modal.classList.add("hidden"); }
function toggleCompra(){ camposCompra.classList.toggle("hidden",!precisaCompra.checked); }
async function salvarManutencao(e){
  e.preventDefault();
  const fd=new FormData(formManutencao);
  const dados=Object.fromEntries(fd.entries());
  dados.precisa_compra=precisaCompra.checked?"1":"0";
  delete dados.foto;
  await js(API+"/manutencoes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(dados)});
  formManutencao.reset(); fecharModal(); carregar(); atualizarContadorNotificacoes();
}
function abrirConcluir(id){ concluirId.value=id; concluirResponsavel.value=""; concluirSolucao.value=""; concluirModal.classList.remove("hidden"); }
function fecharConcluir(){ concluirModal.classList.add("hidden"); }
async function salvarConclusao(){
  if(!concluirSolucao.value.trim())return alert("Informe a solução aplicada.");
  await js(API+`/manutencoes/${concluirId.value}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"Concluído",responsavel:concluirResponsavel.value,solucao:concluirSolucao.value})});
  fecharConcluir(); carregar(); atualizarContadorNotificacoes(); alert("Manutenção concluída.");
}

async function estoque(){
  const data=await js(API+"/estoque");
  const cats=[...new Set(data.map(i=>i.categoria||"Sem categoria"))];
  content.innerHTML=`<div class="panel"><h3>Novo item de estoque</h3><div class="grid"><input id="estNome" placeholder="Nome"><input id="estCategoria" placeholder="Categoria"><input id="estUnidade" placeholder="Unidade"><input id="estQtd" type="number" placeholder="Quantidade"><input id="estMin" type="number" placeholder="Mínimo"></div><button class="primary full" onclick="addEstoque()">Salvar item</button></div><div class="panel"><h3>Categorias</h3><div class="category-grid"><button class="cat-btn" onclick="filtrarEstoque('Todos')">Todos <b>${data.length}</b></button>${cats.map(c=>`<button class="cat-btn" onclick="filtrarEstoque('${esc(c)}')">${c} <b>${data.filter(i=>(i.categoria||"Sem categoria")===c).length}</b></button>`).join("")}</div></div><div class="panel"><h3 id="tituloEstoque">Itens</h3><div id="listaEstoque"></div></div>`;
  window._estoqueData=data; renderEstoque(data);
}
function renderEstoque(lista){
  const baixo=lista.filter(i=>i.baixo).length;
  tituloEstoque.innerText=`Itens ${baixo>0?`• ${baixo} em estoque mínimo`:""}`;
  listaEstoque.innerHTML=lista.map(i=>`<div class="card ${i.baixo?'stock-low':'stock-ok'}"><div class="stock-row"><div><b>${i.nome}</b><br>${i.categoria} • Estoque: <b>${i.quantidade} ${i.unidade}</b> • mínimo ${i.minimo}<br>${i.baixo?'<span class="badge high">ALERTA</span>':'<span class="badge done">OK</span>'}</div><div class="actions"><button class="secondary" onclick="abrirBaixaEstoque(${i.id}, '${esc(i.nome)}', ${Number(i.quantidade||0)}, '${esc(i.unidade)}')">Dar baixa</button></div></div></div>`).join("")||"Nenhum item.";
}
function filtrarEstoque(c){const data=window._estoqueData||[];renderEstoque(c==="Todos"?data:data.filter(i=>(i.categoria||"Sem categoria")===c));}
async function addEstoque(){ await js(API+"/estoque",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome:estNome.value,categoria:estCategoria.value,unidade:estUnidade.value,quantidade:estQtd.value,minimo:estMin.value})}); carregar(); }
function abrirBaixaEstoque(id,nome,disponivel,unidade){
  const qtd=prompt(`Baixa de estoque: ${nome}\nDisponível: ${disponivel} ${unidade}\n\nQuantidade a descontar:`); if(qtd===null)return;
  const quantidade=Number(String(qtd).replace(",",".")); if(!quantidade||quantidade<=0)return alert("Quantidade inválida."); if(quantidade>disponivel)return alert("Quantidade maior que estoque disponível.");
  const destino=prompt("Destino / uso da baixa:",""); if(destino===null)return; const observacao=prompt("Observação (opcional):","")||"";
  fetch(API+`/estoque/${id}/baixa`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quantidade,destino,observacao,usuario:(usuario?.nome||usuario?.username||"Usuário")})}).then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)return alert(data.error||"Erro ao dar baixa.");alert("Baixa realizada com sucesso.");carregar();atualizarContadorNotificacoes();});
}

async function compras(){
  const data=await js(API+"/compras");
  const isAdmin=usuario&&usuario.role==="admin";
  content.innerHTML=`<div class="panel"><h3>${isAdmin?"Compras e solicitações":"Nova solicitação de compra"}</h3><p style="color:#647066">${isAdmin?"Acompanhe pedidos avulsos e de manutenção.":"Use quando precisar solicitar compra sem abrir manutenção."}</p><div class="grid"><input id="compSolicitante" placeholder="Nome do solicitante"><input id="compItem" placeholder="Item"><input id="compQtd" type="number" placeholder="Quantidade"><input id="compCat" placeholder="Categoria"><input id="compDest" placeholder="Destino / uso"></div><button class="primary full" onclick="addCompra()">Enviar solicitação</button></div><div class="panel"><h3>${isAdmin?"Pedidos de compra":"Solicitações enviadas"}</h3>${data.map(c=>`<div class="card"><b>#${c.id} - ${c.item}</b><br>Solicitante: ${c.solicitante||"-"}<br>Quantidade: ${c.quantidade} | Categoria: ${c.categoria||"-"}<br>Destino: <b>${c.destino||"Não informado"}</b><br>Status: ${st(c.status)}${c.fornecedor_escolhido?`<br><span class="chosen">Fornecedor escolhido: <b>${c.fornecedor_escolhido}</b> • ${dinheiro(c.valor_escolhido)}</span>`:""}${isAdmin?`<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirCotacao(${c.id})">Cotação</button><button class="primary" onclick="statusCompra(${c.id},'Aprovado')">Aprovar</button><button class="primary" onclick="statusCompra(${c.id},'Recebido')">Recebido</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div>`:""}</div>`).join("")||"Nenhuma solicitação."}</div>`;
}
async function addCompra(){
  if(!compSolicitante.value.trim())return alert("Informe o nome do solicitante."); if(!compItem.value.trim())return alert("Informe o item."); if(!compQtd.value)return alert("Informe a quantidade.");
  await js(API+"/compras",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({solicitante:compSolicitante.value,item:compItem.value,quantidade:compQtd.value,categoria:compCat.value,destino:compDest.value})});
  carregar(); atualizarContadorNotificacoes();
}
async function statusCompra(id,status){ await js(API+`/compras/${id}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}); carregar(); }

async function abrirCotacao(id){
  const box=document.getElementById("cotacoes-"+id); if(!box)return alert("Área de cotação não encontrada."); box.classList.toggle("hidden"); if(box.classList.contains("hidden"))return;
  const cotacoes=await js(API+`/compras/${id}/cotacoes`); const menor=cotacoes.length?Math.min(...cotacoes.map(c=>Number(c.valor||0))):null;
  box.innerHTML=`<div class="quote-panel"><h4>Cotações do pedido #${id}</h4><div class="grid"><input id="fornecedor-${id}" placeholder="Fornecedor"><input id="valor-${id}" type="number" step="0.01" placeholder="Valor"><input id="obs-${id}" placeholder="Observação"></div><button class="primary full" onclick="addCotacao(${id})">Adicionar cotação</button><div class="quote-table-wrap"><table class="table"><thead><tr><th>Fornecedor</th><th>Valor</th><th>Obs</th><th>Comparação</th><th>Ação</th></tr></thead><tbody>${cotacoes.map(c=>`<tr class="${Number(c.valor)==menor?'best-quote':''}"><td>${c.fornecedor}</td><td>${dinheiro(c.valor)}</td><td>${c.observacao||"-"}</td><td>${Number(c.valor)==menor?'<span class="badge done">Menor preço</span>':'-'}</td><td><button class="secondary" onclick="escolherFornecedor(${id}, '${esc(c.fornecedor)}', ${Number(c.valor||0)})">Escolher</button></td></tr>`).join("")||`<tr><td colspan="5">Nenhuma cotação cadastrada.</td></tr>`}</tbody></table></div></div>`;
}
async function addCotacao(id){ const fornecedor=document.getElementById("fornecedor-"+id).value; const valor=document.getElementById("valor-"+id).value; const observacao=document.getElementById("obs-"+id).value; if(!fornecedor||!valor)return alert("Informe fornecedor e valor."); await js(API+`/compras/${id}/cotacoes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fornecedor,valor,observacao})}); const box=document.getElementById("cotacoes-"+id); box.classList.add("hidden"); abrirCotacao(id); }
async function escolherFornecedor(id,fornecedor,valor){ if(!confirm(`Escolher ${fornecedor} por ${dinheiro(valor)}?`))return; await js(API+`/compras/${id}/escolher-fornecedor`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({fornecedor,valor})}); alert("Fornecedor escolhido e compra aprovada."); carregar(); }

async function cotacoesGerais(){
  const compras=await js(API+"/compras"); const cotacoes=await js(API+"/cotacoes-gerais");
  content.innerHTML=`<div class="panel"><h3>Cotações de compras solicitadas</h3><p style="color:#647066">Pedidos criados em Compras aparecem aqui para cotar.</p>${compras.map(c=>`<div class="card"><b>#${c.id} - ${c.item}</b><br>Solicitante: ${c.solicitante||"-"}<br>Quantidade: ${c.quantidade||"-"} | Categoria: ${c.categoria||"-"}<br>Destino: <b>${c.destino||"Não informado"}</b><br>Status: ${st(c.status)}${c.fornecedor_escolhido?`<br><span class="chosen">Fornecedor escolhido: <b>${c.fornecedor_escolhido}</b> • ${dinheiro(c.valor_escolhido)}</span>`:""}<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirCotacao(${c.id})">Cotar fornecedores</button><button class="primary" onclick="statusCompra(${c.id},'Aprovado')">Aprovar</button><button class="primary" onclick="statusCompra(${c.id},'Recebido')">Recebido</button></div><div id="cotacoes-${c.id}" class="cotacao-box hidden"></div></div>`).join("")||"Nenhuma compra solicitada."}</div><div class="panel"><h3>Nova cotação em planilha</h3><div class="grid"><input id="cotTitulo" placeholder="Título da cotação"><input id="cotCategoria" placeholder="Categoria"></div><button class="primary full" onclick="criarCotacaoGeral()">Criar cotação em planilha</button></div><div class="panel"><h3>Cotações em planilha criadas</h3>${cotacoes.map(c=>`<div class="card"><b>#${c.id} - ${c.titulo}</b><br>Categoria: ${c.categoria||"-"}<br>Status: ${st(c.status==="Fechada"?"Concluído":c.status)}<div class="actions" style="margin-top:10px"><button class="secondary" onclick="abrirCotacaoGeral(${c.id})">Abrir planilha</button><button class="primary" onclick="fecharCotacaoGeral(${c.id})">Fechar cotação</button></div><div id="cotacao-geral-${c.id}" class="cotacao-box hidden"></div></div>`).join("")||"Nenhuma cotação em planilha criada."}</div>`;
}
async function criarCotacaoGeral(){ if(!cotTitulo.value.trim())return alert("Informe o título da cotação."); await js(API+"/cotacoes-gerais",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({titulo:cotTitulo.value,categoria:cotCategoria.value})}); carregar(); }
async function abrirCotacaoGeral(id){
  const box=document.getElementById("cotacao-geral-"+id); box.classList.toggle("hidden"); if(box.classList.contains("hidden"))return;
  const d=await js(API+`/cotacoes-gerais/${id}/detalhes`); const forns=d.fornecedores||[], itens=d.itens||[], precos=d.precos||[]; const preco=(itemId,fornId)=>{const p=precos.find(x=>Number(x.item_id)===Number(itemId)&&Number(x.fornecedor_id)===Number(fornId));return p?Number(p.valor||0):0};
  box.innerHTML=`<div class="quote-panel"><h4>${d.cotacao?.titulo||"Cotação"}</h4><div class="grid"><input id="novoItemDesc-${id}" placeholder="Descrição do item"><input id="novoItemQtd-${id}" type="number" placeholder="Quantidade"><input id="novoItemUn-${id}" placeholder="Unidade"></div><button class="secondary full" onclick="addItemCotacao(${id})">+ Adicionar item</button><div class="grid" style="margin-top:12px"><input id="novoFornecedor-${id}" placeholder="Nome do fornecedor"></div><button class="secondary full" onclick="addFornecedorCotacao(${id})">+ Adicionar fornecedor</button><div class="quote-table-wrap"><table class="table quote-matrix"><thead><tr><th class="item-col">Item / descrição</th>${forns.map(f=>`<th>${f.nome}</th>`).join("")}<th>Melhor</th></tr></thead><tbody>${itens.map(item=>{const valores=forns.map(f=>preco(item.id,f.id)).filter(v=>v>0);const menor=valores.length?Math.min(...valores):null;return `<tr><td class="item-col"><b>${item.descricao}</b><br><small>Qtd: ${item.quantidade||"-"} ${item.unidade||""}</small></td>${forns.map(f=>{const v=preco(item.id,f.id);return `<td class="${menor&&v===menor?'best-quote':''}"><input class="price-input" type="number" step="0.01" value="${v||''}" placeholder="R$" onchange="salvarPrecoCotacao(${id},${item.id},${f.id},this.value)"></td>`}).join("")}<td>${menor?`<span class="badge done">${dinheiro(menor)}</span>`:"-"}</td></tr>`}).join("")||`<tr><td colspan="${forns.length+2}">Adicione itens e fornecedores.</td></tr>`}</tbody></table></div></div>`;
}
async function addItemCotacao(id){const descricao=document.getElementById("novoItemDesc-"+id).value,quantidade=document.getElementById("novoItemQtd-"+id).value,unidade=document.getElementById("novoItemUn-"+id).value;if(!descricao.trim())return alert("Informe o item.");await js(API+`/cotacoes-gerais/${id}/itens`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({descricao,quantidade,unidade})});document.getElementById("cotacao-geral-"+id).classList.add("hidden");abrirCotacaoGeral(id);}
async function addFornecedorCotacao(id){const nome=document.getElementById("novoFornecedor-"+id).value;if(!nome.trim())return alert("Informe o fornecedor.");await js(API+`/cotacoes-gerais/${id}/fornecedores`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome})});document.getElementById("cotacao-geral-"+id).classList.add("hidden");abrirCotacaoGeral(id);}
async function salvarPrecoCotacao(cotacaoId,itemId,fornecedorId,valor){await js(API+`/cotacoes-gerais/${cotacaoId}/precos`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item_id:itemId,fornecedor_id:fornecedorId,valor})});document.getElementById("cotacao-geral-"+cotacaoId).classList.add("hidden");abrirCotacaoGeral(cotacaoId);}
async function fecharCotacaoGeral(id){if(!confirm("Fechar esta cotação?"))return;await js(API+`/cotacoes-gerais/${id}/fechar`,{method:"PUT"});carregar();}

async function fornecedores(){ const data=await js(API+"/fornecedores"); content.innerHTML=`<div class="panel"><h3>Novo fornecedor</h3><div class="grid"><input id="forNome" placeholder="Empresa"><input id="forContato" placeholder="Contato"><input id="forTel" placeholder="Telefone"><input id="forTipo" placeholder="Tipo"></div><button class="primary full" onclick="addFornecedor()">Salvar</button></div><div class="panel"><h3>Fornecedores</h3>${data.map(f=>`<div class="card"><b>${f.nome}</b><br>${f.contato||""} • ${f.telefone||""}<br>${f.tipo_produto||""}</div>`).join("")}</div>`; }
async function addFornecedor(){ await js(API+"/fornecedores",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nome:forNome.value,contato:forContato.value,telefone:forTel.value,tipo_produto:forTipo.value})}); carregar(); }

async function recomendacoesPDF(){ const data=await js(API+"/recomendacoes"); content.innerHTML=`<div class="panel"><h3>Leitura de PDF - Defensivos</h3><p style="color:#647066">Envie o PDF de recomendação.</p><input id="pdfRecomendacao" type="file" accept="application/pdf"><button class="primary full" onclick="uploadRecomendacaoPDF()">Ler PDF</button></div><div class="panel"><h3>Histórico de PDFs</h3>${data.map(r=>`<div class="card"><b>#${r.id} - ${r.arquivo}</b><br>Semana: ${r.semana||"-"}<br>Status: ${st(r.status==="Confirmada"?"Concluído":r.status)}<div class="actions" style="margin-top:10px"><button class="secondary" onclick="verItensRecomendacao(${r.id})">Ver itens</button><button class="primary" onclick="confirmarBaixaRecomendacao(${r.id})">Confirmar baixa no estoque</button></div><div id="rec-itens-${r.id}" class="cotacao-box hidden"></div></div>`).join("")||"Nenhum PDF enviado."}</div>`; }
async function uploadRecomendacaoPDF(){ const file=pdfRecomendacao.files[0]; if(!file)return alert("Escolha um PDF."); const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);}); const data=await js(API+"/recomendacoes/upload-base64",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,base64})}); alert(`PDF lido. Itens encontrados: ${data.itens.length}`); carregar(); }
async function verItensRecomendacao(id){ const box=document.getElementById("rec-itens-"+id); box.classList.toggle("hidden"); if(box.classList.contains("hidden"))return; const itens=await js(API+`/recomendacoes/${id}/itens`); box.innerHTML=`<div class="quote-panel"><h4>Itens identificados</h4><table class="table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Cultura/Destino</th><th>Status</th></tr></thead><tbody>${itens.map(i=>`<tr><td>${i.produto}</td><td>${i.quantidade}</td><td>${i.unidade}</td><td>${i.destino||"-"}</td><td>${i.confirmado?'<span class="badge done">Baixado</span>':'<span class="badge wait">Pendente</span>'}</td></tr>`).join("")||'<tr><td colspan="5">Nenhum item identificado.</td></tr>'}</tbody></table></div>`; }
async function confirmarBaixaRecomendacao(id){ if(!confirm("Confirmar baixa automática desses itens no estoque?"))return; const r=await js(API+`/recomendacoes/${id}/confirmar-baixa`,{method:"POST"}); if(r.naoEncontrados&&r.naoEncontrados.length)alert("Baixa feita, mas estes produtos não existem no estoque: "+r.naoEncontrados.join(", ")); else alert("Baixa no estoque concluída."); carregar(); }

async function adubacaoSemanal(){ const adubos=await js(API+"/adubacao/adubos"); const destinos=await js(API+"/adubacao/destinos"); content.innerHTML=`<div class="panel"><h3>Adubação semanal</h3><p style="color:#647066">1) Selecione os adubos. 2) Distribua por destino. 3) Confirme.</p><div class="grid"><select id="aduboProduto">${adubos.map(a=>`<option value="${a.nome}" data-unidade="${a.unidade||'kg'}" data-estoque="${a.quantidade||0}">${a.nome} — estoque: ${a.quantidade} ${a.unidade||''}</option>`).join("")}</select><input id="aduboQtd" type="number" step="0.01" placeholder="Quantidade total"></div><button class="secondary full" onclick="addAduboItem()">Adicionar adubo</button></div><div class="panel"><h3>Produtos selecionados</h3><div id="aduboLista"></div></div><div class="panel"><h3>Distribuição por destino</h3><div id="aduboDistribuicao"></div><button class="primary full" onclick="confirmarAdubacao()">Confirmar baixa no estoque</button></div>`; window._destinosAdubacao=destinos; renderAdubacao(); }
function addAduboItem(){ const opt=aduboProduto.options[aduboProduto.selectedIndex]; const produto=aduboProduto.value; const quantidade=Number(aduboQtd.value||0); const unidade=opt.dataset.unidade||"kg"; const estoque=Number(opt.dataset.estoque||0); if(!produto||quantidade<=0)return alert("Selecione um adubo e informe a quantidade."); if(quantidade>estoque)return alert("Quantidade maior que estoque disponível."); adubacaoItens.push({produto,quantidade,unidade,estoque}); aduboQtd.value=""; renderAdubacao(); }
function renderAdubacao(){ const destinos=window._destinosAdubacao||[]; if(!document.getElementById("aduboLista"))return; aduboLista.innerHTML=adubacaoItens.map((i,idx)=>`<div class="card"><b>${i.produto}</b><br>Total: ${i.quantidade} ${i.unidade}<br>Estoque atual: ${i.estoque} ${i.unidade}<button class="secondary" onclick="adubacaoItens.splice(${idx},1);renderAdubacao()">Remover</button></div>`).join("")||"Nenhum adubo selecionado."; aduboDistribuicao.innerHTML=adubacaoItens.map(item=>`<div class="card"><b>${item.produto}</b> — distribuir ${item.quantidade} ${item.unidade}<div class="grid">${destinos.map(dest=>`<label>${dest}<input class="dist-input" data-produto="${item.produto}" data-unidade="${item.unidade}" data-destino="${dest}" type="number" step="0.01" placeholder="0"></label>`).join("")}</div></div>`).join("")||"Adicione adubos para distribuir."; }
async function confirmarAdubacao(){ if(!adubacaoItens.length)return alert("Adicione ao menos um adubo."); const distribuicao=[...document.querySelectorAll(".dist-input")].map(inp=>({produto:inp.dataset.produto,destino:inp.dataset.destino,unidade:inp.dataset.unidade,quantidade:Number(inp.value||0)})).filter(d=>d.quantidade>0); for(const item of adubacaoItens){const soma=distribuicao.filter(d=>d.produto===item.produto).reduce((a,d)=>a+d.quantidade,0); if(Math.abs(soma-item.quantidade)>0.001)return alert(`Distribuição não confere para ${item.produto}. Total: ${item.quantidade}, distribuído: ${soma}`);} await js(API+"/adubacao/aplicar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({titulo:"Adubação semanal",itens:adubacaoItens,distribuicao})}); alert("Adubação registrada e estoque atualizado."); adubacaoItens=[]; carregar(); }

async function relatoriosMensais(){ const m=new Date().toISOString().slice(0,7); content.innerHTML=`<div class="panel"><h3>Relatório mensal</h3><p style="color:#647066">Gere relatório com consumo e estoque atual.</p><div class="grid"><input id="relMes" type="month" value="${m}"></div><button class="primary full" onclick="abrirRelatorioMensal()">Gerar relatório mensal</button></div>`; }
function abrirRelatorioMensal(){ const mes=relMes.value||new Date().toISOString().slice(0,7); window.open(API+`/relatorios/mensal/html?month=${mes}`,"_blank"); }

async function atualizarContadorNotificacoes(){ if(!usuario||usuario.role!=="admin")return; try{const r=await js(API+"/notificacoes/unread-count"); if(r.total>0){notifCount.innerText=r.total;notifCount.classList.remove("hidden")}else notifCount.classList.add("hidden")}catch(e){} }
async function abrirNotificacoes(){ if(!usuario||usuario.role!=="admin")return; notifPanel.classList.remove("hidden"); const data=await js(API+"/notificacoes"); notifList.innerHTML=data.map(n=>`<div class="notif-item ${n.lida?"":"unread"}" onclick="marcarNotificacao(${n.id})"><div class="notif-type">${n.tipo}</div><b>${n.titulo}</b><p>${n.mensagem}</p><div class="notif-date">${n.created_at}</div></div>`).join("")||"<p>Nenhuma notificação.</p>"; }
function fecharNotificacoes(){ notifPanel.classList.add("hidden"); }
async function marcarNotificacao(id){ await js(API+`/notificacoes/${id}/lida`,{method:"PUT"}); await abrirNotificacoes(); await atualizarContadorNotificacoes(); }
async function marcarTodasNotificacoes(){ await js(API+"/notificacoes/marcar-todas/lidas",{method:"PUT"}); await abrirNotificacoes(); await atualizarContadorNotificacoes(); }

if("serviceWorker" in navigator){ window.addEventListener("load",()=>{ navigator.serviceWorker.register("/sw.js").catch(()=>{}); }); }
