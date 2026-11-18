/* Assistente de pedidos — dados sensíveis somente em memória; fotos nunca vão à IA. */
(() => {
  'use strict';
  const MiB = 1024 * 1024;
  const MAX_AUDIO = 3 * MiB;
  const MAX_PHOTO = MiB;
  const MAX_PHOTOS_TOTAL = 2 * MiB;
  const FIELD_LIMITS = { nome_lista: 240, categoria: 120, destino: 240, uso: 500, observacoes: 1500 };
  const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/m4a'];
  const audioType = mime => String(mime || '').split(';')[0].trim().toLowerCase();
  const escape = value => htmlEsc(String(value ?? ''));
  const blankItem = () => ({ produto: '', quantidade: '', unidade: '' });
  const emptyDraft = () => ({ nome_lista: '', categoria: '', destino: '', uso: '', observacoes: '', itens: [blankItem()] });
  function newKey() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const state = {
    generation: 0, root: null, controllers: new Set(), requestId: newKey(),
    texto: '', consent: false, draft: emptyDraft(), review: false, transcricao: '',
    pergunta: '', avisos: [], configured: null, busy: '', photoBusy: false,
    audio: null, audioUrl: '', photos: [], recorder: null, stream: null,
    recording: false, recordPending: false, timer: null, recordStarted: 0, success: null,
    metadataCancel: null
  };
  const details = { generation: 0, controller: null, urls: new Set(), opener: null };
  let confirmOpener = null;
  const rootEl = selector => state.root?.querySelector(selector);
  const current = generation => generation === state.generation && tela === 'assistente' && state.root?.isConnected;
  const units = () => [...new Set([...document.querySelectorAll('#novoItemUnidade option')].map(o => o.value).filter(Boolean).concat(UNIDADES_VALIDAS, 'par'))];
  const categorias = () => [...document.querySelectorAll('#listaCompraModalCategoria option')].map(o => o.value).filter(Boolean);
  function normalizeDraft(draft) {
    const result = emptyDraft();
    for (const field of ['nome_lista', 'categoria', 'destino', 'uso', 'observacoes']) result[field] = String(draft?.[field] ?? '');
    result.itens = Array.isArray(draft?.itens) && draft.itens.length
      ? draft.itens.map(item => ({ produto: String(item?.produto ?? ''), quantidade: item?.quantidade ?? '', unidade: String(item?.unidade ?? '') }))
      : [blankItem()];
    return result;
  }
  function collect() {
    if (!state.root?.isConnected) return;
    const text = rootEl('#assistenteTexto');
    if (text) state.texto = text.value;
    const consent = rootEl('#assistenteConsentimento');
    if (consent) state.consent = consent.checked;
    if (!state.review) return;
    for (const field of ['nome_lista', 'categoria', 'destino', 'uso', 'observacoes']) {
      const input = rootEl(`[data-draft-field="${field}"]`);
      if (input) state.draft[field] = input.value;
    }
    state.draft.itens = [...state.root.querySelectorAll('[data-assistente-item]')].map(row => ({
      produto: row.querySelector('[data-item-field="produto"]').value,
      quantidade: row.querySelector('[data-item-field="quantidade"]').value,
      unidade: row.querySelector('[data-item-field="unidade"]').value
    }));
  }
  function payloadDraft() {
    const draft = normalizeDraft(state.draft);
    for (const field of ['nome_lista', 'categoria', 'destino', 'uso', 'observacoes']) draft[field] = draft[field].trim();
    draft.itens = draft.itens.map(item => ({ produto: item.produto.trim(), quantidade: item.quantidade === '' ? '' : Number(String(item.quantidade).replace(',', '.')), unidade: item.unidade.trim() }));
    return draft;
  }
  function message(text, error = false) {
    const target = rootEl('[data-assistente-message]');
    if (!target) return;
    target.textContent = text;
    target.classList.toggle('assistente-error', error);
    target.hidden = !text;
  }
  function responseError(error, fallback) {
    if (error?.name === 'AbortError') return '';
    // Não mostrar configurações, credenciais ou mensagens técnicas devolvidas pelo serviço.
    return /sessão|sessao|401/i.test(String(error?.message || '')) ? 'Sua sessão expirou. Entre novamente para continuar.' : fallback;
  }
  async function request(path, payload, generation) {
    const controller = new AbortController(); state.controllers.add(controller);
    try {
      const result = await js(API + '/assistente' + path, {
        signal: controller.signal,
        ...(payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      });
      return current(generation) ? result : null;
    } finally { state.controllers.delete(controller); }
  }
  function stopTracks() {
    state.stream?.getTracks().forEach(track => track.stop()); state.stream = null;
    clearInterval(state.timer); state.timer = null;
  }
  function revokeAudio() {
    rootEl('[data-assistente-audio] audio')?.pause();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = '';
  }
  function discardRecording() {
    const recorder = state.recorder; state.recorder = null;
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      if (recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) { /* já parado */ } }
    }
    state.recording = false; state.recordPending = false; stopTracks();
  }
  function cleanup(reset = false) {
    collect(); ++state.generation;
    state.controllers.forEach(controller => controller.abort()); state.controllers.clear();
    discardRecording(); revokeAudio();
    state.metadataCancel?.(); state.metadataCancel = null;
    state.photos.forEach(photo => { if (photo.url) URL.revokeObjectURL(photo.url); photo.url = ''; });
    closeConfirmation(false); closeDetails(false);
    state.root = null; state.busy = ''; state.photoBusy = false; state.consent = false;
    if (reset) {
      state.texto = ''; state.draft = emptyDraft(); state.review = false;
      state.transcricao = ''; state.audio = null; state.photos = [];
      state.pergunta = ''; state.avisos = []; state.success = null; state.requestId = newKey(); state.configured = null;
    }
  }
  function updateButtons() {
    if (!state.root?.isConnected) return;
    const locked = !!state.busy || state.recording || state.recordPending || state.photoBusy;
    state.root.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = locked; });
    const stop = rootEl('[data-assistente-action="stop"]');
    if (stop) stop.disabled = !state.recording;
    const ai = rootEl('[data-assistente-action="organize"]');
    if (ai) {
      ai.disabled = locked || !state.consent || state.configured !== true;
      ai.textContent = state.busy === 'interpret' ? 'Organizando pedido…' : 'Organizar pedido';
    }
    const record = rootEl('[data-assistente-action="record"]');
    if (record) record.textContent = state.recordPending ? 'Aguardando microfone…' : 'Gravar áudio';
    const cancel = rootEl('[data-assistente-action="cancel-interpret"]');
    if (cancel) { cancel.hidden = state.busy !== 'interpret'; cancel.disabled = false; }
    state.root.setAttribute('aria-busy', String(!!state.busy || state.photoBusy));
  }
  function renderAudio() {
    const target = rootEl('[data-assistente-audio]'); if (!target) return;
    revokeAudio(); target.replaceChildren();
    if (!state.audio) return;
    state.audioUrl = URL.createObjectURL(state.audio.blob);
    const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = state.audioUrl;
    const caption = document.createElement('p'); caption.className = 'assistente-muted';
    caption.textContent = `Áudio pronto para ouvir (${(state.audio.blob.size / MiB).toFixed(2)} MiB). Só será enviado à IA ao clicar em Organizar pedido com sua autorização.`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary';
    remove.dataset.assistenteAction = 'remove-audio'; remove.textContent = 'Remover áudio';
    target.append(audio, caption, remove);
  }
  function renderPhotos() {
    const target = rootEl('[data-assistente-photos]'); if (!target) return;
    target.replaceChildren();
    state.photos.forEach((photo, index) => {
      if (!photo.url) photo.url = URL.createObjectURL(photo.blob);
      const figure = document.createElement('figure'); figure.className = 'assistente-photo';
      const image = document.createElement('img'); image.src = photo.url; image.alt = `Foto ${index + 1} anexada ao pedido`;
      const caption = document.createElement('figcaption'); caption.textContent = `Foto ${index + 1}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary';
      remove.dataset.assistenteAction = 'remove-photo'; remove.dataset.index = index; remove.textContent = 'Remover';
      figure.append(image, caption, remove); target.append(figure);
    });
    const count = rootEl('[data-photo-count]');
    if (count) count.textContent = `${state.photos.length}/3 fotos · ${(state.photos.reduce((sum, p) => sum + p.blob.size, 0) / MiB).toFixed(2)} de 2 MiB`;
  }
  function renderReview() {
    const target = rootEl('[data-assistente-review]'); if (!target) return;
    target.hidden = !state.review;
    if (!state.review) return;
    const d = state.draft;
    const field = (key, label, placeholder = '') => `<label>${label}<input data-draft-field="${key}" value="${escape(d[key])}" placeholder="${escape(placeholder)}" ${key === 'categoria' ? 'list="assistenteCategorias"' : ''} required id="assistente_${key}" maxlength="${FIELD_LIMITS[key]}"></label>`;
    target.innerHTML = `<div class="assistente-section-heading"><span class="assistente-step">2</span><div><h3>Revise seu pedido</h3><p class="assistente-muted">Edite o que precisar. Nada é enviado ao ADM antes da sua confirmação.</p></div></div>
      <div class="assistente-question" data-assistente-question role="status"></div>
      <form id="assistenteReviewForm" novalidate>
        <div class="assistente-grid">${field('nome_lista', 'Nome da lista', 'Ex.: Materiais para irrigação')}${field('categoria', 'Categoria', 'Selecione ou escreva')}${field('destino', 'Destino', 'Onde será utilizado?')}${field('uso', 'Uso', 'Para que você precisa?')}</div>
        <datalist id="assistenteCategorias">${categorias().map(v => `<option value="${escape(v)}"></option>`).join('')}</datalist>
        <label>Observações (opcional)<textarea id="assistente_observacoes" data-draft-field="observacoes" maxlength="1500" placeholder="Marca, modelo, tamanho ou outra especificação">${escape(d.observacoes)}</textarea></label>
        <h4>Itens do pedido</h4><div data-assistente-items>${d.itens.map(itemHtml).join('')}</div>
        <button type="button" class="secondary" id="assistenteAdicionarItem" data-assistente-action="add-item">+ Adicionar item</button>
        <div class="assistente-transcription" data-assistente-transcription ${state.transcricao ? '' : 'hidden'}><h4>Descrição / transcrição</h4><p>${escape(state.transcricao)}</p></div>
        <p class="assistente-muted">O pedido entra na fila de cotação do ADM. Este envio não aprova compras e não dá baixa no estoque.</p>
        <div class="assistente-actions"><button id="assistenteRevisarPedido" type="submit" class="primary">Revisar e continuar</button></div>
      </form>`;
    rootEl('#assistenteReviewForm').addEventListener('submit', event => { event.preventDefault(); openConfirmation(); });
    showQuestions(false); updateButtons();
  }
  function itemHtml(item, index) {
    const options = units();
    // Uma unidade desconhecida permanece visível para ser corrigida, não é substituída silenciosamente.
    const unknown = item.unidade && !options.includes(item.unidade) ? `<option value="${escape(item.unidade)}" selected>${escape(item.unidade)} — revise a unidade</option>` : '';
    return `<fieldset class="assistente-item" data-assistente-item="${index}"><legend>Item ${index + 1}</legend>
      <label class="assistente-item-product">Produto<input id="assistenteProduto_${index}" data-item-field="produto" value="${escape(item.produto)}" dir="ltr" maxlength="240" required placeholder="Nome e especificação"></label>
      <div class="assistente-item-values"><label>Quantidade<input id="assistenteQuantidade_${index}" data-item-field="quantidade" type="number" inputmode="decimal" step="any" min="0.000001" max="1000000" value="${escape(item.quantidade)}" required placeholder="Qtd."></label>
      <label>Unidade<select id="assistenteUnidade_${index}" data-item-field="unidade" required><option value="">Selecione…</option>${unknown}${options.map(v => `<option value="${escape(v)}"${item.unidade === v ? ' selected' : ''}>${escape(v)}</option>`).join('')}</select></label></div>
      <button type="button" class="secondary assistente-remove-item" data-assistente-action="remove-item" data-index="${index}" aria-label="Remover item ${index + 1}">Remover item</button></fieldset>`;
  }
  function missingFields(mark = false) {
    const missing = []; const draft = payloadDraft();
    if (mark) state.root?.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    const check = (condition, label, selector) => {
      if (!condition) { missing.push(label); if (mark) rootEl(selector)?.setAttribute('aria-invalid', 'true'); }
    };
    for (const [field, label] of [['nome_lista', 'nome da lista'], ['categoria', 'categoria'], ['destino', 'destino'], ['uso', 'uso']]) check(!!draft[field], label, `[data-draft-field="${field}"]`);
    if (!draft.itens.length) missing.push('pelo menos um item');
    draft.itens.forEach((item, i) => {
      const prefix = `[data-assistente-item="${i}"]`;
      check(!!item.produto, `produto do item ${i + 1}`, `${prefix} [data-item-field="produto"]`);
      check(Number.isFinite(item.quantidade) && item.quantidade > 0 && item.quantidade <= 1000000, `quantidade do item ${i + 1}`, `${prefix} [data-item-field="quantidade"]`);
      check(units().includes(item.unidade), `unidade do item ${i + 1}`, `${prefix} [data-item-field="unidade"]`);
    });
    return missing;
  }
  function showQuestions(mark = true) {
    const target = rootEl('[data-assistente-question]'); if (!target) return;
    const missing = missingFields(mark);
    const parts = [state.pergunta, ...state.avisos];
    if (missing.length) parts.push(`Para completar o pedido, informe: ${missing.join(', ')}. Não vamos adivinhar essas informações.`);
    target.textContent = parts.filter(Boolean).join('\n'); target.hidden = !target.textContent;
  }
  function prepareManual() {
    if (state.busy || state.recording || state.recordPending || state.photoBusy) return;
    collect();
    if (!state.review) { state.review = true; state.transcricao = state.texto.trim(); }
    state.pergunta = ''; state.avisos = [];
    renderReview(); showQuestions(true);
    message(state.audio ? 'Você escolheu preencher sem IA. O áudio não será enviado nem transcrito. Escreva as informações nos campos do pedido.' : 'Preencha e revise os campos abaixo. Este caminho não envia nada à IA.');
    rootEl('[data-assistente-review]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(blob);
    });
  }
  async function organize() {
    collect();
    if (state.busy || state.photoBusy || state.recording || state.recordPending) return;
    if (!state.consent) return message('Marque a autorização para usar a IA, ou escolha preencher sem IA.', true);
    if (state.configured !== true) return message('A organização automática não está disponível agora. Você pode preencher sem IA.', true);
    if (!state.texto.trim() && !state.audio) return message('Descreva o que precisa por texto ou adicione um áudio.', true);
    const generation = state.generation;
    state.busy = 'interpret'; message('Organizando seu pedido. As fotos não serão enviadas à IA.'); updateButtons();
    try {
      const payload = { texto: state.texto.trim(), consentimento_ia: true };
      if (state.review) payload.rascunho = payloadDraft();
      if (state.audio) payload.audio = { base64: await toBase64(state.audio.blob), mime_type: state.audio.mime };
      if (!current(generation)) return;
      const response = await request('/interpretar', payload, generation);
      if (!response || !current(generation)) return;
      if (!response.rascunho || typeof response.rascunho !== 'object') throw new Error('Resposta incompleta');
      state.draft = normalizeDraft(response.rascunho); state.review = true;
      if (typeof response.transcricao === 'string') state.transcricao = response.transcricao || state.transcricao || state.texto.trim();
      state.pergunta = typeof response.pergunta === 'string' ? response.pergunta : '';
      state.avisos = Array.isArray(response.avisos) ? response.avisos.filter(v => typeof v === 'string') : [];
      renderReview(); showQuestions(true); message('Pedido organizado. Confira os campos e complete as informações em destaque.');
      rootEl('[data-assistente-review]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (current(generation)) message(responseError(error, 'Não foi possível organizar o pedido agora. Seu rascunho foi mantido. Tente novamente ou preencha sem IA.'), true);
    } finally { if (current(generation)) { state.busy = ''; updateButtons(); } }
  }
  function cancelInterpret() {
    if (state.busy !== 'interpret') return;
    ++state.generation; state.controllers.forEach(c => c.abort()); state.controllers.clear();
    state.busy = ''; updateButtons(); message('Organização cancelada. O texto e o rascunho foram mantidos.');
  }
  async function startRecording() {
    if (state.busy || state.photoBusy || state.recording || state.recordPending) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return message('Este navegador não permite gravar aqui. Você pode escrever ou escolher um arquivo de áudio.', true);
    const generation = state.generation; state.recordPending = true; updateButtons();
    try {
      // Solicitar acesso ao microfone somente em resposta ao clique explícito.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current(generation)) { stream.getTracks().forEach(track => track.stop()); return; }
      state.stream = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const type = audioType(recorder.mimeType || mime);
      if (!AUDIO_TYPES.includes(type)) throw new Error('Formato não suportado');
      state.recorder = recorder; state.recordPending = false; state.recording = true;
      const chunks = []; let size = 0; let exceeded = false;
      recorder.ondataavailable = event => {
        if (!current(generation) || !event.data.size) return;
        size += event.data.size;
        if (size > MAX_AUDIO) { exceeded = true; chunks.length = 0; stopRecording(); }
        else if (!exceeded) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (state.recorder === recorder) { state.recorder = null; state.recording = false; stopTracks(); }
        if (!current(generation)) return;
        const blob = new Blob(chunks, { type });
        if (exceeded || blob.size > MAX_AUDIO) message('O áudio ultrapassou 3 MiB e não foi mantido. Grave um trecho menor ou escreva seu pedido.', true);
        else if (!blob.size) message('Nenhum áudio foi capturado. Tente novamente ou use texto.', true);
        else { revokeAudio(); state.audio = { blob, mime: type }; renderAudio(); message('Gravação concluída. Ouça antes de organizar o pedido.'); }
        const clock = rootEl('[data-record-time]'); if (clock) clock.textContent = '';
        updateButtons();
      };
      recorder.onerror = () => { if (current(generation)) { discardRecording(); updateButtons(); message('A gravação foi interrompida. Você pode tentar novamente ou usar texto.', true); } };
      recorder.start(500); state.recordStarted = Date.now();
      message('Gravando… Toque em Parar gravação quando terminar. Limite: 90 segundos ou 3 MiB.'); updateButtons();
      state.timer = setInterval(() => {
        if (!current(generation)) return discardRecording();
        const seconds = Math.floor((Date.now() - state.recordStarted) / 1000);
        const clock = rootEl('[data-record-time]'); if (clock) clock.textContent = `${seconds}s / 90s`;
        if (seconds >= 90) stopRecording();
      }, 250);
    } catch (_) {
      if (current(generation)) { discardRecording(); updateButtons(); message('Não foi possível acessar o microfone. Permita o acesso se quiser gravar, escolha um arquivo de áudio ou continue por texto.', true); }
    }
  }
  function stopRecording() {
    clearInterval(state.timer); state.timer = null;
    if (state.recorder?.state === 'recording') { try { state.recorder.stop(); } catch (_) { discardRecording(); } }
    state.stream?.getTracks().forEach(track => track.stop());
  }
  async function uploadAudio(file) {
    if (!file || state.busy || state.photoBusy || state.recording || state.recordPending) return;
    if (file.size > MAX_AUDIO) return message('O arquivo de áudio deve ter no máximo 3 MiB. Escolha um arquivo menor ou escreva seu pedido.', true);
    if (!file.size) return message('O arquivo de áudio está vazio.', true);
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const byExtension = { m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm' };
    const mime = AUDIO_TYPES.includes(audioType(file.type)) ? audioType(file.type) : (!file.type || ['application/octet-stream', 'video/mp4', 'video/webm'].includes(file.type)) ? byExtension[extension] : '';
    if (!mime || !Object.hasOwn(byExtension, extension)) return message('Escolha um áudio M4A, MP3, WAV, OGG ou WEBM.', true);
    const generation = state.generation; state.busy = 'audio-check'; updateButtons();
    const url = URL.createObjectURL(file); const audio = document.createElement('audio'); audio.preload = 'metadata';
    try {
      const duration = await new Promise(resolve => {
        const timeout = setTimeout(() => finish(null), 5000);
        const finish = value => { clearTimeout(timeout); state.metadataCancel = null; audio.onloadedmetadata = null; audio.onerror = null; resolve(value); };
        state.metadataCancel = () => finish(null);
        audio.onloadedmetadata = () => finish(audio.duration); audio.onerror = () => finish(null); audio.src = url;
      });
      if (!current(generation)) return;
      if (Number.isFinite(duration) && duration > 90.5) return message('Este áudio tem mais de 90 segundos. Escolha um trecho menor ou use texto.', true);
      revokeAudio(); state.audio = { blob: file, mime }; renderAudio();
      message(Number.isFinite(duration) ? 'Áudio escolhido. Ouça antes de organizar seu pedido.' : 'Áudio escolhido. Não foi possível conferir a duração neste navegador; use um trecho de até 90 segundos.');
    } finally {
      audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
      if (current(generation)) { state.busy = ''; updateButtons(); }
    }
  }
  async function decodePhoto(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* Safari/formatos sem suporte: usar img */ }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Formato de foto não suportado'));
        // Navegadores atuais aplicam a orientação EXIF também ao decodificar via img.
        image.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }
  async function compressPhoto(file) {
    let source;
    try { source = await decodePhoto(file); }
    catch (_) { throw new Error('Não foi possível abrir esta foto. Se ela for HEIC/HEIF do iPhone, escolha “Mais Compatível” na câmera ou converta para JPEG e tente novamente.'); }
    try {
      const width = source.width || source.naturalWidth; const height = source.height || source.naturalHeight;
      if (!width || !height) throw new Error('A foto não pôde ser lida. Escolha uma foto JPEG ou PNG.');
      const scale = Math.min(1, 1600 / width, 1600 / height);
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível preparar a foto. Tente outra imagem.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
      let blob;
      for (const quality of [0.85, 0.72, 0.6, 0.45, 0.3]) {
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_PHOTO) break;
      }
      canvas.width = 0; canvas.height = 0;
      if (!blob || blob.size > MAX_PHOTO) throw new Error('A foto ainda ultrapassa 1 MiB. Escolha uma imagem menor.');
      return blob;
    } finally { source.close?.(); }
  }
  async function uploadPhotos(files) {
    if (state.busy || state.photoBusy || state.recording || state.recordPending || !files.length) return;
    const generation = state.generation; state.photoBusy = true; updateButtons(); message('Preparando as fotos no seu aparelho…');
    const warnings = [];
    try {
      for (const file of files) {
        if (!current(generation)) return;
        if (state.photos.length >= 3) { warnings.push('O pedido aceita até 3 fotos.'); break; }
        // Evitar imagens enormes que podem esgotar a memória de celulares.
        if (file.size > 25 * MiB) { warnings.push('Uma foto é muito grande para preparar neste aparelho. Escolha uma menor.'); continue; }
        if (!/^image\//i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) { warnings.push('Escolha um arquivo de imagem.'); continue; }
        try {
          const blob = await compressPhoto(file);
          if (!current(generation)) return;
          if (state.photos.reduce((sum, p) => sum + p.blob.size, 0) + blob.size > MAX_PHOTOS_TOTAL) { warnings.push('As fotos juntas devem ter até 2 MiB. Remova uma foto ou escolha outra menor.'); continue; }
          state.photos.push({ blob, url: '' });
        } catch (error) { warnings.push(error.message); }
      }
      if (current(generation)) { renderPhotos(); message(warnings.length ? warnings.join(' ') : 'Fotos preparadas. Elas só serão enviadas junto do pedido confirmado, nunca à IA.', !!warnings.length); }
    } finally { if (current(generation)) { state.photoBusy = false; updateButtons(); } }
  }
  function focusDialog(modal) {
    modal.querySelector('button')?.focus();
  }
  function closeConfirmation(restore = true) {
    const modal = document.getElementById('modalAssistenteConfirmacao');
    modal?.classList.add('hidden'); modal?.setAttribute('aria-hidden', 'true');
    document.getElementById('assistenteConfirmacaoResumo')?.replaceChildren();
    if (restore && confirmOpener?.isConnected) confirmOpener.focus(); confirmOpener = null;
  }
  function openConfirmation() {
    if (state.busy || state.photoBusy || state.recording || state.recordPending) return;
    collect(); showQuestions(true);
    if (missingFields().length) { message('Complete as informações em destaque antes de enviar.', true); rootEl('[aria-invalid="true"]')?.focus(); return; }
    const form = rootEl('#assistenteReviewForm');
    if (form && !form.reportValidity()) return;
    const modal = document.getElementById('modalAssistenteConfirmacao'); const target = document.getElementById('assistenteConfirmacaoResumo');
    if (!modal || !target) return;
    const d = payloadDraft(); confirmOpener = document.activeElement;
    target.innerHTML = `<dl class="assistente-summary"><div><dt>Lista</dt><dd>${escape(d.nome_lista)}</dd></div><div><dt>Categoria</dt><dd>${escape(d.categoria)}</dd></div><div><dt>Destino</dt><dd>${escape(d.destino)}</dd></div><div><dt>Uso</dt><dd>${escape(d.uso)}</dd></div>${d.observacoes ? `<div><dt>Observações</dt><dd>${escape(d.observacoes)}</dd></div>` : ''}</dl><h4>Itens</h4><ul class="assistente-summary-items">${d.itens.map(item => `<li><b>${escape(item.produto)}</b><span>${escape(item.quantidade)} ${escape(item.unidade)}</span></li>`).join('')}</ul>${state.transcricao ? `<h4>Descrição / transcrição</h4><p class="assistente-prewrap">${escape(state.transcricao)}</p>` : ''}<p><b>${state.photos.length} foto(s) anexada(s).</b> Fotos ficam somente no pedido.</p><p class="assistente-muted">Será enviada uma lista para cotação do ADM. Não é uma compra aprovada nem uma entrega de estoque.</p>`;
    document.getElementById('assistenteConfirmacaoErro').textContent = '';
    modal.querySelectorAll('button').forEach(button => { button.disabled = false; });
    document.getElementById('assistenteConfirmarEnvio').textContent = 'Confirmar e enviar ao ADM';
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); focusDialog(modal);
  }
  async function confirmSend() {
    const modal = document.getElementById('modalAssistenteConfirmacao');
    if (state.busy || !current(state.generation) || modal?.classList.contains('hidden')) return;
    collect(); if (missingFields(true).length) { closeConfirmation(); showQuestions(true); return; }
    const generation = state.generation; state.busy = 'confirm';
    modal.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const button = document.getElementById('assistenteConfirmarEnvio'); button.textContent = 'Enviando pedido…'; updateButtons();
    try {
      const fotos = await Promise.all(state.photos.map(async photo => ({ base64: await toBase64(photo.blob), mime_type: 'image/jpeg' })));
      if (!current(generation)) return;
      const payload = { request_id: state.requestId, rascunho: payloadDraft(), transcricao: state.transcricao, fotos };
      const response = await request('/confirmar', payload, generation);
      if (!response || !current(generation)) return;
      const id = response.compra_id ?? response.id;
      if (id === undefined || id === null || id === '') throw new Error('Resposta sem identificador');
      closeConfirmation(false); revokeAudio();
      state.photos.forEach(photo => { if (photo.url) URL.revokeObjectURL(photo.url); });
      state.success = { id: String(id) }; state.requestId = newKey();
      state.audio = null; state.photos = []; state.transcricao = ''; state.texto = ''; state.consent = false;
      state.draft = emptyDraft(); state.review = false; state.pergunta = ''; state.avisos = []; state.busy = '';
      renderSuccess();
    } catch (error) {
      if (current(generation)) document.getElementById('assistenteConfirmacaoErro').textContent = responseError(error, 'Não foi possível confirmar o envio. Seu pedido foi mantido. Tente novamente; a mesma solicitação não será enviada duas vezes.');
    } finally {
      if (current(generation)) {
        state.busy = ''; updateButtons(); modal.querySelectorAll('button').forEach(btn => { btn.disabled = false; });
        button.textContent = 'Confirmar e enviar ao ADM';
      }
    }
  }
  function renderSuccess() {
    if (!state.root?.isConnected || !state.success) return;
    state.root.innerHTML = `<section class="panel assistente-success" role="status"><span class="assistente-success-mark" aria-hidden="true">✓</span><h3>Pedido enviado ao ADM</h3><p class="assistente-order-id">Pedido #${escape(state.success.id)}</p><p>Seu pedido entrou na fila de cotação. Aguarde a análise do ADM.</p><p class="assistente-muted">Não há aprovação de compra nem baixa de estoque neste envio.</p><div class="assistente-actions"><button type="button" class="primary" id="assistenteIrCompras" data-assistente-action="compras">Ir para Compras</button><button type="button" class="secondary" id="assistenteNovoPedido" data-assistente-action="new">Fazer outro pedido</button></div></section>`;
  }
  async function mount() {
    if (state.root?.isConnected && tela === 'assistente') { collect(); return; }
    const generation = ++state.generation;
    state.root = document.createElement('div'); state.root.className = 'assistente-page';
    content.replaceChildren(state.root);
    state.root.addEventListener('click', onClick);
    state.root.addEventListener('input', () => { collect(); if (state.review) showQuestions(false); updateButtons(); });
    state.root.addEventListener('change', event => {
      collect();
      if (event.target.id === 'assistenteAudioArquivo') { const file = event.target.files[0]; event.target.value = ''; uploadAudio(file); }
      if (event.target.id === 'assistenteFotosArquivo') { const files = [...event.target.files]; event.target.value = ''; uploadPhotos(files); }
      updateButtons();
    });
    if (state.success) { renderSuccess(); return; }
    state.root.innerHTML = `<section class="panel assistente-intro"><div class="assistente-section-heading"><span class="assistente-step">1</span><div><h3>Descreva o que você precisa</h3><p class="assistente-muted">Escreva ou grave um áudio. Depois, revise os itens e envie o pedido ao ADM.</p></div></div>
      <p class="assistente-muted">Responsável pelo envio: <b>${escape(usuario?.nome || usuario?.username || usuario?.user || 'Conta logada')}</b>. Em uma conta compartilhada, esta identificação é da conta, não de uma pessoa citada no áudio.</p>
      <label for="assistenteTexto">Seu pedido ou correção<textarea id="assistenteTexto" rows="5" maxlength="6000" placeholder="Ex.: Preciso de 2 pares de luvas para a equipe da estufa. Tamanho M, para poda.">${escape(state.texto)}</textarea></label>
      <div class="assistente-actions"><button type="button" class="secondary" id="assistenteGravarAudio" data-assistente-action="record">Gravar áudio</button><button type="button" class="secondary" id="assistentePararAudio" data-assistente-action="stop" disabled>Parar gravação</button><span class="assistente-muted" data-record-time aria-live="off"></span></div>
      <p class="assistente-muted">Até 90 segundos e 3 MiB. O áudio não é enviado automaticamente. Você também pode continuar só por texto.</p><div data-assistente-audio></div>
      <details class="assistente-upload"><summary>Já tem um áudio? Escolher arquivo (opcional)</summary><label>Arquivo de áudio<input id="assistenteAudioArquivo" type="file" accept=".m4a,.mp3,.wav,.ogg,.webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg,audio/webm"></label></details>
      <div class="assistente-status" data-assistente-status role="status">Verificando a organização automática…</div>
      <label class="assistente-consent"><input id="assistenteConsentimento" type="checkbox"${state.consent ? ' checked' : ''}><span>Autorizar envio deste texto/áudio ao serviço de IA para montar o pedido. Fotos só ficam no pedido.</span></label>
      <div class="assistente-actions"><button type="button" class="primary" id="assistenteOrganizarPedido" data-assistente-action="organize" disabled>Organizar pedido</button><button type="button" class="secondary" id="assistentePreencherManual" data-assistente-action="manual">Preencher sem IA</button><button type="button" class="secondary" id="assistenteCancelarOrganizacao" data-assistente-action="cancel-interpret" hidden>Cancelar organização</button></div>
      <p class="assistente-message" data-assistente-message role="status" hidden></p></section>
      <section class="panel assistente-photo-panel"><h3>Fotos de referência <small>(opcional)</small></h3><p class="assistente-muted">Até 3 fotos. Preparadas no aparelho em JPEG, até 1600 × 1600, 1 MiB por foto e 2 MiB no total. Só são enviadas quando você confirma o pedido.</p><label>Adicionar fotos<input id="assistenteFotosArquivo" type="file" accept="image/*,.heic,.heif" multiple></label><p class="assistente-muted" data-photo-count></p><div class="assistente-photos" data-assistente-photos></div></section>
      <section class="panel assistente-review" data-assistente-review hidden></section>
      <div class="assistente-actions assistente-bottom"><button type="button" class="secondary" id="assistenteLimparPedido" data-assistente-action="clear">Limpar pedido</button><p class="assistente-muted">Rascunho só nesta sessão. Nada é salvo neste aparelho.</p></div>`;
    renderAudio(); renderPhotos(); renderReview(); updateButtons();
    try {
      const response = await request('/status', undefined, generation); if (!response || !current(generation)) return;
      state.configured = response.configurado === true;
      rootEl('[data-assistente-status]').textContent = state.configured ? 'Organização automática disponível. A autorização abaixo vale somente para usar a IA.' : 'A organização automática ainda não está disponível. Você pode montar e enviar o pedido normalmente em Preencher sem IA.';
    } catch (_) {
      if (current(generation)) { state.configured = null; rootEl('[data-assistente-status]').textContent = 'Não foi possível verificar a organização automática agora. Você pode preencher sem IA e enviar o pedido.'; }
    } finally { if (current(generation)) updateButtons(); }
  }
  function onClick(event) {
    const button = event.target.closest('[data-assistente-action]'); if (!button || !state.root?.contains(button) || button.disabled) return;
    const action = button.dataset.assistenteAction;
    if (action === 'cancel-interpret') return cancelInterpret();
    if (action === 'compras') return trocarTela('compras');
    if (action === 'new') { cleanup(true); return mount(); }
    if (action === 'stop') return stopRecording();
    if (state.busy || state.photoBusy || state.recording || state.recordPending) return;
    if (action === 'record') return startRecording();
    if (action === 'organize') return organize();
    if (action === 'manual') return prepareManual();
    if (action === 'remove-audio') { revokeAudio(); state.audio = null; renderAudio(); return message('Áudio removido.'); }
    if (action === 'remove-photo') { const photo = state.photos[Number(button.dataset.index)]; if (photo?.url) URL.revokeObjectURL(photo.url); state.photos.splice(Number(button.dataset.index), 1); return renderPhotos(); }
    if (action === 'add-item') { collect(); if (state.draft.itens.length >= 30) return message('Cada pedido aceita até 30 itens. Divida uma lista maior em mais de um pedido.', true); state.draft.itens.push(blankItem()); renderReview(); rootEl(`[data-assistente-item="${state.draft.itens.length - 1}"] input`)?.focus(); return; }
    if (action === 'remove-item') { collect(); state.draft.itens.splice(Number(button.dataset.index), 1); if (!state.draft.itens.length) state.draft.itens.push(blankItem()); return renderReview(); }
    if (action === 'clear' && window.confirm('Limpar texto, áudio, fotos e todos os campos deste pedido?')) { cleanup(true); return mount(); }
  }
  function closeDetails(restore = true) {
    ++details.generation; details.controller?.abort(); details.controller = null;
    details.urls.forEach(url => URL.revokeObjectURL(url)); details.urls.clear();
    const modal = document.getElementById('modalAssistentePedido'); modal?.classList.add('hidden'); modal?.setAttribute('aria-hidden', 'true');
    document.getElementById('assistentePedidoConteudo')?.replaceChildren();
    if (restore && details.opener?.isConnected) details.opener.focus(); details.opener = null;
  }
  async function openDetails(id) {
    if (!Number.isFinite(Number(id)) || Number(id) <= 0) return;
    closeDetails(false); fecharDetalhesPedidoWhatsApp();
    const modal = document.getElementById('modalAssistentePedido'); const target = document.getElementById('assistentePedidoConteudo'); if (!modal || !target) return;
    details.opener = document.activeElement; const generation = details.generation; const controller = new AbortController(); details.controller = controller;
    const alive = () => generation === details.generation && !controller.signal.aborted && !modal.classList.contains('hidden');
    target.textContent = 'Carregando descrição e fotos protegidas…'; modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); focusDialog(modal);
    try {
      const data = await js(API + `/assistente/compras/${encodeURIComponent(String(id))}`, { signal: controller.signal });
      if (!alive()) return;
      if (data?.origem !== 'assistente') throw new Error('Origem inválida');
      target.replaceChildren();
      const person = document.createElement('p'); person.textContent = `Solicitante: ${String(data.solicitante || 'Não informado')}`;
      const finalHeading = document.createElement('h4'); finalHeading.textContent = 'Itens do pedido';
      const finalItems = document.createElement('ul'); finalItems.className = 'assistente-summary-items';
      for (const item of Array.isArray(data.itens) ? data.itens : []) {
        const line = document.createElement('li');
        const product = document.createElement('b'); product.textContent = String(item.produto || 'Produto'); product.dir = 'ltr';
        const amount = document.createElement('span'); amount.textContent = `${item.quantidade ?? ''} ${item.unidade || ''}`.trim();
        line.append(product, amount); finalItems.append(line);
      }
      const heading = document.createElement('h4'); heading.textContent = 'Texto / transcrição original';
      const text = document.createElement('p'); text.className = 'assistente-prewrap'; text.textContent = String(data.transcricao || 'Sem transcrição. Consulte os itens do pedido.');
      const photoHeading = document.createElement('h4'); photoHeading.textContent = 'Fotos do pedido';
      const photos = document.createElement('div'); photos.className = 'assistente-detail-photos'; target.append(person);
      if (finalItems.childElementCount) target.append(finalHeading, finalItems);
      target.append(heading, text, photoHeading, photos);
      const entries = Array.isArray(data.fotos) ? data.fotos.slice(0, 3) : [];
      if (!entries.length) { const empty = document.createElement('p'); empty.textContent = 'Nenhuma foto anexada.'; photos.append(empty); }
      await Promise.all(entries.map(async (photo, index) => {
        const holder = document.createElement('div'); holder.className = 'assistente-detail-photo'; holder.textContent = 'Carregando foto…'; photos.append(holder);
        try {
          if (!photo.id || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime_type)) throw new Error('Foto inválida');
          const response = await fetch(API + `/assistente/midias/${encodeURIComponent(String(photo.id))}`, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!response.ok) throw new Error('Foto indisponível');
          const blob = await response.blob(); if (!alive()) return;
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(audioType(blob.type))) throw new Error('Formato inválido');
          const url = URL.createObjectURL(blob); details.urls.add(url);
          const image = document.createElement('img'); image.src = url; image.alt = `Foto ${index + 1} do pedido`; image.loading = 'lazy';
          const link = document.createElement('button'); link.type = 'button'; link.className = 'assistente-image-button'; link.setAttribute('aria-label', `Ampliar foto ${index + 1}`);
          link.append(image); link.addEventListener('click', () => { holder.classList.toggle('assistente-photo-expanded'); }); holder.replaceChildren(link);
        } catch (_) { if (alive()) holder.textContent = 'Não foi possível carregar esta foto.'; }
      }));
    } catch (_) { if (alive()) target.textContent = 'Não foi possível carregar os detalhes protegidos deste pedido. Feche e tente novamente.'; }
  }
  function init() {
    document.getElementById('assistenteConfirmarEnvio')?.addEventListener('click', confirmSend);
    document.querySelectorAll('[data-assistente-close="confirm"]').forEach(button => button.addEventListener('click', () => { if (state.busy !== 'confirm') closeConfirmation(); }));
    document.querySelectorAll('[data-assistente-close="details"]').forEach(button => button.addEventListener('click', () => closeDetails()));
    document.getElementById('modalAssistenteConfirmacao')?.addEventListener('click', event => { if (event.target.id === 'modalAssistenteConfirmacao' && state.busy !== 'confirm') closeConfirmation(); });
    document.getElementById('modalAssistentePedido')?.addEventListener('click', event => { if (event.target.id === 'modalAssistentePedido') closeDetails(); });
    document.addEventListener('click', event => { const button = event.target.closest('[data-assistente-compra-id]'); if (button) openDetails(button.dataset.assistenteCompraId); });
    document.addEventListener('keydown', event => {
      const confirm = document.getElementById('modalAssistenteConfirmacao'); const detail = document.getElementById('modalAssistentePedido');
      const modal = !confirm?.classList.contains('hidden') ? confirm : !detail?.classList.contains('hidden') ? detail : null;
      if (!modal) return;
      if (event.key === 'Escape') { event.preventDefault(); if (modal === detail) closeDetails(); else if (state.busy !== 'confirm') closeConfirmation(); }
      if (event.key === 'Tab') {
        const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = controls[0]; const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('pagehide', () => cleanup(true));
  }
  window.assistente = mount;
  window.cleanupAssistente = cleanup;
  window.abrirDetalhesAssistente = openDetails;
  window.fecharDetalhesAssistente = closeDetails;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
