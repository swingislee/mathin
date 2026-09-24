import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

export const listenLoopback = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

/** HTTP 联调的 REST / 微信替身；原生 Auth 与 Next 路由本体保持真实。
 * 数据库权限和 SQL 单独由 wechat-oauth-local.mjs 的回滚检查覆盖。
 */
export function createWechatNextGateway({ key, cert, fixtureKey, ownerId, serviceKey }) {
  let nativeOrigin, nextPort;
  const tickets = new Map(), snapshots = new Map(), codes = new Set(), accesses = new Set();
  const observations = { exchanges: 0, wechatRequests: 0, audits: 0 };
  const json = (res, data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const body = async req => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) throw new Error('FIXTURE_BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  };
  async function nativeUser() {
    const response = await fixtureRequest(new URL('/auth/v1/admin/users/' + ownerId, nativeOrigin), {
      headers: { authorization: 'Bearer ' + serviceKey }, rejectUnauthorized: false,
    });
    if (response.status !== 200) throw new Error('FIXTURE_OWNER_READ_FAILED');
    return JSON.parse(response.body);
  }
  async function ownerOf(subject) {
    const data = await nativeUser();
    const user = data.user ?? data;
    return user.identities?.some(identity => identity.provider === 'custom:wechat' && identity.identity_data?.sub === subject) ? ownerId : null;
  }
  async function rest(req, res, url) {
    if (req.headers.authorization !== 'Bearer ' + serviceKey) return json(res, { code: 'fixture_auth' }, 403);
    const name = url.pathname.slice('/rest/v1/'.length);
    const input = req.method === 'POST' ? await body(req) : {};
    if (name === 'rpc/allow_wechat_oauth_attempt') return json(res, true);
    if (name === 'rpc/find_wechat_auth_user') return json(res, await ownerOf(input.p_subject));
    if (name === 'rpc/consume_wechat_oauth_ticket') {
      const ticket = tickets.get(input.p_token_hash);
      if (!ticket || ticket.kind !== input.p_kind || ticket.browser_hash !== input.p_browser_hash || Date.parse(ticket.expires_at) <= Date.now()) return json(res, null);
      tickets.delete(input.p_token_hash);
      return json(res, ticket.payload);
    }
    if (name === 'profiles') return json(res, [{ account_status: 'active', is_active: true, password_change_required: false }]);
    if (name === 'wechat_oauth_tickets') {
      if (req.method === 'POST') {
        if (tickets.has(input.token_hash)) return json(res, { code: '23505' }, 409);
        tickets.set(input.token_hash, input);
        return json(res, null, 201);
      }
      const equal = field => url.searchParams.get(field)?.slice(3);
      const ticket = tickets.get(equal('token_hash'));
      const found = ticket && ticket.kind === equal('kind') && ticket.browser_hash === equal('browser_hash') && Date.parse(ticket.expires_at) > Date.now();
      return json(res, found ? [{ payload: ticket.payload }] : []);
    }
    if (name === 'wechat_profile_snapshots' && req.method === 'POST') {
      if (await ownerOf(input.subject) !== input.user_id) return json(res, { code: 'identity_required' }, 409);
      snapshots.set(input.user_id, input);
      return json(res, null, 201);
    }
    if (name === 'wechat_binding_audits' && req.method === 'POST') {
      observations.audits++;
      return json(res, null, 201);
    }
    return json(res, { code: 'unexpected_fixture_request' }, 400);
  }
  function proxy(req, res, target, tls) {
    const upstream = (tls ? https : http).request(new URL(req.url, target), {
      method: req.method,
      headers: { ...req.headers, ...(tls ? {} : { 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host, 'x-real-ip': '127.0.0.1' }) },
      ...(tls ? { rejectUnauthorized: false } : {}),
    }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { if (!res.headersSent) json(res, { error: 'fixture_upstream_failed' }, 502); else res.destroy(); });
    upstream.setTimeout(45000, () => upstream.destroy());
    req.pipe(upstream);
  }
  const server = https.createServer({ key, cert }, async (req, res) => {
    try {
      const url = new URL(req.url, 'https://fixture.invalid');
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') observations.exchanges++;
        return proxy(req, res, nativeOrigin, true);
      }
      if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url);
      if (url.pathname === '/mock/wechat/sns/oauth2/access_token') {
        if (url.searchParams.get('appid') !== 'touristappid' || url.searchParams.get('secret') !== fixtureKey || !codes.delete(url.searchParams.get('code'))) return json(res, { errcode: 40029 });
        const access = randomBytes(32).toString('hex'); accesses.add(access); observations.wechatRequests++;
        return json(res, { access_token: access, openid: 'synthetic-openid', unionid: 'synthetic-unionid', scope: 'snsapi_login' });
      }
      if (url.pathname === '/mock/wechat/sns/userinfo') {
        if (!accesses.delete(url.searchParams.get('access_token'))) return json(res, { errcode: 40001 });
        return json(res, { openid: 'synthetic-openid', unionid: 'synthetic-unionid', nickname: 'Synthetic WeChat', headimgurl: 'https://thirdwx.qlogo.cn/fixture' });
      }
      if (!nextPort) return json(res, { error: 'fixture_starting' }, 503);
      return proxy(req, res, `http://127.0.0.1:${nextPort}`, false);
    } catch { json(res, { error: 'fixture_request_failed' }, 500); }
  });
  return {
    server, tickets, snapshots, observations,
    connect: (native, port) => { nativeOrigin = native; nextPort = port; },
    code: () => { const code = randomBytes(24).toString('hex'); codes.add(code); return code; },
    reset: () => { tickets.clear(); snapshots.clear(); codes.clear(); accesses.clear(); },
  };
}

/** 使用 Node HTTPS 保留多个 Set-Cookie；不跟随重定向、不输出认证 URL。 */
export function fixtureRequest(url, { method = 'GET', headers = {}, body, ca, rejectUnauthorized = true } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method, headers, ca, rejectUnauthorized,
      // localhost 的 IPv4 loopback 与 Docker Desktop 的转发使用同一监听器。
      family: 4,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.setTimeout(45000, () => request.destroy(new Error('FIXTURE_HTTP_TIMEOUT')));
    request.end(body);
  });
}

export class FixtureCookieJar {
  values = new Map();
  header(url) {
    return [...this.values.values()].filter(cookie => cookie.host === url.hostname && url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === 'https:'))
      .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }
  receive(url, lines = []) {
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';').map(part => part.trim());
      const separator = pair.indexOf('='), name = pair.slice(0, separator), value = pair.slice(separator + 1);
      const options = Object.fromEntries(attributes.map(value => { const index = value.indexOf('='); return index < 0 ? [value.toLowerCase(), true] : [value.slice(0, index).toLowerCase(), value.slice(index + 1)]; }));
      const id = `${url.hostname}:${name}`;
      if (options['max-age'] === '0' || !value) this.values.delete(id);
      else this.values.set(id, { host: url.hostname, name, value, path: options.path || '/', secure: !!options.secure });
    }
  }
}
