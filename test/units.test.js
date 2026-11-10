import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignUnits } from '../src/units.js';

const U = JSON.parse(readFileSync(new URL('../docs/data/units.json', import.meta.url), 'utf8')).stages['ここからだ'];

test('ユニット担当：16人なら16ポジションに1人ずつ', () => {
  const m = ['秋山由奈', '太田有紀', '川村結衣', '工藤華純', '倉野尾成美', '迫由芽実', '佐藤綺星', '髙橋彩音', '徳永羚海', '永野芹佳', '橋本陽菜', '平田侑希', '正鋳真優', '水島美結', '山内瑞葵', '山口結愛'];
  const r = assignUnits(U, m);
  const names = r.flatMap((s) => s.slots.map((x) => x.name));
  assert.equal(names.length, 16);
  assert.equal(new Set(names).size, 16, '同じ人が2つのポジションに入らない');
  assert.ok(names.every(Boolean));
  const by = Object.fromEntries(r.map((s) => [s.title, s.slots]));
  assert.equal(by['2月のMermaid'][0].name, '徳永羚海');
  assert.ok(by['2月のMermaid'][0].sure);
  assert.equal(by['Lollipop'][0].name, '橋本陽菜');
  assert.equal(by['風の待ち伏せ'][3].name, '川村結衣');
});

test('ユニット担当：オリジナルが全員出ていればオリジナル通り・表にない人がいる回は空き', () => {
  const orig = U.flatMap((s) => s.positions.map((p) => p[0]));
  const r = assignUnits(U, orig);
  assert.ok(r.every((s) => s.slots.every((x, i) => x.name === s.positions[i][0])), '迷ったらオリジナル優先');
  const r2 = assignUnits(U, orig.filter((n) => n !== '八木愛月'));
  assert.equal(r2.find((s) => s.title === '2月のMermaid').slots[0].name, null);
});

test('ユニット担当：「RESET」は同じ並びの行が同じポジション（1人2曲）', () => {
  const R = JSON.parse(readFileSync(new URL('../docs/data/units.json', import.meta.url), 'utf8')).stages.RESET;
  const m = ['橋本恵理子', '大賀彩姫', '水島美結', '永野芹佳', '新井彩永', '黒須遥香', '行天優莉奈', '山根涼羽'];
  const by = Object.fromEntries(assignUnits(R, m).map((s) => [s.title, s.slots.map((x) => x.name)]));
  assert.deepEqual(by['制服レジスタンス'], ['橋本恵理子', '大賀彩姫', '水島美結']);
  assert.deepEqual(by['明日のためにキスを'], ['水島美結', '橋本恵理子', '黒須遥香', '永野芹佳']);
  assert.deepEqual(by['心の端のソファー'], ['山根涼羽', '行天優莉奈', '新井彩永']);
});
