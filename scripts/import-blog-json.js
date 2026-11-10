// 公式ブログの記事（ブラウザで集めたJSON）から公演を作って docs/data/history に足す。
// import-history.js（ブログを直接読む版）と同じパーサーを使う。2012年3月以前の記事用。
//
// 使い方：node scripts/import-blog-json.js <posts.json> [--before=2012-04-01]
//   posts.json … [{ url, title, pub, body(HTML) }]
//
// 足し方：
//   ・その日時の公演がまだなければ追加
//   ・あっても、既存がメンバー不明か推定（guess）で、ブログ側に出演メンバーが載っていれば置き換え
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseShows, parseChanges, buildHistory, isRelevantTitle, htmlToLines } from '../src/history.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const before = (args.find((a) => a.startsWith('--before=')) || '--before=2012-04-01').slice(9);
if (!file) { console.error('usage: node scripts/import-blog-json.js posts.json [--before=YYYY-MM-DD]'); process.exit(1); }
const DIR = new URL('../docs/data/history/', import.meta.url);

const raw = JSON.parse(readFileSync(file, 'utf8'));
const posts = raw.filter((p) => p.pub && isRelevantTitle(p.title)).map((p) => {
  const lines = htmlToLines(p.body || '');
  const id = (p.url.match(/entry-(\d+)/) || [])[1] || p.url;
  return { id, title: p.title, pub: p.pub, url: p.url, shows: parseShows(lines, p.pub, p.title), changes: parseChanges(lines, p.pub) };
});
const { shows, applied } = buildHistory(posts);
const mine = shows.filter((s) => s.date < before && s.time);

const idxPath = new URL('index.json', DIR);
const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
let added = 0, replaced = 0;
const byYear = {};
for (const s of mine) (byYear[s.date.slice(0, 4)] = byYear[s.date.slice(0, 4)] || []).push(s);
for (const [y, list] of Object.entries(byYear)) {
  const p = new URL(`${y}.json`, DIR);
  const cur = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  const at = new Map(cur.map((s, i) => [`${s.date}|${s.time}`, i]));
  for (const s of list) {
    const rec = { id: `${s.date.replace(/-/g, '')}-${s.time.replace(':', '')}`, date: s.date, time: s.time, title: s.title, note: s.note || '', members: s.members || [], ...(s.url ? { url: s.url } : {}), src: 'blog' };
    const i = at.get(`${s.date}|${s.time}`);
    if (i == null) { cur.push(rec); at.set(`${s.date}|${s.time}`, cur.length - 1); added++; continue; }
    const old = cur[i];
    if ((old.guess || !old.members.length) && rec.members.length >= 4) {
      cur[i] = { ...rec, id: old.id, title: old.title && !/^チーム|^研究生|^公演$/.test(old.title) ? old.title : rec.title, note: [old.note, rec.note].filter(Boolean).join(' ').trim(), ...(old.absent ? { absent: old.absent } : {}) };
      replaced++;
    }
  }
  cur.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  writeFileSync(p, JSON.stringify(cur));
  idx.counts[y] = cur.length;
  if (!idx.years.includes(y)) idx.years.push(y);
}
idx.years.sort();
writeFileSync(idxPath, JSON.stringify(idx, null, 1) + '\n');
console.log(`ブログ記事 ${posts.length} 件 → ${before} より前の公演 ${mine.length} 件（追加 ${added} / 置き換え ${replaced}）、メンバー変更 ${applied} 件反映`);
