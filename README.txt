FT FLOW - SISTEMA COMPLETO

COMO RODAR

1. Entre na pasta backend
2. Crie um arquivo .env baseado no .env.example
3. Rode:
   npm install
   node server.js

4. Abra:
   frontend/index.html

Login:
admin / 123
operador / 123

Email:
- Use senha de app do Gmail
- Coloque SMTP_PASS sem espaços

Novidades:
- Email profissional em HTML
- Botão para concluir manutenção
- Email automático quando a manutenção é concluída


VERSÃO FINAL COMPLETA:
- Cotação em formato de planilha por fornecedor.
- Total por fornecedor considerando quantidade.
- Geração automática de pedidos escolhendo menor preço.
- PDF de defensivos: leitura, conferência e baixa no estoque.
- Adubação semanal: selecione vários adubos, depois distribua por destino.
- Destinos fixos: Crisântemos (Estufas), Limonium e Statice, Vinhedo, Área 5 (Folhagens).
- Base mensal de consumo: toda baixa entra no histórico.
- Relatório mensal: aba Relatórios, gera tela pronta para salvar/imprimir em PDF.


CORREÇÃO:
- Menu agora mostra Recomendações, Adubação e Relatórios.
- Backend inclui rota /recomendacoes para PDF.
- Após extrair esta versão, rode npm install novamente.
