// 公式ブログ「劇場情報」の過去記事（2012年〜）から公演データを作る
// 記事本文は「1行＝1文字列」に直してから渡す（リンクは行末に " <URL>" を付ける）。
// ネットワークに触らない純粋なロジック。Node（取り込みスクリプト）とブラウザの両方で同じものを使う。

const WD = '[月火水木金土日祝・･·]+';
const FULL_DATE = new RegExp(`^[▼■◆●・]?\\s*(?:(\\d{4})年\\s*)?(\\d{1,2})月\\s*(\\d{1,2})日\\s*[(（](${WD})[)）]\\s*(.*)$`);
const SHORT_DATE = new RegExp(`^[▼■◆●・]?\\s*(\\d{1,2})\\/(\\d{1,2})\\/?\\s*[(（](${WD})[)）]\\s*(.*)$`);
const BARE_DATE = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2}:\d{2})?\s*$/;
const TIME = /(\d{1,2})[:：](\d{2})/g;
const STOP = /^【\s*(お申し?込み|申し?込み期間|当選発表|チケット|料金|配信|ご本人確認|本人確認|ロビー|MC|ピンポン|ガラポン|.*販売スケジュール|入場|注意|ご注意|お願い|お客様へ|販売|グッズ|特典|座席|写真)/;
const NOT_NOTE = /※|★|チケット|円|応募|申込|申し込|詳細|自由席|抽選|入場|ご了承|注意|コチラ|こちら|配信|。|http|お知らせ|ください|下さい|いたします|致します|受付|当選|販売|会員|枠$|[！!？?]|させて|頂き|いただき|です|ます/;
const INTRO = /^(に|の|、|～|〜|から|より|は|を|にて)/;

const pad = (n) => String(n).padStart(2, '0');
// 「202311月26日」のような年と月の間の誤記を補正
const fixLine = (raw) => String(raw).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/^(20\d\d)(\d{1,2})月/, '$1年$2月');
const times = (s) => [...String(s).matchAll(TIME)].map((m) => `${pad(m[1])}:${m[2]}`).filter((t) => Number(t.slice(0, 2)) < 24);
export const normTitle = (s) => String(s || '').normalize('NFKC').replace(/[\s　]/g, '');

function yearFor(month, pubIso) {
  const p = new Date(pubIso);
  const py = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(p));
  const pm = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', month: 'numeric' }).format(p));
  if (month < pm - 6) return py + 1;
  if (month > pm + 6) return py - 1;
  return py;
}
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** 「…」公演 を含む行から演目名（チーム名つき）を取り出す */
export function showTitle(line) {
  let s = line.replace(/<https?:[^>]*>/g, '');
  s = s.replace(/[＜<]\s*\d+回目\s*[＞>]/g, '');
  s = s.replace(/\d{1,2}[:：]\d{2}\s*(開演|開場|～|〜|-)?/g, ' ');
  s = s.replace(/[／/]\s*(?=\s|$)/g, ' ').replace(/開演/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?「[^」]+」\s*(公演)?)/);
  let t = m ? m[1] : s;
  if (!/公演$/.test(t) && /「[^」]+」$/.test(t) && !/公演/.test(t.match(/「([^」]+)」$/)[1])) t += '公演';
  return t.replace(/\s+(?=「)/, '').trim();
}

/** 記事タイトル「8月11日 「ＲＥＳＥＴ」公演のご案内」→「ＲＥＳＥＴ」公演 */
export function titleFromPostTitle(t) {
  let s = String(t || '').replace(/^(【[^】]*】\s*)+/, '').replace(/^\s*\d{1,2}月\s*\d{1,2}日\s*[(（]?[月火水木金土日祝]?[)）]?\s*/, '');
  s = s.replace(/\s*(の出演メンバー.*|のご案内.*|のお申し?込み.*|について.*|開催.*|実施.*|受付開始.*)$/, '').trim();
  if (/「[^」]+」/.test(s)) return showTitle(s);
  return s && s.length <= 30 && !/AKB48劇場|お知らせ|スケジュール/.test(s) ? s : '';
}

export function splitMembers(s) {
  return String(s)
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[・、,，／/･+＋]/)
    .flatMap((x) => x.replace(/[\s\u3000]/g, '').replace(/^(は|が|と|、)/, '').split(/(?<=..)と(?=..)/))
    .map((x) => x.trim())
    .filter((x) => x && x.length >= 2 && x.length <= 12 && !/[【】※:：0-9０-９。]|ゲスト|公演|内容|及び|メンバー/.test(x));
}

const isShowLine = (l) => /「[^」]+」/.test(l) && !/^[※★【■]/.test(l) && l.length <= 90 && !/。/.test(l.replace(/「[^」]*」/g, '')) && !/(中止|変更前|変更後)[：:]/.test(l)
  && !/※|権利|応募|申込|申し込|チャンネル|https?:|、/.test(l.replace(/「[^」]*」/g, '')) && !/^[(（]?\d+[)）]/.test(l);

/**
 * 公演告知の記事 → 公演のリスト（開演時刻ごとに1件）
 * @param {string[]} lines
 * @param {string} pub 記事の投稿日時（ISO）
 */
export function parseShows(lines, pub, postTitle = '') {
  const blocks = [];
  let date = null, pendingTimes = [], pendingTitle = '', cur = null, expect = null, introTitle = '';

  const start = (title, ts) => {
    cur = { date, title, times: [...new Set(ts)], notes: [], members: null, byTime: {}, links: {}, closed: false };
    blocks.push(cur);
    expect = null;
  };

  for (const raw of lines) {
    const line = fixLine(raw);
    if (!line) continue;
    if (!introTitle && /実施|開催/.test(line)) { const it = line.match(/「[^」]*公演[^」]*」|「[^」]+」\s*公演/); if (it) introTitle = /公演$/.test(it[0]) ? it[0].replace(/\s+(?=公演$)/, '') : it[0]; }

    let m = line.match(FULL_DATE) || null;
    let rest = null;
    if (m) {
      if (INTRO.test(m[5]) || /にて|実施|開催|予定|お知らせ|ご案内/.test(m[5]) && !isShowLine(m[5])) {
        const it = m[5].match(/「[^」]*公演[^」]*」|「[^」]+」\s*公演/);
        if (it && !introTitle) introTitle = /公演$/.test(it[0]) ? it[0].replace(/\s+(?=公演$)/, '') : it[0];
        continue;
      }
      const mon = Number(m[2]);
      date = ymd(m[1] ? Number(m[1]) : yearFor(mon, pub), mon, Number(m[3]));
      rest = m[5];
    } else if ((m = line.match(SHORT_DATE))) {
      const mon = Number(m[1]);
      date = ymd(yearFor(mon, pub), mon, Number(m[2]));
      rest = m[4];
    } else if ((m = line.match(BARE_DATE))) {
      const d = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
      if (cur && !cur.date) { cur.date = d; if (m[4]) cur.times.push(`${pad(m[4].split(':')[0])}:${m[4].split(':')[1]}`); date = d; continue; }
      date = d; pendingTimes = m[4] ? times(m[4]) : []; cur = null; continue;
    }
    if (rest !== null) {
      cur = null; expect = null;
      if (/休館|未定|休演日/.test(rest)) { pendingTimes = []; continue; }
      pendingTitle = '';
      // 「10/30(土) 14:00開演 稲垣香織・黒須遥香 / 18:30開演 小田えりな・倉野尾成美」
      const segs = rest.split(/\s+[\/／]\s+/);
      if (!isShowLine(rest) && segs.every((x) => times(x).length === 1 && /・/.test(x))) {
        start(introTitle, segs.map((x) => times(x)[0]));
        for (const x of segs) {
          const words = x.replace(/\d{1,2}[:：]\d{2}\s*(開演)?/, '').trim().split(/\s+/);
          assign(cur, [times(x)[0]], splitMembers(words.filter((w) => /・/.test(w)).join('・')));
          cur.notes.push(...words.filter((w) => !/・/.test(w)));
        }
        cur = null;
        continue;
      }
      if (isShowLine(rest)) { start(showTitle(rest), times(rest)); pendingTimes = []; }
      else {
        pendingTimes = times(rest);
        // 「」のない公演名（柱の会限定イベント など）
        const t = rest.replace(/\d{1,2}[:：]\d{2}\s*(開演)?/g, ' ').replace(/[／/]/g, ' ').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 30 && !NOT_NOTE.test(t)) {
          pendingTitle = t;
          if (/公演|ライブ|イベント|祭/.test(t)) start(t, pendingTimes); // スケジュールだけの記事（メンバーは後の記事で）
        }
      }
      continue;
    }

    if (STOP.test(line)) { if (cur) { cur.closed = true; expect = null; } }

    // 開演時刻だけの行（＜1回目＞ 13:00開演 など）
    if (cur && /^[＜<]?\s*\d+回目\s*[＞>]?\s*\d{1,2}[:：]\d{2}/.test(line)) {
      cur.times.push(...times(line));
      const extra = line.replace(/^[＜<]?\s*\d+回目\s*[＞>]?\s*\d{1,2}[:：]\d{2}\s*(開演)?/, '').trim();
      if (extra && extra.length <= 30 && !NOT_NOTE.test(extra)) cur.notes.push(extra);
      continue;
    }
    if (cur && /^\d{1,2}[:：]\d{2}\s*開演/.test(line) && !cur.members) { cur.times.push(...times(line)); continue; }
    if (!cur && date && /^\d{1,2}[:：]\d{2}\s*(開演)?$/.test(line)) { pendingTimes.push(...times(line)); continue; }
    if (!cur && date && /公演/.test(line) && !/「|出演メンバー/.test(line) && !/^[【■◆※★]/.test(line) && line.length <= 60 && !NOT_NOTE.test(line.replace(/[～~].*$/, ''))) { pendingTitle = line.replace(/\s*[～~].*$/, '').trim(); continue; }

    // 出演メンバーの見出し
    const mh = line.match(/^[【■◆]\s*([^】]*?)出演メンバー([^】]*?)】?\s*(.*)$/);
    if (mh && !/変更前|変更後/.test(line)) {
      if (!cur && (date || blocks.length === 0)) start(pendingTitle, pendingTimes); // タイトル行が無い記事
      const ts = times(mh[1] + mh[2]);
      const inline = mh[3] && !/^※/.test(mh[3]) ? splitMembers(mh[3]) : [];
      const tgt = ts.length ? ts : null;
      if (inline.length) assign(cur, tgt, inline);
      else expect = { times: tgt };
      continue;
    }
    if (expect && cur) {
      if (/^※/.test(line)) continue;
      const mem = splitMembers(line);
      if (mem.length >= 2 || (mem.length === 1 && !/。/.test(line) && line.length <= 14)) { assign(cur, expect.times, mem); expect = null; continue; }
      if (!mem.length && line.length <= 20 && !/。/.test(line) && !STOP.test(line)) continue;
      expect = null;
    }

    // 演目の行
    if (date !== null || blocks.length === 0) {
      if (isShowLine(line) && !(cur && cur.title && !cur.members && !cur.closed && !/公演/.test(line))) {
        if (!cur || cur.members || cur.closed || cur.title) { start(showTitle(line), times(line).length ? times(line) : pendingTimes); continue; }
        cur.title = showTitle(line); cur.times.push(...times(line)); continue;
      }
    }

    // 申込リンク
    const links = [...line.matchAll(/<(https?:\/\/[^>]*zaiko\.io\/[^>]+)>/g)].map((x) => x[1]).filter((u) => /\/(e|item)\//.test(u));
    if (cur && links.length) {
      const ts = times(line);
      links.forEach((u, i) => { cur.links[ts[i] || ts[0] || ''] = u; });
      continue;
    }

    // 補足（生誕祭・女性限定など）
    if (cur && !cur.members && !cur.closed && line.length <= 40 && !NOT_NOTE.test(line)) {
      const n = line.replace(/^【|】$/g, '').replace(/[；;]/g, ' ').trim();
      if (n && !/^\d{1,2}[:：]\d{2}$/.test(n)) cur.notes.push(n);
    }
  }

  function assign(c, ts, mem) {
    if (ts) for (const t of ts) { c.byTime[t] = mem; if (!c.times.includes(t)) c.times.push(t); }
    else c.members = mem;
  }

  const fallback = introTitle || titleFromPostTitle(postTitle);
  const out = [];
  for (const b of blocks) {
    if (!b.date || !(b.title || b.members || Object.keys(b.byTime).length)) continue;
    if (!b.title && blocks.length === 1) b.title = fallback;
    const ts = b.times.length ? [...new Set(b.times)].sort() : [''];
    for (const t of ts) {
      const members = [...new Set(b.byTime[t] || b.members || Object.values(b.byTime)[0] || [])];
      if (!b.title && !members.length) continue;
      out.push({
        date: b.date, time: t, title: b.title, note: [...new Set(b.notes)].join(' '),
        members, url: b.links[t] || b.links[''] || (ts.length === 1 ? Object.values(b.links)[0] : '') || '',
      });
    }
  }
  return out;
}

/**
 * メンバー変更の記事 → 変更のリスト
 * 構造化（【休演】【出演】／【変更前の出演メンバー】【変更後の出演メンバー】）と文章（「出演予定でした○○ですが…代わりに△△が出演」）の両方
 */
export function parseChanges(lines, pub) {
  const out = [];
  let ctx = { date: null, time: '' };
  let mode = null, cur = null;
  const ensure = () => { if (!cur || cur.date !== ctx.date || cur.time !== ctx.time) { cur = { date: ctx.date, time: ctx.time, out: [], in: [], full: [] }; out.push(cur); } return cur; };
  const setDate = (y, mo, d, rest = '') => {
    const ts = times(rest);
    ctx = { date: ymd(y ? Number(y) : yearFor(Number(mo), pub), Number(mo), Number(d)), time: ts.length === 1 ? ts[0] : '' };
    mode = null;
  };

  let carry = '';
  for (const raw of lines) {
    let line = fixLine(raw);
    if (!line) continue;
    if (carry) { line = carry + line; carry = ''; }
    if (/出演予定(でした|の)$/.test(line)) { carry = line; continue; }
    let m;
    if ((m = line.match(FULL_DATE))) setDate(m[1], m[2], m[3], m[5]);
    else if ((m = line.match(SHORT_DATE))) setDate(null, m[1], m[2], m[4]);
    else if (!ctx.date && (m = line.match(/(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日/)) && /変更|休演|出演|公演/.test(line)) setDate(m[1], m[2], m[3], line);
    if (ctx.date && !ctx.time && (m = line.match(/^(\d{1,2}[:：]\d{2})\s*公演/))) { ctx.time = times(m[1])[0]; cur = null; }
    // 文章で書かれた変更「○月○日の…公演に出演予定でした△△ですが、…代わりに□□が出演」
    const pm = line.match(/出演予定(?:でした|の)(.+?)(?:ですが|が、|が休演|は、)/);
    if (pm) {
      const d = line.match(/(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日/);
      if (d) setDate(d[1], d[2], d[3], line.slice(0, line.indexOf('出演予定')));
      if (ctx.date) ensure().out.push(...splitMembers(pm[1].replace(/^.*公演に/, '')));
    }
    if ((m = line.match(/代わりに(.+?)が(出演|代演)/)) && ctx.date) ensure().in.push(...splitMembers(m[1]));

    // 「工藤華純 ⇒ 八木愛月」
    const ar = line.match(/^([^⇒→➡。]+?)\s*[⇒→➡]\s*([^。]+)$/);
    if (ar && ctx.date) { const c = ensure(); c.out.push(...splitMembers(ar[1])); c.in.push(...splitMembers(ar[2])); continue; }

    let h = line.match(/^【\s*(休演|出演|代演|変更前の出演メンバー|変更後の全?出演メンバー一覧|変更後の全出演メンバー|変更後の出演メンバー|追加出演|追加)\s*】\s*(.*)$/);
    if (!h) { const c2 = line.match(/^(休演|出演|代演|追加出演)\s*[：:]\s*(.+)$/); if (c2) h = [line, c2[1], c2[2]]; } // 「休演：○○」
    if (h) {
      if (!ctx.date) continue;
      mode = /一覧|全出演/.test(h[1]) ? 'full' : /休演|変更前/.test(h[1]) ? 'out' : 'in';
      if (h[2]) { ensure()[mode].push(...splitMembers(h[2])); mode = null; }
      continue;
    }
    if (mode && ctx.date) {
      const mem = splitMembers(line);
      if (mem.length && !/。/.test(line)) ensure()[mode].push(...mem);
      mode = null;
    }
  }
  return out.filter((c) => c.date && (c.out.length || c.in.length || c.full.length))
    .map(({ full, ...c }) => ({ ...c, out: [...new Set(c.out)], in: [...new Set(c.in)], ...(full.length ? { full: [...new Set(full)] } : {}) }));
}

const keyOf = (s) => `${s.date}|${s.time || normTitle(s.title)}`;

/**
 * 全記事の結果をまとめる：同じ公演（日付＋開演）は新しい記事で上書き → メンバー変更を時系列に反映
 * @param {Array<{pub, url, shows, changes}>} posts
 */
export function buildHistory(posts) {
  const map = new Map();
  const sorted = [...posts].sort((a, b) => a.pub.localeCompare(b.pub));
  for (const p of sorted) {
    for (const s of p.shows) {
      const k = keyOf(s);
      const prev = map.get(k);
      if (!prev) { map.set(k, { ...s, src: p.url, pub: p.pub }); continue; }
      map.set(k, {
        ...prev,
        title: s.title || prev.title,
        note: [...new Set([...prev.note.split(' '), ...s.note.split(' ')].filter(Boolean))].join(' '),
        members: s.members.length ? s.members : prev.members,
        url: s.url || prev.url,
        src: p.url, pub: p.pub,
      });
    }
  }
  // 開演時刻なしの重複（同じ日に時刻つきがある）を整理
  for (const [k, s] of map) {
    if (!s.time && [...map.values()].some((x) => x !== s && x.date === s.date && x.time && (!s.title || normTitle(x.title) === normTitle(s.title)))) map.delete(k);
  }
  const changes = sorted.flatMap((p) => p.changes.map((c) => ({ ...c, pub: p.pub })));
  let applied = 0;
  for (const c of changes) {
    const same = [...map.values()].filter((s) => s.date === c.date && s.pub <= c.pub);
    const tgt = c.time ? same.filter((s) => s.time === c.time) : same;
    for (const s of (tgt.length ? tgt : same)) {
      if (c.full && c.full.length >= 4) s.members = [...c.full];
      else {
        s.members = s.members.filter((m) => !c.out.includes(m));
        for (const m of c.in) if (!s.members.includes(m)) s.members.push(m);
      }
      applied++;
    }
  }
  const list = [...map.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { shows: list, applied };
}

/** 記事タイトルで、本文を読む必要があるか判定 */
export function isRelevantTitle(t) {
  const main = /公演メンバー|出演メンバー|公演スケジュール|受付開始|公演のご案内|お申し?込みについて|メンバー変更|休演|代演|出演のお知らせ|卒業公演|生誕祭|特別公演|公演決定/.test(t)
    && !/営業時間|展示|プレゼント|グッズ|生写真|書き初め|配信開始タイトル|サブスクリプション|個人情報|不正アクセス/.test(t);
  const extra = /実施のお知らせ|開催のお知らせ|演目変更|公演変更/.test(t) && !/営業時間|展示|プレゼント|グッズ|生写真|販売/.test(t);
  return main || extra;
}

/** ブログ記事のHTML → 本文の行（リンクは " <URL>" を行に付ける）。ブラウザ版と同じ規則 */
export function htmlToLines(bodyHtml) {
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  let h = String(bodyHtml)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `${text} \u0001${href}\u0002`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ent[e.toLowerCase()] ?? m));
  return h.replace(/\u0001/g, '<').replace(/\u0002/g, '>').replace(/\u00a0/g, ' ').split('\n').map((l) => l.replace(/[ \t\u3000]+/g, ' ').trim()).filter(Boolean);
}

/** 公演リスト → 年ごとのファイル内容 { "2013": [...], ... } と索引 */
export function toYearFiles(shows) {
  const used = new Set();
  const years = {};
  for (const s of [...shows].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    let id = `${s.date.replace(/-/g, '')}-${(s.time || '').replace(':', '') || 'x'}`;
    for (let i = 2; used.has(id); i++) id = `${id.replace(/~\d+$/, '')}~${i}`;
    used.add(id);
    const y = s.date.slice(0, 4);
    (years[y] ||= []).push({ id, date: s.date, time: s.time || '', title: s.title || '', note: s.note || '', members: s.members || [], ...(s.url ? { url: s.url } : {}) });
  }
  const index = { years: Object.keys(years).sort(), counts: Object.fromEntries(Object.entries(years).map(([y, v]) => [y, v.length])) };
  return { years, index };
}
