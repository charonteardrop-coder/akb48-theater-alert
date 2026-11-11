import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import worker from '../worker/index.js';
import { parseList, parseDetail, mergeDetail } from '../src/zaiko.js';
import { composeFor, dueReminders } from '../src/core.js';
import { archiveFinished } from '../src/run.js';
import { LIST, DETAIL_1117, listHtml, detailHtml, synthDetail, makeD1, fakeSub } from './helpers.js';

const show1117 = () => {
  const [s] = parseList(listHtml(LIST.filter((e) => e.id === 386017)));
  return mergeDetail(s, parseDetail(detailHtml(DETAIL_1117)));
};
const at = (iso) => new Date(iso);

test('文面：推し1公演なら締切つき、複数公演ならまとめて1通', () => {
  const s = show1117();
  const now = at('2026-11-01T16:05:00+09:00');
  const [one] = composeFor(['千葉恵里'], { opened: [s], changes: [], reminders: [] }, now);
  assert.equal(one.title, '🎫 千葉恵里 出演公演の受付が始まったよ');
  assert.equal(one.body, '11/17(火) 18:30 「ＲＥＳＥＴ」公演（千葉恵里 生誕祭）\n〆 11/10(火) 16:00 映像倉庫/柱の会/100発98中\n〆 11/12(木) 16:00 一般/ファミカプ/女性・小中学生');
  assert.equal(one.url, './?show=386017');
  assert.equal(one.apply, 'https://akb48.zaiko.io/e/2026e-1117-1830');

  const others = parseList(listHtml(LIST)).filter((x) => [386018, 386019].includes(x.id));
  const [multi] = composeFor(['迫由芽実', '黒須遥香'], { opened: [s, ...others], changes: [], reminders: [] }, now);
  assert.equal(multi.title, '🎫 推しの出演公演 3件の受付が始まったよ');
  assert.match(multi.body, /^11\/17\(火\) 18:30 ＲＥＳＥＴ（黒須遥香・迫由芽実）/);
  assert.equal(composeFor(['伊藤百花'], { opened: [s], changes: [], reminders: [] }, now).length, 0, '推しが出ない公演では送らない');
  assert.equal(composeFor(['*'], { opened: [s], changes: [], reminders: [] }, now)[0].title, '🎫 劇場公演の受付が始まったよ');
});

test('文面：メンバー変更と締切リマインド', () => {
  const s = show1117();
  const now = at('2026-11-12T10:30:00+09:00');
  const [c] = composeFor(['山﨑空'], { opened: [], changes: [{ show: s, added: ['山﨑空'], removed: ['黒須遥香'] }], reminders: [] }, now);
  assert.equal(c.title, '🔄 山﨑空 がメンバー変更で出演決定');
  assert.match(c.body, /〆 11\/12\(木\) 16:00 一般/);
  assert.equal(composeFor(['*'], { opened: [], changes: [{ show: s, added: ['山﨑空'], removed: [] }], reminders: [] }, now).length, 0, '全公演購読だけの人には変更は送らない');

  assert.equal(dueReminders([s], new Set(), at('2026-11-12T09:59:00+09:00')).length, 0);
  const due = dueReminders([s], new Set(), now);
  assert.equal(due.length, 1);
  const [r] = composeFor(['千葉恵里'], { opened: [], changes: [], reminders: due }, now);
  assert.equal(r.body, '11/17(火) 18:30 ＲＥＳＥＴ（千葉恵里）\n〆 11/12(木) 16:00 一般/ファミカプ/女性・小中学生');
  assert.equal(dueReminders([s], new Set(due.map((x) => x.key)), now).length, 0, '同じ締切は1回だけ');
});

const pastEvent = (id, name, startIso, performers, venue = 'AKB48劇場') => ({
  id, name, venue: { data: { name: venue } }, performers: performers.map((n, i) => ({ id: i, name: n })),
  display_date_period: { start: { iso: startIso } }, tickets: [],
});
const PAST = {
  'https://akb48.zaiko.io/e/2026-1011-1730': pastEvent(370001, '10月11日 17:30開演「ＲＥＳＥＴ」公演　女性限定公演', '2026-10-11T08:30:00.000000Z', ['千葉恵里', '山﨑空']),
  'https://akb48.zaiko.io/e/2026-1103-1300': pastEvent(370002, '11月3日 13:00開演 「ここからだ」公演', '2026-11-03T04:00:00.000000Z', ['迫由芽実']),
  'https://akb48.zaiko.io/e/haru-con': pastEvent(370003, 'AKB48 春コンサート', '2026-04-03T09:00:00.000000Z', ['千葉恵里'], '国立代々木競技場第一体育館'),
};
const SITEMAP = `<?xml version="1.0"?><urlset>${[
  'https://akb48.zaiko.io/ja', ...Object.keys(PAST).map((u) => u.replace('.io/e/', '.io/ja/e/')), 'https://akb48.zaiko.io/ko/e/2026-1011-1730',
  'https://akb48.zaiko.io/ja/e/2026e-1117-1830', 'https://akb48.zaiko.io/ja/post/365',
].map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;

test('アーカイブ：開演前に一覧から消えた公演（中止など）は入れない・重複しない', () => {
  const past = { id: 1, start: '2026-11-01T09:30:00Z', date: '2026-11-01', members: [] };
  const future = { id: 2, start: '2026-12-01T09:30:00Z', date: '2026-12-01', members: [] };
  const now = at('2026-11-10T12:00:00+09:00');
  const a = archiveFinished([], [past, future], [], now);
  assert.deepEqual(a.map((x) => x.id), [1]);
  assert.equal(archiveFinished(a, [past], [], now), a);
});

test('暗号化：web-pushで作った通知を端末側の鍵で復号できる', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const authSecret = randomBytes(16);
  const sub = { endpoint: 'https://web.push.apple.com/test', keys: { p256dh: ua.getPublicKey('base64url'), auth: authSecret.toString('base64url') } };
  const vapid = webpush.generateVAPIDKeys();
  const payload = JSON.stringify({ title: '🎫 千葉恵里 出演公演の受付が始まったよ', body: '〆 11/12(木) 16:00', url: './?show=386017' });
  const req = webpush.generateRequestDetails(sub, payload, { vapidDetails: { subject: 'mailto:t@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 });
  assert.match(req.headers.Authorization, /^vapid t=.+, k=/);
  const plain = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: ua, authSecret: authSecret.toString('base64url') });
  assert.equal(plain.toString(), payload);
});

test('通し：初回は通知なし → 受付開始・メンバー変更・リマインドが推しの購読者だけに届く → 失効した購読は削除', async () => {
  process.chdir(mkdtempSync(join(tmpdir(), 'akb-')));
  Object.assign(process.env, { API_BASE: 'https://api.test', ADMIN_TOKEN: 'test-admin-token-123456', VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' });
  delete process.env.DRY_RUN;
  process.env.AKUSHU = '0'; // 握手会のチェックは akushu.test.js で見る
  const { run } = await import('../src/run.js');

  const wenv = { DB: makeD1(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8')), ADMIN_TOKEN: process.env.ADMIN_TOKEN };
  const events = structuredClone(LIST);
  const gets = [];
  const fetchImpl = async (url, opt = {}) => {
    if (url.startsWith('https://api.test')) return worker.fetch(new Request(url, opt), wenv);
    gets.push(url);
    if (url === 'https://akb48.zaiko.io/ja') return new Response(listHtml(events));
    if (url === 'https://akb48.zaiko.io/sitemap.xml') return new Response(SITEMAP);
    if (PAST[url]) return new Response(detailHtml(PAST[url]));
    const ev = events.find((e) => e.url.replace('/ja/', '/') === url);
    return ev ? new Response(detailHtml(synthDetail(ev))) : new Response('nf', { status: 404 });
  };
  const subscribe = (n, members) => worker.fetch(new Request('https://api.test/subscribe', { method: 'POST', body: JSON.stringify({ subscription: fakeSub(n), members }) }), wenv);
  await subscribe(1, ['千葉恵里']);
  await subscribe(2, ['山﨑空', '黒須遥香']);
  await subscribe(3, ['伊藤百花']);
  await subscribe(4, ['千葉恵里']); // あとで失効する端末

  const sent = [];
  const sendImpl = async (sub, body) => {
    if (sub.endpoint === fakeSub(4).endpoint) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ n: sub.endpoint.slice(-1), ...JSON.parse(body) });
  };

  // 初回：データ作成のみ（＋サイトマップから過去公演をアーカイブ）
  let r = await run({ now: at('2026-11-10T13:00:00+09:00'), fetchImpl, sendImpl });
  assert.equal(sent.length, 0);
  assert.equal(r.shows.length, 10);
  assert.equal(gets.length, 1 + 10 + 1 + 3, '一覧1回＋詳細10件＋サイトマップ＋過去公演3ページ（今の公演は読み直さない）');
  const arc0 = JSON.parse(readFileSync('docs/data/archive.json', 'utf8'));
  assert.deepEqual(arc0.map((a) => a.id), [370002, 370001], '劇場の過去公演だけ、新しい順。劇場以外と開演前は入れない');
  assert.equal(arc0[1].title, '「ＲＥＳＥＴ」公演');
  assert.equal(arc0[1].note, '女性限定公演');
  assert.deepEqual(arc0[1].members, ['千葉恵里', '山﨑空']);
  assert.equal(arc0[1].url, 'https://akb48.zaiko.io/e/2026-1011-1730');

  // 変化なし
  const snap = () => ['docs/data/shows.json', 'docs/data/members.json', 'docs/data/config.json', 'state/state.json'].map((f) => readFileSync(f, 'utf8')).join('');
  const before = snap();
  gets.length = 0;
  await run({ now: at('2026-11-10T13:10:00+09:00'), fetchImpl, sendImpl });
  assert.equal(gets.length, 1, '一覧を見るだけ');
  assert.equal(sent.length, 0);
  assert.equal(snap(), before, '何も変わらなければファイルも1バイトも変わらない（無駄なコミットをしない）');

  // 11/21公演が受付開始 ＋ 11/18公演で 黒須遥香→山﨑空 の変更
  const add = structuredClone(LIST.find((e) => e.id === 386019));
  Object.assign(add, { id: 390001, name: '11月21日 17:00開演「ＲＥＳＥＴ」公演', url: 'https://akb48.zaiko.io/ja/e/test-1121', start_time: '2026-11-21T08:00:00.000000Z' });
  add.artists = [{ id: 60855, name: '千葉恵里' }, { id: 61232, name: '迫由芽実' }];
  add.ticket_availability_list = add.ticket_availability_list.map((t) => ({ ...t, id: t.id + 100000 }));
  events.push(add);
  const e18 = events.find((e) => e.id === 386018);
  e18.artists = e18.artists.filter((a) => a.name !== '黒須遥香').concat({ id: 60976, name: '山﨑空' });

  r = await run({ now: at('2026-11-10T16:05:00+09:00'), fetchImpl, sendImpl });
  const to = (n) => sent.filter((x) => x.n === String(n));
  assert.equal(to(1).length, 1);
  assert.equal(to(1)[0].title, '🎫 千葉恵里 出演公演の受付が始まったよ');
  assert.equal(to(1)[0].url, './?show=390001');
  assert.equal(to(2).length, 1, '推しが2人いても1公演の変更なら1通');
  assert.equal(to(2)[0].title, '🔄 山﨑空 がメンバー変更で出演決定');
  assert.match(to(2)[0].body, /黒須遥香 は外れたよ/);
  assert.equal(to(3).length, 0, '関係ない推しの人には届かない');
  assert.equal(r.res.gone, 1);
  const left = await (await worker.fetch(new Request('https://api.test/admin/subscriptions', { headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } }), wenv)).json();
  assert.equal(left.items.length, 3, '失効した端末は購読サーバーから消える');

  // 締切リマインド（11/17の一般系は 11/12 16:00）
  sent.length = 0;
  await run({ now: at('2026-11-12T10:30:00+09:00'), fetchImpl, sendImpl });
  assert.match(to(1)[0].title, /締切が近い/);
  sent.length = 0;
  await run({ now: at('2026-11-12T11:00:00+09:00'), fetchImpl, sendImpl });
  assert.equal(sent.length, 0, '同じ締切のリマインドは1回だけ');

  // 11/10公演が終わってチケットセンターの一覧から消えた → アーカイブへ（サイトマップは2回目以降読まない）
  events.splice(events.findIndex((e) => e.id === 385806), 1);
  gets.length = 0;
  await run({ now: at('2026-11-11T09:00:00+09:00'), fetchImpl, sendImpl });
  assert.ok(!gets.includes('https://akb48.zaiko.io/sitemap.xml'));
  const arc = JSON.parse(readFileSync('docs/data/archive.json', 'utf8'));
  assert.equal(arc.length, 3);
  assert.equal(arc[0].id, 385806);
  assert.equal(arc[0].title, '「夢のポップスター」公演');
  assert.equal(arc[0].note, '倉野尾成美 生誕祭');
  assert.ok(arc[0].members.includes('山﨑空'));
  assert.ok(!('slots' in arc[0]), 'アーカイブは記録に必要な項目だけ');

  const cfg = JSON.parse(readFileSync('docs/data/config.json', 'utf8'));
  assert.equal(cfg.apiBase, 'https://api.test');
});

test('文面：応募済みにした枠は締切リマインドから外す', () => {
  const s = show1117();
  const now = at('2026-11-12T10:30:00+09:00');
  const due = dueReminders([s], new Set(), now);
  const ids = due[0].group.ids;
  assert.equal(ids.length, due[0].group.names.length);
  const [r] = composeFor(['千葉恵里'], { opened: [], changes: [], reminders: due }, now, [ids[0]]);
  assert.ok(!r.body.includes(due[0].group.names[0]) && r.body.includes(due[0].group.names[1]), '応募済みの枠だけ消える');
  assert.equal(composeFor(['千葉恵里'], { opened: [], changes: [], reminders: due }, now, ids).length, 0, '全部応募済みなら送らない');
  assert.equal(composeFor(['千葉恵里'], { opened: [], changes: [], reminders: due }, now, ['99999']).length, 1, '関係ない枠IDは影響しない');
});
