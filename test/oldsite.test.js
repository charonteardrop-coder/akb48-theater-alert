import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMonth, parseStagePeriods, stageFor, names } from '../src/oldsite.js';

const rows = readFileSync(new URL('./fixtures/oldsite-rows.html', import.meta.url), 'utf8');
const wiki = readFileSync(new URL('./fixtures/wiki-stages.txt', import.meta.url), 'utf8');
const shows = parseMonth(rows);
const at = (d, t) => shows.find((s) => s.date === d && s.time === t);

test('旧公式サイト：共通メンバー＋回ごとの追加（2007年ひまわり組）', () => {
  const a = at('2007-08-13', '13:00'), b = at('2007-08-13', '19:00');
  assert.equal(a.team, 'ひまわり組');
  assert.ok(a.full && a.members.includes('板野友美') && a.members.includes('秋元才加') && !a.members.includes('川崎希'));
  assert.ok(b.members.includes('川崎希') && !b.members.includes('秋元才加'));
});

test('旧公式サイト：休演者だけの日（全公演／回ごと）', () => {
  const a = at('2008-09-14', '12:00'), b = at('2008-09-14', '15:30'), c = at('2008-09-14', '19:00');
  assert.ok(!a.full && a.members.length === 0);
  assert.ok(a.absent.includes('前田敦子') && a.absent.includes('篠田麻里子') && !a.absent.includes('佐藤由加理'));
  assert.ok(b.absent.includes('佐藤由加理') && !b.absent.includes('篠田麻里子'));
  assert.ok(c.absent.includes('佐藤由加理') && c.absent.includes('篠田麻里子'));
  assert.deepEqual(at('2010-01-05', '19:00').absent, ['板野友美', '前田敦子', '宮崎美穂']);
});

test('旧公式サイト：2011年の回ごとの出演メンバーと演目・生誕祭', () => {
  const a = at('2011-05-03', '12:00'), b = at('2011-05-03', '15:30'), sdn = at('2011-05-03', '20:30');
  assert.equal(a.title, 'RESET'); assert.equal(a.team, 'チームK'); assert.equal(a.members.length, 16);
  assert.ok(b.notes.some((n) => n.includes('野中美郷 生誕祭')));
  assert.equal(sdn.team, 'SDN48'); assert.ok(sdn.members.includes('近藤さや香'));
  assert.ok(!shows.some((s) => s.date === '2006-06-01'), '休館日は公演なし');
});

test('演目の期間：Wikipediaの一覧から読み、チームと日付で引ける', () => {
  const p = parseStagePeriods(wiki);
  assert.ok(p.some((x) => x.team === 'チームA' && x.title === 'PARTYが始まるよ' && x.start === '2005-12-08' && x.end === '2006-03-31'));
  assert.equal(stageFor(p, 'チームK', '2006-04-01'), 'PARTYが始まるよ');
  assert.equal(stageFor(p, 'チームA', '2008-05-01'), 'ただいま恋愛中', 'リバイバル公演も拾う');
  assert.equal(stageFor(p, 'ひまわり組', '2007-08-13'), '僕の太陽');
  assert.equal(stageFor(p, 'チームA', '2007-07-15'), '', 'チームAの公演がない時期');
});

test('名前の切り出し', () => {
  assert.deepEqual(names('秋元才加・大島 優子･小野恵令奈'), ['秋元才加', '大島優子', '小野恵令奈']);
  assert.deepEqual(names('【公演メンバー】'), []);
});
