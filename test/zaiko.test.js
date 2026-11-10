import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseDetail, splitName, isOpen, parseEventPage, parseSitemap } from '../src/zaiko.js';
import { fx } from './helpers.js';
import { LIST, DETAIL_1117, listHtml, detailHtml } from './helpers.js';

test('一覧：劇場公演・出演メンバー・枠の状態を読む（実データ）', () => {
  const shows = parseList(listHtml(LIST));
  assert.equal(shows.length, 10);
  const s = shows.find((x) => x.id === 386017);
  assert.equal(s.url, 'https://akb48.zaiko.io/e/2026e-1117-1830');
  assert.equal(s.title, '「ＲＥＳＥＴ」公演');
  assert.equal(s.note, '千葉恵里 生誕祭');
  assert.equal(s.label, '11/17(火)');
  assert.equal(s.time, '18:30');
  assert.equal(s.date, '2026-11-17');
  assert.ok(s.members.includes('千葉恵里'));
  assert.equal(s.slots.find((x) => x.name === '一般枠').status, 'open');
  assert.ok(isOpen(s));
  assert.equal(isOpen(shows.find((x) => x.id === 385976)), false, 'ロビー観覧だけ受付中の公演は「受付中」扱いしない');
  assert.equal(shows.find((x) => x.id === 385806).slots[0].status, 'soldout');
});

test('詳細：枠ごとの締切と申込URL（実データ）', () => {
  const d = parseDetail(detailHtml(DETAIL_1117));
  assert.equal(d.length, 7);
  const ippan = d.find((x) => x.name === '一般枠');
  assert.equal(ippan.end, '2026-11-12T07:00:00.000000Z');
  assert.equal(ippan.status, 'open');
});

test('公演名の分解', () => {
  assert.deepEqual(splitName('11月10日 18:30開演 「夢のポップスター」公演　倉野尾成美 生誕祭'), { title: '「夢のポップスター」公演', note: '倉野尾成美 生誕祭' });
  assert.deepEqual(splitName('11月11日 19:00開演「ＲＥＳＥＴ」公演'), { title: '「ＲＥＳＥＴ」公演', note: '' });
});

test('ページ構造が変わったらはっきりエラーにする', () => {
  assert.throws(() => parseList('<html>no data</html>'), /ページデータが見つからない/);
});

test('過去の公演ページ（実データ）→ アーカイブ用の情報', () => {
  const a = parseEventPage(detailHtml(fx('zaiko-past-385293.json')), 'https://akb48.zaiko.io/e/2026-1011-1730');
  assert.deepEqual(a, {
    id: 385293, date: '2026-10-11', label: '10/11(日)', time: '17:30', start: '2026-10-11T08:30:00.000000Z',
    title: '「ＲＥＳＥＴ」公演', note: '女性限定公演',
    members: ['秋山由奈', '佐藤綺星', '下尾みう', '成田香姫奈', '畠山希美', '福岡聖菜', '八木愛月', '山内瑞葵'],
    url: 'https://akb48.zaiko.io/e/2026-1011-1730',
  });
  const concert = { ...fx('zaiko-past-385293.json'), name: '春コンサート 特別公演', venue: { data: { name: '国立代々木競技場第一体育館' } } };
  assert.equal(parseEventPage(detailHtml(concert), 'x'), null, '劇場以外は入れない');
});

test('サイトマップ：日本語版の公演ページだけ', () => {
  const xml = '<urlset><url><loc>https://akb48.zaiko.io/ja</loc></url><url><loc>https://akb48.zaiko.io/ja/e/a-1</loc></url><url><loc>https://akb48.zaiko.io/ko/e/a-1</loc></url><url><loc>https://akb48.zaiko.io/ja/item/381305</loc></url><url><loc>https://akb48.zaiko.io/ja/post/1</loc></url></urlset>';
  assert.deepEqual(parseSitemap(xml), ['https://akb48.zaiko.io/e/a-1', 'https://akb48.zaiko.io/item/381305']);
});
