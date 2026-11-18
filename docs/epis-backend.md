# Backend EPI

## Montagem

O módulo `netlify/lib/epis.js` exporta `mountEpiRoutes(app, { pool })`. Deve ser montado após autenticação e `ensureDb` da API base. O host retira `/api` antes do roteamento; o módulo registra exclusivamente `/epis` e não modifica middleware global, frontend, Estoque ou Compras.

As tabelas base `usuarios`, `notificacoes`, `compras` e `lista_compras_itens` devem estar disponíveis. O módulo resolve `usuarios.nome` a cada requisição, porque o JWT atual contém somente `id`, `username` e `role`; na ausência de nome usa os dados da sessão. O ator é sempre determinado pela sessão, nunca pelo corpo enviado.

## Migração

A migração é aditiva, executada somente ao acessar `/epis` com sessão válida. Uma promise compartilhada por montagem elimina chamadas paralelas na mesma instância; `pg_advisory_xact_lock` serializa cold starts entre instâncias. Falhas desfazem toda a migração e permitem nova tentativa. São criadas apenas sete tabelas próprias:

- `ft_epi_itens`: catálogo e saldo protegido por `CHECK (saldo >= 0)`; índice único parcial de nome/tamanho/unidade para itens ativos, ignorando caixa e espaços externos.
- `ft_epi_solicitacoes`: destinatário, operador criador, estado, datas/atores das decisões e vínculo opcional `compra_id`, com FK para `compras`.
- `ft_epi_solicitacao_itens`: snapshots imutáveis de nome, tamanho, unidade, CA e validade; quantidades inteiras e uma linha por item/pedido.
- `ft_epi_eventos`: ator ID/nome, observação e data de cada transição; unicidade por solicitação/ação.
- `ft_epi_movimentacoes`: saldo anterior/posterior, delta, tipo, observação, ator, data e solicitação da entrega.
- `ft_epi_auditoria`: criação, edição, arquivo/reativação de catálogo e geração de compra, com snapshots antes/depois.
- `ft_epi_chaves`: resposta e hash de payload das operações que exigem UUID, por ator/rota/chave.

Não há alterações de definição das tabelas base, limpeza de dados legados ou atualização automática de Estoque/Compras. A FK é definida somente na tabela própria de EPI. Toda transação tem timeout local de espera por lock de 5 segundos e por statement de 15 segundos. Contenção/timeout retorna conflito 409, permitindo tentativa posterior; detalhes SQL nunca são expostos.

## Permissões e fluxo

Uma sessão `req.user` com ID válido e perfil `admin` ou `funcionario` é obrigatória em todas as rotas. Funcionários podem consultar catálogo ativo, resumo de seus pedidos, solicitar para si ou outro colaborador identificado, consultar somente pedidos criados pelo próprio operador e cancelar pedidos próprios pendentes com motivo. A conta de operador compartilhada permite solicitar para a equipe; o nome obrigatório de funcionário é o destinatário, não uma regra de autenticação.

O ADM consulta todos os pedidos, itens arquivados e histórico de movimentações; cadastra/edita catálogo, registra entradas/ajustes, aprova/rejeita e confirma a entrega física. O ADM pode cancelar pedidos pendentes/aprovados. Rejeição exige motivo e aceita pendente/aprovado. Pedidos entregues são terminais.

Solicitar e aprovar **não reduzem saldo nem reservam estoque**. Pedidos podem ser criados mesmo sem saldo. Somente `POST /epis/solicitacoes/:id/entregar`, por ADM e após aprovação, efetua baixas do pedido. A transação bloqueia a solicitação e todos os itens em ordem crescente de ID; todos devem estar ativos e ter saldo suficiente. Falta em qualquer linha desfaz integralmente a operação. Entregas concorrentes não tornam saldo negativo e não há entrega parcial. Repetir entrega já concluída ou aprovação já efetivada não cria novo evento/baixa.

Ajuste é delta inteiro não zero, assinado e com observação obrigatória. Entrada é inteiro positivo. Quantidades e mínimos aceitam somente números JSON inteiros, com limite de 1.000.000 por ação/linha; não são convertidas strings, booleanos ou decimais. Saldo acumulado é limitado ao inteiro PostgreSQL não negativo. Edição de catálogo nunca sobrescreve saldo. Itens inativos não podem ser solicitados, movimentados ou entregues; histórico e snapshots anteriores continuam disponíveis.
 A unidade de contagem não pode ser alterada após o cadastro: usar outro item para uma unidade diferente evita reinterpretar saldos e históricos sem uma conversão explícita.

CA e validade são metadados opcionais. O sistema não certifica conformidade, adequação, validade legal de CA, ficha assinada ou atendimento de norma de segurança.

## Rotas e respostas

| Rota | Acesso | Resposta principal |
|---|---|---|
| `GET /epis/resumo` | Sessão | `itens_ativos`, `estoque_baixo` (saldo ≤ mínimo), `pendentes`, `aprovadas`, `entregues`; estados respeitam criador para funcionário |
| `GET /epis/itens?incluir_inativos=1` | Sessão; inativos só ADM | Array de itens, padrão somente ativos |
| `POST /epis/itens` | ADM | Item criado; `chave` UUID obrigatória, `saldo_inicial` inteiro ≥ 0 |
| `PUT /epis/itens/:id` | ADM | Item editado; campos omitidos preservados, saldo/saldo inicial recusados |
| `POST /epis/itens/:id/movimentacoes` | ADM | `{ok,id,item_id,saldo,saldo_antes,saldo_depois}`; `chave` obrigatória |
| `GET /epis/itens/:id/historico` | ADM | `{item,movimentacoes,total,page,pages}` |
| `POST /epis/solicitacoes` | Sessão | `{ok,id,status,created_at}`; funcionário obrigatório, 1–30 linhas, `chave` obrigatória |
| `GET /epis/solicitacoes` | Sessão, escopo por criador | `{data,total,page,pages}` com snapshots, saldo atual e `compra_id` |
| `GET /epis/solicitacoes/:id` | Sessão, escopo por criador | Mesmo objeto da lista mais `eventos` e `compra_id` |
| `POST /epis/solicitacoes/:id/aprovar` | ADM | `{ok,id,status,approved_at,delivered_at}` |
| `POST /epis/solicitacoes/:id/rejeitar` | ADM | Mesma resposta; `observacao` obrigatória |
| `POST /epis/solicitacoes/:id/cancelar` | ADM ou criador pendente | Mesma resposta; `observacao` obrigatória |
| `POST /epis/solicitacoes/:id/entregar` | ADM | Mesma resposta; confirma entrega física integral |
| `POST /epis/solicitacoes/:id/gerar-compra` | ADM | `{ok,id,compra_id,ja_existente}` |

Lista/histórico usam `page=1&limit=30`, máximo de 100 registros por página. Lista aceita `status=pendente|aprovado|entregue|rejeitado|cancelado|todas` (padrão `todas`) e `busca` literal em funcionário, setor, ID e snapshots nome/tamanho/unidade/CA. `%` e `_` não são curingas da busca. Total e dados paginados são lidos no mesmo snapshot PostgreSQL, inclusive páginas vazias; itens/eventos são agregados em SQL, sem N+1 no aplicativo. Erros são `{error:'mensagem pt-BR'}` com 400/401/403/404/409; falha inesperada usa 500 com texto genérico. Recursos de outro criador respondem 404 para não revelar dados.

## Idempotência e auditoria

Cadastro de item, entrada/ajuste e solicitação exigem `chave` UUID do cliente. Mesma chave/ator/rota e mesmo payload normalizado retorna a resposta persistida original, sem repetir qualquer gravação. Payload diferente retorna 409. A chave é salva na mesma transação da operação; rollback não consome a chave. Linhas de pedido são ordenadas por item antes do hash, então mudar somente sua ordem não duplica o pedido. Decisões e entregas são idempotentes pelo estado e pela solicitação bloqueada, sem exigir chave.

Saldo inicial possui movimentação auditada, inclusive zero. Decisões preservam ator/datas/motivo no histórico. Solicitação e geração de compra notificam ADM exclusivamente por `INSERT notificacoes`, na mesma transação e sem email, WhatsApp ou chamadas externas.

## Compra manual de reposição

O frontend apresenta um preview e envia `{itens:[{item_id,quantidade}],observacao}` para `gerar-compra`. O backend não infere quantidade: o ADM escolhe explicitamente 1–30 linhas únicas pertencentes ao pedido, com quantidade inteira positiva até 1.000.000, que pode exceder a quantidade solicitada para compor reposição.

A primeira geração é permitida somente quando o pedido está pendente/aprovado. Cria uma única `compras` do tipo lista: item `Reposição de EPI — solicitação #ID`, status `Em cotação`, `status_lista='pronta'`, categoria `EPI`, destino `Estoque de EPI`, solicitante com nome real do ADM e descrição com referência do pedido, colaborador, setor, motivo e observação. `lista_compras_itens` usa os snapshots originais com nome/tamanho/CA, unidade original (inclusive `par`/`caixa`), preço zero e fornecedor vazio. Quantidades são as confirmadas pelo ADM.

Solicitação bloqueada, compra, linhas, `compra_id`, evento `compra_solicitada`, auditoria e notificação são gravados atomicamente. Repetir uma geração vinculada retorna o mesmo `compra_id` e `ja_existente:true`, inclusive após o pedido tornar-se terminal; não cria outra compra mesmo se a quantidade do novo clique mudou. Dados inválidos ou linhas estranhas ao pedido continuam recusados.

Gerar compra **não aprova, entrega, debita, reserva nem repõe EPI**. Após receber a compra no fluxo de Compras, o ADM deve registrar uma **entrada manual de EPI** em `/epis/itens/:id/movimentacoes`; somente depois confirma a entrega do pedido. Não há sincronização automática com recebimentos ou outros estoques nesta fase.

## Testes seguros

```sh
node --test tests/epis.test.js
WHATSAPP_TEST_DB=1 node --test tests/epis.test.js
npm test
```

O teste sem flag verifica montagem lazy e autenticação sem acessar banco. A integração é compatível com `npm run test:integration` pela flag existente, mas o comando direcionado acima executa somente EPI.

A configuração é fixa: socket `/var/run/postgresql`, usuário `ubuntu`, banco `ft_flow_epi_test`, sem uso de `DATABASE_URL`. Antes de limpar o schema exclusivo de teste, o código valida configuração, `current_database()`, `current_user` e endereço de conexão nulo (socket Unix). Não resetar bancos de produção, UI, WhatsApp ou qualquer outro nome. O teste cria tabelas base mínimas próprias nesse banco e monta seu Express com sessões simuladas no formato real do JWT. O `x-test-user` existe somente no arquivo de teste; o módulo de produção usa exclusivamente `req.user` da autenticação real.

Cobertura: cold starts paralelos, auth/perfis, entradas e quantidades inválidas, UUIDs e conflitos, cadastro atomicamente reversível, pedidos para equipe sem baixa, fronteiras entre criadores, snapshots, aprovação sem baixa, entrega integral e retries, concorrência sem saldo negativo, shortage e falha intermediária sem baixa parcial, ajustes, arquivo/histórico, rejeição/cancelamento, busca/paginação e compra manual única com rollback.
