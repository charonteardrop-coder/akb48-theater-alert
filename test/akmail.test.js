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
test('スクショのOCRっぽい崩れたテキスト', () => {
  const ocr = `■ 支払 開始 予定 : 2025-03-06 19:00:00
【 抽選 申込 / 第 7 販売 第 3 次 】 AKB48 65th シングル Official Shop 盤
● 抽選 (当落) 結果
商品 名 : [3 月 23 日 (日) 幕張 メッセ ] AKB48 大賀 彩姫 第 1 部
申込 数 : 2 枚 当選 数 : 2 枚 落選 数 : 0 枚
小計 : 2,400 円`;
  const r = parseAkMail(ocr, new Date('2025-03-06T10:00:00Z'));
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].date, r[0].member, r[0].part, r[0].won, r[0].sale, r[0].round, r[0].venue], ['2025-03-23', '大賀彩姫', 1, 2, 7, 3, '幕張メッセ']);
});
test('重ねて撮ったスクショの重複は1つに', () => {
  const a = `商品名：【3月22日(土) 幕張メッセ】 AKB48 坂川 陽香 第4部\n申込数：2枚　当選数：2枚\n`;
  assert.equal(parseAkMail(a + a, new Date('2025-03-06')).length, 1);
});
test('申込受付のご連絡（結果待ちの申込）と、抽選結果の申込番号', () => {
  const app = `本メールは申込内容確認ご案内です。
●申込受付内容
【抽選申込/第7販売 第3次】AKB48 65thシングル「まさかのConfession」Official Shop盤
申込番号：430306-1289764
合計枚数：2枚

■商品内訳
商品名：【3月23日(日) 幕張メッセ】 AKB48 大賀 彩姫 第1部
数量：2枚（単価1,200円）
小計：2,400 円(税込)
●各種ご注意事項
※お申込み内容の抽選（当落）結果は、別途、期日内にメールにてご案内いたします。`;
  const a = parseAkMail(app, new Date('2025-03-05T21:00:00Z'));
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].type, a[0].no, a[0].applied, a[0].won, a[0].sale, a[0].round, a[0].date], ['apply', '430306-1289764', 2, null, 7, 3, '2025-03-23']);
  const r = parseAkMail(lottery, new Date('2025-03-06T10:00:00Z'));
  assert.deepEqual([r[0].type, r[0].no], ['result', '430306-1289764']);
  const o = parseAkMail(order, new Date('2025-08-30T21:00:00Z'));
  assert.equal(o[0].type, 'order');
});
