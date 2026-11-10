// チーム8の劇場公演（2014〜2015年ごろ）を公式ブログの専用記事から足す。
// チーム8の出演メンバーは「劇場情報」テーマではなく、
//   「チーム8公演　出演メンバーのご案内」（【AKB48劇場】8/5(火) 名前（県）・…）
//   「11/24(月) チーム8公演 出演メンバー」（■AKB48劇場■【開演時間】11:30/15:00【出演メンバー】…）
//   「チーム8公演のチケット料金と開演時間につきまして」「次回日程の開演時間決定」（開演時間だけ）
//   「○/○(金)の公演メンバーと予想応募倍率」（ほかのチームと同じ書き方）
// で告知されていたので、それを読む。SKE48・NMB48・HKT48劇場への出張公演は入れない。
//
// 使い方：node scripts/import-team8.js <posts.json>   … [{ url, title, pub, body(HTML) }]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseShows, parseChanges, buildHistory, htmlToLines, splitMembers } from '../src/history.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/import-team8.js posts.json'); process.exit(1); }
const DIR = new URL('../docs/data/history/', import.meta.url);
const raw = JSON.parse(readFileSync(file, 'utf8'));

const N = (s) => String(s || '').normalize('NFKC');
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(Number(h))}:${m}`;
const text = (html) => N(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));
const yearOf = (pub, mo) => { const y = Number(pub.slice(0, 4)), pm = Number(pub.slice(5, 7)); return pm === 12 && mo <= 2 ? y + 1 : pm <= 2 && mo >= 11 ? y - 1 : y; };
// 「8/5(火)」「8/6(水)・8/7(木)」「8/5(火)～8/7(木)」「8/12(火)～8/15(金)」→ 日付の配列
function datesIn(s, pub) {
  const out = [];
  const t = N(s);
  for (const m of t.matchAll(/(?<![:\d])(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*[～~〜-]\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\([^)]*\))?/g)) {
    const mo = Number(m[1]), d1 = Number(m[2]), mo2 = Number(m[3] || m[1]), d2 = Number(m[4]);
    const y = yearOf(pub, mo);
    for (let d = new Date(Date.UTC(y, mo - 1, d1)); d <= new Date(Date.UTC(yearOf(pub, mo2), mo2 - 1, d2)); d = new Date(d.getTime() + 864e5)) out.push(d.toISOString().slice(0, 10));
  }
  const rest = t.replace(/(?<![:\d])(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*[～~〜-]\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\([^)]*\))?/g, '');
  for (const m of rest.matchAll(/(?<![:\d])(\d{1,2})\/(\d{1,2})(?![:\d])/g)) out.push(`${yearOf(pub, Number(m[1]))}-${pad(m[1])}-${pad(m[2])}`);
  return [...new Set(out)];
}
const timesIn = (s) => [...N(s).matchAll(/(\d{1,2})(?::|時)(\d{2})分?/g)].map((m) => hhmm(m[1], m[2]));
const isAkbTheater = (head) => /AKB48劇場/.test(head) && !/SKE|NMB|HKT|NGT|STU/.test(head);

// 開演時間のお知らせ → { 日付: [時刻] }
const timeOf = new Map();
for (const p of raw) {
  if (!/開演時間|次回日程/.test(N(p.title))) continue;
  const t = text(p.body);
  // 【AKB48劇場】のブロックだけ
  for (const blk of t.split(/(?=【[^】]*劇場[^】]*】|■[^■]*劇場■|\n[A-Z]{3}48劇場\n)/)) {
    const head = blk.split('\n')[0];
    if (!isAkbTheater(head) && !/^AKB48劇場/.test(blk.trim())) continue;
    for (const line of blk.split(/\n(?=\d{1,2}\/)/)) {
      const ds = datesIn(line.split('⇒')[0], p.pub), ts = timesIn(line.split('⇒').slice(1).join(' ') || line);
      if (ds.length && ts.length) for (const d of ds) timeOf.set(d, ts);
    }
  }
}


// 「出演メンバーのご案内」系：劇場の見出し・日付・開演時間・メンバーの行を順に読む
function parseLineup(t, pub, title) {
  const out = [];
  const ttl = (N(t).match(/【演目】\s*([^\n]+)/) || [])[1]?.trim()
    || (/会いたかった/.test(t) ? 'チーム8「会いたかった」公演' : 'チーム8「PARTYが始まるよ」公演');
  let akb = true;            // いまの見出しがAKB48劇場か
  let pending = [];          // メンバー待ちの [{date, times}]
  const dateList = (line) => {
    const ds = [...datesIn(line, pub)];
    for (const m of N(line).matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) ds.push(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
    for (const m of N(line).matchAll(/(?<![\d年\/])(\d{1,2})月(\d{1,2})日/g)) ds.push(`${yearOf(pub, Number(m[1]))}-${pad(m[1])}-${pad(m[2])}`);
    return [...new Set(ds)];
  };
  // 1行に1人ずつ「坂口渚沙(北海道)★」と並ぶ書き方は、まとめて1行にしてから読む
  const PREF = /^[^\s・、/]{2,8}\((?:北海道|東京都|大阪府|京都府|..県|...県)\)★?$/;
  const rows = [];
  for (const raw of N(t).split(/\n|(?<=。)/)) {
    const l = raw.trim();
    if (PREF.test(l) && rows.length && rows[rows.length - 1].multi) rows[rows.length - 1].text += '・' + l.replace(/★$/, '');
    else rows.push({ text: l.replace(/★$/, ''), multi: PREF.test(l) });
  }
  for (const { text: raw } of rows) {
    const line = raw.trim();
    if (!line) continue;
    const venue = line.match(/【([^】]*劇場)】|■([^■=]*劇場)/);
    if (venue && !/\d{1,2}\/\d{1,2}/.test(line)) { akb = isAkbTheater(venue[1] || venue[2]); pending = []; continue; }
    if (/チケット料金|円|ご応募|お待ち|ご了承|決定しました|付き添い|現金/.test(line) && !/・.*・.*・/.test(line)) continue;
    const head = line.match(/【([^】]*\d{1,2}\/\d{1,2}[^】]*)】/);
    const namesPart = (head ? line.slice(line.indexOf(head[0]) + head[0].length) : line).replace(/^【出演メンバー】(\(.*?\))?/, '').replace(/\//g, '・');
    const mem = splitMembers(namesPart);
    if (mem.length >= 8 && /[・/]/.test(line)) {
      if (head) pending.push(...dateList(head[1]).map((d) => ({ date: d, times: timesIn(head[1].replace(/(?<![:\d])\d{1,2}\/\d{1,2}(?![:\d])/g, '')) })));
      if (akb) for (const sl of pending) for (const tm of sl.times.length ? sl.times : (timeOf.get(sl.date) || [''])) out.push({ date: sl.date, time: tm, title: ttl, note: '', members: mem });
      pending = [];
      continue;
    }
    const ds = /^\d{4}年\d{1,2}月\d{1,2}日.*(までの|の)(AKB48|チーム)/.test(line) || /のAKB48劇場公演|に出演する/.test(line) ? [] : dateList(line);
    const ts = timesIn(line.replace(/(?<![:\d])\d{1,2}\/\d{1,2}(?![:\d])/g, ''));
    if (ds.length) { pending.push(...ds.map((d) => ({ date: d, times: ts }))); continue; }
    if (ts.length && pending.length) for (const sl of pending) if (!sl.times.length) sl.times = ts;
  }
  return out;
}

const posts = [];
for (const p of raw) {
  const title = N(p.title);
  if (/出張|SKE48劇場|NMB48劇場|HKT48劇場|ツアー|握手|イベント/.test(title) && !/AKB48劇場/.test(title)) continue;
  const t = text(p.body);
  const lines = htmlToLines(p.body || '');
  const shows = [];
  if (/予想応募倍率/.test(title)) {
    shows.push(...parseShows(lines, p.pub, p.title));
  } else if (/出演メンバー/.test(title) && !/変更/.test(title)) {
    const got = parseLineup(t, p.pub, title); if (process.env.DEBUG && p.pub.startsWith(process.env.DEBUG)) console.error(title, JSON.stringify(got.map((x) => [x.date, x.time, x.members.length]))); shows.push(...got);
  }
  const changes = /変更|休演|一部出演/.test(title) ? parseChanges(lines, p.pub) : [];
  if (shows.length || changes.length) posts.push({ id: p.url, title: p.title, pub: p.pub, url: p.url, shows, changes });
}
const { shows, applied } = buildHistory(posts);

// 既存データへ：同じ日時がなければ追加、あっても時刻なし／メンバー不足なら置き換え。時刻なしの仮の行（YYYYMMDD-x）は消す
const idxPath = new URL('index.json', DIR);
const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
let added = 0, replaced = 0;
const byYear = {};
for (const s of shows) if (s.date && s.members.length >= 8) (byYear[s.date.slice(0, 4)] = byYear[s.date.slice(0, 4)] || []).push(s);
for (const [y, list] of Object.entries(byYear)) {
  const p = new URL(`${y}.json`, DIR);
  let cur = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  for (const s of list) {
    const rec = { id: `${s.date.replace(/-/g, '')}-${s.time ? s.time.replace(':', '') : 'x'}`, date: s.date, time: s.time || '', title: s.title, note: s.note || '', members: s.members, src: 'team8' };
    const same = cur.findIndex((o) => o.date === s.date && o.time === (s.time || ''));
    if (same >= 0) {
      const o = cur[same];
      if (o.members.length < 8 || o.guess) { cur[same] = { ...rec, id: o.id, title: o.title || rec.title }; replaced++; }
      continue;
    }
    if (s.time) cur = cur.filter((o) => !(o.date === s.date && !o.time && /チーム8|チーム８/.test(o.title))); // 時刻なしの仮の行
    cur.push(rec); added++;
  }
  cur.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  writeFileSync(p, JSON.stringify(cur));
  idx.counts[y] = cur.length;
}
writeFileSync(idxPath, JSON.stringify(idx, null, 1) + '\n');
console.log(`チーム8の記事 ${posts.length} 件 → 公演 ${shows.length} 件（追加 ${added} / 置き換え ${replaced}）、メンバー変更 ${applied} 件、開演時間 ${timeOf.size} 日分`);
