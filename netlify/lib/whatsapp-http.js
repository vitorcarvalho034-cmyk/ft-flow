'use strict';

const crypto = require('crypto');
const { normalizePhone } = require('./whatsapp');

function workerToken(secret) {
  return crypto.createHmac('sha256', secret).update('ft-flow-whatsapp-worker').digest('hex');
}

function trustedBaseUrl(env, worker = false) {
  // Never use Host/X-Forwarded-Host from the incoming webhook to send an internal secret.
  const value = (worker && env.DEPLOY_URL) || env.APP_URL || env.URL || 'https://ft-flow.netlify.app';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('URL de integração inválida');
  }
  return url.origin;
}

function createWorkerDispatcher({ env = process.env, fetchImpl = fetch } = {}) {
  return async function dispatch(phones) {
    const selected = [...new Set((phones || []).map(normalizePhone).filter(Boolean))];
    if (!selected.length) return 0;
    if (env.FT_WHATSAPP_ENABLED !== 'true' || !env.WHATSAPP_APP_SECRET) {
      throw new Error('Canal WhatsApp ainda não está habilitado');
    }
    const endpoint = `${trustedBaseUrl(env, true)}/.netlify/functions/whatsapp-process-background`;
    for (let offset = 0; offset < selected.length; offset += 10) {
      const result = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${workerToken(env.WHATSAPP_APP_SECRET)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones: selected.slice(offset, offset + 10) }),
      });
      if (result.status !== 202) throw new Error('Processador WhatsApp indisponível; os eventos foram preservados');
    }
    return selected.length;
  };
}

function privateResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas o ADM pode gerenciar o WhatsApp' });
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Autenticação obrigatória' });
  next();
}

function mountPublicWhatsAppRoutes(app, { service, ensureBaseDb, dispatch }) {
  app.get('/whatsapp/webhook', privateResponse, (req, res) => {
    const challenge = service.verifyChallenge(req.query);
    if (challenge === null) return res.status(403).type('text').send('Verificação inválida');
    return res.status(200).type('text').send(challenge);
  });

  app.post('/whatsapp/webhook', privateResponse, async (req, res) => {
    if (!service.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
      return res.status(403).json({ error: 'Assinatura inválida' });
    }
    const status = service.getStatus();
    if (!status.enabled) return res.status(503).json({ error: 'Canal WhatsApp desativado' });
    if (!status.ready) return res.status(503).json({ error: 'Configuração do WhatsApp incompleta' });
    try {
      await ensureBaseDb();
      const accepted = await service.ingestWebhook(req.body);
      await dispatch(accepted.phones);
      // Only acknowledge after durable intake and background admission; Meta retries otherwise.
      return res.status(200).json({ ok: true });
    } catch (_error) {
      console.error('WhatsApp: falha de recebimento ou encaminhamento; aguardando reenvio');
      return res.status(503).json({ error: 'Recebimento temporariamente indisponível' });
    }
  });
}

function mountPrivateWhatsAppRoutes(app, { service, pool, dispatch, env = process.env }) {
  app.use('/whatsapp', privateResponse);
  app.get('/whatsapp/status', requireAdmin, async (_req, res) => {
    try {
      await service.ensureDb();
      const counts = await pool.query(`SELECT
        (SELECT COUNT(*)::int FROM ft_whatsapp_lideres WHERE ativo=TRUE) AS leader_count,
        (SELECT COUNT(*)::int FROM ft_whatsapp_inbox WHERE status='pending') AS pending_count,
        ((SELECT COUNT(*)::int FROM ft_whatsapp_inbox WHERE status='failed') +
         (SELECT COUNT(*)::int FROM ft_whatsapp_outbox WHERE status='failed')) AS failed_count`);
      res.json({ ...service.getStatus(), ...counts.rows[0], webhook_url: `${trustedBaseUrl(env)}/api/whatsapp/webhook`, business_phone: normalizePhone(env.WHATSAPP_BUSINESS_PHONE) || null });
    } catch (_error) {
      res.status(503).json({ error: 'Não foi possível carregar o estado da integração' });
    }
  });

  app.get('/whatsapp/lideres', requireAdmin, async (_req, res) => {
    try { res.json(await service.listLeaders()); }
    catch (_error) { res.status(503).json({ error: 'Não foi possível carregar os líderes' }); }
  });

  const saveLeader = async (req, res) => {
    try {
      const result = await service.saveLeader(req.body, req.params.id, req.user.id);
      res.status(req.params.id ? 200 : 201).json(result);
    } catch (error) {
      const allowed = [
        'Dados do líder inválidos', 'Telefone brasileiro inválido; informe DDD e número',
        'Nome do líder deve ter ao menos 2 caracteres', 'ativo deve ser booleano',
        'ID de líder inválido', 'Líder não encontrado', 'Telefone já cadastrado para outro líder',
      ];
      if (allowed.includes(error.message)) return res.status(error.message === 'Líder não encontrado' ? 404 : 400).json({ error: error.message });
      return res.status(503).json({ error: 'Não foi possível salvar o líder' });
    }
  };
  app.post('/whatsapp/lideres', requireAdmin, saveLeader);
  app.put('/whatsapp/lideres/:id', requireAdmin, saveLeader);

  app.get('/whatsapp/conversas', requireAdmin, async (_req, res) => {
    try { res.json(await service.listConversations()); }
    catch (_error) { res.status(503).json({ error: 'Não foi possível carregar as conversas' }); }
  });

  app.post('/whatsapp/reprocessar', requireAdmin, async (req, res) => {
    if (!service.getStatus().ready) return res.status(409).json({ error: 'Conecte e habilite o WhatsApp antes de reprocessar' });
    try {
      const phones = await service.retryFailures();
      const dispatched = await dispatch(phones);
      await pool.query(`INSERT INTO audit_log (actor_id,action,target_table,meta) VALUES ($1,'reprocessar_whatsapp','ft_whatsapp_inbox',$2)`, [req.user.id, JSON.stringify({ telefones: dispatched })]);
      res.json({ ok: true, dispatched });
    } catch (_error) {
      res.status(503).json({ error: 'Não foi possível iniciar o reprocessamento; as mensagens foram preservadas' });
    }
  });

  app.get('/whatsapp/compras/:id', requireLogin, async (req, res) => {
    try {
      const details = await service.getPurchaseDetails(req.params.id);
      if (!details) return res.status(404).json({ error: 'Pedido WhatsApp não encontrado' });
      res.json(details);
    } catch (_error) { res.status(503).json({ error: 'Não foi possível carregar os detalhes do pedido' }); }
  });

  app.get('/whatsapp/midias/:id', requireLogin, async (req, res) => {
    try {
      const media = await service.getMedia(req.params.id);
      if (!media) return res.status(404).json({ error: 'Foto não encontrada' });
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Disposition', 'inline');
      res.type(media.mime_type).send(media.buffer);
    } catch (_error) { res.status(503).json({ error: 'Não foi possível carregar a foto' }); }
  });
}

module.exports = { createWorkerDispatcher, mountPublicWhatsAppRoutes, mountPrivateWhatsAppRoutes, _private: { workerToken, trustedBaseUrl } };
