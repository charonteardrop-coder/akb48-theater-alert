// 過去の劇場公演を公式ブログ「劇場情報」から取り込む（GitHub Actions の「過去公演の取り込み」から手動で実行）
//   node scripts/import-history.js [--since 2012] [--max-pages 400]
// 2025年以降の公演でチケットセンター（zaiko）のリンクがあるものは、zaiko側の最終的な出演メンバーで上書きする。
import { writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'node-html-parser';
import { parseShows, parseChanges, buildHistory, isRelevantTitle, htmlToLines, toYearFiles } from '../src/history.js';
import { parseEventPage, canonicalUrl } from '../src/zaiko.js';

const BLOG = 'https://ameblo.jp/akihabara48';
const THEME = '10052993816'; // 「劇場情報」
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SINCE = arg('--since', '2012');
const MAX_PAGES = Number(arg('--max-pages', '400'));
const UA = 'oshi-gekijo-alert history importer (one-time, polite)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch {}
    await sleep(3000 * (i + 1));
  }
  return null;
}

// 1. テーマの記事一覧
const items = new Map();
for (let p = 1; p <= MAX_PAGES; p++) {
  const html = await get(p === 1 ? `${BLOG}/theme-${THEME}.html` : `${BLOG}/theme${p}-${THEME}.html`);
  if (!html) break;
  const before = items.size;
  for (const a of parse(html).querySelectorAll('a[href*="/akihabara48/entry-"]')) {
    const id = (a.getAttribute('href').match(/entry-(\d+)/) || [])[1];
    const title = a.text.trim();
    if (id && title && !items.has(id)) items.set(id, title);
  }
  if (items.size === before) break;
  if (p % 20 === 0) console.log(`一覧 ${p}ページ / ${items.size}件`);
  await sleep(700);
}
const targets = [...items].filter(([, t]) => isRelevantTitle(t));
console.log(`記事 ${items.size}件中 ${targets.length}件を読む`);

// 2. 記事を読んで解析
const posts = [];
let n = 0;
for (const [id, title] of targets) {
  const html = await get(`${BLOG}/entry-${id}.html`);
  n++;
  if (html) {
    const pub = (html.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] || '';
    if (pub && pub.slice(0, 4) >= SINCE) {
      const body = parse(html).querySelector('#entryBody');
      if (body) {
        const lines = htmlToLines(body.innerHTML);
        posts.push({ id, title, pub, url: `${BLOG}/entry-${id}.html`, shows: parseShows(lines, pub), changes: parseChanges(lines, pub) });
      }
    }
  }
  if (n % 200 === 0) console.log(`記事 ${n}/${targets.length}`);
  await sleep(500);
}

// 3. まとめる → zaikoの最終メンバーで上書き
const { shows, applied } = buildHistory(posts);
let fixed = 0;
for (const s of shows.filter((x) => x.url)) {
  const url = canonicalUrl(s.url);
  const html = await get(url);
  const ev = html && (() => { try { return parseEventPage(html, url); } catch { return null; } })();
  if (ev && ev.members.length) { s.members = ev.members; s.url = ev.url; fixed++; }
  await sleep(700);
}

// 4. 書き出し
const { years, index } = toYearFiles(shows);
await mkdir('docs/data/history', { recursive: true });
for (const [y, list] of Object.entries(years)) await writeFile(`docs/data/history/${y}.json`, JSON.stringify(list) + '\n');
await writeFile('docs/data/history/index.json', JSON.stringify({ ...index, source: 'AKB48公式ブログ「劇場情報」＋AKB48チケットセンター', builtAt: new Date().toISOString() }, null, 1) + '\n');
console.log(`公演 ${shows.length}件（メンバー変更の反映 ${applied}回、zaikoで上書き ${fixed}件）`);
