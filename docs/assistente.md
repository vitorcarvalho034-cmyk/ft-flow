# Assistente de pedidos — backend FT FLOW

O módulo organiza texto/áudio em um rascunho revisável e só cria uma compra após confirmação explícita. Não altera contas Meta/YCloud, não envia WhatsApp/e-mail diretamente, não apaga compras/histórico e não importa configuração nem código do canal WhatsApp. A primeira versão cria listas de compras, não pedidos EPI; a área EPI existente fica preservada.

## Montagem e autenticação

```js
const { mountAssistenteRoutes } = require('../lib/assistente');

// Depois da remoção do prefixo /api e, obrigatoriamente, depois do JWT:
app.use(autenticar);
mountAssistenteRoutes(app, { pool, ensureBaseDb: ensureDb });
```

O prefixo do módulo é `/assistente`; no app o endereço externo é `/api/assistente/...`. O middleware de autenticação fornece `req.user.username`, `req.user.role` e normalmente `req.user.id`, assinados via JWT. O módulo não interpreta tokens por conta própria; reafirma a autenticação em todas as rotas, inclusive status e mídias. Permite os perfis existentes `funcionario` e `admin`. Na confirmação consulta `usuarios` pelo username autenticado e verifica o ID do JWT quando presente. Autenticação, autorização, propriedade, cotas e auditoria continuam exclusivamente vinculadas a essa conta autenticada, nunca a uma pessoa citada no texto/áudio ou enviada no body.

`rascunho.nome_pessoa` identifica a pessoa que pede e precisa ser informado/revisado pelo usuário; não é obtido automaticamente do cadastro. O nome indicado será `compras.solicitante` e `ft_assistente_pedidos.solicitante`, para que o ADM veja quem pede. Separadamente, `ft_assistente_pedidos.registrado_por` guarda o `nome` registrado da conta que confirmou, com fallback para seu username quando vazio. `solicitante_username`, `solicitante_id` e `audit_log.actor_id` continuam sendo da conta autenticada. Nome da pessoa não concede acesso, define role, muda a conta ou comprova identidade. Campos extras como `solicitante`, `registrado_por`, `role`, preço e status enviados pelo cliente não substituem os dados autenticados.

`mountAssistenteRoutes` retorna o serviço e aceita as opções adicionais `env`, `fetchImpl`, `timeoutMs` e `onCreated` para testes/integração. `createAssistenteService` também é exportado. O host deve fornecer um pool PostgreSQL válido e `ensureBaseDb` deve estabelecer os contratos atuais de `usuarios`, `compras`, `lista_compras_itens`, `notificacoes` e `audit_log`. O status não invoca esse callback, não consulta banco, não executa DDL e não testa a IA.

`onCreated` é opcional e recebe somente `{id,solicitante,nome_lista,categoria,destino,itens}`, com `itens` numérico. É invocado uma vez no processo que cria a compra, após COMMIT, sem aguardar a execução. Replays não o invocam. Erros do callback são absorvidos, não desfazem a compra e não são logados. Não é uma fila durável de e-mail; o host pode usá-lo para integração já existente, sem duplicar a notificação in-app inserida pelo módulo. Sem callback não há qualquer contato externo além de OpenAI quando a interpretação é autorizada.

## Configuração de IA

A única chave aceita é `FT_ASSISTENTE_AI_API_KEY`, criada/configurada pelo usuário para o projeto. Não existe fallback para `OPENAI_API_KEY`, chaves Sandbox, `FT_WHATSAPP_AI_API_KEY`, Meta ou YCloud. A aplicação não deve distribuir essa variável no frontend, no repositório ou em respostas. Não há variável para trocar o provedor/base URL: os endpoints HTTPS originais OpenAI são fixos e redirecionamentos são proibidos.

`FT_ASSISTENTE_AI_MODEL` tem padrão `gpt-6-luna`, com Chat Completions, `reasoning_effort:'none'`, `max_completion_tokens:6000` e schema JSON estrito; não é enviado `temperature`. `FT_ASSISTENTE_TRANSCRIBE_MODEL` tem padrão `gpt-transcribe`, com arquivo multipart, extensão coerente, `language:'pt'` e `response_format:'json'`. Overrides precisam ser IDs de modelo válidos e compatíveis com esses parâmetros/endpoints; cabe ao deploy escolher um modelo disponível para a conta.

Os defaults foram verificados na documentação oficial em 18/11/2026: GPT-6 Luna suporta Chat Completions e Structured Outputs [1]; GPT-Transcribe suporta `/v1/audio/transcriptions` [2] e os parâmetros multipart utilizados [3]. Não se iniciou uma integração nova com o transcriber antigo `gpt-4o-mini-transcribe`, cuja documentação anuncia depreciação e encerramento em 26/02/2027 [4]. Os aliases antigos também não foram adotados como default textual; os IDs atuais foram acordados para este novo módulo. Não houve chamada real de IA nem teste de crédito, faturamento ou conectividade.

## GET `/assistente/status`

Resposta autenticada, exclusivamente booleana:

```json
{
  "configurado": false,
  "texto_habilitado": false,
  "audio_habilitado": false,
  "manual_habilitado": true,
  "fotos_enviadas_ia": false,
  "conexao_testada": false
}
```

Os primeiros três valores passam a `true` apenas quando existe uma chave Assistente não vazia. Isso sinaliza configuração, não prova chave válida, crédito, disponibilidade de modelo, acesso ou funcionamento real. `conexao_testada` permanece sempre `false`; `manual_habilitado` sempre `true`; `fotos_enviadas_ia` sempre `false`. Nunca retorna a chave ou parte dela. Todas as respostas usam `Cache-Control: private, no-store`.

## Rascunho compartilhado

```json
{
  "nome_pessoa": "Maria Oliveira",
  "nome_lista": "Materiais da Obra A",
  "categoria": "Manutenção",
  "destino": "Obra A",
  "uso": "Reparo",
  "descricao": "Materiais para reparo da parede",
  "observacoes": "Entrega pela manhã",
  "link_produto": null,
  "itens": [
    {"produto":"Cimento", "quantidade":2, "unidade":"saco"},
    {"produto":"Parafusos", "quantidade":4, "unidade":"caixa"}
  ]
}
```

**Dados essenciais do rascunho:** `nome_pessoa`, `destino`, pelo menos um item e `produto`, quantidade positiva e unidade válida de cada item. **Opcionais:** `nome_lista`, `categoria`, `uso`, `descricao`, `observacoes` e `link_produto`; não bloqueiam a interpretação/confirmação quando ausentes, mas são preservados quando fornecidos. O link usa a propriedade `link_produto` compatível com `compras`; é texto opcional, não é buscado ou executado pelo módulo.

Limites: `nome_pessoa` e `nome_lista` 240 caracteres, `categoria` 120, `destino` 240, `uso` 500, `descricao` e `observacoes` 1500 cada, `link_produto` 2048, produto 240 e unidade 30; no máximo 30 itens. Ausência é representada por `null`, sem nome automático, categoria padrão, destino presumido, quantidade ou unidade inventados no rascunho. `nome_pessoa` é nullable string no normalize e no schema de extração estrito (`maxLength:240`). Campos excedentes não são persistidos, especialmente privilégios, preço, fornecedor, aprovação e status. Excesso de itens ou texto é rejeitado, jamais truncado.

Nome vazio ou rótulos genéricos de conta, como `admin`, `administrador`, `operador`, `funcionário` e `conta logada` (ignorando caixa, acentos e espaços), não satisfazem `nome_pessoa`: o módulo solicita o nome da pessoa que pede. Não há validação fictícia de identidade, documento ou cadastro, nem exigência de sobrenome. Nomes reais que contenham termos de cargo não são rejeitados por isso.

Quantidades informadas precisam ser finitas, positivas e no máximo 1.000.000, limite explícito porque as tabelas existentes usam PostgreSQL REAL. Aceita número JSON ou string decimal simples, inclusive vírgula brasileira; rejeita booleano, objeto, array, notação hexadecimal, zero, negativos e valores que seriam zero em REAL. Valores decimais mantêm a precisão disponível no contrato existente. Unidades canônicas permitidas: `m`, `cm`, `kg`, `g`, `L`, `mL`, `un`, `par`, `m²`, `m³`, `caixa`, `saco`, `pacote`, `fardo`, `rolo`, `tubo`, `kit`, `lata`, `frasco`, `galão`, `balde`. Normaliza aliases como litros/caixas/pares, sem converter embalagens em unidades arbitrárias. Unidade desconhecida pode aparecer no rascunho de interpretação para revisão, mas bloqueia a confirmação.

## POST `/assistente/interpretar`

```json
{
  "texto": "Mude o cimento para três sacos e mantenha os outros itens",
  "audio": {"base64":"BASE64_SEM_PREFIXO_DATA", "mime_type":"audio/ogg;codecs=opus"},
  "rascunho": {},
  "consentimento_ia": true
}
```

`audio` e `rascunho` são opcionais. Pelo menos texto não vazio ou áudio válido é obrigatório. `consentimento_ia` precisa ser literalmente `true`. Aceita somente essas quatro propriedades; fotos nessa rota são rejeitadas. O texto, o texto transcrito e o rascunho são enviados como dados JSON não confiáveis, separados da instrução de sistema. Não são enviadas fotos, IDs de mídia, base64 de imagens nem áudio ao endpoint textual; áudio só vai ao endpoint de transcrição após consentimento. Texto/transcrição combinados não podem exceder 6000 caracteres. Transcrição longa é rejeitada sem corte. Cada áudio tem até 3 MiB, com base64 canônico puro, sem prefixo `data:` nem URL.

Áudios permitidos: OGG (`audio/ogg`), WebM (`audio/webm`), MP4 (`audio/mp4`), MPEG/MP3 (`audio/mpeg`) e WAV (`audio/wav`). Verifica assinaturas de bytes OggS, EBML, ftyp, ID3/frame MPEG ou RIFF/WAVE. Parâmetros MIME como `codecs=opus` são aceitos; o tipo declarado deve corresponder ao detectado. Não há relabeling silencioso, fetch de URL remota nem validação completa de codec/duração: áudio corrompido que tem assinatura válida pode ser rejeitado pelo provedor e recebe erro amigável.

Resposta de sucesso:

```json
{
  "rascunho": {"nome_pessoa":null,"nome_lista":null,"categoria":null,"destino":null,"uso":null,"descricao":null,"observacoes":null,"link_produto":null,"itens":[{"produto":"Tinta","quantidade":null,"unidade":null}]},
  "transcricao": null,
  "pergunta": "Para continuar, informe ou corrija: nome_pessoa, destino, itens.1.quantidade, itens.1.unidade. Informe o nome da pessoa que pede, não o nome ou rótulo da conta.",
  "avisos": ["Confira o nome da pessoa que pede, o destino e todos os itens; revise e corrija antes de confirmar. Fotos não são enviadas à IA."]
}
```

`transcricao` é a transcrição deste áudio ou `null` em texto puro; o frontend conserva/revisa a transcrição que desejar anexar à confirmação. Na extração, `itens:null` mantém a lista anterior; se a IA retornar itens, substitui por uma lista completa corrigida, sem concatenar/duplicar. Campos gerais `null` mantêm os anteriores; string vazia apaga explicitamente, inclusive `nome_pessoa`. A pessoa pode ser extraída quando indicada explicitamente no texto ou áudio e pode ser corrigida posteriormente, mas precisa de revisão humana obrigatória. A IA nunca recebe o nome da conta como fonte automática da pessoa; se esta faltar, o backend pergunta. Nos itens, `null` indica informação ausente. Retorno com mais de 30 itens gera 422, não uma lista parcial. JSON malformado, chaves inesperadas, tipos inválidos, recusa, resposta incompleta ou fora dos limites geram erro; o frontend deve preservar o rascunho anterior. O modelo não recebe ferramentas e nunca executa SQL, URLs, código ou confirmação contidos no texto. O schema valida estrutura, não garante factualidade da IA: todos os valores exigem revisão humana.

`missingFields` e `pergunta` consideram somente pessoa, destino e os campos essenciais dos itens. O backend gera sua própria pergunta e não repassa a pergunta sugerida pela IA, evitando exigências indevidas de lista, categoria, uso, descrição, observações, link ou fotos. Quando os dados essenciais do rascunho estão completos, `pergunta:null`, mesmo sem foto; foto é verificada somente em `/confirmar`.

Sem chave exclusiva retorna 503 com `code:'IA_NAO_CONFIGURADA'` e mensagem de preenchimento manual. A IA tem cotas duráveis, compartilhadas entre instâncias: 12 chamadas em janela fixa de 10 minutos e 60 em janela diária UTC por username autenticado. Texto custa uma chamada; áudio reserva duas (transcrição + extração). Tentativas que chegam à IA, inclusive falhas, consomem a reserva. Uma reserva recusada por qualquer cota é inteiramente desfeita. 429 informa `Retry-After:600`. Não armazena texto, áudio, transcrição intermediária ou fotos nessa rota; apenas contadores de uso sem conteúdo.

Cada operação remota, incluindo leitura da resposta, tem timeout máximo de 20 segundos: no máximo 40 segundos de espera remota para áudio + extração, sem retry automático. Um deadline de 45 segundos começa antes da reserva de cota e reduz o orçamento de cada chamada ao tempo restante; se o banco consumir esse orçamento, não se inicia outra chamada remota. Timeout retorna 504; falhas de rede/provedor retornam 502. Há aborto com `AbortController`, limite de resposta remota de 128 KiB e limite de saída de 6000 tokens. `timeoutMs` só permite reduzir o limite por chamada em testes. Há margem para overhead no limite síncrono Netlify de 60 segundos [5]; banco/migração pode falhar separadamente com mensagem genérica. A reserva de IA exige as tabelas do módulo, mas não cria compras, pedidos confirmados ou mídias.

## POST `/assistente/confirmar`

```json
{
  "request_id": "12345678-1234-4234-8234-123456789abc",
  "rascunho": {"nome_pessoa":"Maria Oliveira","destino":"Obra A","itens":[{"produto":"Cimento","quantidade":2,"unidade":"saco"}]},
  "transcricao": "Transcrição final revisada",
  "fotos": [{"base64":"BASE64_SEM_PREFIXO_DATA", "mime_type":"image/png"}]
}
```

Confirmação funciona sem chave de IA e não chama nenhum modelo. Exige UUID RFC com versão 1–8, **nome da pessoa que pede revisado**, **destino**, **pelo menos um item com produto/quantidade positiva/unidade permitida** e **pelo menos uma foto válida do pedido**. Ausência de algum essencial, nome vazio/rótulo genérico ou fotos omitidas, `null` ou `[]` gera **HTTP 400 `PEDIDO_INCOMPLETO` antes de qualquer INSERT ou acesso ao banco**. Nome de lista, categoria, uso, descrição, observações, link e transcrição são opcionais. Transcrição confirmada tem até 6000 caracteres. O único nome de pessoa usado para apresentação é `rascunho.nome_pessoa`; campos extras de identidade/privilégios, status, fornecedor e preço enviados pelo body são ignorados e não alteram autenticação ou fluxo.

No máximo três fotos, cada uma até 1 MiB e no total até 2 MiB. Formatos exclusivos: JPEG, PNG e WebP; MIME declarado precisa coincidir com assinaturas binárias. Não aceita SVG, GIF, URL, `href`, `data:` ou propriedades extras no objeto da foto. Base64 de 2 MiB ocupa aproximadamente 2,67 MiB; confirmação e interpretação são requests separados, mantendo os corpos válidos abaixo do limite JSON bufferizado Netlify de 6 MB [5]. Esses limites são de bytes decodificados e validados também no backend.

Uma única transação cria `compras`, todos os itens, o registro idempotente, fotos, uma notificação ADM e audit log. Um advisory lock transacional por UUID serializa clicks/retries antes de qualquer INSERT; `ft_assistente_pedidos.request_id` possui PRIMARY KEY e `compra_id` UNIQUE duráveis. Reutilização do UUID por outra conta autenticada ou com rascunho/transcrição/fotos diferentes gera 409 sem retornar o pedido de outra conta. O hash inclui `nome_pessoa`, opcionais normalizados, transcrição e bytes/tipos das fotos, sem defaults técnicos. Replay idêntico retorna o mesmo ID sem novo item, foto, notificação ou auditoria, inclusive depois de reiniciar o serviço. Falha em qualquer escrita faz ROLLBACK; o mesmo UUID pode ser reenviado. Locks de confirmação e migração têm limite de 5 segundos; statements transacionais têm limite de 10 segundos. Deadlock/timeout de banco recebe erro genérico recuperável, sem detalhes internos.

Resposta novo pedido, HTTP 201:

```json
{"ok":true,"id":123,"compra_id":123,"duplicado":false}
```

Replay, HTTP 200: mesma estrutura com `duplicado:true`. Não retorna base64, transcrição, fotos, rascunho, fornecedor ou detalhes grandes.

## Compatibilidade com compras/cotações existentes

Sempre cria `tipo_solicitacao='lista'`, inclusive para um único item. **Defaults técnicos apenas na persistência:** `compras.item` recebe `nome_lista` quando fornecido; ausente, recebe o nome do produto se há um item, ou `Pedido de materiais` se há vários. Categoria ausente vira `Outros`; uso ausente permanece `NULL`. Isso não preenche nem modifica o rascunho de IA. `onCreated` recebe o nome de lista/categoria efetivamente persistidos. Destino e demais valores fornecidos são preservados; `solicitante` é o `nome_pessoa` revisado, `descricao` contém os itens, a descrição opcional e observações finais; `link_produto` preserva o link opcional. `quantidade=0` e `unidade=''` no cabeçalho são a representação existente para lista; as quantidades reais ficam em `lista_compras_itens`. `origem='assistente'`, `foto_url=NULL`, valores iniciais zero, fornecedor não escolhido, sem transcrição embutida em `compras`.

O início é `status='Em cotação'` e `status_lista='rascunho'`, não uma lista pronta fictícia. Cada item começa com `fornecedor=''` e `preco=0`; não insere cotações, fornecedores nem aprovações. Isso reutiliza a representação utilizada pelo núcleo WhatsApp sem importar sua configuração. A rota existente `/cotacoes/abertas` filtra pelo `status`, não por `status_lista`, então a compra chega à fila ADM. O frontend existente permite adicionar fornecedor na lista em rascunho. Não há campo `lista_pronta` no schema atual: o contrato é `status_lista`. Nenhuma informação adicional é necessária para abrir a fila de cotação. O POST `/compras` legado vincula Em cotação a pronta, mas esse módulo usa o caminho explicitamente requerido de lista aguardando fornecedores e o estado já utilizado pelo núcleo de pedidos.

Não se alteram `api.js`/frontend neste módulo: o host monta o helper e pode exibir a origem e consultar metadados sob demanda. Como as fotos estão em tabela separada, `/compras` e `/compras?leves=1` nunca carregam os binários; o `tem_foto` legado, baseado em `foto_url`, fica `false` para estas novas fotos. Use o metadata helper da origem Assistente para anexos. No momento da implementação a API de compras não aplicava filtro owner às listagens; o Assistente não perpetua isso para mídias/transcrição e aplica acesso ADM ou proprietário cadastrado.

## Metadados e mídia privada

`GET /assistente/compras/:id` retorna `{origem:'assistente',solicitante,registrado_por,destino,transcricao,itens:[{produto,quantidade,unidade}],fotos:[{id,mime_type}]}`. Em novos pedidos, `solicitante` é a pessoa indicada/revisada e `registrado_por` é o nome da conta registrada que confirmou. Em histórico antigo com `registrado_por` nulo/vazio, retorna o `solicitante_username` capturado como fallback, sem atualizar/backfill dos registros antigos nem consultar o nome atual da conta. `destino` é o destino atual da compra, mostrado junto da pessoa e das fotos no modal do ADM. Transcrição é o texto original anexado e confirmado ou `null`. Os itens são a lista atual da compra, com as quantidades finais revisadas; o modal os separa do texto/transcrição original para não confundir uma correção com o áudio anterior. Fotos não contêm base64, conteúdo, href ou URL pública.

`GET /assistente/midias/:id` devolve bytes com MIME real validado, `Cache-Control:private, no-store`, `X-Content-Type-Options:nosniff`, `Content-Disposition:inline` e CSP restritiva. O frontend usa a mesma autorização Bearer, normalmente via fetch autenticado + object URL. Não há endpoint de upload público nem link remoto.

Ambas as rotas fazem JOIN com a compra de origem Assistente e restringem por `admin` ou username/ID proprietário capturados na confirmação; não usam o nome visível como autorização. Inexistente, ID inválido, compra legada ou outro proprietário retornam o mesmo 404 `{error:'Não encontrado.',code:'NAO_ENCONTRADO'}`, sem revelar existência. Sem autenticação retorna 401 antes de acesso ao banco.

## Persistência e erros

DDL é aditivo, serializado e limitado a `ft_assistente_pedidos`, `ft_assistente_midias`, `ft_assistente_ai_limites`, seus índices, a nova coluna `ft_assistente_pedidos.registrado_por TEXT` nullable (via `ADD COLUMN IF NOT EXISTS`) e a coluna opcional `compras.origem` com default `app`, sem alterar registros antigos. `ft_assistente_pedidos` vincula compra/UUID, conta autenticada (username/ID), pessoa indicada, nome da conta registradora, hash do conteúdo final e transcrição confirmada; `ft_assistente_midias` guarda BYTEA privado vinculado à compra confirmada. Áudio original e rascunhos/transcrições intermediárias nunca são persistidos. Os contadores da IA armazenam username/janela/período/contagem sem conteúdo; não há limpeza automática desses contadores nesta versão. Retenção/backup existentes do PostgreSQL se aplicam.

Erros de rota usam `{error,code}` com mensagem amigável. Nenhuma falha do módulo registra segredo, headers, payload, foto, transcrição, stack, SQL ou body de provedor. Mensagens de banco/provedor não são propagadas. Sem IA o usuário continua preenchendo e confirmando manualmente. A aplicação host continua responsável por autenticação, parser JSON, erros anteriores ao mount e configuração Netlify.

## Testes locais sem IA externa

```bash
# Unitários/HTTP de configuração/autenticação, sem PostgreSQL:
node --test tests/assistente.test.js

# Banco local dedicado já provisionado (socket peer):
ASSISTENTE_TEST_DB=1 node --test tests/assistente.test.js

# Mesmo banco em TCP loopback, se houver senha local de teste:
ASSISTENTE_TEST_DB=1 ASSISTENTE_TEST_PGHOST=127.0.0.1 \
  ASSISTENTE_TEST_PGPASSWORD='SENHA_EXCLUSIVAMENTE_LOCAL' \
  node --test tests/assistente.test.js
```

A configuração é fixada em banco **`ft_flow_assistente_test`**, usuário **`ubuntu`**, SSL desabilitado e host permitido somente `/var/run/postgresql` ou `127.0.0.1`. Antes do reset afirma `current_database()`, `current_user` e `inet_server_addr()`: banco distinto, usuário distinto ou IP externo é proibido. Não usa `DATABASE_URL`, senhas de produção nem chaves da sessão. Remove variáveis herdadas de SMTP/mail/WA/YCloud/OpenAI e `FT_ASSISTENTE_*`, usa chave sintética exclusiva, `fetchImpl` fake e endpoints permitidos explicitamente. O reset só toca tabelas nomeadas nesse banco dedicado; não toca bancos/suites de WhatsApp/EPI. Integração é opt-in.

Execução efetiva local em 18/11/2026: **22 testes aprovados, 0 falhas**, incluindo 16 cenários PostgreSQL e 5 testes independentes de banco (o contador inclui o agrupador da integração). Cobertura: autenticação, ausência de chave, essenciais/foto bloqueados antes do banco, nomes genéricos, extração/revisão/correção/null/apagar pessoa por texto/áudio, opcionais preservados, perguntas IA opcionais ignoradas, defaults somente na persistência, migração aditiva/fallback de histórico, itens atuais, multi-itens/cópia completa de 30, texto adversarial, erros/refusal/incompletos/excesso da IA, áudio multipart, transcrição vazia/longa/combinada, timeout, cotas concorrentes/duráveis, confirmação manual, limites/fotos, privacidade owner/ADM, oito clicks concorrentes, replay entre instâncias, conflitos de pessoa/áudio/fotos, auditoria por conta e rollback/retry. A execução usou socket local em `ft_flow_assistente_test`, usuário ubuntu. Sem PostgreSQL: **5 aprovados, 1 integração pulada, 0 falhas**. Não houve acesso a produção, chaves reais ou rede de IA, nem commit/push. Frontend e demais suites são de responsabilidade da integração host.

## Referências

[1]: https://developers.openai.com/api/docs/models/gpt-6-luna "OpenAI GPT-6 Luna e recursos suportados"
[2]: https://developers.openai.com/api/docs/models/gpt-transcribe "OpenAI GPT-Transcribe e endpoint suportado"
[3]: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create "OpenAI criação de transcrição e parâmetros"
[4]: https://developers.openai.com/api/docs/guides/speech-to-text "OpenAI formatos de arquivos e depreciação de modelos"
[5]: https://docs.netlify.com/build/functions/configuration/ "Netlify configuração e limites de funções"
