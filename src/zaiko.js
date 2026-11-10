// AKB48チケットセンター（akb48.zaiko.io）のページを読む
// ページには Inertia.js の初期データ（<script data-page="app" type="application/json">）が埋め込まれている

export const ORIGIN = 'https://akb48.zaiko.io';

/** HTMLから埋め込みJSONを取り出す */
export function extractPage(html) {
  const m = html.match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('zaikoのページデータが見つからない（ページ構造が変わった可能性）');
  return JSON.parse(m[1]);
}

const SHORT = [
  [/映像倉庫/, '映像倉庫'],
  [/柱の会/, '柱の会'],
  [/100発98中/, '100発98中'],
  [/^一般/, '一般'],
  [/ファミリー|カップル/, 'ファミカプ'],
  [/女性|小中学生/, '女性・小中学生'],
  [/ロビー/, 'ロビー観覧'],
];
export function shortName(name) {
  for (const [re, s] of SHORT) if (re.test(name)) return s;
  return name.replace(/会員枠|枠|権利|チケット/g, '').trim() || name;
}
export const isLobby = (name) => /ロビー/.test(name);

function listStatus(t) {
  const type = t.type || '';
  if (type === 'lottery_during_application' || type === 'on_sale' || type === 'available') return 'open';
  if (/sold_out|sale_over/.test(type) || t.is_sold_out_or_over) return 'soldout';
  if (/ended/.test(type) || t.is_lottery_ended) return 'ended';
  if (/before|not_started|future|coming/.test(type)) return 'upcoming';
  return 'other';
}

function detailStatus(t) {
  if (t.is_sold_out) return 'soldout';
  if (t.is_lottery) {
    if (t.can_do_lottery_application) return 'open';
    if (t.is_lottery_application_in_future) return 'upcoming';
    return 'ended';
  }
  if (t.is_sale_ended) return 'ended';
  if (t.is_sale_started) return 'open';
  return 'upcoming';
}

const JST_PARTS = (iso) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );

/** "11月17日 18:30開演「ＲＥＳＥＴ」公演　千葉恵里 生誕祭" → 演目と補足 */
export function splitName(name) {
  const rest = name.replace(/^\s*\d{1,2}月\d{1,2}日\s*(\d{1,2}:\d{2}開演)?\s*/, '');
  const m = rest.match(/「[^」]+」\s*公演/);
  if (m) {
    const note = (rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)).replace(/[\s　]+/g, ' ').trim();
    return { title: m[0].replace(/\s+/g, ''), note };
  }
  return { title: rest.replace(/[\s　]+/g, ' ').trim(), note: '' };
}

export const canonicalUrl = (url) => url.replace(/^(https:\/\/[^/]+)\/(ja|en|zh-tw|zh-cn|ko)\//, '$1/').split('?')[0];

/** トップページ → 劇場公演の一覧 */
export function parseList(html) {
  const page = extractPage(html);
  const block = page.props?.creator_hub_event_browser_block;
  if (!block) throw new Error('イベント一覧ブロックが見つからない');
  const events = [...(block.upcomingEvents || []), ...(block.ongoingEvents || []), ...(Array.isArray(block.events) ? block.events : [])];
  const seen = new Set();
  return events
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
    .filter((e) => { const v = e.venue?.data?.name || ''; return v ? /劇場/.test(v) : /公演/.test(e.name); })
    .map(fromListEvent);
}

export function fromListEvent(e) {
  const p = JST_PARTS(e.start_time);
  const { title, note } = splitName(e.name);
  const slots = (e.ticket_availability_list || []).map((t) => ({
    id: t.id, name: t.name, short: shortName(t.name), lobby: isLobby(t.name), status: listStatus(t), label: t.label || '',
  }));
  return {
    id: e.id,
    url: canonicalUrl(e.url),
    name: e.name,
    title,
    note,
    date: `${p.year}-${p.month}-${p.day}`,
    label: `${Number(p.month)}/${Number(p.day)}(${p.weekday})`,
    time: `${p.hour}:${p.minute}`,
    start: e.start_time,
    members: [...new Set((e.artists || []).map((a) => a.name.replace(/\s+/g, '')))],
    slots,
  };
}

/** 一覧の状態の指紋。変わったときだけ詳細ページを取りに行く */
export const fingerprint = (s) => s.slots.map((x) => `${x.id}:${x.status}`).join(',') + '|' + s.members.join(',');

/** 詳細ページ → 枠ごとの受付期間・申込URL */
export function parseDetail(html) {
  const ev = extractPage(html).props?.event;
  if (!ev) throw new Error('イベント詳細が見つからない');
  return (ev.tickets || []).map((t) => ({
    id: t.id,
    name: t.ref_name,
    status: detailStatus(t),
    start: t.lottery_start_date?.iso || t.on_sale_from?.iso || null,
    end: t.lottery_end_date?.iso || t.on_sale_until?.iso || null,
    applyUrl: t.url || null,
    price: t.price ?? null,
  }));
}

/** 一覧の枠情報に詳細の日時を合体 */
export function mergeDetail(show, detail) {
  const byId = new Map(detail.map((d) => [d.id, d]));
  show.slots = show.slots.map((s) => {
    const d = byId.get(s.id);
    return d ? { ...s, status: d.status, start: d.start, end: d.end, applyUrl: d.applyUrl, price: d.price } : s;
  });
  for (const d of detail) {
    if (!show.slots.some((s) => s.id === d.id)) {
      show.slots.push({ id: d.id, name: d.name, short: shortName(d.name), lobby: isLobby(d.name), status: d.status, label: '', start: d.start, end: d.end, applyUrl: d.applyUrl, price: d.price });
    }
  }
  return show;
}

/** 本命の枠（ロビー観覧以外）が受付中か */
export const isOpen = (show) => show.slots.some((s) => !s.lobby && s.status === 'open');

/** サイトマップ → 公演ページのURL（日本語版のみ・重複なし） */
export function parseSitemap(xml) {
  const urls = [...xml.matchAll(/<loc>\s*(https:\/\/akb48\.zaiko\.io\/ja\/(?:e|item)\/[^<\s]+)\s*<\/loc>/g)].map((m) => canonicalUrl(m[1]));
  return [...new Set(urls)];
}

/** 公演ページ（詳細）→ アーカイブ用の公演情報。劇場公演でなければ null */
export function parseEventPage(html, url) {
  const ev = extractPage(html).props?.event;
  if (!ev || !ev.display_date_period?.start?.iso) return null;
  const venue = ev.venue?.data?.name || ev.venue?.name || '';
  if (venue ? !/劇場/.test(venue) : !/公演/.test(ev.name)) return null; // 会場名があれば「劇場」で判定（コンサート等を除く）
  const s = fromListEvent({
    id: ev.id, name: ev.name, url, start_time: ev.display_date_period.start.iso,
    venue: { data: { name: venue } }, artists: ev.performers || [], ticket_availability_list: [],
  });
  const { id, date, label, time, start, title, note, members } = s;
  return { id, date, label, time, start, title, note, members, url: s.url };
}
