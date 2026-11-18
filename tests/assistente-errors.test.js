'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
const assistant = fs.readFileSync(path.join(__dirname, '../frontend/assistente.js'), 'utf8');
const helper = app.slice(app.indexOf('async function apiJson('), app.indexOf('\nasync function js(', app.indexOf('async function apiJson(')));
const translator = assistant.slice(assistant.indexOf('  function responseError('), assistant.indexOf('  async function request(', assistant.indexOf('  function responseError(')));
function context(status, body) {
  const state = { reloads: 0, removed: [], options: null };
  const sandbox = { token: 'synthetic-session', localStorage: { removeItem: key => state.removed.push(key) }, location: { reload: () => state.reloads++ },
    fetch: async (_url, options) => { state.options = options; return { status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }; } };
  vm.createContext(sandbox); vm.runInContext(helper + '\n' + translator, sandbox);
  return { sandbox, state };
}

test('API helper preserves safe error classification and compatible messages', async () => {
  const { sandbox, state } = context(503, { code: 'IA_SEM_CREDITOS', error: 'Conta sem créditos' });
  await assert.rejects(() => sandbox.apiJson('/api/assistente/interpretar', { keepOnUnauthorized: true }), error => error.status === 503 && error.code === 'IA_SEM_CREDITOS' && error.message === 'Conta sem créditos');
  assert.equal(state.options.headers.Authorization, 'Bearer synthetic-session');
  assert.equal(Object.hasOwn(state.options, 'keepOnUnauthorized'), false, 'local helper option never goes to fetch');
  assert.equal(state.reloads, 0);
  const nested = context(400, { error: { message: 'Mensagem string segura' } });
  await assert.rejects(() => nested.sandbox.apiJson('/api/teste'), error => error.message === 'Mensagem string segura' && error.status === 400);
});

test('credits, quota, media and provider failures are useful without revealing raw provider text', () => {
  const { sandbox } = context(200, {});
  for (const [code, expected] of [
    ['IA_SEM_CREDITOS', /sem créditos/], ['IA_LIMITE_CONTA', /limite de uso ou gasto/], ['IA_MUITAS_REQUISICOES', /muitas solicitações/],
    ['IA_ACESSO_NEGADO', /não autorizou/], ['IA_CONFIGURACAO_INVALIDA', /configuração/], ['AUDIO_NAO_PROCESSADO', /ler este áudio/],
    ['TRANSCRICAO_VAZIA', /reconhecer fala/], ['TEMPO_IA_EXCEDIDO', /demorou demais/], ['RESPOSTA_IA_INVALIDA', /completo e válido/],
  ]) {
    const message = sandbox.responseError({ code, status: 503, message: 'SENSITIVE_PROVIDER_DETAIL 401' }, 'Fallback seguro');
    assert.match(message, expected); assert.match(message, /mantidos nesta tela/);
    assert.equal(message.includes('SENSITIVE_PROVIDER_DETAIL'), false); assert.equal(message.includes('sessão expirou'), false);
  }
  assert.equal(sandbox.responseError({ code: 'UNKNOWN', status: 502, message: 'SENSITIVE_PROVIDER_DETAIL' }, 'Fallback seguro'), 'Fallback seguro');
  assert.equal(sandbox.responseError({ code: 'constructor', status: 502 }, 'Fallback seguro'), 'Fallback seguro');
  assert.match(sandbox.responseError({ status: 413 }, 'Fallback seguro'), /grande demais/);
  assert.match(sandbox.responseError({ status: 429 }, 'Fallback seguro'), /muitas solicitações/);
  assert.equal(sandbox.responseError({ name: 'AbortError' }, 'Fallback seguro'), '');
});

test('assistant 401 does not reload and lose in-memory request; other screens keep original behavior', async () => {
  const kept = context(401, { error: 'Token inválido' });
  await assert.rejects(() => kept.sandbox.apiJson('/api/assistente/interpretar', { keepOnUnauthorized: true }), error => error.status === 401);
  assert.equal(kept.state.reloads, 0); assert.deepEqual(kept.state.removed, ['ft_flow_token']);
  assert.match(kept.sandbox.responseError({ status: 401 }, 'Fallback seguro'), /guarde os dados antes de entrar novamente/);
  const ordinary = context(401, { error: 'Token inválido' });
  await assert.rejects(() => ordinary.sandbox.apiJson('/api/compras'), error => error.status === 401);
  assert.equal(ordinary.state.reloads, 1);
  assert.match(assistant, /signal: controller.signal, keepOnUnauthorized: true/);
});
