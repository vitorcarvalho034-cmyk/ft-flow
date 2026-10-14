# Núcleo WhatsApp oficial — FT FLOW

## Escopo entregue

O núcleo está em `netlify/lib/whatsapp.js` e é deliberadamente independente de HTTP. Ele exporta:

```js
const { createWhatsAppService } = require('../lib/whatsapp');
const whatsapp = createWhatsAppService({ pool, env: process.env, fetchImpl: fetch });
```

Também exporta helpers puros para teste: `normalizePhone`, `normalizeDraft`, `missingFields`, `buildSummary` e `parseCommand`.

A função Netlify Background v1 está em `netlify/functions/whatsapp-process-background.js`. Ela aceita somente:

```json
{ "phones": ["5511998765432"] }
```

Sua autorização é um `Authorization: Bearer <HMAC-SHA256>` onde o HMAC é `HMAC(WHATSAPP_APP_SECRET, "ft-flow-whatsapp-worker")`. Não é JWT de usuário e o worker não recebe o webhook nem conteúdo de mídia.

> O uso de Background Functions depende da disponibilidade do recurso/plano Netlify. Validar isso antes de ativar o webhook em produção.

## Integração HTTP e frontend

O adaptador `netlify/lib/whatsapp-http.js` é integrado por `netlify/functions/api.js`, com painel e modal de detalhes no frontend. Ele implementa:

1. Preservação do **corpo bruto** `Buffer` no parser JSON para `verifySignature(raw, req.headers['x-hub-signature-256'])`.
2. GET de verificação Meta que responde `verifyChallenge(req.query)` apenas quando válido, antes da autenticação JWT e do acesso ao banco.
3. POST assinado que chama `ingestWebhook(body)` e invoca o worker com somente os telefones e bearer interno. A admissão deve retornar 202; falha mantém as mensagens persistidas e devolve 503 para a Meta reenviar.
4. Rotas ADM para líderes/status/conversas/recuperação; detalhes de compra e imagens exigem sessão do aplicativo, com `Cache-Control: private, no-store`. Não há exclusão de líder.
5. Ação ADM explícita para `retryFailures()`. Ela é a única operação que volta dead letters `failed` a `pending` e zera seus contadores; não é chamada por cron/retry automático.

O núcleo não possui lógica de aprovação, envio de e-mail ou destinatário Dorian/Felipe. A ativação real depende das credenciais Meta/OpenAI e do número comercial, conforme `whatsapp-ativacao.md`.

## Configuração

| Variável | Obrigatória | Observação |
|---|---:|---|
| `FT_WHATSAPP_ENABLED` | Sim | Apenas o literal `true` habilita o canal; padrão efetivo é desligado. |
| `WHATSAPP_ACCESS_TOKEN` | Sim | Token Graph API, nunca retornado por status/log. |
| `WHATSAPP_PHONE_NUMBER_ID` | Sim | Comparado no ingest para ignorar outro número. |
| `WHATSAPP_APP_SECRET` | Sim | HMAC de webhook e token do worker. |
| `WHATSAPP_VERIFY_TOKEN` | Sim | Desafio de verificação Meta. |
| `FT_WHATSAPP_AI_API_KEY` | Sim | Necessária para extração de texto e transcrição. |
| `FT_WHATSAPP_AI_MODEL` | Não | Padrão `gpt-4o-mini`. |
| `FT_WHATSAPP_TRANSCRIBE_MODEL` | Não | Padrão `gpt-4o-mini-transcribe`. |
| `WHATSAPP_GRAPH_VERSION` | Não | Padrão `v26.0`. |
| `APP_URL` | Não | Padrão `https://ft-flow.netlify.app`; mantida para configuração/telemetria futura. |

`getStatus()` retorna apenas `enabled`, `ready` e nomes de variáveis faltantes — sem segredos. `verifyChallenge()` exige que **o token configurado e o token da query sejam strings não vazias** antes de executar a comparação constant-time; duas ausências nunca validam o desafio.

## Persistência e idempotência

`ensureDb()` só cria as tabelas `ft_whatsapp_*` e os `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` aditivos em `compras`. Antes disso, confirma que `compras`, `lista_compras_itens`, `notificacoes` e `audit_log` já existem; não cria, remove ou modifica destrutivamente tabelas base.

- Inbox tem chave primária no ID da mensagem e `ON CONFLICT DO NOTHING`; um webhook duplicado também devolve telefones com outbox pendente **ou failed** para que a fila bloqueada seja visível ao worker/ADM. Perfis `contacts` da Meta não são persistidos: o nome válido é exclusivamente o do líder cadastrado.
- O telefone é processado em ordem determinística de `timestamp, received_at, id`, no máximo 30 eventos por execução, sob advisory lock PostgreSQL. Lock ocupado lança erro para a execução background ser repetida. A Background Function limita cada chamada a 10 telefones e lança somente quando ainda há trabalho `pending` real.
- Alteração de rascunho e resposta de outbox são gravadas na mesma transação do evento. Antes de consumir o próximo inbox, o worker tenta entregar o outbox já gravado. Ele para no primeiro erro; um outbox posterior (inclusive botão de confirmar) jamais passa uma mensagem anterior.
- Cada falha automática incrementa tentativas. Até três tentativas a linha permanece `pending`; na terceira vira `failed` (dead letter), bloqueia todo o telefone e não é reenviada automaticamente. `retryFailures()` é limitado a 100 telefones, inclui pendências/dead letters e reseta apenas as linhas failed em recuperação manual.
- Botões incorporam `request_id:revision`. A confirmação exige a revisão atual e um registro outbox `sent` com `provider_message_id`; uma falha de envio não conta como resumo exibido. Títulos interativos e payloads `button` externos são ignorados, nunca transformados em comando. Texto `sim`/`confirmar pedido` com `context.id` de resumo antigo, ou timestamp anterior ao resumo entregue da revisão atual, é rejeitado.
- `compras.whatsapp_request_id` é único. A criação de compra, itens, notificação para `destino_role='admin'` e auditoria ocorrem dentro da mesma transação.
- Se o `lider_id` de um telefone mudou (número reciclado), o rascunho/estado/compra confirmada da conversa são reinicializados antes de processar o novo evento.

## Segurança de mídia e IA

- Somente líderes ativos previamente cadastrados podem entrar na inbox. O allowlist é rechecado a cada evento **antes** de baixar mídia.
- Downloads seguem apenas URLs HTTPS retornadas pela Meta em `*.fbcdn.net`, `*.fbsbx.com` ou `lookaside.fbsbx.com`, com redirect manual e timeouts. O Graph e OpenAI usam endpoints fixos.
- Imagens: somente JPEG/PNG com magic bytes, máximo **4 MiB** (margem para a expansão base64/Lambda), persistidas como `bytea`; URL temporária não é salva. Há no máximo **10** fotos por rascunho; a 11ª não é baixada. Imagens maiores recebem orientação para reduzir/enviar texto.
- Áudios: OGG/AAC/MP3/M4A com magic bytes, máximo 16 MB, enviados à transcrição oficial OpenAI com idioma `pt`; áudio não é persistido. Falha mantém (ou cria) o rascunho e pede texto/novo áudio curto. Transcrições preservam quebras de linha seguras.
- Extração usa `/v1/chat/completions` com `json_schema` estrito. Dados de usuário entram como JSON em mensagem `user`, sem ferramentas. A IA não consegue confirmar nem criar compras.
- `getMedia(id)` aceita UUID estrito e faz `JOIN compras ON whatsapp_request_id`, com `compras.origem='whatsapp'`; foto de rascunho não confirmado não é exposta pela rota de mídia.

## Fluxo funcional

O bot coleta produto, quantidade positiva, unidade e destino. Uma compra comum aceita `m`, `cm`, `kg`, `g`, `L`, `mL` e `un`. Caixa, saco, pacote, rolo, kit, lata, frasco, galão e balde são aceitos **inclusive para um item**, que é representado como `tipo_solicitacao='lista'` de um único item (sem conversão implícita de embalagem para `un`). A interface ADM deve oferecer essas unidades no editor de listas de um item. Não inventa quantidade/unidade/destino.

O cadastro fornece categoria/destino padrão quando houver; a categoria também pode ser inferida e sempre aparece explicitamente no resumo. Múltiplos produtos (ou uma unidade de embalagem) criam uma compra do tipo `lista`, em **Em cotação**, com `status_lista='rascunho'`, mesmo sem fornecedor ou preço. Para lista, `compras.item` é `Lista WhatsApp — <nome do líder>`, `quantidade=0`, `unidade=''`, e só seus itens vão para `lista_compras_itens`; pedido comum não ganha linha duplicada nessa tabela. A descrição preserva itens e observações. A ADM inclui fornecedores e prepara depois.

O solicitante gravado é sempre o `nome` do líder cadastrado (nunca um nome narrado em áudio). Fotos são opcionais. Uma foto/mensagem posterior a pedido confirmado inicia um novo rascunho e não altera a compra já criada.

Comandos curtos reconhecidos em **texto**: `confirmo`, `confirmar pedido`, `cancelar`, `corrigir`, `novo pedido`, `ajuda`. `sim` só confirma quando há resumo entregue para a revisão pendente. O primeiro retorno da sessão informa claramente que os dados podem ser analisados por IA e saúda o líder cadastrado pelo nome. Resumos são quebrados por linha em mensagens `summary_text` de até 4.000 caracteres, preservando todos os itens; o botão interativo só é enviado depois de todos os blocos.

## Verificação local

```bash
node --check netlify/lib/whatsapp.js
node --check netlify/functions/whatsapp-process-background.js
node --test tests/whatsapp-core.test.js
WHATSAPP_TEST_DB=1 node --test tests/whatsapp-core.test.js tests/whatsapp-integration.test.js
```

O teste de integração é ignorado por padrão para CI sem banco. Com `WHATSAPP_TEST_DB=1`, conecta por socket Unix como `ubuntu` ao banco isolado `ft_flow_whatsapp_core_test`. Não aceita `DATABASE_URL` nem URL externa de substituição. Antes de recriar o schema `public`, valida o nome exato do banco e exige `inet_server_addr() IS NULL`, correspondente ao socket local. Nunca limpa o banco compartilhado `ft_flow_whatsapp_test` nem o banco HTTP do adaptador. As chamadas Meta/OpenAI dos testes são simuladas.
