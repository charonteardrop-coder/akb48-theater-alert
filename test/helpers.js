import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
export const LIST = fx('zaiko-list-events.json'); // 2026-11-10 13:00 JST に取得した実データ
export const DETAIL_1117 = fx('zaiko-detail-386017.json');

const page = (component, props) =>
  `<!doctype html><html><body><div id="app"></div><script data-page="app" type="application/json">${JSON.stringify({ component, props, url: '/ja', version: 'x' })}</script></body></html>`;
export const listHtml = (events) => page('Microsite/MicrositeIndex', { creator_hub_event_browser_block: { upcomingEvents: events, ongoingEvents: [], events: [] } });
export const detailHtml = (event) => page('Microsite/MicrositeEventItem', { event });

/** 実データ以外の公演の詳細は、公式ルール（会員系7日前・一般系5日前・ロビー3日前の16時）で作る */
export function synthDetail(ev) {
  if (ev.id === 386017) return DETAIL_1117;
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(ev.start_time));
  const at = (days) => { const d = new Date(`${date}T16:00:00+09:00`); d.setUTCDate(d.getUTCDate() - days); return { iso: d.toISOString() }; };
  return {
    id: ev.id, name: ev.name,
    tickets: ev.ticket_availability_list.map((t) => ({
      id: t.id, ref_name: t.name, price: 4300, url: `https://akb48.zaiko.io/apply/x${t.id}`, is_lottery: true,
      can_do_lottery_application: t.type === 'lottery_during_application',
      is_lottery_application_in_future: false,
      is_sold_out: t.is_sold_out_or_over,
      lottery_start_date: { iso: '2026-11-01T07:00:00.000Z' },
      lottery_end_date: /ロビー/.test(t.name) ? at(3) : /一般|ファミリー|女性/.test(t.name) ? at(5) : at(7),
    })),
  };
}

/** Cloudflare D1 の最小互換（node:sqlite） */
export function makeD1(schemaSql) {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  return {
    prepare(sql) {
      let args = [];
      const st = db.prepare(sql);
      const api = {
        bind: (...a) => { args = a; return api; },
        run: async () => { st.run(...args); return { success: true }; },
        all: async () => ({ results: st.all(...args).map((r) => ({ ...r })) }),
        first: async () => { const r = st.get(...args); return r ? { ...r } : null; },
      };
      return api;
    },
    _db: db,
  };
}

/** それっぽい購読（エンドポイントはApple） */
export const fakeSub = (n) => ({
  endpoint: `https://web.push.apple.com/QG${'x'.repeat(20)}${n}`,
  keys: { p256dh: 'BOr' + 'A'.repeat(84), auth: 'Q'.repeat(22) },
});
