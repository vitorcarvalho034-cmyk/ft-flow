'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createWorkerDispatcher, mountPublicWhatsAppRoutes, mountPrivateWhatsAppRoutes, _private } = require('../netlify/lib/whatsapp-http');

async function harness(overrides = {}) {
  const calls = { db: 0, ingest: 0, dispatch: 0, save: 0 };
  const env = { APP_URL: 'https://ft-flow.netlify.app', FT_WHATSAPP_ENABLED: 'true', WHATSAPP_APP_SECRET: 'test-secret' };
  const service = {
    getStatus: () => ({ enabled: true, ready: true, missing: [] }),
    verifyChallenge: (query) => query['hub.verify_token'] === 'test-verify' ? query['hub.challenge'] : null,
    verifySignature: (raw, signature) => Buffer.isBuffer(raw) && signature === 'test-signature',
    ingestWebhook: async () => { calls.ingest++; return { phones: ['5511998765432'], count: 1 }; },
    ensureDb: async () => { calls.db++; },
    listLeaders: async () => [],
    saveLeader: async (body) => { calls.save++; return { id: 1, ...body }; },
    listConversations: async () => [],
    retryFailures: async () => ['5511998765432'],
    getPurchaseDetails: async (id) => id === '1' ? { origem: 'whatsapp', transcricao: 'Teste', fotos: [] } : null,
    getMedia: async (id) => id === 'known' ? { buffer: Buffer.from([255, 216, 255]), mime_type: 'image/jpeg' } : null,
    ...overrides,
  };
  const pool = { query: async () => ({ rows: [{ leader_count: 0, pending_count: 0, failed_count: 0 }] }) };
  const app = express();
  app.use(express.json({ verify(req, _res, raw) { req.rawBody = raw; } }));
  app.use((req, _res, next) => { req.url = req.url.replace(/^\/api(?=\/)/, ''); next(); });
  mountPublicWhatsAppRoutes(app, { service, ensureBaseDb: async () => { calls.db++; }, dispatch: async () => { calls.dispatch++; } });
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'Sem autenticação' });
    req.user = { role, id: 1 }; next();
  });
  mountPrivateWhatsAppRoutes(app, { service, pool, dispatch: async () => { calls.dispatch++; return 1; }, env });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/whatsapp`;
  return { calls, base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('public Meta routes reject invalid signature before database or dispatch, without JWT bypass', async () => {
  const h = await harness();
  try {
    let r = await fetch(h.base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403); assert.equal(h.calls.db, 0); assert.equal(h.calls.ingest, 0);
    r = await fetch(h.base + '/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=abc');
    assert.equal(r.status, 200); assert.equal(await r.text(), 'abc'); assert.equal(h.calls.db, 0);
    r = await fetch(h.base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'test-signature' }, body: '{}' });
    assert.equal(r.status, 200); assert.equal(h.calls.ingest, 1); assert.equal(h.calls.dispatch, 1);
  } finally { await h.close(); }
});

test('disabled channel does not acknowledge accepted incoming messages', async () => {
  const h = await harness({ getStatus: () => ({ enabled: false, ready: false }) });
  try {
    const r = await fetch(h.base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'test-signature' }, body: '{}' });
    assert.equal(r.status, 503); assert.equal(h.calls.db, 0); assert.equal(h.calls.ingest, 0);
  } finally { await h.close(); }
});

test('leader administration, conversations and retries are ADM-only; private photos require a session', async () => {
  const h = await harness();
  try {
    for (const path of ['/status', '/lideres', '/conversas', '/compras/1', '/midias/known']) {
      assert.equal((await fetch(h.base + path)).status, 401);
    }
    for (const path of ['/status', '/lideres', '/conversas']) {
      assert.equal((await fetch(h.base + path, { headers: { 'x-test-role': 'funcionario' } })).status, 403);
    }
    let r = await fetch(h.base + '/lideres', { method: 'POST', headers: { 'x-test-role': 'funcionario', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403); assert.equal(h.calls.save, 0);
    r = await fetch(h.base + '/reprocessar', { method: 'POST', headers: { 'x-test-role': 'funcionario' } });
    assert.equal(r.status, 403); assert.equal(h.calls.dispatch, 0);
    r = await fetch(h.base + '/status', { headers: { 'x-test-role': 'admin' } });
    assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal((await r.json()).webhook_url, 'https://ft-flow.netlify.app/api/whatsapp/webhook');
    r = await fetch(h.base + '/midias/known', { headers: { 'x-test-role': 'funcionario' } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from([255, 216, 255]));
    r = await fetch(h.base + '/midias/missing', { headers: { 'x-test-role': 'admin' } });
    assert.equal(r.status, 404);
  } finally { await h.close(); }
});

test('internal dispatch is bounded, HTTPS-only, authenticated, and rejects non-background responses', async () => {
  const env = { FT_WHATSAPP_ENABLED: 'true', WHATSAPP_APP_SECRET: 'test-secret', APP_URL: 'https://ft-flow.netlify.app', DEPLOY_URL: 'https://immutable--ft-flow.netlify.app' };
  const calls = [];
  const dispatch = createWorkerDispatcher({ env, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { status: 202 }; } });
  assert.equal(await dispatch(['5511998765432', '5511998765432', 'wrong']), 1);
  assert.equal(calls[0].url, 'https://immutable--ft-flow.netlify.app/.netlify/functions/whatsapp-process-background');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer ' + _private.workerToken('test-secret'));
  assert.deepEqual(JSON.parse(calls[0].opts.body), { phones: ['5511998765432'] });
  assert.equal(calls[0].opts.redirect, 'manual');
  await assert.rejects(createWorkerDispatcher({ env, fetchImpl: async () => ({ status: 200 }) })(['5511998765432']), /indisponível/);
  assert.throws(() => _private.trustedBaseUrl({ APP_URL: 'https://user:pass@evil.example/' }), /inválida/);
  assert.throws(() => _private.trustedBaseUrl({ APP_URL: 'http://ft-flow.netlify.app/' }), /inválida/);
  await assert.rejects(createWorkerDispatcher({ env: { ...env, FT_WHATSAPP_ENABLED: 'false' } })(['5511998765432']), /habilitado/);
});
