'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const { createWhatsAppService } = require('../lib/whatsapp');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

function workerToken(secret) {
  return crypto.createHmac('sha256', String(secret || '')).update('ft-flow-whatsapp-worker').digest('hex');
}

function timingSafeBearer(header, secret) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!match || !secret) return false;
  const received = Buffer.from(match[1], 'utf8');
  const expected = Buffer.from(workerToken(secret), 'utf8');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function parseBody(event) {
  if (event?.body === undefined || event?.body === null || event.body === '') return {};
  if (typeof event.body === 'object') return event.body;
  try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); }
  catch { return null; }
}

/**
 * Netlify Background Function (v1 handler). Throwing after authentication tells
 * the background runtime to retry an operational failure; intentionally do not
 * turn this into a 500 response.
 */
exports.handler = async (event) => {
  if (process.env.FT_WHATSAPP_ENABLED !== 'true') return response(403, { error: 'Canal WhatsApp desativado' });
  if (!timingSafeBearer(event?.headers?.authorization || event?.headers?.Authorization, process.env.WHATSAPP_APP_SECRET)) {
    return response(401, { error: 'Não autorizado' });
  }
  const body = parseBody(event);
  if (!body || !Array.isArray(body.phones) || body.phones.length > 100 || body.phones.some((phone) => typeof phone !== 'string')) {
    return response(400, { error: 'Payload inválido; phones deve ter no máximo 100 itens' });
  }
  const service = createWhatsAppService({ pool: getPool(), env: process.env, fetchImpl: fetch });
  // No webhook body/media is accepted here. Only allowlisted phone queues are processed.
  await service.ensureDb();
  const requested = [...new Set(body.phones)];
  // Pilot safety bound: a background invocation processes at most ten phone queues.
  // pendingPhones orders actual pending SQL work, preventing a 100-phone payload
  // from repeatedly starving phones after its first ten entries.
  const phones = await service.pendingPhones(requested, 10, true);
  const results = [];
  for (const phone of phones) results.push(await service.processPhone(phone));
  const remaining = await service.pendingPhones(requested, 100);
  const terminalBlockedPhones = new Set(results
    .filter((result) => result.blocked && !result.retryable).map((result) => result.phone));
  // A terminal dead letter blocks its own later pending messages until an ADM
  // reset. Transient failures remain pending and explicitly request the next
  // bounded Background Function attempt (up to the core's three attempts).
  const more = results.some((result) => result.more || result.retryable)
    || remaining.some((phone) => !terminalBlockedPhones.has(phone));
  // Persisted failed rows are manual-recovery dead letters, not an automatic retry
  // signal. Only known remaining pending work asks Netlify to invoke us again.
  if (more) throw new Error('Há trabalho WhatsApp pendente para continuação');
  return response(202, { ok: true, phones: results.length, more: false, blocked: results.filter((result) => result.blocked).length });
};

exports._private = { workerToken, timingSafeBearer, parseBody };
