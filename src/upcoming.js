// 公式ブログ「劇場情報」の「公演スケジュール」記事から、まだチケットセンターに出ていない先の公演を拾う。
// サイトの「チケットを申し込む」で、受付前の公演として下に並べる（受付が始まったら zaiko 側の公演に置き換わる）。
import { parse } from 'node-html-parser';
import { parseShows, htmlToLines } from './history.js';

export const BLOG = 'https://ameblo.jp/akihabara48';
export const THEME = '10052993816'; // 「劇場情報」
export const isScheduleTitle = (t) => /公演スケジュール/.test(String(t || ''));

/** テーマの記事一覧のHTML → [{id, title}]（新しい順） */
export function scheduleLinks(html) {
  const seen = new Set(), out = [];
  for (const a of parse(html).querySelectorAll('a[href*="/akihabara48/entry-"]')) {
    const id = (a.getAttribute('href').match(/entry-(\d+)/) || [])[1];
    const title = a.text.trim();
    if (!id || !title || seen.has(id) || !isScheduleTitle(title)) continue;
    seen.add(id); out.push({ id, title });
  }
  return out;
}

/** スケジュール記事の本文HTML → 公演（開演時刻ごと） */
export function showsFromPost(bodyHtml, pub, title, url) {
  const list = parseShows(htmlToLines(bodyHtml), pub, title);
  return list.filter((s) => s.date && s.title).map((s) => {
    // 「17:30公演；女性限定公演」のような補足は、その時刻の回だけに付ける
    let note = String(s.note || '').trim();
    const only = note.match(/^(\d{1,2}[:：]\d{2})公演[;；:：\s]*(.+)$/);
    if (only) note = only[1].replace('：', ':').padStart(5, '0') === s.time ? only[2].trim() : '';
    // 「AKB48 全メンバー・研究生」はメンバー欄
    if (/全メンバー/.test(note)) note = '';
    return { date: s.date, time: s.time || '', title: s.title, note, members: s.members || [], url };
  });
}

/** 新しい記事の内容を優先して、日付・時刻ごとに1件にまとめる */
export function mergeUpcoming(posts, today) {
  const by = new Map();
  for (const p of [...posts].sort((a, b) => a.pub.localeCompare(b.pub))) {
    // 新しい記事が扱っている日付は、その記事の内容で置き換える（時刻が変わった・中止になった場合に古い回を残さない）
    const days = new Set(p.shows.map((s) => s.date));
    for (const k of [...by.keys()]) if (days.has(k.split('|')[0])) by.delete(k);
    for (const s of p.shows) by.set(`${s.date}|${s.time}`, s);
  }
  return [...by.values()].filter((s) => s.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * 1時間に1回だけブログを見に行く。記事一覧の1ページ目から「公演スケジュール」の記事を新しい順に2本読む。
 * @param {{ now: Date, getText: (url: string) => Promise<string>, prev: object }} o
 */
export async function checkUpcoming({ now, getText, prev = {} }) {
  const today = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const fresh = prev.checkedAt && now - new Date(prev.checkedAt) < 55 * 60e3;
  let posts = prev.posts || [];
  if (!fresh) {
    const links = scheduleLinks(await getText(`${BLOG}/theme-${THEME}.html`)).slice(0, 2);
    const read = [];
    for (const { id, title } of links) {
      const url = `${BLOG}/entry-${id}.html`;
      const html = await getText(url);
      const pub = (html.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] || now.toISOString();
      const body = parse(html).querySelector('#entryBody');
      if (body) read.push({ id, title, pub, url, shows: showsFromPost(body.innerHTML, pub, title, url) });
    }
    // 読めた記事で置き換え。前に読んだ記事でも、まだ先の公演が残っているものは取っておく
    const ids = new Set(read.map((p) => p.id));
    posts = [...read, ...posts.filter((p) => !ids.has(p.id) && p.shows.some((s) => s.date >= today))].slice(0, 4);
  }
  return {
    source: `${BLOG}/theme-${THEME}.html`,
    checkedAt: fresh ? prev.checkedAt : now.toISOString(),
    posts: posts.map((p) => ({ ...p, shows: p.shows.filter((s) => s.date >= today) })),
    shows: mergeUpcoming(posts, today),
  };
}
