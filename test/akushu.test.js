import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNewsList, parseArticle, buildReleases, windows, dueAkushu, composeAkushu, wanted, releaseOf, TOKEN, NEWS } from '../src/akushu.js';

// 2026-11-11 に公式ニュースで見た書き方をそのまま縮めたもの
const row = (slug, date, title) => `<div class="list-row"><a href="${NEWS}${slug}/">
  <div class="list-row__detail"><p class="tags"><span class="tags__date">${date}</span> <span class="tags__icon tags__icon--news">TOPICS</span></p><p>${title}</p></div></a></div>`;
const art = (body) => `<html><body><article class="widget-newsDetail"><div class="main-editor-content">${body}</div></article></body></html>`;
const LIST = [
  ['2026-10-19', '2026.10.19', '69thシングル『タイトル未定』OS盤 第2販売開始のご案内'],
  ['2026-10-04-5', '2026.10.04', 'AKB48 69thSG OS盤発売記念「オンラインお話し会」に関するご案内'],
  ['2026-10-04-4', '2026.10.04', 'AKB48 69thSG OS盤発売記念「個別握手会」に関するご案内'],
  ['2026-10-04-3', '2026.10.04', '69thシングル『タイトル未定』OS盤 第1販売開始のご案内'],
  ['2026-10-04-2', '2026.10.04', 'AKB48 69thシングル 2027年2月24日（水）発売決定！！'],
  ['2026-09-30-2', '2026.09.30', '10月4日(日)12:30スタート「東京握手会 ライブパフォーマンス」全曲無料生配信が決定！'],
  ['2026-09-03', '2026.09.03', '【9/5-6】68thSG OS盤 個別握手会@幕張メッセのご案内'],
  ['2026-08-14-5', '2026.08.14', '【10/4】68thSG『好きish』初回限定盤 発売記念「東京握手会」のご案内'],
  ['2026-05-01', '2026.05.01', 'AKB48 68thSG OS盤発売記念「個別握手会」に関するご案内'],
];
const PAGES = {
  '2026-10-19': art(`<p>AKB48 69thシングル「タイトル未定」Official Shop盤の第2販売を、2026年10月19日 (月) 17:00より受付開始いたします。</p>
    <p>Official Shop盤お申込みページ<br><a href="https://official-cd.akb48.co.jp/akb48-69th/">https://official-cd.akb48.co.jp/akb48-69th/</a></p>
    <p>◆ご予約受付スケジュール<br>＜ご予約受付日程＞<br>●第1次受付…10/19(月)17:00 ～ 10/20(火)13:00<br>1種3枚まで／10種までを1回のみ申込可能（最大30枚分）<br>
    ●第2次受付…10/20(火)17:00 ～ 10/21(水)13:00<br>1種5枚まで／10種までを3回のみ申込可能（最大150枚分）</p>
    <p>※各受付の抽選発表は各受付終了日16時頃を予定しておりますが、お申込状況によりましては16時を過ぎてからの発表とさせていただく場合がございます。</p>
    <p>例．「個別握手会 4/25(日) Aichi Sky Expo 倉野尾成美 第6部」⇒1種</p><a href="https://shop.akb48.co.jp/contact">お問い合わせ</a>`),
  '2026-10-04-3': art(`<p>●第1次受付…10/4(日)14:00 ～10/6(火)13:00<br>1種3枚まで／5種までを1回のみ申込可能（最大15枚分）</p><a href="https://official-cd.akb48.co.jp/akb48-69th/">申込</a>`),
  '2026-10-04-4': art(`<p>＜個別握手会 会場・開催日時＞<br>関東会場8日間、東海会場2日間　全10日程にて開催<br>・AKB48全メンバー参加<br>2027年1月9日（土）幕張メッセ<br>2027年1月10日（日）幕張メッセ<br>2027年4月25日（日）Aichi Sky Expo<br>幕張メッセ：<a href="https://www.m-messe.co.jp/access/">https://www.m-messe.co.jp/access/</a></p>
    <p>＜個別握手会 各部 時間帯＞<br>各部の時間帯は全日程／会場で共通です。<br>【第1部】受付開始10:20／受付終了11:20（個別握手会10:30～11:45）<br>【第2部】受付開始11:50／受付終了12:50（個別握手会12:00～13:15）</p>
    <p>＜各日程参加メンバースケジュール＞<br><a href="https://www.universal-music.co.jp/akb48/69thsg_kobetsu_akushu_ver1/">https://www.universal-music.co.jp/akb48/69thsg_kobetsu_akushu_ver1/</a></p>
    <p>2026年6月1日（月）以降に開催される主催コンサート・劇場公演・イベントより、「顔写真付き本人確認書類」をご持参いただく必要がございます。</p>`),
  '2026-10-04-5': art(`<p>＜「オンラインお話し会」 開催日時＞<br>全6日程にて開催<br>2026年12月26日（土）10:30〜19:00<br>2027年1月30日（土）10:30〜19:00</p>
    <p>【第1部】受付開始10:20／受付終了11:20（オンラインお話し会10:30～11:30）</p>`),
  '2026-09-03': art('<p>9月5日（土）・6日（日）幕張メッセで開催いたします</p>'),
  '2026-05-01': art(`<p>＜個別握手会 会場・開催日時＞<br>2026年9月5日（土）10:30〜19:15（幕張メッセ）<br>2026年9月6日（日）10:30〜19:15（幕張メッセ）<br>2026年9月13日（日）10:30〜19:15（インテックス大阪 6号館B）</p>`),
  '2026-08-14-5': art(`<p>◆東京握手会 開催詳細<br>開催日：2026年10月4日（日）</p><p>◆「東京握手会 入場優先権利」応募方法</p>
    <p>【応募期間】<br>2026年8月19日（水）10:00～8月31日（月）17:00まで</p><p>【当選通知】<br>2026年9月4日（金）18:00以降を予定しております。</p>`),
};
const items = parseNewsList(LIST.map((x) => row(...x)).join(''));
const frags = items.filter((x) => wanted(x.title)).map((it) => parseArticle(it, PAGES[it.slug])).filter(Boolean);
const at = (s) => new Date(s);

test('握手会：ニュース一覧から握手会系の記事だけ拾う', () => {
  assert.equal(items.length, 9);
  assert.deepEqual(items[0], { slug: '2026-10-19', url: `${NEWS}2026-10-19/`, date: '2026-10-19', title: '69thシングル『タイトル未定』OS盤 第2販売開始のご案内' });
  assert.deepEqual(items.filter((x) => !wanted(x.title)).map((x) => x.slug), ['2026-10-04-2', '2026-09-30-2']);
  assert.deepEqual(releaseOf('AKB48 69thSG OS盤発売記念「個別握手会」に関するご案内'), { id: '69th', label: '69thシングル' });
  assert.equal(releaseOf('AKB48「M.T.に捧ぐ」公演アルバム【イベント参加権利付き】 第2販売受付開始のご案内').id, 'M.T.に捧ぐ');
});

test('握手会：販売の受付日程・開催日・各部・事前応募を読む', () => {
  const rel = buildReleases(frags, at('2026-11-11T19:00:00+09:00'));
  assert.deepEqual(rel.map((r) => r.id), ['69th', '68th']);
  const r69 = rel[0];
  assert.equal(r69.applyUrl, 'https://official-cd.akb48.co.jp/akb48-69th/');
  assert.deepEqual(r69.sales.map((s) => s.no), [1, 2]);
  assert.deepEqual(r69.sales[1].rounds[0], { n: 1, start: '2026-10-19T17:00:00+09:00', end: '2026-10-20T13:00:00+09:00', limit: '1種3枚まで/10種までを1回のみ申込可能(最大30枚分)', key: '69th:2:1' });
  assert.equal(r69.sales[1].rounds.length, 2, '説明用の例（4/25…）は受付として拾わない');
  assert.equal(r69.sales[1].resultHour, 16);
  const ak = r69.events.find((e) => e.kind === '個別握手会');
  assert.deepEqual(ak.days.map((d) => `${d.date} ${d.venue}`), ['2027-01-09 幕張メッセ', '2027-01-10 幕張メッセ', '2027-04-25 Aichi Sky Expo']);
  assert.deepEqual(ak.parts[1], { n: 2, recv: '11:50', recvEnd: '12:50', start: '12:00', end: '13:15' });
  assert.equal(ak.memberUrl, 'https://www.universal-music.co.jp/akb48/69thsg_kobetsu_akushu_ver1/');
  const on = r69.events.find((e) => e.kind === 'オンラインお話し会');
  assert.deepEqual(on.days[0], { date: '2026-12-26', venue: '', open: '10:30', close: '19:00' });
  const r68 = rel[1];
  assert.equal(r68.song, '好きish');
  assert.deepEqual(r68.events[0].days.map((d) => [d.venue, !!d.guideUrl]), [['幕張メッセ', true], ['幕張メッセ', true], ['インテックス大阪 6号館B', false]]);
  assert.deepEqual(r68.others[0].apply, { start: '2026-08-19T10:00:00+09:00', end: '2026-08-31T17:00:00+09:00', result: '2026-09-04T18:00:00+09:00', what: '東京握手会 入場優先権利', key: '68th:東京握手会:2026-10-04' });
  assert.equal(buildReleases(frags, at('2027-03-01T00:00:00+09:00')).length, 1, '終わって120日たったリリースは外す');
});

test('握手会：年またぎの日付（12月の記事に1月の受付）', () => {
  const it = { slug: 'x', url: `${NEWS}x/`, date: '2026-12-28', title: '69thシングル『タイトル未定』OS盤 第9販売開始のご案内' };
  const f = parseArticle(it, art('<p>●第1次受付…12/31(木)17:00 ～ 1/2(土)13:00<br>●第2次受付…1/4(月)17:00 ～ 1/5(火)13:00</p>'));
  assert.deepEqual(f.rounds.map((r) => [r.start, r.end]), [['2026-12-31T17:00:00+09:00', '2027-01-02T13:00:00+09:00'], ['2027-01-04T17:00:00+09:00', '2027-01-05T13:00:00+09:00']]);
});

test('握手会：受付開始と締切3時間前に1回ずつ。印のない端末には送らない', () => {
  const rel = buildReleases(frags, at('2026-10-19T12:00:00+09:00'));
  const sent = new Set();
  dueAkushu(rel, sent, at('2026-10-19T12:00:00+09:00')); // それまでの分を既読に
  const a = dueAkushu(rel, sent, at('2026-10-19T17:05:00+09:00'));
  assert.deepEqual(a.opened.map((w) => w.key), ['69th:2:1']);
  assert.equal(a.closing.length, 0);
  const [n] = composeAkushu(['千葉恵里', TOKEN], a);
  assert.equal(n.title, '🤝 握手会の申込受付が始まったよ');
  assert.equal(n.body, '69thシングル OS盤 第2販売 第1次受付\n〆 10/20(火) 13:00\n1種3枚まで/10種までを1回のみ申込可能(最大30枚分)');
  assert.equal(n.apply, 'https://official-cd.akb48.co.jp/akb48-69th/');
  assert.equal(n.url, './?view=akushu');
  assert.equal(composeAkushu(['千葉恵里', '*'], a).length, 0);
  assert.equal(dueAkushu(rel, sent, at('2026-10-19T17:15:00+09:00')).opened.length, 0, '同じ受付は2回送らない');
  assert.equal(dueAkushu(rel, sent, at('2026-10-20T09:55:00+09:00')).closing.length, 0);
  const c = dueAkushu(rel, sent, at('2026-10-20T10:05:00+09:00'));
  assert.deepEqual(c.closing.map((w) => w.key), ['69th:2:1']);
  assert.match(composeAkushu([TOKEN], c)[0].body, /〆 10\/20\(火\) 13:00$/);
  // 長い応募期間（初回限定盤の事前応募）は24時間前
  const s2 = new Set();
  dueAkushu(rel, s2, at('2026-08-20T00:00:00+09:00'));
  assert.equal(dueAkushu(rel, s2, at('2026-08-30T16:00:00+09:00')).closing.length, 0);
  assert.deepEqual(dueAkushu(rel, s2, at('2026-08-30T17:05:00+09:00')).closing.map((w) => w.title), ['68thシングル「東京握手会」東京握手会 入場優先権利']);
  assert.equal(windows(rel).length, 4);
});

test('握手会：通し（初回は通知なし→新しい販売の記事が出たら受付開始を通知、取得に失敗しても落ちない）', async () => {
  process.chdir(mkdtempSync(join(tmpdir(), 'akb-ak-')));
  const { checkAkushu } = await import('../src/run.js');
  let list = LIST.slice(1), down = false;
  const gets = [];
  const fetchImpl = async (url) => {
    gets.push(url);
    if (down) return new Response('x', { status: 503 });
    if (url === NEWS) return new Response(list.map((x) => row(...x)).join(''));
    if (url.startsWith(`${NEWS}page/`)) return new Response('<div></div>');
    const slug = url.slice(NEWS.length, -1);
    return PAGES[slug] ? new Response(PAGES[slug]) : new Response('nf', { status: 404 });
  };
  const r1 = await checkAkushu({ now: at('2026-10-19T16:50:00+09:00'), fetchImpl });
  assert.deepEqual(r1.due, { opened: [], closing: [] });
  assert.equal(r1.releases[0].sales.length, 1);
  assert.equal(JSON.parse(readFileSync('docs/data/akushu.json', 'utf8')).releases.length, 2);
  list = LIST;
  const n = gets.length;
  const r2 = await checkAkushu({ now: at('2026-10-19T17:00:30+09:00'), fetchImpl });
  assert.deepEqual(gets.slice(n), [NEWS, `${NEWS}2026-10-19/`], '読むのは一覧と新しい記事だけ');
  assert.deepEqual(r2.due.opened.map((w) => w.key), ['69th:2:1']);
  down = true;
  const r3 = await checkAkushu({ now: at('2026-10-20T10:01:00+09:00'), fetchImpl });
  assert.deepEqual(r3.due.closing.map((w) => w.key), ['69th:2:1'], 'サイトが落ちていても、分かっている締切は知らせる');
  const st = JSON.parse(readFileSync('state/akushu.json', 'utf8'));
  assert.ok(st.notified.includes('close:69th:2:1') && st.bootstrapped);
});

test('握手会：参加メンバーの表（PDF）から、部ごとの私物サイン／色紙サインを読む', async () => {
  const { pdfPages } = await import('../src/pdf.js');
  const { parseLineupPage, packLineups } = await import('../src/akushu.js');
  const pages = await pdfPages(readFileSync(new URL('./fixtures/lineup-sample.pdf', import.meta.url)));
  assert.equal(pages.length, 2);
  const d = parseLineupPage(pages[0]);
  assert.equal(d.date, '2027-01-09');
  assert.equal(d.venue, '幕張メッセ');
  assert.deepEqual(Object.keys(d.members), ['秋山由奈', '新井彩永', '小栗有以', '髙橋彩音', '千葉恵里', '近藤沙樹', '長谷川百々花'], '縦書きの見出し（正規メンバー・研究生）は名前にしない');
  assert.deepEqual(d.members['秋山由奈'], ['私物サイン', '色紙サイン', '', '私物サイン', '色紙サイン', '私物サイン']);
  assert.deepEqual(d.members['新井彩永'], ['', '', '', '私物サイン', '色紙サイン', '私物サイン'], '空のマス＝その部は不参加');
  assert.deepEqual(d.members['近藤沙樹'], ['私物サイン', '色紙サイン', '私物サイン', '', '私物サイン', '色紙サイン']);
  const p = packLineups(pages);
  assert.deepEqual(p.kinds, ['私物サイン', '色紙サイン']);
  assert.equal(p.days['2027-01-09']['小栗有以'], '211.21');
  assert.equal(p.days['2027-01-10']['千葉恵里'], '2....1');
  // お話し会の表（サインA／サインB）
  const on = parseLineupPage([
    { s: '2026年12月26日(土)／ WithLIVE Meet&Greet', x: 145, y: 1421 }, { s: 'サインA：CDジャケットサイズ色紙', x: 147, y: 1343 }, { s: 'サインB：A5サイズ色紙', x: 458, y: 1343 },
    { s: '第1部', x: 283, y: 1298 }, { s: '第2部', x: 387, y: 1298 }, { s: 'メンバー', x: 170, y: 1231 }, { s: '秋山由奈', x: 172, y: 1208 }, { s: 'サインB', x: 280, y: 1209 }, { s: 'サインA', x: 384, y: 1209 },
  ]);
  assert.deepEqual(on.members, { 秋山由奈: ['サインB', 'サインA'] });
  assert.deepEqual(on.legend, ['サインA:CDジャケットサイズ色紙', 'サインB:A5サイズ色紙']);
});

test('握手会：通し（参加メンバーの表を取り込んで開催日に付ける。6時間は読み直さない）', async () => {
  process.chdir(mkdtempSync(join(tmpdir(), 'akb-ak2-')));
  const { checkAkushu } = await import('../src/run.js');
  const pdf = readFileSync(new URL('./fixtures/lineup-sample.pdf', import.meta.url));
  const gets = [];
  const fetchImpl = async (url) => {
    gets.push(url);
    if (url === NEWS) return new Response(row(...LIST[2]));
    if (url.startsWith(`${NEWS}page/`)) return new Response('<div></div>');
    if (/kobetsu_akushu_ver1/.test(url)) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
    return new Response(PAGES[url.slice(NEWS.length, -1)]);
  };
  const r = await checkAkushu({ now: at('2026-11-11T19:00:00+09:00'), fetchImpl });
  const ev = r.releases[0].events[0];
  assert.deepEqual(ev.signs, ['私物サイン', '色紙サイン']);
  assert.equal(ev.days[0].lineup['千葉恵里'], '112.12');
  assert.equal(ev.days[2].lineup, undefined, '表にない日は付けない');
  const n = gets.length;
  await checkAkushu({ now: at('2026-11-11T19:10:00+09:00'), fetchImpl });
  assert.deepEqual(gets.slice(n), [NEWS]);
  await checkAkushu({ now: at('2026-11-12T19:20:00+09:00'), fetchImpl });
  assert.equal(gets.filter((u) => /kobetsu/.test(u)).length, 2, '1日たったら記事と表を読み直す');
  assert.equal(JSON.parse(readFileSync('docs/data/akushu.json', 'utf8')).releases[0].events[0].days[1].lineup['千葉恵里'], '2....1');
});

test('握手会：シングルのタイトルは、発表後の記事に出たら入る（タイトル未定で上書きしない）', () => {
  const f = (slug, date, title) => ({ slug, url: 'u', date, title, rel: '69th', relLabel: '69thシングル', song: (title.match(/『([^』]+)』/) || [])[1] === 'タイトル未定' ? '' : (title.match(/『([^』]+)』/) || [, ''])[1], type: 'sale', no: Number(slug), rounds: [{ n: 1, start: '2026-12-01T17:00:00+09:00', end: '2026-12-02T13:00:00+09:00', limit: '' }], resultHour: 16, applyUrl: '' });
  const now = at('2026-12-01T00:00:00+09:00');
  assert.equal(buildReleases([f('1', '2026-10-04', '69thシングル『タイトル未定』OS盤 第1販売開始のご案内')], now)[0].song, '');
  assert.equal(buildReleases([f('1', '2026-10-04', '69thシングル『タイトル未定』OS盤 第1販売開始のご案内'), f('7', '2026-11-20', '69thシングル『春の歌』OS盤 第7販売開始のご案内')], now)[0].song, '春の歌');
  const it = { slug: 'y', url: `${NEWS}y/`, date: '2026-11-20', title: '69thシングル『春の歌』OS盤 第7販売開始のご案内' };
  assert.equal(parseArticle(it, PAGES['2026-10-04-3']).song, '春の歌');
});

test('握手会：本文だけ切り出して読む・会場ごとに各部の時間が違うイベント（2ショット写真会）', () => {
  // ページのほかの部分が崩れていても本文は読める（実際に「オンラインお話し会」の記事が読めていなかった）
  const page = (body) => `<html><body><script>if (a <= (window.innerHeight || 0)) {}</script><div class="column__detail paragraph--01"><div class="main-editor-content">${body}</div>\n</div>\n<!--/.column--></div>\n</article><div class="main-editor-content"><p>＜開催日時＞<br />2030年1月1日（火）別の欄</p></div></body></html>`;
  const it = { slug: 'p', url: `${NEWS}p/`, date: '2026-09-12', title: 'AKB48「M.T.に捧ぐ」公演アルバム発売記念「2ショット写真会」開催のご案内' };
  const f = parseArticle(it, page(`<p><strong>＜会場・開催日時＞<br /></strong>※全3日程にて開催<br />2026年11月21日（土）10:00〜20:15（幕張メッセ）<br />2026年11月22日（日）10:00〜20:15（幕張メッセ）<br />2026年12月19日（土）9:45〜20:00（インテックス大阪）<br />幕張メッセ：https://www.m-messe.co.jp/access/</p>
    <p><strong>＜各部 時間帯＞</strong><br />＜2026年11月21日（土）・22日（日）幕張メッセ開催分＞<br />【第1部】受付開始09:50／受付終了10:50（イベント時間10:00～11:15）<br />【第2部】受付開始11:20／受付終了12:20（イベント時間11:30～12:45）</p>
    <p>＜2026年12月19日（土）インテックス大阪開催分＞<br />【第1部】受付開始9:35／受付終了10:35（イベント時間9:45～11:00）</p>`));
  assert.equal(f.kind, '2ショット写真会');
  assert.equal(f.rel, 'M.T.に捧ぐ');
  assert.deepEqual(f.days.map((d) => [d.date, d.venue, d.open, d.parts ? d.parts.map((p) => p.start) : null]), [
    ['2026-11-21', '幕張メッセ', '10:00', null], ['2026-11-22', '幕張メッセ', '10:00', null], ['2026-12-19', 'インテックス大阪', '9:45', ['09:45']],
  ]);
  assert.deepEqual(f.parts.map((p) => `${p.n} ${p.start}~${p.end}`), ['1 10:00~11:15', '2 11:30~12:45']);
});
