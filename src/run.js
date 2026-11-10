// 定期実行のエントリポイント（GitHub Actionsから10分おきに呼ばれる）
// 情報源は AKB48チケットセンター（akb48.zaiko.io）のみ。通知は Web Push で購読者の端末へ直接送る。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import webpush from 'web-push';
import { ORIGIN, parseList, parseDetail, mergeDetail, fingerprint, isOpen, parseSitemap, parseEventPage } from './zaiko.js';
import { composeFor, diffMembers, dueReminders } from './core.js';

const env = process.env;
const UA = 'oshi-gekijo-alert (fan-made notifier; checks the event list every 10 min)';

const PATHS = {
  state: 'state/state.json',
  shows: 'docs/data/shows.json',
  members: 'docs/data/members.json',
  archive: 'docs/data/archive.json',
  config: 'docs/data/config.json',
};

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
async function writeJson(p, v) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 2) + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, fetchImpl) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-language': 'ja' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
      last = new Error(`HTTP ${r.status} ${url}`);
      if (r.status < 500 && r.status !== 429) throw last;
    } catch (e) {
      last = e;
    }
    await sleep(3000 * (i + 1));
  }
  throw last;
}

/** 購読サーバーから全購読を取る */
async function loadSubscriptions(fetchImpl) {
  const items = [];
  let offset = 0;
  while (offset !== null) {
    const r = await fetchImpl(`${env.API_BASE}/admin/subscriptions?offset=${offset}&limit=1000`, {
      headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` },
    });
    if (!r.ok) throw new Error(`購読一覧を取れなかった: HTTP ${r.status}`);
    const j = await r.json();
    items.push(...j.items);
    offset = j.next;
  }
  return items;
}

/** 実際に送る（失効した購読のendpointを返す） */
async function deliver(jobs, { sendImpl, fetchImpl }) {
  const gone = [];
  let ok = 0, ng = 0;
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const { subscription, payload } = queue.shift();
      try {
        await sendImpl(subscription, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
        ok++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) gone.push(subscription.endpoint);
        else { ng++; console.error(`push失敗 ${e.statusCode || ''} ${e.body || e.message}`); }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (gone.length) {
    await fetchImpl(`${env.API_BASE}/admin/remove`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoints: gone }),
    }).catch((e) => console.error('失効購読の削除に失敗', e.message));
  }
  return { ok, ng, gone: gone.length };
}

/** 一覧から消えた公演のうち、開演時刻を過ぎたものをアーカイブに追加（新しい順・最大2000件） */
export function archiveFinished(archive, prevShows, currentShows, now) {
  const cur = new Set(currentShows.map((s) => s.id));
  const have = new Set(archive.map((a) => a.id));
  const add = prevShows
    .filter((s) => !cur.has(s.id) && !have.has(s.id) && new Date(s.start) <= now)
    .map(({ id, date, label, time, start, title, note, members, url }) => ({ id, date, label, time, start, title, note, members, url }));
  if (!add.length) return archive;
  return [...archive, ...add].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 2000);
}

export async function run({ now = new Date(), fetchImpl = fetch, sendImpl } = {}) {
  const DRY_RUN = env.DRY_RUN === '1';
  const canSend = env.API_BASE && env.ADMIN_TOKEN && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY;
  if (!sendImpl && canSend) {
    webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    sendImpl = (sub, body, opt) => webpush.sendNotification(sub, body, opt);
  }

  const state = await readJson(PATHS.state, { bootstrapped: false, openNotified: [], sentReminders: [] });
  const prevShows = new Map((await readJson(PATHS.shows, [])).map((s) => [s.id, s]));
  const members = await readJson(PATHS.members, []);
  const openNotified = new Set(state.openNotified);
  const sent = new Set(state.sentReminders);
  const firstRun = !state.bootstrapped;

  // 1. 一覧（トップページ1回だけ）
  const list = parseList(await fetchText(`${ORIGIN}/ja`, fetchImpl));
  if (!list.length) console.warn('劇場公演が1件も見つからなかった（掲載がないか、ページ構造が変わった可能性）');

  // 2. 新しい公演・状態が変わった公演だけ詳細を取りに行く
  const shows = [];
  const ev = { opened: [], changes: [], reminders: [] };
  for (const s of list) {
    const prev = prevShows.get(s.id);
    s.fp = fingerprint(s);
    if (!prev || prev.fp !== s.fp || s.slots.some((x) => !prev.slots.some((p) => p.id === x.id))) {
      try {
        mergeDetail(s, parseDetail(await fetchText(s.url, fetchImpl)));
      } catch (e) {
        console.warn(`詳細を取れなかった ${s.url}: ${e.message}`);
        if (prev) mergeDetail(s, prev.slots.filter((x) => x.end).map((x) => ({ ...x, status: s.slots.find((y) => y.id === x.id)?.status ?? x.status })));
      }
      await sleep(1500);
    } else {
      mergeDetail(s, prev.slots);
    }
    shows.push(s);

    if (isOpen(s) && !openNotified.has(s.id)) {
      openNotified.add(s.id);
      if (!firstRun) ev.opened.push(s);
    }
    if (prev && !firstRun) {
      const d = diffMembers(prev.members, s.members);
      if (d.added.length || d.removed.length) ev.changes.push({ show: s, ...d });
    }
  }

  // 3. 締切リマインド（初回は既読扱いにするだけ）
  const due = dueReminders(shows, sent, now);
  due.forEach((r) => sent.add(r.key));
  if (!firstRun && env.REMINDERS !== '0') ev.reminders = due;

  // 4. 送信
  const anything = ev.opened.length || ev.changes.length || ev.reminders.length;
  let jobs = [];
  if (anything) {
    if (!canSend && !sendImpl) {
      console.warn('API_BASE / ADMIN_TOKEN / VAPID鍵 が未設定なので送信はスキップ');
    } else {
      const subs = await loadSubscriptions(fetchImpl);
      for (const sub of subs) {
        for (const payload of composeFor(sub.members, ev, now, sub.applied || [])) jobs.push({ subscription: sub.subscription, payload });
      }
    }
  }
  if (DRY_RUN) {
    for (const j of jobs) console.log(`[dry-run] → ${j.subscription.endpoint.slice(0, 40)}…\n  ${j.payload.title}\n  ${j.payload.body.replace(/\n/g, '\n  ')}`);
    jobs = [];
  }
  const res = jobs.length ? await deliver(jobs, { sendImpl, fetchImpl }) : { ok: 0, ng: 0, gone: 0 };
  console.log(`公演 ${shows.length}件 / 新規受付 ${ev.opened.length} / 変更 ${ev.changes.length} / リマインド ${ev.reminders.length} / 送信 成功${res.ok} 失敗${res.ng} 失効${res.gone}`);

  // 5. メンバー一覧（180日出演がなければ外す）
  const mm = new Map(members.map((m) => [m.name, m]));
  for (const s of shows) for (const name of s.members) {
    const prev = mm.get(name);
    mm.set(name, { name, lastSeen: prev && prev.lastSeen > s.date ? prev.lastSeen : s.date });
  }
  const cutoff = new Date(now.getTime() - 180 * 864e5).toISOString().slice(0, 10);
  const memberList = [...mm.values()].filter((m) => m.lastSeen >= cutoff);

  // 6. 保存
  // 7. 終わった公演はアーカイブへ（観覧記録で「公演から選ぶ」に使う）
  const archive = await readJson(PATHS.archive, []);
  let archived = archiveFinished(archive, [...prevShows.values()], shows, now);

  // 初回だけ：チケットセンターのサイトマップに残っている過去の公演（直近1か月ほど）もアーカイブに入れる
  if (!state.backfilled) {
    try {
      const known = new Set([...shows, ...archived].map((s) => s.url));
      const urls = parseSitemap(await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl)).filter((u) => !known.has(u)).slice(0, 300);
      const found = [];
      for (const u of urls) {
        try {
          const ev = parseEventPage(await fetchText(u, fetchImpl), u);
          if (ev && new Date(ev.start) <= now) found.push(ev);
        } catch (e) { console.warn(`過去公演を読めなかった ${u}: ${e.message}`); }
        await sleep(1500);
      }
      archived = archiveFinished(archived, found, [], now);
      state.backfilled = true;
      console.log(`過去の公演 ${found.length}件をアーカイブに追加（サイトマップから）`);
    } catch (e) { console.warn('サイトマップを読めなかった（次回また試す）', e.message); }
  }

  // データが変わったときだけ更新日時を進める（毎回コミットが発生しないように）
  const ids = new Set(shows.map((s) => s.id));
  const prevCfg = await readJson(PATHS.config, {});
  const changed = JSON.stringify(shows) !== JSON.stringify([...prevShows.values()]) || JSON.stringify(memberList) !== JSON.stringify(members)
    || archived.length !== archive.length;
  await writeJson(PATHS.shows, shows);
  await writeJson(PATHS.members, memberList);
  await writeJson(PATHS.archive, archived);
  await writeJson(PATHS.config, {
    apiBase: env.API_BASE || '',
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
    source: ORIGIN,
    updatedAt: changed || !prevCfg.updatedAt ? now.toISOString() : prevCfg.updatedAt,
  });
  await writeJson(PATHS.state, {
    bootstrapped: true,
    backfilled: !!state.backfilled,
    openNotified: [...openNotified].filter((id) => ids.has(id)),
    sentReminders: [...sent].filter((k) => ids.has(Number(k.split(':')[0]))),
  });
  return { ev, jobs, shows, memberList, res };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
