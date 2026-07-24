// Funções para salvar Lista de Compra (Rascunho e Pronta)

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
