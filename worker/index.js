// 推し劇場アラート 購読サーバー（Cloudflare Workers + D1）
// 役割は「どの端末がどの推しを購読しているか」を保存するだけ。通知の送信はGitHub Actions側で行う。
//
// 公開API（サイトから呼ぶ）
//   POST /subscribe    { subscription: PushSubscriptionJSON, members: string[] }  ※ members に "*" で全公演
//   POST /unsubscribe  { endpoint }
// 管理API（GitHub Actionsから呼ぶ。Authorization: Bearer <ADMIN_TOKEN>）
//   GET  /admin/subscriptions?offset=0&limit=1000
//   POST /admin/remove { endpoints: string[] }

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^web\.push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
  /^wns2-[a-z0-9]+\.notify\.windows\.com$/,
  /^android\.googleapis\.com$/,
];
const MAX_MEMBERS = 60;

export function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && endpoint.length <= 1024 && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function validate(body) {
  const sub = body?.subscription;
  if (!sub || !validEndpoint(sub.endpoint)) return 'endpoint が不正';
  const { p256dh, auth } = sub.keys || {};
  if (!B64URL.test(p256dh || '') || p256dh.length > 128 || !B64URL.test(auth || '') || auth.length > 64) return 'keys が不正';
  const m = body.members;
  if (!Array.isArray(m) || m.length > MAX_MEMBERS) return 'members が不正';
  if (!m.every((x) => typeof x === 'string' && x.length >= 1 && x.length <= 20)) return 'members が不正';
  return null;
}

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'access-control-allow-origin': ok ? (allowed.includes('*') ? '*' : origin) : 'null',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

function isAdmin(req, env) {
  const h = req.headers.get('authorization') || '';
  return !!env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16 && h === `Bearer ${env.ADMIN_TOKEN}`;
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 8000) throw new Error('too large');
  return JSON.parse(text);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    try {
      if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true }, 200, h);

      if (req.method === 'POST' && url.pathname === '/subscribe') {
        const body = await readBody(req);
        const err = validate(body);
        if (err) return json({ error: err }, 400, h);
        const members = [...new Set(body.members)];
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO subs (endpoint, p256dh, auth, members, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, members = ?4, updated_at = ?5`,
        ).bind(body.subscription.endpoint, body.subscription.keys.p256dh, body.subscription.keys.auth, JSON.stringify(members), now).run();
        return json({ ok: true, members }, 200, h);
      }

      if (req.method === 'POST' && url.pathname === '/unsubscribe') {
        const body = await readBody(req);
        if (!validEndpoint(body?.endpoint)) return json({ error: 'endpoint が不正' }, 400, h);
        await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?1').bind(body.endpoint).run();
        return json({ ok: true }, 200, h);
      }

      if (url.pathname.startsWith('/admin/')) {
        if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401, h);

        if (req.method === 'GET' && url.pathname === '/admin/subscriptions') {
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 1000, 1), 5000);
          const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
          const { results } = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth, members FROM subs ORDER BY endpoint LIMIT ?1 OFFSET ?2',
          ).bind(limit, offset).all();
          const items = results.map((r) => ({
            subscription: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
            members: JSON.parse(r.members),
          }));
          return json({ items, next: items.length === limit ? offset + limit : null }, 200, h);
        }

        if (req.method === 'POST' && url.pathname === '/admin/remove') {
          const body = await readBody(req);
          const eps = (body?.endpoints || []).filter((e) => typeof e === 'string').slice(0, 500);
          for (const e of eps) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?1').bind(e).run();
          return json({ ok: true, removed: eps.length }, 200, h);
        }
      }

      return json({ error: 'not found' }, 404, h);
    } catch (e) {
      return json({ error: 'bad request' }, 400, h);
    }
  },
};
