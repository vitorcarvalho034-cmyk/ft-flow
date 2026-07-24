// Patch para POST /compras - nova versão
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
      
      // Salvar cada item da lista com fornecedor e preço
      for (const item of b.itens) {
        await q(
          `INSERT INTO lista_compras_itens (compra_id, produto, quantidade, unidade, fornecedor, preco) VALUES ($1, $2, $3, $4, $5, $6)`,
          [compraId, item.produto, item.quantidade, item.unidade, item.fornecedor || '', Number(item.preco) || 0]
        );
      }
      
      // Se for lista pronta, criar cotações automaticamente
      if (b.status_lista === 'pronta') {
        const itens = await q(`SELECT id FROM lista_compras_itens WHERE compra_id=$1`, [compraId]);
        for (const item of itens.rows) {
          // Buscar o item original para pegar fornecedor e preço
          const itemData = b.itens[itens.rows.indexOf(item)];
          if (itemData && itemData.fornecedor && itemData.preco) {
            await q(
              `INSERT INTO cotacoes (compra_id, item_id, fornecedor, valor) VALUES ($1, $2, $3, $4)`,
              [compraId, item.id, itemData.fornecedor, Number(itemData.preco)]
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
    const r=await q(
      `INSERT INTO compras (item,quantidade,unidade,categoria,destino,solicitante,status,valor_unitario,valor_total,descricao,link_produto,foto_url,tipo_solicitacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [b.item,b.quantidade,b.unidade||null,b.categoria,b.destino,b.solicitante||"Não informado","Em cotação",Number(b.valor_unitario||0),Number(b.valor_total||0),b.descricao_detalhada||b.descricao||null,b.link_produto||null,b.foto_url||null,'compra']
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
