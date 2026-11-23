/* Perguntas guiadas: confirmação humana por campo, sem salvamento automático. */
(() => {
  'use strict';
  window.criarAssistenteGuiado = function createGuided({ state, rootEl, collect, escape, explicitPerson, units, blankItem, updateButtons, renderReview, renderAudio, revokeAudio, message, focusPhoto, toBase64, request, current, waitForPoll, cancelProcessing, newKey }) {
    const guide = { active: false, step: 0, item: 0, answer: '', transcript: '', log: [], stage: 'question' };
    const fields = ['nome_pessoa', 'destino', 'produto', 'quantidade', 'unidade'];
    const label = { nome_pessoa: 'Nome da pessoa', destino: 'Destino', produto: 'Produto', quantidade: 'Quantidade', unidade: 'Unidade' };
    function target() {
      const field = fields[guide.step];
      return { campo: field, ...(['produto','quantidade','unidade'].includes(field) ? { indice_item: guide.item } : {}) };
    }
    function value() {
      const field = fields[guide.step];
      return String(guide.step < 2 ? state.draft[field] || '' : state.draft.itens[guide.item]?.[field] ?? '');
    }
    function valid() {
      const a = guide.answer.trim(); const field = fields[guide.step];
      if (field === 'nome_pessoa') return explicitPerson(a);
      if (field === 'quantidade') return /^\d+(?:[.,]\d+)?$/.test(a) && Number(a.replace(',', '.')) > 0 && Number(a.replace(',', '.')) <= 1000000 && Math.fround(Number(a.replace(',', '.'))) !== 0;
      if (field === 'unidade') return units().includes(a);
      return !!a && a.length <= 240;
    }
    function question() {
      return ['Qual é o nome de quem está pedindo?', 'Para onde o material vai?', `Qual é o produto do item ${guide.item + 1}?`, `Qual é a quantidade do item ${guide.item + 1}?`, `Qual é a unidade de medida do item ${guide.item + 1}?`][guide.step];
    }
    function instruction() {
      return ['Fale só o nome, por exemplo: “José da Oficina”. Não use “Operador” ou “Administrador”.', 'Fale o local, por exemplo: “Estufa 2” ou “Oficina”.', 'Fale o nome e, se necessário, o tamanho ou modelo: “Luva de proteção tamanho M”.', 'Fale somente a quantidade: “dois” ou “dois e meio”. Não vamos adivinhar.', 'Fale a unidade, por exemplo: “pares”, “litros”, “quilos” ou “unidades”.'][guide.step];
    }
    function clearAudio() {
      revokeAudio(); state.audio = null; renderAudio();
      const input = rootEl('#assistenteTexto'); if (input) input.value = ''; state.texto = '';
    }
    function loadAnswer() { guide.answer = value(); guide.transcript = ''; clearAudio(); }
    function collectGuide() {
      const input = rootEl('#assistenteRespostaGuiada'); if (input) guide.answer = input.value;
    }
    function syncButtons() {
      const next = rootEl('[data-assistente-action="guide-next"]');
      if (next) next.disabled = !!state.busy || state.photoBusy || state.recording || state.recordPending || !valid();
    }
    function render() {
      const panel = rootEl('[data-assistente-guide]'); if (!panel) return;
      panel.hidden = !guide.active;
      rootEl('#assistenteTexto')?.closest('label')?.toggleAttribute('hidden', guide.active);
      const manual = rootEl('#assistentePreencherManual'); if (manual) manual.textContent = guide.active ? 'Abrir formulário completo' : 'Preencher sem IA';
      const organize = rootEl('#assistenteOrganizarPedido'); if (organize && !state.busy) organize.textContent = guide.active && guide.stage === 'question' ? 'Transcrever resposta deste áudio' : 'Organizar pedido';
      if (!guide.active) return;
      if (guide.stage === 'items') {
        panel.innerHTML = `<p class="assistente-guide-progress">Item ${guide.item + 1} confirmado</p><h3>Quer pedir mais algum produto?</h3><p class="assistente-muted">Os itens já respondidos continuam no rascunho. Nada foi enviado ao ADM.</p><div class="assistente-actions"><button type="button" class="primary" data-assistente-action="guide-add">Adicionar outro item</button><button type="button" class="secondary" data-assistente-action="guide-photo">Ir para a foto e revisão</button><button type="button" class="secondary" data-assistente-action="guide-back">Corrigir unidade</button></div>`;
      } else if (guide.stage === 'photo') {
        panel.innerHTML = `<p class="assistente-guide-progress">Última etapa · foto e conferência</p><h3>Anexe a foto e confira o pedido</h3><p class="assistente-muted">Pelo menos uma foto por pedido. Depois você verá todos os campos e o resumo antes de confirmar o envio ao ADM.</p><div class="assistente-actions"><button type="button" class="secondary" data-assistente-action="focus-photo">Anexar foto</button><button type="button" class="primary" data-assistente-action="guide-review">Conferir todos os campos</button><button type="button" class="secondary" data-assistente-action="guide-back">Voltar aos itens</button></div>`;
      } else {
        const field = fields[guide.step];
        const control = field === 'unidade'
          ? `<select id="assistenteRespostaGuiada"><option value="">Selecione…</option>${units().map(u => `<option value="${escape(u)}"${guide.answer === u ? ' selected' : ''}>${escape(u)}</option>`).join('')}</select>`
          : `<input id="assistenteRespostaGuiada" value="${escape(guide.answer)}" maxlength="240" ${field === 'quantidade' ? 'inputmode="decimal"' : ''} autocomplete="off" dir="ltr">`;
        panel.innerHTML = `<p class="assistente-guide-progress">Uma pergunta por vez · ${guide.step < 2 ? `Etapa ${guide.step + 1}` : `Item ${guide.item + 1}, ${guide.step - 1} de 3`}</p><h3>${question()}</h3><p class="assistente-muted">${instruction()} Você pode digitar abaixo sem usar IA ou gravar um áudio pelos botões logo abaixo.</p><label for="assistenteRespostaGuiada">Resposta para conferir${control}</label>${guide.transcript ? `<p class="assistente-muted assistente-prewrap">O áudio foi entendido como: “${escape(guide.transcript)}”. Confira ou corrija a resposta antes de continuar.</p>` : ''}<p class="assistente-muted">A IA não avança sozinha. Confirme esta resposta para ir à próxima pergunta.</p><div class="assistente-actions"><button type="button" class="primary" id="assistenteConfirmarResposta" data-assistente-action="guide-next">Confirmar resposta e continuar</button><button type="button" class="secondary" data-assistente-action="guide-back" ${guide.step === 0 ? 'hidden' : ''}>Voltar e corrigir</button></div>`;
      }
      syncButtons();
    }
    function activate() {
      collect(); guide.active = true; guide.stage = 'question'; guide.step = 0; guide.item = 0;
      state.review = false; renderReview();
      if (!state.draft.itens.length) state.draft.itens = [blankItem()];
      loadAnswer(); render(); updateButtons(); syncButtons();
      rootEl('[data-assistente-guide]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      message('Responda uma pergunta por vez. Você sempre confere a resposta antes de avançar. Nada será enviado ao ADM antes da confirmação final.');
    }
    function next() {
      collectGuide(); if (!valid()) { syncButtons(); return message('Confira a resposta desta pergunta. Nome, quantidade e unidade precisam ser válidos.', true); }
      const t = target(); const answer = guide.answer.trim();
      if (guide.step < 2) state.draft[t.campo] = answer;
      else state.draft.itens[guide.item][t.campo] = t.campo === 'quantidade' ? Number(answer.replace(',', '.')) : answer;
      if (guide.transcript) {
        const tag = `${label[t.campo]}${guide.step > 1 ? ` do item ${guide.item + 1}` : ''}`;
        const log = guide.log.filter(entry => entry.tag !== tag).concat({ tag, text: guide.transcript });
        if (log.map(entry => `${entry.tag}: ${entry.text}`).join('\n').length > 6000) return message('As transcrições juntas ultrapassam o limite. Use respostas menores ou abra o formulário completo; nada foi cortado.', true);
        guide.log = log;
      }
      if (guide.step === 4) { guide.stage = 'items'; clearAudio(); }
      else { guide.step++; loadAnswer(); }
      render(); updateButtons(); syncButtons(); message('Resposta confirmada. Continue para completar o rascunho.');
      rootEl('[data-assistente-guide]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function back() {
      if (guide.stage === 'photo') guide.stage = 'items';
      else if (guide.stage === 'items') { guide.stage = 'question'; guide.step = 4; loadAnswer(); }
      else if (guide.step > 0) { guide.step--; loadAnswer(); }
      render(); updateButtons(); syncButtons();
    }
    function review() {
      guide.active = false; state.review = true;
      if (guide.log.length) state.transcricao = guide.log.map(entry => `${entry.tag}: ${entry.text}`).join('\n');
      clearAudio(); render(); renderReview(); updateButtons();
      message('Rascunho pronto para sua conferência, ainda não enviado. Corrija o que precisar e use Revisar e continuar.');
      rootEl('[data-assistente-review]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    async function transcribe() {
      collectGuide(); if (guide.stage !== 'question') return message('Esta etapa não precisa de áudio. Use os botões da pergunta.', true);
      if (!state.consent) return message('Autorize o envio do áudio à IA ou digite sua resposta.', true);
      if (state.configured !== true) return message('A transcrição não está disponível agora. Digite a resposta para continuar.', true);
      if (!state.audio) return message('Grave ou escolha o áudio desta resposta. Para digitação, use Confirmar resposta e continuar.', true);
      const generation = state.generation; const t = target();
      state.busy = 'interpret'; updateButtons(); message('Transcrevendo somente a resposta desta pergunta. Aguarde e confira antes de continuar.');
      try {
        const payload = { consentimento_ia: true, pergunta_guiada: t, rascunho: state.draft, audio: { base64: await toBase64(state.audio.blob), mime_type: state.audio.mime } };
        if (!current(generation)) return;
        if (state.async) { state.processing = newKey(); payload.processamento_id = state.processing; }
        let response = await request('/interpretar', payload, generation); const deadline = Date.now() + 240000;
        while (response?.estado === 'processando' && current(generation)) {
          if (response.processamento_id !== state.processing) throw new Error('Identificador inválido');
          if (Date.now() > deadline) throw { code: 'TEMPO_IA_EXCEDIDO' };
          await waitForPoll(generation); if (!current(generation)) return;
          response = await request('/processamentos/' + encodeURIComponent(state.processing), undefined, generation);
        }
        if (!response || !current(generation)) return;
        if (response.campo_guiado !== t.campo || !response.rascunho) throw new Error('Resposta inválida');
        state.processing = null;
        const candidate = t.indice_item === undefined ? response.rascunho[t.campo] : response.rascunho.itens?.[t.indice_item]?.[t.campo];
        guide.answer = String(candidate ?? ''); guide.transcript = String(response.transcricao || '');
        render(); message('Áudio transcrito. Confira ou corrija a resposta e toque em Confirmar resposta e continuar. Ainda não avançamos nem enviamos o pedido.');
      } catch (error) {
        if (current(generation)) { cancelProcessing(); message(error.code === 'TEMPO_IA_EXCEDIDO' ? 'A transcrição demorou demais. O áudio e a resposta foram mantidos; você pode digitar para continuar.' : 'Não foi possível transcrever esta resposta agora. O áudio e os campos foram mantidos; tente novamente ou digite a resposta.', true); }
      } finally { if (current(generation)) { state.busy = ''; updateButtons(); syncButtons(); } }
    }
    function action(name) {
      if (name === 'guide-start') activate();
      else if (name === 'guide-full') { collectGuide(); guide.active = false; render(); updateButtons(); }
      else if (name === 'guide-next') next();
      else if (name === 'guide-back') back();
      else if (name === 'guide-add') {
        if (state.draft.itens.length >= 30) return message('Cada pedido aceita até 30 itens. Divida uma lista maior.', true);
        guide.item = state.draft.itens.length; state.draft.itens.push(blankItem()); guide.step = 2; guide.stage = 'question'; loadAnswer(); render(); updateButtons(); syncButtons();
      } else if (name === 'guide-photo') { guide.stage = 'photo'; clearAudio(); render(); updateButtons(); focusPhoto(); }
      else if (name === 'guide-review') review();
    }
    function reset() { guide.active=false;guide.step=0;guide.item=0;guide.answer='';guide.transcript='';guide.log=[];guide.stage='question'; }
    return { get active() { return guide.active; }, action, transcribe, collect: collectGuide, render, syncButtons, review, reset };
  };
})();
