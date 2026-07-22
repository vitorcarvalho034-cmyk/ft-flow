async function cotacoesGerais(){
  const data=await js(API+"/compras");
  const compData = data.data || data;
  const comCotacao = compData.filter(c => {
  const status = normalizarStatus(c.status).replace(/_/g, ' ');
  return status.includes("cotação") || status.includes("pendente");
});
  
  if (comCotacao.length === 0) {
    content.innerHTML = `<div class="panel"><h3>Cotações em aberto</h3><p>Nenhuma cotação em aberto.</p></div>`;
    return;
  }
  
  content.innerHTML = `<div class="panel"><h3>Cotações em aberto</h3></div>`;
  
  // Carregar todas as cotações em paralelo para melhor performance
  const cotacoesMap = await Promise.all(
    comCotacao.map(c => js(API+`/compras/${c.id}/cotacoes`).then(cots => ({id: c.id, cotacoes: cots})))
  );
  
  for (const compra of comCotacao) {
    const cotData = cotacoesMap.find(m => m.id === compra.id);
    const cotacoes = cotData?.cotacoes || [];
    
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
    content.innerHTML += cardHtml;
  }
}

