'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createWhatsAppService, normalizePhone, normalizeDraft, missingFields, buildSummary, parseCommand, _private,
} = require('../netlify/lib/whatsapp');

function minimalPool() {
  return { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }), query: async () => ({ rows: [] }) };
}

const readyEnv = {
  FT_WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'access', WHATSAPP_PHONE_NUMBER_ID: '12345',
  WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'verify', FT_WHATSAPP_AI_API_KEY: 'ai-key',
};

test('normalizePhone accepts Brazilian DDD formats and rejects wrong formats', () => {
  assert.equal(normalizePhone('+55 (11) 99876-5432'), '5511998765432');
  assert.equal(normalizePhone('1198765432'), '551198765432');
  assert.equal(normalizePhone('5511998765432'), '5511998765432');
  assert.equal(normalizePhone('551234'), null);
  assert.equal(normalizePhone('000000'), null);
});

test('normalizeDraft does not invent missing quantities, units, or destination', () => {
  const draft = normalizeDraft({ items: [{ product: 'Cimento', qtd: 0, unit: 'L' }], destino: '   ' });
  assert.deepEqual(draft.itens, [{ produto: 'Cimento', quantidade: null, unidade: 'L' }]);
  assert.equal(draft.destino, null);
  assert.deepEqual(missingFields(draft), ['quantidade', 'destino']);
});

test('missingFields treats packaging as an explicit one-item list without implicit conversion', () => {
  assert.deepEqual(missingFields({ itens: [{ produto: 'Areia', quantidade: 1, unidade: 'saco' }], destino: 'Obra' }), []);
  assert.deepEqual(missingFields({ itens: [{ produto: 'Areia', quantidade: 1, unidade: 'saco' }, { produto: 'Cal', quantidade: 2, unidade: 'caixa' }], destino: 'Obra' }), []);
});

test('summary exposes inferred/default category and all list items', () => {
  const summary = buildSummary({ itens: [{ produto: 'Prego', quantidade: 3, unidade: 'kg' }, { produto: 'Parafuso', quantidade: 2, unidade: 'caixa' }], destino: 'Galpão' });
  assert.match(summary, /Resumo da lista/);
  assert.match(summary, /Prego/);
  assert.match(summary, /Parafuso/);
  assert.match(summary, /Categoria: Outros \(padrão\)/);
});

test('parseCommand only accepts sim with a delivered current confirmation', () => {
  assert.equal(parseCommand('sim', { status: 'collecting', summaryDelivered: true }), null);
  assert.equal(parseCommand('sim', { status: 'awaiting_confirmation', summaryDelivered: false }), null);
  assert.equal(parseCommand('SIM', { status: 'awaiting_confirmation', summaryDelivered: true }), 'confirm');
  assert.equal(parseCommand('por favor confirma isso agora', { status: 'awaiting_confirmation', summaryDelivered: true }), null);
  assert.equal(parseCommand('confirmar pedido'), 'confirm');
});

test('signature and challenge verification use secret constant-time path', () => {
  const service = createWhatsAppService({ pool: minimalPool(), env: readyEnv, fetchImpl: async () => { throw new Error('not used'); } });
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${crypto.createHmac('sha256', 'secret').update(raw).digest('hex')}`;
  assert.equal(service.verifySignature(raw, signature), true);
  assert.equal(service.verifySignature(raw, 'sha256=wrong'), false);
  assert.equal(service.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify', 'hub.challenge': 'ok' }), 'ok');
  assert.equal(service.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'ok' }), null);
  const missingTokenService = createWhatsAppService({ pool: minimalPool(), env: { ...readyEnv, WHATSAPP_VERIFY_TOKEN: undefined }, fetchImpl: async () => null });
  assert.equal(missingTokenService.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': undefined, 'hub.challenge': 'must-not-pass' }), null);
  assert.equal(service.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'must-not-pass' }), null);
});

test('status reveals booleans and names only, never any secret', () => {
  const service = createWhatsAppService({ pool: minimalPool(), env: { ...readyEnv, FT_WHATSAPP_ENABLED: 'false' }, fetchImpl: async () => null });
  const status = service.getStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.ready, false);
  assert.ok(status.missing.includes('FT_WHATSAPP_ENABLED'));
  assert.equal(JSON.stringify(status).includes('access'), false);
  assert.equal(JSON.stringify(status).includes('secret'), false);
});

test('media SSRF allowlist admits only HTTPS Meta CDN hosts and MIME magic is enforced', () => {
  assert.equal(_private.isAllowedMetaMediaUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?x=1'), true);
  assert.equal(_private.isAllowedMetaMediaUrl('https://video.xx.fbcdn.net/file'), true);
  assert.equal(_private.isAllowedMetaMediaUrl('https://graph.facebook.com/redirect'), false);
  assert.equal(_private.isAllowedMetaMediaUrl('http://lookaside.fbsbx.com/file'), false);
  assert.equal(_private.isAllowedMetaMediaUrl('https://lookaside.fbsbx.com.evil.example/file'), false);
  assert.equal(_private.extensionMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/png', 'image'), 'image/jpeg');
  assert.equal(_private.extensionMime(Buffer.from('not an image'), 'image/jpeg', 'image'), null);
});

test('stale button revision cannot match current confirmation', () => {
  const button = _private.parseButtonId('confirm:123e4567-e89b-12d3-a456-426614174000:1');
  const draft = normalizeDraft({ request_id: '123e4567-e89b-12d3-a456-426614174000', revision: 2 });
  assert.equal(_private.isCurrentConfirmation(button, draft, 'awaiting_confirmation'), false);
  assert.equal(_private.isCurrentConfirmation({ ...button, revision: 2 }, draft, 'awaiting_confirmation'), true);
});

test('ingestWebhook ignores statuses, a wrong number id, and unauthorized phones before media processing', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      if (/FROM ft_whatsapp_lideres/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  };
  const service = createWhatsAppService({ pool, env: readyEnv, fetchImpl: async () => { throw new Error('fetch must not happen'); } });
  service.ensureDb = async () => {}; // business filtering happens before a write in this test
  const ignored = await service.ingestWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'other' }, statuses: [{ id: 'status' }], messages: [{ id: 'm1', from: '5511998765432', type: 'image', image: { id: 'media' } }] } }] }] });
  assert.deepEqual(ignored, { phones: [], count: 0 });
  assert.equal(calls.some((sql) => /FROM ft_whatsapp_lideres/.test(sql)), false);
});

test('spoken Portuguese units preserve quantities and explicit packaging without conversion', () => {
  const cases = [['litros', 'L'], ['quilogramas', 'kg'], ['mililitros', 'mL'], ['unidades', 'un'], ['sacos', 'saco'], ['caixas', 'caixa'], ['galões', 'galão'], ['fardos', 'fardo'], ['tubos', 'tubo'], ['metros quadrados', 'm²'], ['m3', 'm³']];
  for (const [spoken, canonical] of cases) {
    const draft = normalizeDraft({ itens: [{ produto: 'Material de teste', quantidade: 3, unidade: spoken }], destino: 'Estufa' });
    assert.equal(draft.itens[0].unidade, canonical);
    assert.equal(draft.itens[0].quantidade, 3);
    assert.deepEqual(missingFields(draft), []);
  }
});
