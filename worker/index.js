// 推し劇場アラート 購読サーバー（Cloudflare Workers + D1）
// 役割は「どの端末がどの推しを購読しているか」を保存するだけ。通知の送信はGitHub Actions側で行う。
//
// 公開API（サイトから呼ぶ）
//   POST /subscribe    { subscription: PushSubscriptionJSON, members: string[], applied?: string[] }
//                      ※ members に "*" で全公演。applied は「応募済み」にした枠ID（省略時は前の値のまま）
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
const MAX_APPLIED = 300;

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
  const a = body.applied;
  if (a !== undefined && (!Array.isArray(a) || a.length > MAX_APPLIED || !a.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(x)))) return 'applied が不正';
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

// 前のバージョンで作ったテーブルに applied 列を足す（あれば何もしない）
const migrated = new WeakSet();
async function migrate(env) {
  if (migrated.has(env.DB)) return;
  try { await env.DB.prepare("ALTER TABLE subs ADD COLUMN applied TEXT NOT NULL DEFAULT '[]'").run(); } catch { /* もうある */ }
  migrated.add(env.DB);
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 8000) throw new Error('too large');
  return JSON.parse(text);
}

// ---- カレンダー追加（.ics） ----
// GET /ics?d=<base64url(JSON)>  JSON: {n: ファイル名, e: [{t, s, e, a, l, d, u}]}
//   t=タイトル s/e=開始/終了(ISO) a=終日の日付(YYYY-MM-DD) l=場所 d=メモ u=URL
const icsEsc = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsFold = (line) => {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
};
const icsUtc = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
function buildIcs(q) {
  const evs = (Array.isArray(q?.e) ? q.e : []).slice(0, 20);
  if (!evs.length) return null;
  const stamp = icsUtc(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AKB48 BOOKING ALERT//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  evs.forEach((e, i) => {
    const t = String(e.t || '').slice(0, 120);
    if (!t) return;
    lines.push('BEGIN:VEVENT', `UID:${stamp}-${i}-${Math.random().toString(36).slice(2, 10)}@akb48-booking-alert`, `DTSTAMP:${stamp}`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.a || '')) {
      const d = e.a.replace(/-/g, ''), n = new Date(`${e.a}T00:00:00Z`); n.setUTCDate(n.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n.toISOString().slice(0, 10).replace(/-/g, '')}`);
    } else {
      const s = icsUtc(e.s), en = icsUtc(e.e || e.s);
      if (!s) return lines.splice(lines.lastIndexOf('BEGIN:VEVENT'));
      lines.push(`DTSTART:${s}`, `DTEND:${en}`);
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(t)}`, 'TRIGGER:-PT1H', 'END:VALARM');
    }
    lines.push(`SUMMARY:${icsEsc(t)}`);
    if (e.l) lines.push(`LOCATION:${icsEsc(String(e.l).slice(0, 120))}`);
    if (e.d) lines.push(`DESCRIPTION:${icsEsc(String(e.d).slice(0, 1000))}`);
    if (/^https:\/\/[^\s]+$/.test(e.u || '')) lines.push(`URL:${String(e.u).slice(0, 500)}`);
    lines.push('END:VEVENT');
  });
  if (!lines.includes('BEGIN:VEVENT')) return null;
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
function icsResponse(url) {
  const raw = url.searchParams.get('d') || '';
  if (raw.length > 8000) return new Response('too long', { status: 400 });
  let q = null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    q = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0))));
  } catch { return new Response('bad request', { status: 400 }); }
  const body = buildIcs(q);
  if (!body) return new Response('no events', { status: 400 });
  const name = (String(q.n || 'event').replace(/[^\w.-]/g, '').slice(0, 40) || 'event') + '.ics';
  return new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    try {
      if (req.method === 'GET' && url.pathname === '/ics') return icsResponse(url);
      if (req.method !== 'GET' || url.pathname !== '/health') await migrate(env);
      if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true }, 200, h);

      if (req.method === 'POST' && url.pathname === '/subscribe') {
        const body = await readBody(req);
        const err = validate(body);
        if (err) return json({ error: err }, 400, h);
        const members = [...new Set(body.members)];
        const applied = body.applied === undefined ? null : JSON.stringify([...new Set(body.applied)]);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO subs (endpoint, p256dh, auth, members, applied, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, COALESCE(?6, '[]'), ?5, ?5)
           ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, members = ?4, applied = COALESCE(?6, applied), updated_at = ?5`,
        ).bind(body.subscription.endpoint, body.subscription.keys.p256dh, body.subscription.keys.auth, JSON.stringify(members), now, applied).run();
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
            'SELECT endpoint, p256dh, auth, members, applied FROM subs ORDER BY endpoint LIMIT ?1 OFFSET ?2',
          ).bind(limit, offset).all();
          const items = results.map((r) => ({
            subscription: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
            members: JSON.parse(r.members),
            applied: (() => { try { return JSON.parse(r.applied || '[]'); } catch { return []; } })(),
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
