# Correção: Renderização de Cotações em Chunks

## Problema
A tela de Cotações estava mostrando apenas **2 cotações** em vez de **11+** que existiam no banco de dados.

### Sintomas
- Filtro retornava 11 cotações corretamente
- Mas apenas 2 apareciam na tela
- Nenhum erro no console

### Causa Raiz
A função `cotacoesGerais()` estava construindo uma **string HTML gigante** em uma única variável `html` e depois fazendo `content.innerHTML = html` uma única vez no final.

Isso causava **truncamento silencioso** do HTML - o navegador tem limites para o tamanho de strings que pode processar em uma única operação.

## Solução
Mudança na estratégia de renderização:

### Antes (não funcionava)
```javascript
let html = `<div class="panel">...`;
for (const compra of comCotacao) {
  html += `<div class="card">...</div>`;
}
html += `</div>`;
content.innerHTML = html;  // Uma única operação com string gigante
```

### Depois (funciona!)
```javascript
content.innerHTML = `<div class="panel"><h3>Cotações em aberto</h3></div>`;
for (const compra of comCotacao) {
  let cardHtml = `<div class="card">...</div>`;
  content.innerHTML += cardHtml;  // Renderiza cada card incrementalmente
}
```

## Resultado
✅ Todas as **11+ cotações** agora aparecem corretamente na tela:
- #51 — Notebook Lenovo Ideapad 1
- #50 — Nitrato de Calcio
- #49 — Roda reforçada 15cm
- #48 — Barra de metalon 15x15
- #47 — MKP
- #46 — Barra de cano de ferro 3/4
- #44 — Barra de ferro 5/16
- #43 — Fonte Chaveada 12v 50a
- #41 — Adaptador Para Container IBC
- #39 — cantoneiras de 1e 1/4 por 1/8
- #34 — Tinopal cbs-x

## Commit
```
ee130c3 fix: renderizar cotacoes em chunks para evitar truncamento de HTML
```

## Arquivo Modificado
- `/tmp/ft-flow/frontend/app.js` (linhas 958-1022)

## Data
22/07/2026 12:42 GMT-3
