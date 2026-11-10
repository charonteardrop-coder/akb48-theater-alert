// ファンの公演レポート（個人ブログ）の「出演メンバー」で、出演者が分からない／推定の回を埋める。
// 2010年夏〜秋の一部の回だけ。劇場以外（全国ツアーなど）や、日付・回が特定できない記事は使わない。
//
// 使い方：node scripts/import-fan-reports.js <reports.json>   … [{ url, title, pub, members }]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { names } from '../src/oldsite.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/import-fan-reports.js reports.json'); process.exit(1); }
const DIR = new URL('../docs/data/history/', import.meta.url);
const reports = JSON.parse(readFileSync(file, 'utf8'));

const z2h = (s) => String(s).normalize('NFKC');
export function dateOf(r) {
  const t = z2h(r.title);
  const y4 = (r.pub || '').slice(0, 4);
  let m = t.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/) || t.match(/\((\d{2})\/(\d{1,2})\/(\d{1,2})\)/);
  if (m) return `${m[1].length === 2 ? '20' + m[1] : m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(?:20\d{2}\s+)?(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (m && y4) return `${y4}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // 「本日の〜」「昨日の〜」は投稿日から（日本時間）
  if (r.pub && /本日|今日|昨日/.test(t)) {
    const d = new Date(new Date(r.pub).getTime() + 9 * 3600e3 - (/昨日/.test(t) ? 864e5 : 0));
    return d.toISOString().slice(0, 10);
  }
  return null;
}
const slotOf = (t) => (/おやつ/.test(t) ? 'mid' : /昼/.test(t) ? 'first' : /夜/.test(t) ? 'last' : null);
const teamOf = (t) => { t = z2h(t); return /SDN48/.test(t) ? 'SDN48' : /研究生/.test(t) ? '研究生' : /チームA|A6th/.test(t) ? 'チームA' : /チームK|K6th/.test(t) ? 'チームK' : /チームB|B5th/.test(t) ? 'チームB' : null; };
// 「新チームA → …」「9期研究生 → …」の行を集める（前座ガールズは本編に出ていないので外す）
export function membersOf(text) {
  const LABEL = /(新チーム[AKB]|\d+期研究生|前座ガールズ?(?:\(研究生\))?|特別出演\(チーム.\)|\d期生(?:&1\.5期生)?)\s*→/g;
  const t = z2h(text).replace(/\[[^\]]*\]/g, '').replace(/※[\s\S]*$/, '').replace(/以下[\s\S]*$/, '').replace(/\s+/g, '');
  const marks = [...t.matchAll(LABEL)];
  const out = [];
  if (!marks.length) return [...new Set(names(t))];
  marks.forEach((m, i) => {
    if (/前座|特別出演/.test(m[1])) return;
    out.push(...names(t.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : t.length)));
  });
  return [...new Set(out)];
}

let filled = 0, skipped = 0;
const files = {};
const load = (y) => files[y] || (files[y] = existsSync(new URL(`${y}.json`, DIR)) ? JSON.parse(readFileSync(new URL(`${y}.json`, DIR), 'utf8')) : []);
const why = {};
for (const r of reports) {
  if (/ツアー|やって来た|in|＠|奉納|名古屋|大阪|福岡|北海道/i.test(z2h(r.title)) && !/劇場/.test(r.title)) { skipped++; continue; }
  const date = dateOf(r), team = teamOf(r.title), mem = membersOf(r.members);
  if (!date || !team || mem.length < 8) { skipped++; why[r.title] = 'date/team/members'; continue; }
  const day = load(date.slice(0, 4)).filter((s) => s.date === date && s.note.split(' ')[0] === team);
  if (!day.length) { skipped++; why[r.title] = 'no show ' + date; continue; }
  const slot = slotOf(r.title);
  const target = day.length === 1 ? day[0] : slot === 'first' ? day[0] : slot === 'last' ? day[day.length - 1] : slot === 'mid' && day.length === 3 ? day[1] : null;
  if (!target || (target.members.length && !target.guess)) { skipped++; why[r.title] = target ? 'already full' : 'ambiguous'; continue; }
  target.members = mem; target.guess = 'fan'; target.fan = r.url;
  filled++;
}
for (const [y, list] of Object.entries(files)) writeFileSync(new URL(`${y}.json`, DIR), JSON.stringify(list));
if (process.env.DEBUG) console.log(why);
console.log(`ファンの公演レポート ${reports.length} 件 → ${filled} 公演のメンバーを補完（使わなかった記事 ${skipped}）`);
