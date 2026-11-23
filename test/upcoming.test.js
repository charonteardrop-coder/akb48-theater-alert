import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showsFromPost, mergeUpcoming, scheduleLinks, checkUpcoming } from '../src/upcoming.js';

const body = readFileSync(new URL('./fixtures/blog-schedule.html', import.meta.url), 'utf8');
const pub = '2026-11-20T21:15:00.000+09:00';

test('スケジュール記事 → 公演（休館日・未定は入れない、補足はその回だけ）', () => {
  const s = showsFromPost(body, pub, 'AKB48劇場 公演スケジュール更新のお知らせ', 'u');
  const key = s.map((x) => `${x.date} ${x.time} ${x.title}`);
  assert.ok(key.includes('2026-12-01 18:30 「ＲＥＳＥＴ」公演'));
  assert.ok(!s.some((x) => x.date === '2026-12-02' || x.date === '2026-12-28'));
  const d6 = s.filter((x) => x.date === '2026-12-06');
  assert.deepEqual(d6.map((x) => [x.time, x.note]), [['13:00', ''], ['17:30', '女性限定公演']]);
  assert.equal(s.find((x) => x.date === '2026-12-15').note, '布袋百椛 生誕祭');
  assert.equal(s.find((x) => x.date === '2026-12-08').note, '');
  assert.equal(s.find((x) => x.date === '2026-12-05').members.length, 16);
});

test('新しい記事が同じ日を上書きする', () => {
  const a = { pub: '2026-11-01', shows: [{ date: '2026-12-01', time: '18:30', title: 'A' }, { date: '2026-12-02', time: '18:30', title: 'B' }] };
  const b = { pub: '2026-11-10', shows: [{ date: '2026-12-01', time: '13:00', title: 'C' }] };
  assert.deepEqual(mergeUpcoming([b, a], '2026-11-24').map((x) => x.title), ['C', 'B']);
});

test('記事一覧からスケジュール記事だけ拾って読む', async () => {
  const list = '<a href="https://ameblo.jp/akihabara48/entry-1.html">12月1日 公演のご案内</a><a href="https://ameblo.jp/akihabara48/entry-2.html">AKB48劇場 公演スケジュール更新のお知らせ</a>';
  assert.deepEqual(scheduleLinks(list), [{ id: '2', title: 'AKB48劇場 公演スケジュール更新のお知らせ' }]);
  const pages = { 'https://ameblo.jp/akihabara48/theme-10052993816.html': list, 'https://ameblo.jp/akihabara48/entry-2.html': `"datePublished":"${pub}"<div id="entryBody">${body}</div>` };
  const r = await checkUpcoming({ now: new Date('2026-11-24T00:00:00+09:00'), getText: async (u) => pages[u] });
  assert.ok(r.shows.length >= 9);
  const again = await checkUpcoming({ now: new Date('2026-11-24T00:20:00+09:00'), getText: async () => { throw new Error('should not fetch'); }, prev: r });
  assert.equal(again.shows.length, r.shows.length);
});
