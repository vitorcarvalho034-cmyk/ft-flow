# Assistente Manus e perguntas guiadas

A configuração `FT_ASSISTENTE_AI_PROVIDER=manus` seleciona a API oficial `https://api.manus.ai/v2/`. A chave autorizada da empresa deve estar em `FT_ASSISTENTE_MANUS_API_KEY`, marcada secreta no Netlify, somente Functions/Production. Nenhuma chave do ambiente interno ou fallback OpenAI é utilizado. A integração OpenAI anterior continua disponível quando o provedor não é Manus; não é chamada como fallback automático.

## Fluxo que salva um pedido

O processamento da IA nunca cria compras. A pessoa confere as respostas, revisa os campos e passa pelo resumo final. Só `POST /assistente/confirmar`, após clique em **Confirmar e enviar ao ADM**, cria uma lista Em cotação/rascunho. A transação e o UUID de confirmação impedem duplicação. A IA não aprova compras nem movimenta estoque.

O backend bloqueia a confirmação sem nome explícito da pessoa, destino, pelo menos um produto com nome/quantidade positiva/unidade permitida e pelo menos uma foto válida por pedido. Nome genérico da conta, nome só numérico, quantidade zero/negativa e unidade ausente/desconhecida não passam. Título, categoria, uso, descrição, observações e link continuam opcionais.

## Processamento assíncrono

`POST /assistente/interpretar` admite as propriedades anteriores e um `processamento_id` UUID opcional. Em Manus responde HTTP 202 com `{processamento_id,estado:'processando',consultar_em_ms:5000}`. A interface consulta `GET /assistente/processamentos/:id` a cada cinco segundos. A tarefa não é recriada em cada consulta. Mesmo UUID/mesmos dados da mesma conta reutiliza o processamento; outro conteúdo gera conflito. IDs remotos e URLs Manus não são enviados ao frontend.

O resultado só é aceito quando o agente está `stopped`, `has_running_background_jobs===false`, e existe `structured_output_result.success===true`. Estado inicial `waiting` sem evento de autorização continua pendente. Uma solicitação real de autorização não é aprovada automaticamente: retorna erro seguro e mantém o pedido manual disponível. `success:false`, JSON inesperado, transcrição vazia e limites excedidos são rejeitados sem salvar resultado parcial. Mensagens brutas do provedor, tokens e dados internos não são expostos.

`POST /assistente/processamentos/:id/cancelar` cancela o rascunho remoto; cancelamento não confirma pedidos. O UUID é limitado ao username e ID autenticados que iniciaram o processamento, inclusive para ADM. Sem login, todas as rotas retornam 401 antes de consultar o banco. Erros de credencial do provedor retornam 503, não invalidam o login FT FLOW.

## Uma pergunta por vez

O modo guiado pergunta nome da pessoa, destino, produto, quantidade e unidade. A pessoa pode digitar sem API ou gravar um áudio. Depois da transcrição, o app mostra a resposta reconhecida, permite correção e exige **Confirmar resposta e continuar**; nunca avança ou salva o pedido por decisão da IA. Após a unidade, pode adicionar outro produto ou ir para foto/conferência. A tela completa e o resumo final continuam disponíveis.

A interpretação guiada envia `pergunta_guiada:{campo:'nome_pessoa'|'destino'|'produto'|'quantidade'|'unidade',indice_item?:numero}`. O servidor valida a lista de campos e o item existente. Ao retornar a extração, só aplica o campo perguntado e, para produto/quantidade/unidade, só o item indicado. Nome, destino, opcionais e demais itens anteriormente respondidos não são sobrescritos por uma resposta guiada. A transcrição não serve como decisão de envio.

Cada áudio guiado é uma tarefa Manus separada. Há espera de processamento; a alternativa digitada não chama IA. Limites locais: 12 reservas/10 min e 60/dia por username; uma pergunta guiada reserva 1, áudio completo reserva 2. Não há consulta ou promessa sobre plano, cobrança ou créditos Manus. Condições da conta são confirmadas no suporte oficial.

## Privacidade e limites

Texto/áudio só seguem à Manus com `consentimento_ia:true`. Tarefas são privadas e não habilitam conectores. Fotos nunca seguem à IA: ficam no PostgreSQL privado após confirmação. Áudio é enviado como `type:'voice'`, data URI base64 e MIME/extensão correspondentes; não usa URL pública. A chave permanece apenas no backend. A tarefa do provedor pode reter o texto/áudio conforme as regras do serviço; não se promete remoção da tarefa ao cancelar.

O processamento usa tabela aditiva `ft_assistente_processamentos`, com owner autenticado, hash, ID remoto e rascunho/resultado temporários. A janela é cinco minutos; o cliente espera até quatro. Rascunho/resultado são limpos ao cancelar/expirar ou oportunisticamente ao iniciar outra tarefa. Não há armazenamento de bytes de áudio/fotos nessa tabela. A limpeza não é uma garantia de eliminação física de backups nem ocorre por job recorrente. O rascunho do aparelho continua em memória, sem localStorage; fechar/recarregar perde essa sessão.

Limites de áudio e foto, validação de MIME/base64, checklist, confirmação e auditoria seguem o núcleo existente. Chamada remota limitada a 20s, respostas a 128KiB, polling limitado também no servidor. Não se mantém a Function síncrona esperando a tarefa inteira. Migrações não alteram compras históricas, EPI, estoque nem configuração WhatsApp.

Fontes oficiais: https://open.manus.ai/docs/v2/authentication, https://open.manus.ai/docs/v2/structured-output e https://open.manus.ai/docs/v2/task-lifecycle.
