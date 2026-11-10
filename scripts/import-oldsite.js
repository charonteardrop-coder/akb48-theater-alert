// 2006年4月〜2011年10月の劇場公演を、旧公式サイトの月別スケジュール（Wayback Machineの保存ページ）から作って
// docs/data/history/YYYY.json に足す。あわせて演目の期間表 docs/data/history/stages.json を作る。
//
// 使い方：node scripts/import-oldsite.js <schedule.json> [<members.json>]
//   schedule.json … { months: { 'YYYYMM': { url, html } }, wiki: 'Wikipedia「AKB48の劇場公演」のwikitext' }
//   members.json  … { r2: { 'YYYYMM': { url, html } }（月ページの差し替え）, members: [{ ts, url, html }]（メンバー一覧ページ） }
//
// 出演メンバーは
//   ・その回の出演者がページに載っていればそれ
//   ・休演者しか載っていなければ「当時のチームのメンバー（公式サイトのメンバー一覧）− 休演者」で推定（guess: 'roster'）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseMonth, parseStagePeriods, stageFor } from '../src/oldsite.js';

const [, , schedPath, ...morePaths] = process.argv;
if (!schedPath) { console.error('usage: node scripts/import-oldsite.js schedule.json [members.json] [more-pages.json…]'); process.exit(1); }
const DIR = new URL('../docs/data/history/', import.meta.url);
const sched = JSON.parse(readFileSync(schedPath, 'utf8'));
const extras = morePaths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
const extra = { members: extras.flatMap((x) => x.members || []) };

// 演目の期間
const periods = parseStagePeriods(sched.wiki).filter((p) => /^(チーム|ひまわり組|研究生)/.test(p.team));
writeFileSync(new URL('stages.json', DIR), JSON.stringify(periods.map(({ team, title, start, end }) => ({ team, title, start, end }))) + '\n');

// メンバー一覧（チームごと）
export function parseRoster(html) {
  const teams = {};
  const norm = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
  // 旧サイト：<h3>チームA</h3><ul id="list"><li>…</li></ul>
  for (const m of html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/g)) {
    const team = norm(m[1]); if (!/^チーム[AKB4]$/.test(team)) continue;
    teams[team] = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => norm(x[1])).filter((x) => x.length >= 2 && x.length <= 10);
  }
  // 2011年秋以降：<div id="team_a"> … <img alt="名前"> or <p>名前</p>
  for (const m of html.matchAll(/id="team_([ak b4])"([\s\S]*?)(?=id="team_|<!-- ▲contents)/g)) {
    const team = `チーム${m[1].toUpperCase()}`; if (teams[team]) continue;
    const ns = [...m[2].matchAll(/alt="([^"]{2,10})"/g)].map((x) => x[1].replace(/\s+/g, '')).filter((x) => !/チーム|ボタン|bt_|写真|title/i.test(x));
    if (ns.length >= 8) teams[team] = [...new Set(ns)];
  }
  return teams;
}
const rosters = (extra.members || []).map((p) => ({ date: `${p.ts.slice(0, 4)}-${p.ts.slice(4, 6)}-${p.ts.slice(6, 8)}`, teams: parseRoster(p.html) }))
  .filter((r) => Object.keys(r.teams).length).sort((a, b) => a.date.localeCompare(b.date));
const rosterFor = (team, date) => {
  const has = rosters.filter((r) => r.teams[team]);
  if (!has.length) return null;
  // その日に一番近い日付の一覧（前後どちらでも）。200日以上離れていたら使わない
  const before = has.filter((r) => r.date <= date).pop();
  const after = has.find((r) => r.date > date);
  const days = (r) => Math.abs((new Date(r.date) - new Date(date)) / 864e5);
  const pick = [before, after].filter(Boolean).sort((a, b) => days(a) - days(b))[0];
  return pick && days(pick) <= 200 ? pick.teams[team] : null;
};

// 同じ月のページが何版かあるときは、一番情報が多いもの（公演数＋出演者の載っている回）を使う
const score = (html) => { const xs = parseMonth(html); return xs.length + xs.filter((x) => x.full).length * 2 + xs.filter((x) => x.absent.length).length; };
const months = {};
for (const src of [sched.months, ...extras.map((x) => x.r2 || {})]) {
  for (const [ym, v] of Object.entries(src || {})) {
    if (!/^\d{6}$/.test(ym) || !v || !v.html) continue;
    if (!months[ym] || score(v.html) > score(months[ym].html)) months[ym] = v;
  }
}

const out = [];
for (const [ym, v] of Object.entries(months).sort()) {
  if (!v || !v.html || ym > '201110') continue;
  for (const s0 of parseMonth(v.html)) {
    const s = { ...s0, team: s0.team.normalize('NFKC') };
    if (s.date.slice(0, 7).replace('-', '') !== ym) continue;
    if (/SKE48/.test(s.team)) continue; // SKE48劇場の公演
    const title = s.title || stageFor(periods, s.team, s.date);
    const notes = [];
    if (s.team) notes.push(s.team);
    const label = s.label.replace(/^公演$/, '').replace(/「|」/g, '').replace(/公演$/, '公演');
    if (label) notes.push(label);
    notes.push(...s.notes.map((n) => n.replace(/[「」]/g, '')));
    const rec = { id: `${s.date.replace(/-/g, '')}-${s.time.replace(':', '')}`, date: s.date, time: s.time, title: title ? `「${title}」公演` : `${s.team || ''}公演`, note: [...new Set(notes)].join(' '), members: s.members };
    if (!s.full) {
      const roster = rosterFor(s.team, s.date);
      if (roster) { rec.members = roster.filter((n) => !s.absent.includes(n)); rec.guess = 'roster'; }
    }
    if (s.absent.length) rec.absent = s.absent;
    rec.src = 'oldsite';
    out.push(rec);
  }
}

// 同じIDは後勝ち（月ページの重複）
const byId = new Map(out.map((s) => [s.id, s]));
const byYear = {};
for (const s of byId.values()) (byYear[s.date.slice(0, 4)] = byYear[s.date.slice(0, 4)] || []).push(s);
const idxPath = new URL('index.json', DIR);
const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
for (const [y, list] of Object.entries(byYear)) {
  const p = new URL(`${y}.json`, DIR);
  const prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  const keep = prev.filter((s) => s.src !== 'oldsite' && !byId.has(s.id));
  const merged = [...keep, ...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  writeFileSync(p, JSON.stringify(merged));
  idx.counts[y] = merged.length;
  if (!idx.years.includes(y)) idx.years.push(y);
}
idx.years.sort();
writeFileSync(idxPath, JSON.stringify(idx, null, 1) + '\n');
const n = byId.size, full = [...byId.values()].filter((s) => !s.guess && s.members.length).length, guess = [...byId.values()].filter((s) => s.guess).length;
console.log(`旧公式サイトから ${n} 公演（出演者そのまま ${full} / チーム名簿から推定 ${guess} / メンバー不明 ${n - full - guess}）、演目の期間 ${periods.length} 件`);
