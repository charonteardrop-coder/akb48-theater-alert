import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';
import { makeD1, fakeSub } from './helpers.js';

const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
const mk = () => ({ DB: makeD1(schema), ADMIN_TOKEN: 'test-admin-token-123456', ALLOWED_ORIGINS: 'https://me.github.io' });
const call = (env, path, { method = 'GET', body, token, origin = 'https://me.github.io' } = {}) =>
  worker.fetch(new Request(`https://api.test${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env);

test('購読の登録・更新・一覧・解除', async () => {
  const env = mk();
  let r = await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(1), members: ['千葉恵里', '迫由芽実', '千葉恵里'] } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://me.github.io');
  await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(1), members: ['山﨑空'] } }); // 同じ端末は上書き
  await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(2), members: ['*'] } });

  r = await call(env, '/admin/subscriptions', { token: env.ADMIN_TOKEN });
  const j = await r.json();
  assert.equal(j.items.length, 2);
  assert.deepEqual(j.items.find((x) => x.subscription.endpoint === fakeSub(1).endpoint).members, ['山﨑空']);

  await call(env, '/unsubscribe', { method: 'POST', body: { endpoint: fakeSub(2).endpoint } });
  await call(env, '/admin/remove', { method: 'POST', token: env.ADMIN_TOKEN, body: { endpoints: [fakeSub(1).endpoint] } });
  assert.equal((await (await call(env, '/admin/subscriptions', { token: env.ADMIN_TOKEN })).json()).items.length, 0);
});

test('不正な入力・認証なしは弾く', async () => {
  const env = mk();
  const bad = [
    { subscription: { ...fakeSub(1), endpoint: 'https://evil.example.com/x' }, members: ['a'] },
    { subscription: { ...fakeSub(1), endpoint: 'http://web.push.apple.com/x' }, members: ['a'] },
    { subscription: { ...fakeSub(1), keys: { p256dh: '<script>', auth: 'x' } }, members: ['a'] },
    { subscription: fakeSub(1), members: 'a' },
    { subscription: fakeSub(1), members: ['x'.repeat(21)] },
    { subscription: fakeSub(1), members: Array.from({ length: 61 }, (_, i) => `m${i}`) },
  ];
  for (const b of bad) assert.equal((await call(env, '/subscribe', { method: 'POST', body: b })).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await call(env, '/admin/subscriptions')).status, 401);
  assert.equal((await call(env, '/admin/subscriptions', { token: 'wrong-token-wrong-token' })).status, 401);
  assert.equal((await call({ ...env, ADMIN_TOKEN: 'short' }, '/admin/subscriptions', { token: 'short' })).status, 401, '短すぎるトークンは無効');
  const r = await call(env, '/subscribe', { method: 'OPTIONS', origin: 'https://other.example' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'null', '許可していないサイトからは使えない');
});

test('応募済みの枠：保存・省略時は前の値のまま・古いテーブルにも自動で列を足す', async () => {
  const env = mk();
  const list = async () => (await (await call(env, '/admin/subscriptions', { token: env.ADMIN_TOKEN })).json()).items[0];
  await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(1), members: ['千葉恵里'] } });
  assert.deepEqual((await list()).applied, []);
  await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(1), members: ['千葉恵里'], applied: ['212265', '212266'] } });
  assert.deepEqual((await list()).applied, ['212265', '212266']);
  await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(1), members: ['山﨑空'] } });
  assert.deepEqual((await list()).applied, ['212265', '212266'], 'applied を送らない更新では消えない');
  assert.equal((await call(env, '/subscribe', { method: 'POST', body: { subscription: fakeSub(1), members: ['a'], applied: ['<x>'] } })).status, 400);

  // applied 列がない前のバージョンのテーブル
  const old = { ...mk(), DB: makeD1(schema.replace(/^\s*applied .*\n/m, '')) };
  const r = await call(old, '/subscribe', { method: 'POST', body: { subscription: fakeSub(2), members: ['千葉恵里'], applied: ['1'] } });
  assert.equal(r.status, 200);
  const j = await (await call(old, '/admin/subscriptions', { token: old.ADMIN_TOKEN })).json();
  assert.deepEqual(j.items[0].applied, ['1']);
});
