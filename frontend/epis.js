/* EPIs — área independente de Estoque/Compras. Sem polling ou reload de página. */
var epiModule = (() => {
  'use strict';
  const epiState = {
    generation: 0, read: 0, root: null, tab: 'estoque', items: [], summary: {},
    search: '', inactive: false,
    requests: { status: 'pendente', search: '', page: 1 },
    history: { status: 'entregue', search: '', page: 1 },
    result: { data: [], total: 0, page: 1, pages: 1 }, modal: null, modalGeneration: 0
  };
  const epiStatuses = { pendente: 'Pendente', aprovado: 'Aprovado', entregue: 'Entregue', rejeitado: 'Rejeitado', cancelado: 'Cancelado', todas: 'Todas' };
  const epiActions = { aprovar: 'Aprovar solicitação', rejeitar: 'Rejeitar solicitação', cancelar: 'Cancelar solicitação', entregar: 'Confirmar entrega física', solicitar: 'Solicitação criada', criada: 'Solicitação criada', compra_solicitada: 'Compra solicitada' };
  const epiEsc = value => htmlEsc(String(value ?? ''));
  const epiAdmin = () => usuario?.role === 'admin';
  const epiActive = item => item.ativo !== false && item.ativo !== 0 && item.ativo !== '0';
  const epiNumber = value => Number(value || 0).toLocaleString('pt-BR');
  const epiDate = value => {
    if (!value) return 'Não informado';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
  };
  const epiKey = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const epiCurrent = generation => tela === 'epis' && generation === epiState.generation && epiState.root?.isConnected;
  const epiItem = id => epiState.items.find(item => String(item.id) === String(id));
  const epiFilter = () => epiState.tab === 'historico' ? epiState.history : epiState.requests;
  const epiPost = (path, payload, method = 'POST') => js(API + '/epis' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const epiButton = (action, label, id = '', extra = '') => `<button type="button" class="secondary" data-epi-action="${action}"${id !== '' ? ` data-id="${epiEsc(id)}"` : ''} ${extra}>${label}</button>`;
  const epiBadge = status => `<span class="epi-badge epi-status-${Object.hasOwn(epiStatuses, status) ? status : 'pendente'}">${epiEsc(epiStatuses[status] || status)}</span>`;
  const epiShort = request => (request.itens || []).some(item => !epiActive(item) || Number(item.saldo_atual || 0) < Number(item.quantidade));
  const epiWaiting = request => ['pendente', 'aprovado'].includes(request.status) && epiShort(request)
    ? '<span class="epi-badge epi-warning">Aguardando reposição</span>' : '';

  function epiSummary() {
    const target = epiState.root?.querySelector('[data-epi-summary]');
    if (!target) return;
    const labels = [['itens_ativos', 'EPIs ativos'], ['estoque_baixo', 'Estoque baixo'], ['pendentes', 'Pendentes'], ['aprovadas', 'Aprovadas'], ['entregues', 'Entregues']];
    target.innerHTML = labels.map(([key, label]) => `<div class="epi-stat"><span>${label}</span><strong>${epiNumber(epiState.summary[key])}</strong></div>`).join('');
  }

  function epiFilters() {
    const target = epiState.root.querySelector('[data-epi-filters]');
    const isStock = epiState.tab === 'estoque';
    if (isStock) {
      target.innerHTML = `<label class="epi-search">Buscar EPI<input type="search" data-epi-filter="stock" value="${epiEsc(epiState.search)}" placeholder="Nome, tamanho ou CA" autocomplete="off"></label>${epiAdmin() ? `<label class="epi-check"><input type="checkbox" data-epi-filter="inactive"${epiState.inactive ? ' checked' : ''}> Mostrar também arquivados</label>` : ''}`;
    } else {
      const filter = epiFilter();
      const statuses = epiState.tab === 'historico' ? ['entregue', 'rejeitado', 'cancelado'] : ['pendente', 'aprovado', 'todas'];
      target.innerHTML = `<form class="epi-filter-form" data-epi-form="search"><label class="epi-search">Buscar solicitações<input name="busca" type="search" value="${epiEsc(filter.search)}" placeholder="Funcionário, EPI ou setor" autocomplete="off"></label><label>Status<select name="status" data-epi-filter="status">${statuses.map(status => `<option value="${status}"${filter.status === status ? ' selected' : ''}>${epiStatuses[status]}</option>`).join('')}</select></label><button type="submit" class="secondary">Buscar</button></form><p class="epi-muted">${epiAdmin() ? 'Todas as solicitações da empresa.' : 'Solicitações criadas por esta conta. Uma conta compartilhada pode incluir diferentes funcionários.'} ${epiState.tab === 'historico' ? 'Consulte entregues, rejeitadas e canceladas pelo filtro de status.' : 'Aprovar não reserva estoque. A baixa acontece somente após confirmar a entrega física.'}</p>`;
    }
    epiState.root.querySelectorAll('[data-epi-action="tab"]').forEach(button => {
      const selected = button.dataset.tab === epiState.tab;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('epi-tab-active', selected);
    });
    epiState.root.querySelector('[data-epi-panel]').setAttribute('aria-labelledby', 'epi-tab-' + epiState.tab);
  }

  function epiRenderStock() {
    const target = epiState.root.querySelector('[data-epi-results]');
    const needle = epiState.search.trim().toLocaleLowerCase('pt-BR');
    const items = epiState.items.filter(item => (epiState.inactive || epiActive(item)) && `${item.nome} ${item.tamanho || ''} ${item.ca || ''}`.toLocaleLowerCase('pt-BR').includes(needle));
    if (!items.length) {
      const text = epiState.items.some(epiActive) || needle || epiState.inactive
        ? 'Nenhum EPI encontrado com estes filtros. Ajuste a busca ou a opção de arquivados.'
        : epiAdmin() ? 'Cadastre o primeiro EPI com nome, tamanho e saldo inicial. Depois registre entradas ou ajustes para manter o estoque atualizado.' : 'Ainda não há EPIs cadastrados. Peça ao ADM para cadastrar os equipamentos; depois você poderá solicitar para você ou sua equipe.';
      target.innerHTML = `<div class="epi-empty"><h3>${needle ? 'Nenhum resultado' : 'Estoque de EPIs'}</h3><p>${text}</p>${epiAdmin() ? epiButton('new-item', 'Cadastrar EPI') : ''}</div>`;
    } else {
      target.innerHTML = `<div class="epi-stock-grid">${items.map(item => {
        const zero = Number(item.saldo) <= 0;
        const low = !zero && Number(item.saldo) <= Number(item.minimo);
        return `<article class="epi-stock-card"><div class="epi-card-head"><h3>${epiEsc(item.nome)}</h3><div class="epi-badges">${!epiActive(item) ? '<span class="epi-badge epi-muted-badge">Arquivado</span>' : ''}${zero ? '<span class="epi-badge epi-danger">Zerado</span>' : low ? '<span class="epi-badge epi-warning">Estoque baixo</span>' : '<span class="epi-badge epi-good">Disponível</span>'}</div></div><p class="epi-muted">Tamanho ${epiEsc(item.tamanho || 'Único')} · ${epiEsc(item.unidade || 'un')}</p><dl class="epi-stock-values"><div><dt>Saldo</dt><dd>${epiNumber(item.saldo)} <small>${epiEsc(item.unidade || 'un')}</small></dd></div><div><dt>Mínimo</dt><dd>${epiNumber(item.minimo)}</dd></div></dl><p class="epi-muted">CA: ${epiEsc(item.ca || 'Não informado')}${item.validade ? ` · Validade: ${epiEsc(String(item.validade).slice(0, 10).split('-').reverse().join('/'))}` : ''}</p>${item.observacoes ? `<p class="epi-notes">${epiEsc(item.observacoes)}</p>` : ''}${epiAdmin() ? `<div class="epi-actions">${epiButton('edit-item', 'Editar', item.id)}${epiButton('movement', 'Entrada / ajuste', item.id)}${epiButton('ledger', 'Movimentações', item.id)}</div>` : ''}</article>`;
      }).join('')}</div>`;
    }
    epiState.root.querySelector('[data-epi-pagination]').innerHTML = `<p class="epi-muted">${items.length} de ${epiState.items.filter(item => epiState.inactive || epiActive(item)).length} EPIs</p>`;
  }

  function epiRequestButtons(request, full = false) {
    let buttons = full ? '' : epiButton('detail', 'Ver detalhes', request.id);
    if (request.compra_id) buttons += epiButton('purchases', `Compra #${epiEsc(request.compra_id)}`, request.id);
    else if (epiAdmin() && ['pendente', 'aprovado'].includes(request.status)) buttons += epiButton('purchase', 'Solicitar compra', request.id);
    if (epiAdmin() && request.status === 'pendente') buttons += epiButton('aprovar', 'Aprovar', request.id);
    if (epiAdmin() && request.status === 'aprovado') buttons += epiButton('entregar', 'Confirmar entrega', request.id);
    if (epiAdmin() && ['pendente', 'aprovado'].includes(request.status)) buttons += epiButton('rejeitar', 'Rejeitar', request.id);
    if (request.status === 'pendente' || (epiAdmin() && request.status === 'aprovado')) buttons += epiButton('cancelar', 'Cancelar', request.id);
    return buttons;
  }

  function epiPagination(result, modal = false) {
    const page = Number(result.page || 1), pages = Math.max(1, Number(result.pages || 1));
    return `<nav class="epi-pagination" aria-label="${modal ? 'Páginas de movimentações' : 'Páginas de solicitações'}">${epiButton(modal ? 'ledger-page' : 'page', 'Anterior', page - 1, page <= 1 ? 'disabled' : '')}<span aria-live="polite">Página ${page} de ${pages} · ${epiNumber(result.total)} registros</span>${epiButton(modal ? 'ledger-page' : 'page', 'Próxima', page + 1, page >= pages ? 'disabled' : '')}</nav>`;
  }

  function epiRenderRequests() {
    const result = epiState.result;
    const target = epiState.root.querySelector('[data-epi-results]');
    target.innerHTML = !result.data?.length ? `<div class="epi-empty"><h3>Nenhuma solicitação neste filtro</h3><p>${epiState.tab === 'historico' ? 'As entregas, rejeições e cancelamentos ficam registrados aqui. Troque o status para consultar outras finalizações.' : 'Crie uma solicitação para você ou sua equipe. É possível solicitar um EPI sem saldo e aguardar a reposição.'}</p>${epiState.tab !== 'historico' ? epiButton('new-request', 'Nova solicitação') : ''}</div>` : `<div class="epi-request-list">${result.data.map(request => `<article class="epi-request-card"><div class="epi-card-head"><div><h3>#${epiEsc(request.id)} · ${epiEsc(request.funcionario)}</h3><p class="epi-muted">${epiEsc(request.setor || 'Setor não informado')} · ${epiEsc(epiDate(request.created_at))}</p></div><div class="epi-badges">${epiBadge(request.status)}${epiWaiting(request)}</div></div><p class="epi-muted">Criado por ${epiEsc(request.criado_por_nome || 'Não informado')}${request.motivo ? ` · ${epiEsc(request.motivo)}` : ''}</p><ul class="epi-request-items">${(request.itens || []).map(item => `<li><span>${epiEsc(item.nome)} <small>· ${epiEsc(item.tamanho || 'Único')}</small></span><strong>${epiNumber(item.quantidade)} ${epiEsc(item.unidade || 'un')}</strong></li>`).join('')}</ul><div class="epi-actions">${epiRequestButtons(request)}</div></article>`).join('')}</div>`;
    epiState.root.querySelector('[data-epi-pagination]').innerHTML = epiPagination(result);
  }

  async function epiRefresh(preserveScroll = false) {
    const generation = epiState.generation, read = ++epiState.read, tab = epiState.tab;
    if (!epiCurrent(generation)) return;
    const filter = { ...epiFilter() };
    const root = epiState.root;
    const scrollY = window.scrollY;
    root.querySelector('[data-epi-panel]').setAttribute('aria-busy', 'true');
    root.querySelector('[data-epi-error]').innerHTML = '';
    const refresh = root.querySelector('[data-epi-action="refresh"]');
    refresh.disabled = true;
    try {
      const params = new URLSearchParams({ status: filter.status, busca: filter.search, page: filter.page, limit: 30 });
      const [summary, items, result] = await Promise.all([
        js(API + '/epis/resumo'),
        js(API + '/epis/itens' + (epiAdmin() ? '?incluir_inativos=1' : '')),
        tab === 'estoque' ? Promise.resolve(null) : js(API + '/epis/solicitacoes?' + params)
      ]);
      if (!epiCurrent(generation) || read !== epiState.read || tab !== epiState.tab) return;
      epiState.summary = summary;
      epiState.items = Array.isArray(items) ? items : [];
      if (result) {
        epiState.result = result;
        epiFilter().page = Number(result.page || filter.page);
      }
      epiSummary();
      if (tab === 'estoque') epiRenderStock(); else epiRenderRequests();
      if (preserveScroll) requestAnimationFrame(() => {
        if (epiCurrent(generation) && read === epiState.read && !epiState.modal) window.scrollTo(0, scrollY);
      });
    } catch (error) {
      if (epiCurrent(generation) && read === epiState.read) root.querySelector('[data-epi-error]').innerHTML = `<div class="epi-error" role="alert">Não foi possível atualizar EPIs: ${epiEsc(error.message)} ${epiButton('refresh', 'Tentar novamente')}</div>`;
    } finally {
      if (epiCurrent(generation) && read === epiState.read) {
        root.querySelector('[data-epi-panel]').setAttribute('aria-busy', 'false');
        refresh.disabled = false;
      }
    }
  }

  function epiModalCurrent(modal) {
    return epiCurrent(modal.generation) && epiState.modal === modal && !modal.element.classList.contains('hidden');
  }

  function epiCloseModal(force = false, restoreFocus = true) {
    const modal = epiState.modal;
    if (!modal || (modal.saving && !force)) return;
    epiState.modal = null;
    ++epiState.modalGeneration;
    modal.abort?.abort();
    modal.element.classList.add('hidden');
    modal.element.setAttribute('aria-hidden', 'true');
    modal.observer.disconnect();
    modal.element.remove();
    document.removeEventListener('keydown', epiModalKeydown);
    if (typeof atualizarScrollLock === 'function') atualizarScrollLock();
    if (restoreFocus && modal.returnFocus?.isConnected) modal.returnFocus.focus({ preventScroll: true });
  }

  function epiModalKeydown(event) {
    const modal = epiState.modal;
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); epiCloseModal(); return; }
    if (event.key === 'Tab') {
      const nodes = [...modal.element.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(node => !node.closest('.hidden'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !modal.element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  }

  function epiOpenModal(title, body, type, id = '') {
    epiCloseModal(true, false);
    const element = document.createElement('div');
    element.className = 'modal epi-modal hidden';
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = `<div class="modal-card epi-modal-card" role="dialog" aria-modal="true" aria-labelledby="epi-modal-title" tabindex="-1"><div class="epi-modal-head"><h3 id="epi-modal-title">${epiEsc(title)}</h3>${epiButton('close', '×', '', 'aria-label="Fechar modal"')}</div><div data-epi-modal-body>${body}</div></div>`;
    const modal = { element, type, id, generation: epiState.generation, serial: ++epiState.modalGeneration, key: epiKey(), saving: false, returnFocus: document.activeElement, abort: new AbortController(), read: 0 };
    modal.observer = new MutationObserver(() => { if (typeof atualizarScrollLock === 'function') atualizarScrollLock(); });
    modal.observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    epiState.modal = modal;
    element.addEventListener('click', event => {
      if (event.target === element) epiCloseModal();
      else epiOnClick(event);
    });
    element.addEventListener('submit', epiOnSubmit);
    element.addEventListener('input', epiModalInput);
    element.addEventListener('change', epiModalInput);
    document.body.appendChild(element);
    element.classList.remove('hidden');
    element.setAttribute('aria-hidden', 'false');
    if (typeof atualizarScrollLock === 'function') atualizarScrollLock();
    document.addEventListener('keydown', epiModalKeydown);
    requestAnimationFrame(() => {
      if (epiModalCurrent(modal)) (element.querySelector('[data-epi-initial], input:not([type="hidden"]), select, textarea') || element.querySelector('.epi-modal-card')).focus({ preventScroll: true });
    });
    return modal;
  }

  function epiFormFooter(label) {
    return `<p class="epi-form-error hidden" data-epi-form-error role="alert"></p><div class="epi-form-actions">${epiButton('close', 'Voltar')}<button type="submit" class="primary" data-epi-submit>${label}</button></div>`;
  }

  function epiEditItem(id) {
    if (!epiAdmin()) return;
    const item = id ? epiItem(id) : null;
    if (id && !item) return mostrarErro('EPI não encontrado. Atualize o estoque.');
    const editing = !!item;
    epiOpenModal(editing ? 'Editar EPI' : 'Cadastrar EPI', `<form data-epi-form="item"><div class="epi-form-grid"><label>Nome do EPI *<input name="nome" value="${epiEsc(item?.nome)}" maxlength="180" placeholder="Ex.: Luva de proteção" required data-epi-initial></label><label>Tamanho<input name="tamanho" value="${epiEsc(item?.tamanho)}" maxlength="50" placeholder="Único ou número"></label><label>Unidade *<select name="unidade">${[['un', 'Unidade (un)'], ['par', 'Par'], ['caixa', 'Caixa']].map(([value, label]) => `<option value="${value}"${item?.unidade === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Estoque mínimo *<input name="minimo" type="number" min="0" step="1" value="${epiEsc(item?.minimo ?? 0)}" required></label><label>CA (opcional)<input name="ca" value="${epiEsc(item?.ca)}" maxlength="80" placeholder="Certificado de Aprovação"></label><label>Validade (opcional)<input name="validade" type="date" value="${epiEsc(item?.validade ? String(item.validade).slice(0, 10) : '')}"></label>${editing ? `<label>Situação<select name="ativo"><option value="1"${epiActive(item) ? ' selected' : ''}>Ativo</option><option value="0"${!epiActive(item) ? ' selected' : ''}>Arquivado</option></select></label><p class="epi-note">Saldo atual: <strong>${epiNumber(item.saldo)} ${epiEsc(item.unidade)}</strong>. Para alterar o saldo, use Entrada / ajuste; editar o cadastro não movimenta estoque.</p>` : '<label>Saldo inicial *<input name="saldo_inicial" type="number" min="0" step="1" value="0" required></label>'}</div><p class="epi-muted">CA e validade são opcionais neste cadastro. O registro não substitui verificação de conformidade ou documentação legal.${editing ? ' Arquivar retira o EPI das novas solicitações, sem apagar seu histórico.' : ''}</p><label>Observações<textarea name="observacoes" maxlength="2000">${epiEsc(item?.observacoes)}</textarea></label>${epiFormFooter(editing ? 'Salvar cadastro' : 'Cadastrar EPI')}</form>`, 'item', id);
  }

  function epiMovement(id) {
    if (!epiAdmin()) return;
    const item = epiItem(id);
    if (!item) return mostrarErro('EPI não encontrado. Atualize o estoque.');
    const modal = epiOpenModal('Entrada / ajuste de estoque', `<form data-epi-form="movement"><p><strong>${epiEsc(item.nome)} · ${epiEsc(item.tamanho || 'Único')}</strong></p><p class="epi-muted">Saldo atual: ${epiNumber(item.saldo)} ${epiEsc(item.unidade)}</p><div class="epi-form-grid"><label>Tipo<select name="tipo" data-epi-initial><option value="entrada">Entrada — adicionar ao estoque</option><option value="ajuste">Ajuste — diferença positiva ou negativa</option></select></label><label>Quantidade (diferença) *<input name="quantidade" type="number" step="1" min="1" required placeholder="Ex.: 10"></label></div><p class="epi-note" data-epi-movement-help>Entrada: informe uma quantidade positiva para somar ao saldo.</p><p class="epi-stock-preview" data-epi-stock-preview aria-live="polite"></p><label>Observação *<textarea name="observacao" required maxlength="2000" placeholder="Ex.: recebimento de compra, inventário ou correção"></textarea></label>${epiFormFooter('Registrar movimentação')}</form>`, 'movement', id);
    modal.item = { ...item };
    epiUpdateMovement(modal);
  }

  function epiUpdateMovement(modal) {
    const form = modal.element.querySelector('form');
    const type = form.elements.tipo.value;
    const quantity = form.elements.quantidade;
    if (type === 'entrada') quantity.min = '1'; else quantity.removeAttribute('min');
    modal.element.querySelector('[data-epi-movement-help]').textContent = type === 'entrada' ? 'Entrada: informe uma quantidade positiva para somar ao saldo.' : 'Ajuste é uma diferença, não o saldo final. Use +5 para somar 5 ou -3 para retirar 3. Zero não é permitido.';
    const value = quantity.value === '' ? 0 : Number(quantity.value);
    const after = Number(modal.item.saldo) + value;
    modal.element.querySelector('[data-epi-stock-preview]').textContent = `Saldo previsto: ${epiNumber(modal.item.saldo)} ${value < 0 ? '−' : '+'} ${epiNumber(Math.abs(value))} = ${epiNumber(after)} ${modal.item.unidade}${after < 0 ? ' — saldo negativo não permitido' : ''}`;
  }

  function epiNewRequest() {
    if (!epiState.items.some(epiActive)) return mostrarErro('Peça ao ADM para cadastrar um EPI ativo antes de solicitar.');
    // Não tratar o nome de uma conta genérica como nome do funcionário.
    const name = String(usuario?.nome || '').trim();
    const generic = /^(administrador|administradora|admin|operador|operadora|operator|administrator)$/i.test(name);
    const modal = epiOpenModal('Nova solicitação de EPI', `<form data-epi-form="request"><p class="epi-note">Solicitação → aprovação do ADM → entrega física → baixa de estoque. Você pode solicitar para si ou para sua equipe.</p><div class="epi-form-grid"><label>Nome do funcionário *<input name="funcionario" value="${epiEsc(generic ? '' : name)}" placeholder="Nome de quem receberá os EPIs" maxlength="180" required data-epi-initial></label><label>Setor *<input name="setor" maxlength="120" placeholder="Ex.: Produção" required></label><label>Motivo<select name="motivo"><option value="">Selecione (opcional)</option><option>Primeira entrega</option><option>Reposição</option><option>Troca</option><option>Outro</option></select></label></div><h4>EPIs solicitados</h4><p class="epi-muted">A quantidade não depende do saldo atual. Sem estoque, o pedido aguarda reposição. Não repita o mesmo EPI; ajuste a quantidade da linha.</p><div data-epi-request-lines></div><div class="epi-actions">${epiButton('add-line', 'Adicionar EPI')}<span class="epi-muted" data-epi-line-count aria-live="polite"></span></div><label>Observações<textarea name="observacao" maxlength="2000" placeholder="Informações para o ADM"></textarea></label>${epiFormFooter('Enviar solicitação')}</form>`, 'request');
    epiAddLine(modal);
  }

  function epiAddLine(modal) {
    const target = modal.element.querySelector('[data-epi-request-lines]');
    if (target.children.length >= 30) return;
    const row = document.createElement('div');
    row.className = 'epi-request-line';
    row.innerHTML = `<label>EPI *<select name="item_id" required><option value="">Selecione o EPI...</option>${epiState.items.filter(epiActive).map(item => `<option value="${epiEsc(item.id)}">${epiEsc(item.nome)} · ${epiEsc(item.tamanho || 'Único')} · saldo ${epiNumber(item.saldo)} ${epiEsc(item.unidade)}${Number(item.saldo) <= 0 ? ' — aguarda reposição' : ''}</option>`).join('')}</select><small class="epi-muted" data-epi-line-stock></small></label><label>Quantidade *<input name="quantidade" type="number" min="1" step="1" value="1" required></label>${epiButton('remove-line', 'Remover', '', 'aria-label="Remover linha de EPI"')}`;
    target.appendChild(row);
    epiUpdateLines(modal);
    if (target.children.length > 1) row.querySelector('select').focus();
  }

  function epiUpdateLines(modal) {
    const rows = [...modal.element.querySelectorAll('.epi-request-line')];
    const selected = rows.map(row => row.querySelector('select').value).filter(Boolean);
    rows.forEach(row => {
      const select = row.querySelector('select');
      [...select.options].forEach(option => { option.disabled = !!option.value && option.value !== select.value && selected.includes(option.value); });
      const item = epiItem(select.value), quantity = Number(row.querySelector('input').value);
      row.querySelector('[data-epi-line-stock]').textContent = item ? `${item.nome} · Tamanho ${item.tamanho || 'Único'} · Disponível: ${epiNumber(item.saldo)} ${item.unidade}${Number(item.saldo) < quantity ? ' · Aguardará reposição' : ''}` : '';
      row.querySelector('[data-epi-action="remove-line"]').disabled = rows.length <= 1;
    });
    modal.element.querySelector('[data-epi-line-count]').textContent = `${rows.length} de 30 itens`;
    modal.element.querySelector('[data-epi-action="add-line"]').disabled = rows.length >= 30;
  }

  function epiItemsTable(request, delivery = false) {
    return `<table class="epi-lines-table"><thead><tr><th>EPI / tamanho</th><th>CA</th><th>Quantidade</th>${delivery ? '<th>Saldo atual → previsto</th>' : '<th>Saldo atual</th>'}</tr></thead><tbody>${(request.itens || []).map(item => `<tr><td data-label="EPI / tamanho"><strong>${epiEsc(item.nome)}</strong><br>${epiEsc(item.tamanho || 'Único')}${!epiActive(item) ? ' · Arquivado' : ''}</td><td data-label="CA">${epiEsc(item.ca || 'Não informado')}</td><td data-label="Quantidade">${epiNumber(item.quantidade)} ${epiEsc(item.unidade)}</td><td data-label="${delivery ? 'Saldo atual → previsto' : 'Saldo atual'}">${epiNumber(item.saldo_atual)}${delivery ? ` → ${epiNumber(Number(item.saldo_atual || 0) - Number(item.quantidade))}` : ''} ${epiEsc(item.unidade)}</td></tr>`).join('')}</tbody></table>`;
  }

  async function epiLoadRequest(modal, purpose) {
    const read = ++modal.read;
    try {
      const request = await js(API + '/epis/solicitacoes/' + encodeURIComponent(modal.id), { signal: modal.abort.signal });
      if (!epiModalCurrent(modal) || read !== modal.read) return;
      modal.request = request;
      const target = modal.element.querySelector('[data-epi-modal-body]');
      const heading = `<div class="epi-card-head"><div><h4>Solicitação #${epiEsc(request.id)}</h4><p><strong>${epiEsc(request.funcionario)}</strong> · ${epiEsc(request.setor || 'Setor não informado')}</p></div><div class="epi-badges">${epiBadge(request.status)}${epiWaiting(request)}</div></div>`;
      if (purpose === 'detail') {
        target.innerHTML = `${heading}<p class="epi-muted">Criado por ${epiEsc(request.criado_por_nome || 'Não informado')} em ${epiEsc(epiDate(request.created_at))}</p>${request.motivo ? `<p>Motivo: ${epiEsc(request.motivo)}</p>` : ''}${request.observacao ? `<p class="epi-notes">${epiEsc(request.observacao)}</p>` : ''}${epiItemsTable(request)}<p class="epi-muted">Os itens e CA acima são os dados registrados no pedido; o saldo exibido é o atual. Aprovação não reserva estoque.</p>${request.approved_at ? `<p class="epi-muted">Aprovação: ${epiEsc(epiDate(request.approved_at))}</p>` : ''}${request.delivered_at ? `<p class="epi-muted">Entrega registrada: ${epiEsc(epiDate(request.delivered_at))}</p>` : ''}<div class="epi-actions">${epiRequestButtons(request, true)}</div><h4>Histórico da solicitação</h4><p class="epi-muted">Registro de ações, responsáveis e datas. Não representa assinatura ou recibo do funcionário.</p><ol class="epi-events">${(request.eventos || []).map(event => `<li><strong>${epiEsc(epiActions[event.acao] || epiStatuses[event.acao] || event.acao)}</strong><p class="epi-muted">${epiEsc(event.ator_nome || 'Não informado')} · ${epiEsc(epiDate(event.created_at))}</p>${event.observacao ? `<p class="epi-notes">${epiEsc(event.observacao)}</p>` : ''}</li>`).join('') || '<li>Nenhum evento registrado.</li>'}</ol>`;
      } else if (purpose === 'purchase') {
        if (request.compra_id) {
          target.innerHTML = `${heading}<p>Esta solicitação já está vinculada à compra #${epiEsc(request.compra_id)}.</p><div class="epi-actions">${epiButton('purchases', `Abrir Compras — #${epiEsc(request.compra_id)}`)}</div>`;
          return;
        }
        if (!epiAdmin() || !['pendente', 'aprovado'].includes(request.status)) throw new Error('A compra só pode ser solicitada pelo ADM para pedidos pendentes ou aprovados.');
        target.innerHTML = `<form data-epi-form="purchase">${heading}<p class="epi-note">Criar uma lista em Compras, em cotação. O pedido de EPI permanece ${epiEsc(epiStatuses[request.status].toLowerCase())}; esta ação não baixa estoque.</p><p class="epi-muted">Quantidades sugeridas: o que falta para atender este pedido. Você pode ajustar para repor estoque. Linhas com zero não serão compradas.</p><div class="epi-purchase-lines">${(request.itens || []).map(item => `<label class="epi-purchase-line"><span><strong>${epiEsc(item.nome)} · ${epiEsc(item.tamanho || 'Único')}</strong><small>Solicitado: ${epiNumber(item.quantidade)} ${epiEsc(item.unidade)} · Saldo atual: ${epiNumber(item.saldo_atual)}</small></span><span>Comprar (${epiEsc(item.unidade)})<input name="compra_quantidade" data-item-id="${epiEsc(item.item_id)}" type="number" min="0" step="1" value="${Math.max(Number(item.quantidade) - Number(item.saldo_atual || 0), 0)}" required></span></label>`).join('')}</div><div class="epi-note" data-epi-purchase-preview aria-live="polite"></div><p class="epi-note">A compra segue o fluxo normal de cotação/aprovação. Depois de receber, registre a entrada no estoque de EPI.</p><label>Observação<textarea name="observacao" maxlength="2000" placeholder="Informações para a cotação"></textarea></label>${epiFormFooter('Confirmar solicitação de compra')}</form>`;
        epiUpdatePurchase(modal);
      } else {
        const isDelivery = purpose === 'entregar';
        const required = ['rejeitar', 'cancelar'].includes(purpose);
        const valid = purpose === 'aprovar' ? epiAdmin() && request.status === 'pendente'
          : isDelivery ? epiAdmin() && request.status === 'aprovado'
          : purpose === 'rejeitar' ? epiAdmin() && ['pendente', 'aprovado'].includes(request.status)
          : request.status === 'pendente' || (epiAdmin() && request.status === 'aprovado');
        if (!valid) throw new Error('A situação da solicitação mudou. Atualize a listagem para ver as ações disponíveis.');
        target.innerHTML = `<form data-epi-form="request-action">${heading}${epiItemsTable(request, isDelivery)}<p class="epi-note">${isDelivery ? 'Confirme somente depois de entregar fisicamente TODOS os EPIs ao funcionário indicado. A baixa será integral, nunca parcial. Se faltar estoque, o pedido continua aprovado para reposição.' : purpose === 'aprovar' ? 'A aprovação não reserva nem baixa estoque. A entrega física será registrada em uma ação separada.' : 'Esta ação encerra o pedido sem baixar estoque. Informe o motivo para manter o histórico claro.'}</p>${isDelivery && epiShort(request) ? '<p class="epi-error">Há EPI sem saldo suficiente ou arquivado. Reponha/ative o estoque antes de confirmar. Nenhum item será baixado parcialmente.</p>' : ''}<label>Observação${required ? ' *' : ' (opcional)'}<textarea name="observacao" maxlength="2000"${required ? ' required' : ''}></textarea></label>${isDelivery ? `<label class="epi-check epi-confirm"><input name="confirmacao" type="checkbox" required> Confirmo que entreguei todos os itens acima a ${epiEsc(request.funcionario)}.</label>` : ''}${epiFormFooter(epiActions[purpose])}</form>`;
      }
      requestAnimationFrame(() => { if (epiModalCurrent(modal)) (target.querySelector('input, select, textarea') || modal.element.querySelector('.epi-modal-card')).focus({ preventScroll: true }); });
    } catch (error) {
      if (epiModalCurrent(modal) && error.name !== 'AbortError' && read === modal.read) modal.element.querySelector('[data-epi-modal-body]').innerHTML = `<p class="epi-error" role="alert">${epiEsc(error.message)}</p>${epiButton('retry-modal', 'Tentar novamente')}`;
    }
  }

  function epiRequestModal(id, purpose) {
    const modal = epiOpenModal(purpose === 'detail' ? 'Detalhes da solicitação' : purpose === 'purchase' ? 'Solicitar compra de EPIs' : epiActions[purpose], '<p class="epi-muted" role="status">Carregando solicitação...</p>', purpose, id);
    epiLoadRequest(modal, purpose);
  }

  function epiUpdatePurchase(modal) {
    const inputs = [...modal.element.querySelectorAll('[name="compra_quantidade"]')];
    const lines = inputs.filter(input => Number(input.value) > 0).map(input => {
      const item = modal.request.itens.find(item => String(item.item_id) === input.dataset.itemId);
      return `${item.nome} · ${item.tamanho || 'Único'}: ${epiNumber(input.value)} ${item.unidade}`;
    });
    modal.element.querySelector('[data-epi-purchase-preview]').textContent = `Destinatário dos EPIs: ${modal.request.funcionario}. ${lines.length ? 'Comprar: ' + lines.join('; ') + '.' : 'Informe quantidade positiva em pelo menos um item para comprar.'}`;
  }

  async function epiLedger(modal, page = 1) {
    const read = ++modal.read;
    const target = modal.element.querySelector('[data-epi-modal-body]');
    target.setAttribute('aria-busy', 'true');
    target.querySelectorAll('[data-epi-action="ledger-page"]').forEach(button => { button.disabled = true; });
    try {
      const result = await js(API + '/epis/itens/' + encodeURIComponent(modal.id) + '/historico?page=' + page + '&limit=30', { signal: modal.abort.signal });
      if (!epiModalCurrent(modal) || read !== modal.read) return;
      modal.page = Number(result.page || page);
      target.innerHTML = `<h4>${epiEsc(result.item?.nome || '')} · ${epiEsc(result.item?.tamanho || 'Único')}</h4><p class="epi-muted">Entradas, ajustes e baixas por entrega; responsáveis e saldo antes/depois.</p>${result.movimentacoes?.length ? `<ol class="epi-events">${result.movimentacoes.map(movement => `<li><div class="epi-card-head"><strong>${epiEsc({ entrada: 'Entrada', ajuste: 'Ajuste', saida: 'Baixa', entrega: 'Entrega', inicial: 'Saldo inicial', saldo_inicial: 'Saldo inicial' }[movement.tipo] || movement.tipo)} · ${Number(movement.quantidade) > 0 ? '+' : ''}${epiNumber(movement.quantidade)}</strong><span>${epiNumber(movement.saldo_antes)} → ${epiNumber(movement.saldo_depois)} ${epiEsc(result.item?.unidade)}</span></div><p class="epi-muted">${epiEsc(movement.ator_nome || 'Não informado')} · ${epiEsc(epiDate(movement.created_at))}</p>${movement.observacao ? `<p class="epi-notes">${epiEsc(movement.observacao)}</p>` : ''}${movement.solicitacao_id ? epiButton('detail', `Solicitação #${epiEsc(movement.solicitacao_id)}`, movement.solicitacao_id) : ''}</li>`).join('')}</ol>` : '<p class="epi-empty">Nenhuma movimentação registrada.</p>'}${epiPagination(result, true)}`;
      target.scrollTop = 0;
    } catch (error) {
      if (epiModalCurrent(modal) && error.name !== 'AbortError' && read === modal.read) target.innerHTML = `<p class="epi-error" role="alert">${epiEsc(error.message)}</p>${epiButton('retry-modal', 'Tentar novamente')}`;
    } finally {
      if (epiModalCurrent(modal) && read === modal.read) target.setAttribute('aria-busy', 'false');
    }
  }

  function epiModalInput() {
    const modal = epiState.modal;
    if (!modal || modal.saving) return;
    if (modal.type === 'movement') epiUpdateMovement(modal);
    if (modal.type === 'request') epiUpdateLines(modal);
    if (modal.type === 'purchase' && modal.request) epiUpdatePurchase(modal);
  }

  function epiShowFormError(form, message) {
    const target = form.querySelector('[data-epi-form-error]');
    if (!target) return;
    target.textContent = message;
    target.classList.remove('hidden');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function epiInteger(value, minimum = 0) {
    const number = Number(value);
    if (value === '' || !Number.isSafeInteger(number) || number < minimum) throw new Error(`Informe uma quantidade inteira${minimum > 0 ? ' positiva' : ' maior ou igual a zero'}.`);
    return number;
  }

  async function epiSave(form, modal) {
    if (!epiModalCurrent(modal) || modal.saving) return;
    let path, payload, method = 'POST';
    const data = new FormData(form);
    const text = name => String(data.get(name) || '').trim();
    try {
      if (modal.type === 'item') {
        if (!epiAdmin()) throw new Error('Somente o ADM pode cadastrar ou editar EPIs.');
        if (!text('nome')) throw new Error('Informe o nome do EPI.');
        payload = { nome: text('nome'), tamanho: text('tamanho') || 'Único', unidade: text('unidade'), ca: text('ca'), validade: text('validade') || null, minimo: epiInteger(text('minimo')), observacoes: text('observacoes') };
        path = '/itens' + (modal.id ? '/' + encodeURIComponent(modal.id) : '');
        if (modal.id) { method = 'PUT'; payload.ativo = text('ativo') === '1'; }
        else { payload.saldo_inicial = epiInteger(text('saldo_inicial')); payload.chave = modal.key; }
      } else if (modal.type === 'movement') {
        if (!epiAdmin()) throw new Error('Somente o ADM pode movimentar estoque.');
        const quantity = Number(text('quantidade'));
        if (!Number.isSafeInteger(quantity) || quantity === 0 || (text('tipo') === 'entrada' && quantity < 0)) throw new Error('Entrada exige quantidade inteira positiva; ajuste exige diferença inteira diferente de zero.');
        if (!text('observacao')) throw new Error('Informe a observação da movimentação.');
        if (Number(modal.item.saldo) + quantity < 0) throw new Error('O ajuste não pode resultar em saldo negativo.');
        path = '/itens/' + encodeURIComponent(modal.id) + '/movimentacoes';
        payload = { tipo: text('tipo'), quantidade: quantity, observacao: text('observacao'), chave: modal.key };
      } else if (modal.type === 'request') {
        if (!text('funcionario') || !text('setor')) throw new Error('Informe o nome do funcionário e o setor.');
        const rows = [...form.querySelectorAll('.epi-request-line')];
        if (!rows.length || rows.length > 30) throw new Error('Selecione de 1 a 30 EPIs.');
        const ids = new Set();
        const items = rows.map(row => {
          const id = row.querySelector('select').value;
          const item = epiItem(id);
          if (!item || !epiActive(item)) throw new Error('Selecione um EPI ativo em cada linha.');
          if (ids.has(id)) throw new Error('Não repita o mesmo EPI. Some as quantidades em uma única linha.');
          ids.add(id);
          return { item_id: Number(id), quantidade: epiInteger(row.querySelector('input').value, 1) };
        });
        path = '/solicitacoes';
        payload = { funcionario: text('funcionario'), setor: text('setor'), motivo: text('motivo'), observacao: text('observacao'), itens: items, chave: modal.key };
      } else if (modal.type === 'purchase') {
        if (!epiAdmin()) throw new Error('Somente o ADM pode solicitar compra.');
        const items = [...form.querySelectorAll('[name="compra_quantidade"]')].map(input => ({ item_id: Number(input.dataset.itemId), quantidade: epiInteger(input.value) })).filter(item => item.quantidade > 0);
        if (!items.length) throw new Error('Informe quantidade positiva em pelo menos um EPI para comprar.');
        path = '/solicitacoes/' + encodeURIComponent(modal.id) + '/gerar-compra';
        payload = { itens: items, observacao: text('observacao') };
      } else {
        if (['aprovar', 'rejeitar', 'entregar'].includes(modal.type) && !epiAdmin()) throw new Error('Ação permitida somente ao ADM.');
        if (['rejeitar', 'cancelar'].includes(modal.type) && !text('observacao')) throw new Error('Informe o motivo desta ação.');
        if (modal.type === 'entregar' && data.get('confirmacao') !== 'on') throw new Error('Confirme a entrega física de todos os itens ao funcionário.');
        path = '/solicitacoes/' + encodeURIComponent(modal.id) + '/' + modal.type;
        payload = { observacao: text('observacao') };
      }
      if (payload.chave) {
        const identity = JSON.stringify({ ...payload, chave: undefined });
        if (modal.identity && modal.identity !== identity) modal.key = epiKey();
        modal.identity = identity;
        payload.chave = modal.key;
      }
    } catch (error) { epiShowFormError(form, error.message); return; }
    modal.saving = true;
    const originalDisabled = new Map([...modal.element.querySelectorAll('button, input, select, textarea')].map(control => [control, control.disabled]));
    originalDisabled.forEach((_, control) => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    const submit = form.querySelector('[data-epi-submit]');
    const originalLabel = submit.textContent;
    submit.textContent = 'Salvando...';
    form.querySelector('[data-epi-form-error]').classList.add('hidden');
    try {
      // Retry com o mesmo payload conserva a chave; editar o pedido cria nova tentativa lógica.
      const response = await epiPost(path, payload, method);
      if (!epiModalCurrent(modal)) return;
      modal.saving = false;
      const type = modal.type;
      epiCloseModal();
      const message = type === 'purchase' ? `Compra #${response.compra_id || response.id} ${response.ja_existente ? 'já vinculada' : 'solicitada'}. Registre a entrada do EPI após o recebimento.`
        : type === 'entregar' ? 'Entrega registrada e estoque baixado.' : type === 'aprovar' ? 'Solicitação aprovada. O estoque só será baixado na entrega.'
        : type === 'request' ? 'Solicitação enviada ao ADM.' : 'Operação registrada com sucesso.';
      mostrarSucesso(message);
      await epiRefresh(true);
    } catch (error) {
      if (epiModalCurrent(modal)) epiShowFormError(form, error.message + (modal.type === 'entregar' ? ' O pedido não foi descartado; atualize/reponha o estoque e tente novamente.' : ' Revise os dados ou tente novamente sem fechar este formulário.'));
    } finally {
      modal.saving = false;
      if (epiModalCurrent(modal)) {
        originalDisabled.forEach((disabled, control) => { control.disabled = disabled; });
        submit.textContent = originalLabel;
        form.setAttribute('aria-busy', 'false');
      }
    }
  }

  function epiOnSubmit(event) {
    const form = event.target.closest('[data-epi-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.epiForm === 'search') {
      const filter = epiFilter();
      filter.search = form.elements.busca.value.trim();
      filter.status = form.elements.status.value;
      filter.page = 1;
      epiRefresh();
    } else if (epiState.modal) epiSave(form, epiState.modal);
  }

  function epiOnClick(event) {
    const button = event.target.closest('[data-epi-action]');
    if (!button || button.disabled || !epiCurrent(epiState.generation)) return;
    const action = button.dataset.epiAction, id = button.dataset.id;
    const modal = epiState.modal;
    if (modal?.saving) return;
    if (action === 'close') return epiCloseModal();
    if (action === 'refresh') return epiRefresh();
    if (action === 'tab') {
      epiState.tab = button.dataset.tab;
      epiFilters();
      epiState.root.querySelector('[data-epi-results]').innerHTML = '<p class="epi-muted" role="status">Carregando...</p>';
      epiState.root.querySelector('[data-epi-pagination]').innerHTML = '';
      return epiRefresh();
    }
    if (action === 'new-item') return epiEditItem();
    if (action === 'edit-item') return epiEditItem(id);
    if (action === 'movement') return epiMovement(id);
    if (action === 'new-request') return epiNewRequest();
    if (action === 'add-line' && modal?.type === 'request') return epiAddLine(modal);
    if (action === 'remove-line' && modal?.type === 'request') {
      const row = button.closest('.epi-request-line');
      if (row && row.parentNode.children.length > 1) { row.remove(); epiUpdateLines(modal); }
      return;
    }
    if (action === 'ledger' && epiAdmin()) {
      const ledger = epiOpenModal('Movimentações de estoque', '<p class="epi-muted" role="status">Carregando movimentações...</p>', 'ledger', id);
      return epiLedger(ledger);
    }
    if (action === 'ledger-page' && modal?.type === 'ledger') return epiLedger(modal, Number(id));
    if (action === 'retry-modal' && modal) return modal.type === 'ledger' ? epiLedger(modal, modal.page || 1) : epiLoadRequest(modal, modal.type);
    if (action === 'page') { epiFilter().page = Number(id); return epiRefresh(); }
    if (action === 'purchases') { epiCloseModal(); return trocarTela('compras'); }
    if (['detail', 'purchase', 'aprovar', 'rejeitar', 'cancelar', 'entregar'].includes(action)) return epiRequestModal(id, action);
  }

  function epiOnFilter(event) {
    const field = event.target;
    if (field.dataset.epiFilter === 'stock') { epiState.search = field.value; epiRenderStock(); }
    if (field.dataset.epiFilter === 'inactive') { epiState.inactive = field.checked; epiRenderStock(); }
    if (event.type === 'change' && field.dataset.epiFilter === 'status') {
      const form = field.closest('form');
      const filter = epiFilter();
      filter.status = field.value;
      filter.search = form.elements.busca.value.trim();
      filter.page = 1;
      epiRefresh();
    }
  }

  async function epiOpen() {
    epiCloseModal(true, false);
    ++epiState.generation;
    ++epiState.read;
    const contentElement = document.getElementById('content');
    contentElement.innerHTML = `<div class="epi-area"><header class="epi-header"><div><p class="epi-eyebrow">FT FLOW / PROTEÇÃO INDIVIDUAL</p><h2>Gestão de EPIs</h2><p class="epi-muted">Estoque por tamanho, solicitações e registro de entregas.</p></div><div class="epi-actions"><button type="button" class="primary" data-epi-action="new-request">Nova solicitação</button>${epiAdmin() ? '<button type="button" class="secondary" data-epi-action="new-item">Cadastrar EPI</button>' : ''}${epiButton('refresh', 'Atualizar')}</div></header><div class="epi-summary" data-epi-summary aria-label="Resumo de EPIs"></div><div class="epi-tabs" role="tablist" aria-label="Área de EPIs">${[['estoque', 'Estoque'], ['solicitacoes', 'Solicitações'], ['historico', 'Histórico']].map(([tab, label]) => `<button type="button" role="tab" id="epi-tab-${tab}" data-epi-action="tab" data-tab="${tab}" aria-controls="epi-panel" aria-selected="false">${label}</button>`).join('')}</div><section id="epi-panel" data-epi-panel role="tabpanel"><div class="epi-filters" data-epi-filters></div><div data-epi-error></div><div data-epi-results><p class="epi-muted" role="status">Carregando EPIs...</p></div><div data-epi-pagination></div></section></div>`;
    epiState.root = contentElement.querySelector('.epi-area');
    epiState.root.addEventListener('click', epiOnClick);
    epiState.root.addEventListener('submit', epiOnSubmit);
    epiState.root.addEventListener('input', epiOnFilter);
    epiState.root.addEventListener('change', epiOnFilter);
    const root = epiState.root;
    const observer = new MutationObserver(() => {
      if (!root.isConnected) {
        observer.disconnect();
        if (epiState.root === root) { ++epiState.generation; ++epiState.read; epiCloseModal(true, false); }
      }
    });
    observer.observe(contentElement, { childList: true });
    epiFilters();
    epiSummary();
    await epiRefresh();
  }

  return { open: epiOpen };
})();

async function epis() {
  return epiModule.open();
}
