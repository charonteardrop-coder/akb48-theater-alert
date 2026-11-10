// 旧公式サイト（akb48.co.jp/schedule/YYYYMM.html、2006年4月〜2011年10月）の月別スケジュールを読む。
// ページはWayback Machineに残っているものを使う（scripts/import-oldsite.js）。
//
// 1日1行の表で、劇場の列（id="stage"）に「19:00～ [チームアイコン] 公演」、
// メンバーの列（id="attendance"）に時期によって次のどれかが書いてある。
//   ・2007〜2008年春：【公演メンバー】共通の出演者 ＋「13:00 A・B」のような回ごとの追加
//   ・2011年春〜秋 ：「12:00公演 … 【出演メンバー】 A・B・…」の回ごとのブロック
//   ・2008年春〜2011年春：「A・Bが全公演休演を、Cが12:00公演を休演いたします」のような休演者だけ
//   ・2006〜2007年：ほぼ空（たまに休演や誕生日のお知らせ）

const DOT = /[・･、,，]/;

const text = (html) => String(html || '')
  .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' [[$1]] ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/[ \t　]+/g, ' ');

const hhmm = (h, m) => `${String(Number(h)).padStart(2, '0')}:${m}`;

// 「秋元才加・大島優子」→ ['秋元才加','大島優子']（敬称や空白は落とす）
export function names(s) {
  return String(s || '').normalize('NFKC').split(DOT)
    .map((x) => x.replace(/\s+/g, '').replace(/(さん|ちゃん)$/, '').replace(/[()（）]/g, ''))
    .filter((x) => x.length >= 2 && x.length <= 12 && !/[0-9:：【】「」]|公演|休演|メンバー|出演|生誕|誕生日|料金|円/.test(x));
}

const isNameList = (line) => { const n = names(line); return n.length >= 4 && n.length >= line.split(DOT).length - 1; };

/** 劇場の列 → [{time, team, title, label}] */
export function parseStage(cellHtml) {
  const t = text(cellHtml).replace(/\n/g, ' ');
  const out = [];
  const re = /(\d{1,2}):(\d{2})\s*[～〜~]\s*([\s\S]*?)(?=\d{1,2}:\d{2}\s*[～〜~]|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const seg = m[3].trim();
    if (/チケット/.test(seg) && !/公演/.test(seg.replace(/チケット[^公]*/, ''))) continue;
    if (!/公演|\[\[/.test(seg)) continue;
    const icon = (seg.match(/\[\[([^\]]+)\]\]/) || [])[1] || '';
    const team = icon.replace(/「.*$/, '').trim();
    const title = (icon.match(/「([^」]+)」/) || [])[1] || '';
    const label = seg.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();
    out.push({ time: hhmm(m[1], m[2]), team, title, label });
  }
  return out;
}

/**
 * メンバーの列 → { byTime: {時刻: [名前]}, common: [名前] | null, absent: {全: [名前], 時刻: [名前]}, notes: {時刻|'*': [文字]} }
 */
export function parseAttendance(cellHtml) {
  const lines = text(cellHtml).normalize('NFKC').split('\n').map((x) => x.trim()).filter(Boolean);
  const res = { byTime: {}, common: null, absent: { '*': [] }, notes: { '*': [] } };
  let cur = null; // 2011形式の「12:00公演」ブロック
  let wantList = false;
  let absentMode = false; // 「休演メンバー」の見出しのあとは、時刻つきの行も休演者
  for (const line of lines) {
    if (/^【?休演(メンバー|者)】?$/.test(line)) { absentMode = true; continue; }
    if (absentMode) {
      const t = line.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
      if (t) { const k = hhmm(t[1], t[2]); res.absent[k] = [...(res.absent[k] || []), ...names(t[3])]; continue; }
      if (isNameList(line) || names(line).length) { res.absent['*'].push(...names(line)); continue; }
      absentMode = false;
    }
    if (/お休み|欠席/.test(line)) { absences(line.replace(/お休み(いた|致)します/, '休演いたします').replace(/^.*?の(為|ため)、?/, ''), res.absent); continue; }
    if (/出演(いた|致)します|ゲスト出演/.test(line)) { (res.notes['*'] = res.notes['*'] || []).push(line.replace(/(が|は)?出演(いた|致)します。?/, ' 出演')); continue; }
    const block = line.match(/^(\d{1,2}):(\d{2})\s*公演$/);
    if (block) { cur = hhmm(block[1], block[2]); wantList = false; continue; }
    if (/【(出演|公演)メンバー】/.test(line)) { wantList = true; const rest = line.replace(/.*】/, ''); if (isNameList(rest)) { put(names(rest)); wantList = false; } continue; }
    if (/【チケット料金】|円/.test(line)) continue;
    const extra = line.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
    if (extra && isNameList(extra[3]) === false && names(extra[3]).length >= 1 && !/休演|公演/.test(extra[3])) {
      const k = hhmm(extra[1], extra[2]); res.byTime[k] = [...(res.byTime[k] || []), ...names(extra[3])]; continue;
    }
    if (extra && isNameList(extra[3])) { const k = hhmm(extra[1], extra[2]); res.byTime[k] = [...(res.byTime[k] || []), ...names(extra[3])]; continue; }
    if (/休演/.test(line)) { absences(line, res.absent); continue; }
    if (/生誕祭|お披露目|卒業|千秋楽|初日|特別/.test(line) && line.length <= 40) { (res.notes[cur || '*'] = res.notes[cur || '*'] || []).push(line.replace(/を実施予定です|を予定しております|。$/g, '')); continue; }
    if ((wantList || isNameList(line)) && names(line).length >= 4) { put(names(line)); wantList = false; continue; }
  }
  return res;

  function put(list) {
    if (cur) res.byTime[cur] = list;
    else res.common = [...(res.common || []), ...list];
  }
}

// 「多田愛佳・渡辺麻友が全公演休演を、浦野一美・平嶋夏海が12:00公演を休演いたします」
// 「篠田麻里子が12:00/19:00公演を、…が全公演を休演いたします」「渡辺麻友は、休演致します。」
function absences(line, into) {
  const parts = line.normalize('NFKC').replace(/休演(いた|致)します.*$/, '').split(/を、|、(?=[^・]+[がは])/);
  for (const p of parts) {
    const m = p.match(/^(.+?)(?:が|は、?|も)\s*(.*)$/);
    if (!m) continue;
    const who = names(m[1].replace(/^.*[)）]/, ''));
    if (!who.length) continue;
    const times = [...m[2].matchAll(/(\d{1,2}):(\d{2})/g)].map((x) => hhmm(x[1], x[2]));
    if (!times.length) into['*'].push(...who);
    else for (const t of times) into[t] = [...(into[t] || []), ...who];
  }
}

/** 月ページ1枚 → [{date, time, team, title, label, members, absent, notes, full}] */
export function parseMonth(html) {
  const out = [];
  const rows = String(html).matchAll(/<td id="date"><a name="(\d{8})">\d+<\/a><\/td>([\s\S]*?)<\/tr>/g);
  for (const [, ymd, rest] of rows) {
    const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const stage = (rest.match(/<td id="stage">([\s\S]*?)<\/td>/) || [])[1] || '';
    const att = (rest.match(/<td id="attendance">([\s\S]*?)<\/td>/) || [])[1] || '';
    const ev = (rest.match(/<td id="event">([\s\S]*?)<\/td>/) || [])[1] || '';
    const shows = parseStage(stage);
    if (!shows.length) continue;
    const a = parseAttendance(att);
    const evNotes = text(ev).normalize('NFKC').split('\n').map((x) => x.trim()).filter((x) => /生誕祭/.test(x) && x.length <= 30);
    for (const s of shows) {
      // 回ごとの一覧だけで足りるのは、共通の一覧がなくて8人以上いるとき（それ以外は共通＋その回の追加）
      let members = !a.common && a.byTime[s.time] && a.byTime[s.time].length >= 8 ? a.byTime[s.time] : null;
      let full = !!members;
      if (!members && a.common) { members = [...a.common, ...(a.byTime[s.time] || [])]; full = true; }
      const absent = [...new Set([...(a.absent['*'] || []), ...(a.absent[s.time] || [])])];
      const notes = [...(a.notes[s.time] || []), ...(shows.length === 1 ? [...(a.notes['*'] || []), ...evNotes] : [])];
      out.push({ date, time: s.time, team: s.team, title: s.title, label: s.label, members: [...new Set(members || [])], full, absent, notes: [...new Set(notes)] });
    }
  }
  return out;
}

/** Wikipedia「AKB48の劇場公演」のwikitext → 演目の期間 [{team, title, start, end}] */
export function parseStagePeriods(wikitext) {
  const lines = String(wikitext).split('\n');
  const out = [];
  let team = '';
  const date = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  for (const raw of lines) {
    const h = raw.match(/^===\s*(.+?)\s*===$/);
    if (h) { team = h[1]; continue; }
    if (!team || /^==[^=]/.test(raw)) { if (/^==[^=]/.test(raw)) team = ''; continue; }
    const line = raw.replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/g, '');
    const t = line.match(/\[\[[^\]|]*\|([^\]]+)\]\]|\[\[([^\]]+)\]\]|「([^」]+)」/);
    const d = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[-–～〜]\s*(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/);
    if (!t || !d) continue;
    let title = (t[1] || t[2] || t[3]).replace(/^.*「|」.*$/g, '').trim();
    if (/リバイバル/.test(line) && out.length) title = out[out.length - 1].title;
    const start = date(d[1], d[2], d[3]);
    const end = date(d[4] || d[1], d[5] || d[2], d[6]);
    out.push({ team: team.replace(/による劇場公演|の通常公演/, ''), title, start, end });
  }
  return out;
}

/** チームと日付から演目名を引く */
export function stageFor(periods, team, date) {
  const t = team === '研究生' ? '研究生' : team;
  const hit = periods.filter((p) => p.start <= date && date <= p.end && (p.team.includes(t) || (t === '研究生' && /研究生/.test(p.team))));
  return hit.length === 1 ? hit[0].title : hit.length ? hit[hit.length - 1].title : '';
}
