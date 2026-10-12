/** Run under the deployment's existing process supervisor with server environment variables. */
const origin = process.env.MATHIN_MINIAPP_WORKER_ORIGIN;
const secret = process.env.MATHIN_MINIAPP_NOTIFICATION_WORKER_SECRET;
if (!origin || !secret || secret.length < 32) throw new Error('MINIAPP_NOTIFICATION_WORKER_NOT_CONFIGURED');
const endpoint = new URL('/api/internal/miniapp-notifications', origin);
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))) throw new Error('MINIAPP_NOTIFICATION_WORKER_ORIGIN_INVALID');
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; });
while (!stopping) {
  try { const result = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!result.ok) console.error('MINIAPP_NOTIFICATION_DISPATCH_UNAVAILABLE');
  } catch { console.error('MINIAPP_NOTIFICATION_DISPATCH_UNAVAILABLE'); }
  if (process.argv.includes('--once')) break;
  for (let seconds = 0; seconds < 30 && !stopping; seconds++) await new Promise(resolve => setTimeout(resolve, 1000));
}
