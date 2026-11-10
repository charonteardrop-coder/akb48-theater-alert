// 通知の中身づくり（ネットワークに触らない純粋なロジック）

export function fmtJst(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.month}/${p.day}(${p.weekday}) ${p.hour}:${p.minute}`;
}

/** 受付中の枠を締切ごとにまとめる → [{end, names}] */
export function deadlineGroups(show, now = new Date(), { includeLobby = false } = {}) {
  const g = new Map();
  for (const s of show.slots) {
    if (s.status !== 'open' || !s.end || new Date(s.end) <= now) continue;
    if (s.lobby && !includeLobby) continue;
    if (!g.has(s.end)) g.set(s.end, []);
    g.get(s.end).push(s.short);
  }
  return [...g.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([end, names]) => ({ end, names }));
}

export function diffMembers(prev, next) {
  const a = new Set(prev), b = new Set(next);
  return { added: next.filter((m) => !a.has(m)), removed: prev.filter((m) => !b.has(m)) };
}

/** 締切リマインドの対象：各締切の leadHours 前を過ぎたもの（keyで1回だけ） */
export function dueReminders(shows, sent, now = new Date(), leadHours = 6) {
  const items = [];
  for (const s of shows) {
    for (const g of deadlineGroups(s, now)) {
      const key = `${s.id}:${g.end}`;
      if (sent.has(key)) continue;
      if (now < new Date(new Date(g.end).getTime() - leadHours * 3600e3)) continue;
      items.push({ key, show: s, group: g });
    }
  }
  return items;
}

const head = (s) => `${s.label} ${s.time} ${s.title}${s.note ? `（${s.note}）` : ''}`;
const dlLines = (s, now) => {
  const g = deadlineGroups(s, now);
  return g.length ? g.map((x) => `〆 ${fmtJst(x.end)} ${x.names.join('/')}`).join('\n') : '';
};
const shortTitle = (s) => s.title.replace(/^「|」\s*公演$/g, '').replace(/」公演$/, '');

/**
 * 購読者1人ぶんの通知を作る
 * @param {string[]} subMembers 購読している推し（"*" で全公演）
 * @param {{opened, changes, reminders}} ev このチェックで起きたこと
 * @returns {Array<{title, body, url, tag, apply?}>}
 */
export function composeFor(subMembers, ev, now = new Date()) {
  const all = subMembers.includes('*');
  const mine = new Set(subMembers.filter((m) => m !== '*'));
  const oshiIn = (s) => s.members.filter((m) => mine.has(m));
  const relevant = (s) => all || oshiIn(s).length > 0;
  const out = [];

  // 受付開始
  const opened = ev.opened.filter(relevant).sort((a, b) => a.start.localeCompare(b.start));
  if (opened.length === 1) {
    const s = opened[0];
    const o = oshiIn(s);
    out.push({
      title: o.length ? `🎫 ${o.join('・')} 出演公演の受付が始まったよ` : '🎫 劇場公演の受付が始まったよ',
      body: [head(s), dlLines(s, now)].filter(Boolean).join('\n'),
      url: `./?show=${s.id}`,
      apply: s.url,
      tag: `open-${s.id}`,
    });
  } else if (opened.length > 1) {
    const firstEnd = opened.flatMap((s) => deadlineGroups(s, now)).map((g) => g.end).sort()[0];
    out.push({
      title: mine.size && !all ? `🎫 推しの出演公演 ${opened.length}件の受付が始まったよ` : `🎫 劇場公演 ${opened.length}件の受付が始まったよ`,
      body: opened.map((s) => `${s.label} ${s.time} ${shortTitle(s)}${oshiIn(s).length ? `（${oshiIn(s).join('・')}）` : ''}`).join('\n')
        + (firstEnd ? `\n最初の締切 ${fmtJst(firstEnd)}` : ''),
      url: './?view=oshi',
      tag: `open-${opened.map((s) => s.id).join('-')}`.slice(0, 60),
    });
  }

  // メンバー変更（推しが入った／外れた）。全公演購読だけの人には送らない
  for (const c of ev.changes) {
    const add = c.added.filter((m) => mine.has(m));
    const rem = c.removed.filter((m) => mine.has(m));
    if (!add.length && !rem.length) continue;
    const s = c.show;
    const live = deadlineGroups(s, now).length > 0;
    const lines = [head(s)];
    if (add.length && live) lines.push(dlLines(s, now));
    if (add.length && !live) lines.push('この公演の受付は終わってるよ');
    out.push({
      title: add.length ? `🔄 ${add.join('・')} がメンバー変更で出演決定` : `ℹ️ ${rem.join('・')} が出演メンバーから外れたよ`,
      body: lines.join('\n') + (add.length && rem.length ? `\n（${rem.join('・')} は外れたよ）` : ''),
      url: `./?show=${s.id}`,
      apply: add.length && live ? s.url : undefined,
      tag: `change-${s.id}`,
    });
  }

  // 締切リマインド
  const rem = ev.reminders.filter((r) => mine.size ? oshiIn(r.show).length > 0 : false);
  if (rem.length) {
    const shows = [...new Set(rem.map((r) => r.show))];
    out.push({
      title: `⏰ 推しの出演公演、締切が近いよ`,
      body: rem.map((r) => `${r.show.label} ${r.show.time} ${shortTitle(r.show)}（${oshiIn(r.show).join('・')}）\n〆 ${fmtJst(r.group.end)} ${r.group.names.join('/')}`).join('\n'),
      url: shows.length === 1 ? `./?show=${shows[0].id}` : './?view=oshi',
      apply: shows.length === 1 ? shows[0].url : undefined,
      tag: `remind-${rem.map((r) => r.key).join('|')}`.slice(0, 60),
    });
  }
  return out;
}
