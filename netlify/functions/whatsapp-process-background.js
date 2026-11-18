'use strict';

// Retired channel. Keep the old URL harmless without deleting historical records.
// No database, provider, media, or AI calls may run through this handler.
exports.handler = async () => ({
  statusCode: 410,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ error: 'Integração WhatsApp removida. Use o assistente dentro do aplicativo.' }),
});
