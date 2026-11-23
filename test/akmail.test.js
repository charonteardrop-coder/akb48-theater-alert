import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAkMail } from '../src/akmail.js';
const lottery = `○○ 様
抽選お申込みいただきました『【抽選申込/第7販売 第3次】AKB48 65thシングル「まさかのConfession」Official Shop盤』
■支払開始予定：2025-03-06 19:00:00
━━━━━━━━━━━━━
●申込番号：430306-1289764
━━━━━━━━━━━━━
【抽選申込/第7販売 第3次】AKB48 65thシングル「まさかのConfession」Official Shop盤

●抽選（当落）結果
商品名：【3月23日(日) 幕張メッセ】 AKB48 大賀 彩姫 第1部
申込数：2枚　当選数：2枚　落選数：0枚
小計：2,400円（単価1,200円）

━━━━━━━━━━━━━
●申込番号：430306-1289766
━━━━━━━━━━━━━
【抽選申込/第7販売 第3次】AKB48 65thシングル「まさかのConfession」Official Shop盤

●抽選（当落）結果
商品名：【3月22日(土) 幕張メッセ】 AKB48 坂川 陽香 第4部
申込数：3枚　当選数：1枚　落選数：2枚

━━━━━━━━━━━━━
●抽選（当落）結果に関して
━━━━━━━━━━━━━`;
const order = `●ご注文情報
ご注文番号：4796476
●ご注文内容
商品コード: AK-1391-2507-88724
商品名: 【10月14日　新宿住友ホール】長友 彩海　第2部 | AKB48 20th Anniversary Book【イベント参加権利付き】
単価：￥ 3,000
数量：1
`;
test('抽選結果メール', () => {
  const r = parseAkMail(lottery, new Date('2025-03-06T10:00:00Z'));
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].date, r[0].member, r[0].part, r[0].applied, r[0].won, r[0].sale, r[0].round, r[0].venue], ['2025-03-23', '大賀彩姫', 1, 2, 2, 7, 3, '幕張メッセ']);
  assert.match(r[0].relText, /65thシングル/);
  assert.deepEqual([r[1].member, r[1].part, r[1].won], ['坂川陽香', 4, 1]);
});
test('注文完了メール（年またぎ）', () => {
  const r = parseAkMail(order, new Date('2025-08-30T21:00:00Z'));
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].date, r[0].member, r[0].part, r[0].won, r[0].venue], ['2025-10-14', '長友彩海', 2, 1, '新宿住友ホール']);
  assert.match(r[0].relText, /20th Anniversary Book/);
  const r2 = parseAkMail(order.replace('10月14日', '1月9日'), new Date('2025-11-20T00:00:00Z'));
  assert.equal(r2[0].date, '2026-01-09');
});
