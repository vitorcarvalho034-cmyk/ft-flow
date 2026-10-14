# Ativação dos pedidos pelo WhatsApp — FT FLOW

## Situação e escopo

O aplicativo possui integração preparada para a **API oficial WhatsApp Cloud API da Meta**, com processamento em Netlify Background Functions e persistência no PostgreSQL existente. O canal permanece desligado enquanto a configuração não estiver completa.

O painel **Pedidos pelo WhatsApp** é exclusivo do ADM. Ele permite cadastrar nome, telefone e setor dos líderes; definir destino/categoria padrão; pausar o cadastro; ver estados das conversas e reprocessar falhas. O telefone cadastrado é o **celular do líder**, não o número comercial usado pelo assistente.

Após confirmação explícita, os pedidos entram em Compras como **Em cotação**, com solicitante do cadastro e origem WhatsApp. Múltiplos produtos, ou um produto solicitado em embalagem como caixa/saco, entram como lista para preservar a unidade original. Não há escolha automática de fornecedor, aprovação ou envio para Dorian/Felipe. O ADM recebe uma notificação dentro do app. Este fluxo novo não envia e-mail automático.

## O que falta para ativar

1. Definir **um número comercial do FT FLOW**. Não migrar nem desconectar um número existente sem confirmar o procedimento adequado à sua conta Meta. A configuração varia entre número novo, WhatsApp Business app e número já conectado à API.
2. Criar ou selecionar o aplicativo Meta e a conta empresarial WhatsApp correspondentes.
3. Obter token de acesso apropriado e ID do número comercial no painel da Meta. Token temporário serve apenas para testes; produção precisa de token de usuário do sistema configurado para os ativos corretos.
4. Configurar uma chave própria de API OpenAI para transcrição e extração estruturada. A chave e o serviço de IA desta conversa não são transferidos ao site.
5. Salvar os segredos no **Netlify**, nunca no frontend, no GitHub ou em mensagem de chat.
6. Cadastrar dois líderes autorizados para o piloto, verificar o webhook e testar pedidos reais antes de ampliar.

### Variáveis do projeto Netlify

Manter as variáveis existentes do banco, autenticação e e-mail. Adicionar somente as da integração, em contexto `production` e disponíveis às funções; usar armazenamento secreto quando aplicável.

| Variável | Uso |
| --- | --- |
| `FT_WHATSAPP_ENABLED` | `false` durante a configuração; `true` somente depois da preparação e validação. |
| `WHATSAPP_ACCESS_TOKEN` | Token Meta autorizado para envio e download de mídia. |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número da API; não é o telefone com DDD. |
| `WHATSAPP_APP_SECRET` | Segredo do aplicativo Meta para validar a assinatura do webhook. |
| `WHATSAPP_VERIFY_TOKEN` | Valor aleatório escolhido para verificar o webhook; repetir exatamente no painel Meta. |
| `FT_WHATSAPP_AI_API_KEY` | Chave própria de API OpenAI. |
| `WHATSAPP_BUSINESS_PHONE` | Opcional: telefone comercial com país/DDD para mostrar o link de conversa no painel. |
| `WHATSAPP_GRAPH_VERSION` | Opcional; padrão `v26.0`, conforme documentação consultada. |
| `FT_WHATSAPP_AI_MODEL` | Opcional; padrão `gpt-4o-mini`. |
| `FT_WHATSAPP_TRANSCRIBE_MODEL` | Opcional; padrão `gpt-4o-mini-transcribe`. |
| `APP_URL` | URL canônica; neste projeto `https://ft-flow.netlify.app`. |

Após alterar variáveis, realizar novo deploy e verificar o painel autenticado. Não considerar os indicadores de configuração uma prova de entrega real: o piloto deve verificar a conversa de ponta a ponta.

### Webhook Meta

- URL de retorno: `https://ft-flow.netlify.app/api/whatsapp/webhook`
- Token de verificação: o mesmo valor secreto cadastrado em `WHATSAPP_VERIFY_TOKEN`.
- Assinar o campo de eventos `messages` da conta WhatsApp vinculada ao aplicativo.
- A verificação GET precisa responder o desafio; o recebimento POST só aceita HMAC válido calculado sobre o corpo bruto.

O recebimento responde sucesso somente depois de persistir a mensagem e receber admissão do worker em segundo plano. Se o processador estiver indisponível, a mensagem permanece no banco e o webhook retorna erro para permitir o reenvio da Meta.

## Piloto obrigatório

Com os números dos líderes cadastrados e ativos:

1. Enviar texto com produto, quantidade/unidade e destino. Conferir que **não aparece uma compra antes da confirmação**.
2. Corrigir quantidade e confirmar o novo resumo. Verificar os dados no app e o nome do líder cadastrado.
3. Enviar áudio e depois foto antes de confirmar. Abrir transcrição/fotos autenticadas no app.
4. Solicitar dois produtos em um áudio. Confirmar que a lista contém todos os itens e entra para cotação.
5. Cancelar um rascunho. Confirmar que nenhuma compra foi criada.
6. Repetir confirmação e testar botões antigos após corrigir o pedido. Não devem criar uma compra nova nem confirmar uma revisão antiga.
7. Testar dois líderes ao mesmo tempo. As conversas e fotos não devem se misturar.
8. Testar número não cadastrado e líder pausado. Não devem criar pedidos nem disparar processamento de mídia/IA.
9. Simular falha temporária, conferir o painel e usar **Reprocessar falhas**. O pedido já registrado não deve ser duplicado.
10. Validar em iPhone e Android reais, inclusive foto e áudio gravados pelo aparelho. A validação em larguras de navegador não substitui a validação física.

## Limites e privacidade

- Até **30 produtos por pedido**. Se a extração retornar mais itens, o assistente pede a divisão em pedidos menores; não salva nem confirma uma lista parcial.
- Fotos opcionais: JPEG/PNG, até **4 MB**, no máximo **10** por pedido. São armazenadas no banco e servidas apenas com sessão autenticada; URLs temporárias da Meta não são usadas no histórico.
- Áudios: OGG/AAC/MP3/M4A, até **16 MB**. Recomendar áudios curtos. O áudio original não é retido; somente a transcrição é preservada no pedido.
- Mensagens por texto e transcrições são processadas pela API OpenAI. O assistente informa o uso de IA; a empresa deve orientar os funcionários e definir suas regras de acesso/retenção.
- O sistema não inventa quantidade, medida ou destino ausente. Pergunta os campos essenciais e mostra categoria/destino padrão no resumo quando utilizados.
- Foto enviada depois de uma compra confirmada **não altera automaticamente o pedido anterior**; inicia um novo rascunho e informa isso na conversa.
- Mensagens e compras têm identificação persistente para evitar duplicidades. Envio de respostas pela Meta é rastreado por outbox; falhas definitivas exigem intervenção do ADM. Uma resposta pode ser reenviada se houver interrupção entre aceitação na Meta e registro local do envio; isso não deve duplicar a compra.
- O worker executa na infraestrutura Netlify, não neste sandbox. Verificar a disponibilidade de Background Functions no projeto e observar os limites do provedor; não houve contratação ou mudança de plano.

## Desenvolvimento e validação

```bash
npm ci
npm test
# Somente no sandbox preparado com os bancos PostgreSQL de teste:
npm run test:integration
```

Os testes locais usam mensagens sintéticas e simulações de Meta/OpenAI. Eles não enviam mensagens reais, não acessam o banco de produção e não provam que credenciais externas ainda pendentes funcionarão.

## Links oficiais

- [Aplicativos Meta e configuração da API](https://developers.facebook.com/apps/)
- [Guia oficial de configuração WhatsApp Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Usuários do sistema e tokens de produção](https://business.facebook.com/latest/settings)
- [Chaves de API OpenAI](https://platform.openai.com/api-keys)
- [Background Functions no Netlify](https://docs.netlify.com/build/functions/background-functions/)
