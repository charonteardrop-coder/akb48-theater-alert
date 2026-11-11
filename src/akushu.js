// 握手会・お話し会まわり：公式ニュース（universal-music.co.jp/akb48/news/）を読んで
// 「OS盤の申込受付スケジュール」と「イベントの開催日程」を取り出す。通知の文面もここで作る。
// ネットワークには触らない（取得は run.js 側）。
import { parse } from 'node-html-parser';
import { fmtJst } from './core.js';

export const NEWS = 'https://www.universal-music.co.jp/akb48/news/';
/** 購読の members に入れる印。これが入っている端末にだけ握手会の通知を送る */
export const TOKEN = '#akushu';

const norm = (s) => String(s || '').normalize('NFKC').replace(/[〜～]/g, '~').replace(/[ \t　]+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d, hm = '00:00') => `${y}-${pad(m)}-${pad(d)}T${hm.padStart(5, '0')}:00+09:00`;

/** 握手会系の記事かどうか（一覧のタイトルで判断） */
export const wanted = (title) => /握手会|お話し会|写真会|サイン会|販売(受付)?開始|発売記念イベント/.test(norm(title))
  && !/生配信|会場CD販売/.test(norm(title));

/** ニュース一覧 → [{slug, url, date:'YYYY-MM-DD', title}] */
export function parseNewsList(html) {
  const out = [];
  for (const a of parse(html).querySelectorAll('.list-row a')) {
    const url = a.getAttribute('href') || '';
    const m = url.match(/\/akb48\/news\/([0-9a-z-]+)\/?$/i);
    const d = norm(a.querySelector('.tags__date')?.text).match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    const title = norm([...a.querySelectorAll('p')].filter((p) => !p.classList.contains('tags')).map((p) => p.text).join(' '));
    if (m && d && title) out.push({ slug: m[1], url, date: `${d[1]}-${pad(d[2])}-${pad(d[3])}`, title });
  }
  return out;
}

/** 記事本文 → { lines, links } */
export function articleText(html) {
  // ページ全体を解析すると記事によっては本文が見つからなくなるので、本文の部分だけ切り出してから読む
  const a = html.indexOf('main-editor-content');
  const from = a < 0 ? -1 : html.lastIndexOf('<div', a);
  if (from < 0) return { lines: [], links: [] };
  const to = html.indexOf('</article>', from);
  const root = parse(html.slice(from, to < 0 ? undefined : to));
  const links = root.querySelectorAll('a').map((a) => a.getAttribute('href')).filter(Boolean);
  const lines = root.structuredText.split('\n').map(norm).filter(Boolean);
  return { lines, links };
}

/** どのリリースの話か（'69th' や アルバム名） */
export function releaseOf(title) {
  const t = norm(title);
  const n = t.match(/(\d+)\s*(?:st|nd|rd|th)\s*(?:シングル|SG|Single)/i);
  if (n) {
    const k = Number(n[1]);
    const suf = k % 100 >= 11 && k % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th';
    return { id: `${k}${suf}`, label: `${k}${suf}シングル` };
  }
  const q = t.match(/「([^」]+)」\s*公演アルバム/);
  if (q) return { id: q[1], label: `「${q[1]}」公演アルバム` };
  return null;
}
const songOf = (title) => { const m = norm(title).match(/『([^』]+)』/); return m && m[1] !== 'タイトル未定' ? m[1] : ''; };

/** 月日だけの日付に年を付ける（記事の日付より3か月以上前の月なら翌年） */
function yearFor(month, base) {
  const [by, bm] = base.split('-').map(Number);
  return month < bm - 3 ? by + 1 : by;
}

const RANGE = /(?:(\d{4})年)?(\d{1,2})[\/月](\d{1,2})日?\s*\([^)]*\)\s*(\d{1,2}:\d{2})?\s*[~\-]\s*(?:(\d{4})年)?(\d{1,2})[\/月](\d{1,2})日?\s*\([^)]*\)\s*(\d{1,2}:\d{2})?/;
function range(line, base) {
  const m = line.match(RANGE);
  if (!m) return null;
  const y1 = m[1] ? Number(m[1]) : yearFor(Number(m[2]), base);
  let y2 = m[5] ? Number(m[5]) : y1;
  if (!m[5] && Number(m[6]) < Number(m[2])) y2 = y1 + 1;
  return { start: iso(y1, m[2], m[3], m[4] || '00:00'), end: iso(y2, m[6], m[7], m[8] || '23:59') };
}

/** OS盤「第N販売開始のご案内」→ 受付（第n次）の一覧 */
export function parseSale(item, { lines, links }) {
  const no = Number((norm(item.title).match(/第\s*(\d+)\s*販売/) || [])[1]) || 1;
  const rounds = [];
  lines.forEach((l, i) => {
    const m = l.match(/第\s*(\d+)\s*次受付/);
    if (!m) return;
    const r = range(l, item.date);
    if (!r) return;
    const next = lines[i + 1] || '';
    rounds.push({ n: Number(m[1]), ...r, limit: /種.*枚|枚.*種/.test(next) && !/次受付/.test(next) ? next.slice(0, 60) : '' });
  });
  const resultHm = (lines.join('\n').match(/抽選発表は各受付終了日\s*(\d{1,2})時/) || [])[1];
  return {
    type: 'sale', no, rounds, resultHour: resultHm ? Number(resultHm) : null,
    applyUrl: links.find((u) => /official-cd\.akb48\.co\.jp|shop\.akb48\.co\.jp\/(?!contact)/.test(u)) || '',
  };
}

/** 「個別握手会／オンラインお話し会に関するご案内」→ 開催日・各部の時間 */
export function parseEventInfo(item, { lines, links }) {
  const kind = (norm(item.title).match(/「([^」]*(?:握手会|お話し会|写真会|サイン会)[^」]*)」/) || [])[1] || '';
  const days = [];
  let inSec = false;
  for (const l of lines) {
    if (/^[<◆■●【]/.test(l)) { inSec = /開催日/.test(l); continue; }
    if (!inSec) continue;
    const m = l.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*\([^)]*\)\s*(?:(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2}))?\s*(.*)$/);
    if (!m) continue;
    const venue = m[6].replace(/^[(\s]+|[)\s]+$/g, '');
    if (venue.length > 30) continue;
    days.push({ date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, venue, open: m[4] || '', close: m[5] || '' });
  }
  // 各部の時間。会場ごとに違うときは「<2026年11月21日(土)・22日(日)幕張メッセ開催分>」の見出しで分かれている
  const buckets = [{ dates: null, parts: [] }];
  for (const l of lines) {
    if (/^<.*開催分>$/.test(l)) {
      const dates = [];
      for (const m of l.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日\([^)]*\)(?:\s*・\s*(\d{1,2})日)?/g)) {
        dates.push(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
        if (m[4]) dates.push(`${m[1]}-${pad(m[2])}-${pad(m[4])}`);
      }
      if (dates.length) buckets.push({ dates, parts: [] });
      continue;
    }
    const m = l.match(/^【第\s*(\d+)\s*部】\s*受付開始\s*(\d{1,2}:\d{2})\s*\/\s*受付終了\s*(\d{1,2}:\d{2})\s*\(\D*(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)/);
    const b = buckets[buckets.length - 1];
    if (m && !b.parts.some((p) => p.n === Number(m[1]))) b.parts.push({ n: Number(m[1]), recv: m[2].padStart(5, '0'), recvEnd: m[3], start: m[4].padStart(5, '0'), end: m[5] });
  }
  const filled = buckets.filter((b) => b.parts.length);
  const parts = filled.length ? filled[0].parts : [];
  for (const d of days) {
    const b = filled.find((x) => x.dates && x.dates.includes(d.date));
    if (b && b.parts !== parts) d.parts = b.parts;
  }
  const at = lines.findIndex((l) => /参加メンバースケジュール/.test(l));
  const memberUrl = (at >= 0 && /^https?:\/\//.test(lines[at + 1] || '') ? lines[at + 1] : '')
    || links.find((u) => /universal-music\.co\.jp\/akb48\/[^/]*(kobetsu|akushu|ohanashi|_ka_|online|offline_ver|shashin)[^/]*\/?$/i.test(u) && !/meet_greet|sankaken|chusen|denshi/.test(u)) || '';
  return { type: 'event', kind, days, parts, memberUrl };
}

/** 日付つきの個別のご案内（「【10/4】…「東京握手会」のご案内」など）→ その日のイベント */
export function parseDated(item, { lines }) {
  const t = norm(item.title);
  const head = t.match(/^【(\d{1,2})\/(\d{1,2})(?:\s*[-・~]\s*(\d{1,2}))?】/);
  if (!head) return null;
  const y = yearFor(Number(head[1]), item.date);
  const dates = [`${y}-${pad(head[1])}-${pad(head[2])}`];
  if (head[3]) for (let d = Number(head[2]) + 1; d <= Number(head[3]); d++) dates.push(`${y}-${pad(head[1])}-${pad(d)}`);
  const os = /OS盤/.test(t);
  const name = os
    ? (t.match(/(個別握手会|オンラインお話し会|[^\s「」]*写真会)/) || [])[1] || ''
    : (t.match(/「([^」]*(?:握手会|お話し会|写真会|サイン会)[^」]*)」/) || [])[1] || '';
  if (!name) return null;
  const venue = os ? (t.match(/@(.+?)のご案内/) || [])[1] || '' : (lines.map((l) => l.match(/^会場\s*[::]\s*(.{2,30})$/)).find(Boolean) || [])[1] || '';
  // 事前応募（入場優先権利など）
  let apply = null;
  const ai = lines.findIndex((l) => /^【応募期間】/.test(l));
  if (ai >= 0) {
    const r = range(lines[ai].replace(/^【応募期間】/, '') || lines[ai + 1] || '', item.date) || range(lines[ai + 1] || '', item.date);
    if (r) {
      const ri = lines.findIndex((l) => /^【当選(通知|発表)】/.test(l));
      const rm = ri >= 0 ? (lines[ri] + ' ' + (lines[ri + 1] || '')).match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*\([^)]*\)\s*(\d{1,2}:\d{2})?/) : null;
      const what = (lines.slice(Math.max(0, ai - 12), ai).reverse().find((l) => /応募方法|応募抽選/.test(l) && /「/.test(l)) || '').match(/「([^」]+)」/);
      apply = { ...r, result: rm ? iso(rm[1] || r.end.slice(0, 4), rm[2], rm[3], rm[4] || '00:00') : '', what: what ? what[1] : '事前応募' };
    }
  }
  return { type: os ? 'guide' : 'other', name, dates, venue, apply };
}

/**
 * 参加メンバーの表（PDFの1ページ＝1開催日）→ その日の「誰がどの部に出て、抽選企画が何か」
 * 行＝メンバー、列＝第n部、マス＝「私物サイン」「色紙サイン」（お話し会は「サインA」「サインB」）。空のマスは不参加。
 * @param {Array<{s,x,y}>} items pdfPages() の1ページぶん
 * @returns {{date, venue, members: Record<string, string[]>, legend: string[]} | null} members[name][部-1] = マスの文字（不参加は ''）
 */
export function parseLineupPage(items) {
  const it = items.map((i) => ({ ...i, s: norm(i.s) }));
  const head = it.map((i) => i.s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\([^)]*\)\s*\/?\s*(.*)$/)).find(Boolean);
  const cols = it.filter((i) => /^第\d+部$/.test(i.s)).map((i) => ({ n: Number(i.s.match(/\d+/)[0]), x: i.x, y: i.y })).sort((a, b) => a.n - b.n);
  const mh = it.find((i) => i.s === 'メンバー');
  if (!head || !cols.length || !mh) return null;
  const cells = it.filter((i) => i.y < mh.y - 5 && i.x > mh.x + 60 && i.s.length <= 14 && !/^[\d:~\s]+$/.test(i.s));
  const members = {};
  for (const m of it.filter((i) => i.y < mh.y - 5 && Math.abs(i.x - mh.x) <= 30 && i.s.length >= 2)) {
    const row = cols.map(() => '');
    for (const c of cells.filter((x) => Math.abs(x.y - m.y) <= 5)) {
      const col = cols.reduce((a, b) => (Math.abs(b.x - c.x) < Math.abs(a.x - c.x) ? b : a));
      row[cols.indexOf(col)] = c.s;
    }
    members[m.s.replace(/\s+/g, '')] = row;
  }
  if (!Object.keys(members).length) return null;
  return {
    date: `${head[1]}-${pad(head[2])}-${pad(head[3])}`, venue: head[4].trim(), members,
    legend: it.filter((i) => /^サイン[A-Z]:/.test(i.s)).map((i) => i.s),
  };
}

/** 表ぜんたい → サイトに出す小さい形 { kinds:[種類…], legend, days:{日付:{名前:'12.121'}} }（数字は kinds の番号、. は不参加） */
export function packLineups(pages) {
  const days = pages.map(parseLineupPage).filter(Boolean);
  if (!days.length) return null;
  const kinds = [...new Set(days.flatMap((d) => Object.values(d.members).flat()).filter(Boolean))].sort().slice(0, 9);
  const out = {};
  for (const d of days) out[d.date] = Object.fromEntries(Object.entries(d.members).map(([n, row]) => [n, row.map((c) => (c ? String(kinds.indexOf(c) + 1) : '.')).join('')]));
  return { kinds, legend: [...new Set(days.flatMap((d) => d.legend))], days: out };
}

/** 記事1本を読む。握手会の予定として使えないものは null */
export function parseArticle(item, html) {
  const rel = releaseOf(item.title);
  if (!rel) return null;
  const body = articleText(html);
  const t = norm(item.title);
  let frag = null;
  if (/第\s*\d+\s*販売/.test(t)) frag = parseSale(item, body);
  else if (/^【\d{1,2}\/\d{1,2}/.test(t)) frag = parseDated(item, body);
  else if (/に関するご案内|開催のご案内/.test(t) && /握手会|お話し会|写真会|サイン会/.test(t) && !/参加方法/.test(t)) frag = parseEventInfo(item, body);
  if (!frag) return null;
  if (frag.type === 'sale' && !frag.rounds.length) return null;
  if (frag.type === 'event' && !frag.days.length) return null;
  return { slug: item.slug, url: item.url, date: item.date, title: t, rel: rel.id, relLabel: rel.label, song: songOf(item.title), ...frag };
}

/** 記事ごとの結果をリリース単位にまとめる（サイトに出す形） */
export function buildReleases(frags, now = new Date(), keepDays = 120) {
  const map = new Map();
  const byDate = [...frags].sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  for (const f of byDate) {
    if (!map.has(f.rel)) map.set(f.rel, { id: f.rel, label: f.relLabel, song: '', applyUrl: '', sales: [], events: [], others: [] });
    const r = map.get(f.rel);
    if (f.song) r.song = f.song;
    if (f.type === 'sale') {
      if (f.applyUrl) r.applyUrl = f.applyUrl;
      r.sales = r.sales.filter((s) => s.no !== f.no);
      r.sales.push({ no: f.no, url: f.url, resultHour: f.resultHour, rounds: f.rounds.map((x) => ({ ...x, key: `${f.rel}:${f.no}:${x.n}` })) });
    } else if (f.type === 'event') {
      r.events = r.events.filter((e) => e.kind !== f.kind);
      r.events.push({
        kind: f.kind, url: f.url, memberUrl: f.memberUrl, parts: f.parts,
        signs: f.lineup ? f.lineup.kinds : [], legend: f.lineup ? f.lineup.legend : [],
        days: f.days.map((d) => ({ ...d, ...(f.lineup && f.lineup.days[d.date] ? { lineup: f.lineup.days[d.date] } : {}) })),
      });
    } else if (f.type === 'guide') {
      const ev = r.events.find((e) => e.kind === f.name);
      if (ev) for (const d of ev.days) if (f.dates.includes(d.date)) { d.guideUrl = f.url; if (!d.venue && f.venue) d.venue = f.venue; }
    } else if (f.type === 'other') {
      let o = r.others.find((x) => x.name === f.name && x.dates[0] === f.dates[0]);
      if (!o) { o = { name: f.name, dates: f.dates, venue: '', url: f.url, apply: null }; r.others.push(o); }
      o.url = f.url;
      if (f.venue) o.venue = f.venue;
      if (f.apply) o.apply = { ...f.apply, key: `${f.rel}:${f.name}:${f.dates[0]}` };
    }
  }
  const cut = new Date(now.getTime() - keepDays * 864e5).toISOString();
  const last = (r) => [
    ...r.sales.flatMap((s) => s.rounds.map((x) => x.end)),
    ...r.events.flatMap((e) => e.days.map((d) => `${d.date}T23:59:00+09:00`)),
    ...r.others.flatMap((o) => o.dates.map((d) => `${d}T23:59:00+09:00`)),
  ].map((x) => new Date(x).toISOString()).sort().pop() || '';
  const out = [...map.values()].filter((r) => last(r) >= cut);
  for (const r of out) {
    r.sales.sort((a, b) => a.no - b.no);
    r.others.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  }
  return out.sort((a, b) => last(b).localeCompare(last(a)));
}

/** 申込の窓口をぜんぶ平らに → [{key, title, start, end, url, apply}] */
export function windows(releases) {
  const out = [];
  for (const r of releases) {
    for (const s of r.sales) for (const x of s.rounds) {
      out.push({ key: x.key, title: `${r.label} OS盤 第${s.no}販売 第${x.n}次受付`, start: x.start, end: x.end, limit: x.limit, apply: r.applyUrl });
    }
    for (const o of r.others) if (o.apply) {
      out.push({ key: o.apply.key, title: `${r.label}「${o.name}」${o.apply.what}`, start: o.apply.start, end: o.apply.end, limit: '', apply: o.url });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** 締切の何時間前に知らせるか：受付が3日より長いものは24時間前、短いものは3時間前 */
export const leadHours = (w) => (new Date(w.end) - new Date(w.start) > 3 * 864e5 ? 24 : 3);

/**
 * このチェックで知らせること。notified は「送った印」の集合（'open:key' / 'close:key'）で、ここで書き足す。
 * @returns {{opened: object[], closing: object[]}}
 */
export function dueAkushu(releases, notified, now = new Date()) {
  const opened = [], closing = [];
  for (const w of windows(releases)) {
    const s = new Date(w.start), e = new Date(w.end);
    if (now >= s && !notified.has(`open:${w.key}`)) {
      notified.add(`open:${w.key}`);
      if (now < e) opened.push(w);
    }
    if (now >= new Date(e.getTime() - leadHours(w) * 3600e3) && !notified.has(`close:${w.key}`)) {
      notified.add(`close:${w.key}`);
      // 受付開始の通知と同じ回なら、締切も書いてあるので重ねない
      if (now < e && !opened.includes(w)) closing.push(w);
    }
  }
  return { opened, closing };
}

/** 握手会の通知（TOKEN を購読している端末向け） */
export function composeAkushu(subMembers, due) {
  if (!(subMembers || []).includes(TOKEN)) return [];
  const out = [];
  const one = (w) => `${w.title}\n〆 ${fmtJst(w.end)}${w.limit ? `\n${w.limit}` : ''}`;
  if (due.opened.length) {
    out.push({
      title: '🤝 握手会の申込受付が始まったよ',
      body: due.opened.map(one).join('\n'),
      url: './?view=akushu',
      apply: due.opened.length === 1 ? due.opened[0].apply || undefined : undefined,
      tag: `ak-open-${due.opened.map((w) => w.key).join('|')}`.slice(0, 60),
    });
  }
  if (due.closing.length) {
    out.push({
      title: '⏰ 握手会の申込、締切が近いよ',
      body: due.closing.map((w) => `${w.title}\n〆 ${fmtJst(w.end)}`).join('\n'),
      url: './?view=akushu',
      apply: due.closing.length === 1 ? due.closing[0].apply || undefined : undefined,
      tag: `ak-close-${due.closing.map((w) => w.key).join('|')}`.slice(0, 60),
    });
  }
  return out;
}
