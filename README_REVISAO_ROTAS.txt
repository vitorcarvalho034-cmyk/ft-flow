FT FLOW Mobile V2.3 Revisado

Revisão aplicada:
- API frontend confirmada em /api.
- Prefixo /api tratado na Netlify Function.
- Login robusto.
- Manutenção agora envia JSON, compatível com Netlify Functions.
- Estoque voltou a ter baixa manual.
- Compras enviam solicitante.
- Cotações agora mostram solicitações de compra.
- Cotações por fornecedor têm tela visual, não prompt.
- Funções da cotação em planilha foram adicionadas:
  criarCotacaoGeral
  abrirCotacaoGeral
  fecharCotacaoGeral
  addItemCotacao
  addFornecedorCotacao
  salvarPrecoCotacao

Rotas revisadas:
POST /api/auth/login
GET /api/dashboard
GET/POST /api/manutencoes
PUT /api/manutencoes/:id
GET/POST /api/estoque
POST /api/estoque/:id/baixa
GET/POST /api/compras
GET/POST /api/compras/:id/cotacoes
PUT /api/compras/:id/status
PUT /api/compras/:id/escolher-fornecedor
GET/POST /api/cotacoes-gerais
GET /api/cotacoes-gerais/:id/detalhes
POST /api/cotacoes-gerais/:id/itens
POST /api/cotacoes-gerais/:id/fornecedores
POST /api/cotacoes-gerais/:id/precos
PUT /api/cotacoes-gerais/:id/fechar
GET/POST /api/recomendacoes
GET/POST /api/adubacao
GET /api/relatorios/mensal/html

Publicar:
git add .
git commit -m "revisao rotas e cotacoes"
git push
