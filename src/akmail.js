// 握手会・お話し会・写真会の当選メール（AKB48 Official Shop）を読む。docs/index.html と同じロジック（テスト用）
//   ・「申込受付のご連絡」…商品名：【…】 … 第1部 ／ 数量：2枚（結果待ちの申込として記録）
//   ・「抽選結果のお知らせ」…商品名：【1月9日(土) 幕張メッセ】 AKB48 大賀 彩姫 第1部 ／ 申込数：2枚 当選数：2枚
//   ・「ご注文完了のご案内」…商品名: 【10月14日 新宿住友ホール】長友 彩海 第2部 | 〇〇【イベント参加権利付き】 ／ 数量：1
// 本文のコピペでも、スクショを文字認識（OCR）したテキストでも読めるように、記号の崩れや余計な空白に強くしてある。
// 何通（何枚）かまとめても読める。年はメール内の支払日（なければ今日）から、近い将来の日付になるように決める。
export function parseAkMail(text, now = new Date()) {
  let t = String(text || '').normalize('NFKC').replace(/\r/g, '').replace(/[　\t]/g, ' ');
  // OCRは日本語の文字の間に空白を入れがちなので詰める
  t = t.replace(/([^\x00-\x7F]) +(?=[^\x00-\x7F])/g, '$1').replace(/ *([:：]) */g, '$1');
  const out = [];
  const pad = (n) => String(n).padStart(2, '0');
  const lastBefore = (re, pos) => { const all = [...t.slice(0, pos).matchAll(re)]; return all[all.length - 1] || null; };
  const refDate = (pos) => {
    const m = lastBefore(/支払開始予定[:：]?\s*(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/g, pos);
    return m ? new Date(`${m[1]}-${pad(m[2])}-${pad(m[3])}T00:00:00+09:00`) : now;
  };
  const dateFor = (mo, d, ref) => {
    let y = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(ref));
    if (new Date(`${y}-${pad(mo)}-${pad(d)}T23:59:59+09:00`) < new Date(ref.getTime() - 60 * 864e5)) y += 1;
    return `${y}-${pad(mo)}-${pad(d)}`;
  };
  // 商品名の行 → 日付・会場・メンバー・部・（リリース名）
  const product = (s) => {
    const m = String(s).match(/[【\[]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:\([^)]{0,3}\))?\s*([^】\]\n]*?)\s*[】\]]\s*([^\n]*)/);
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return null;
    const [who, ...rest] = m[4].split(/\s*[|｜]\s*/);
    const p = who.replace(/AKB\s*48/gi, '').match(/^\s*(.+?)\s*第\s*(\d+)\s*部/);
    return { mo: +m[1], d: +m[2], venue: m[3].trim(), member: (p ? p[1] : who.replace(/AKB\s*48/gi, '')).replace(/\s+/g, ''), part: p ? +p[2] : 0, relText: rest.join(' ').trim() };
  };
  // 「商品名」ごとに、すぐ後ろの 申込数／当選数（抽選）か 数量（注文）を拾う
  const re = /商品名\s*[:：]?\s*([^\n]+)\n?([\s\S]*?)(?=商品名|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const p = product(m[1]);
    if (!p) continue;
    const after = m[2];
    const lot = after.match(/申込数\s*[:：]?\s*(\d+)[\s\S]{0,40}?当選数\s*[:：]?\s*(\d+)/);
    const qty = !lot && after.match(/数量\s*[:：]?\s*(\d+)/);
    if (!lot && !qty) continue;
    // どのメールか：申込受付（申込の控え）／抽選結果／ご注文完了（先着）
    const mk = lastBefore(/(申込受付内容|申込受付のご連絡|申込内容確認ご案内)|(抽選\(当落\)結果|当選結果)|(ご注文番号|ご注文内容|ご注文情報)/g, m.index);
    const head = lastBefore(/抽選申込\s*\/\s*([^】\]\n]*)[】\]]\s*([^\n]*)/g, m.index);
    const type = lot ? 'result' : mk ? (mk[1] ? 'apply' : mk[3] ? 'order' : null) : head ? 'apply' : 'order';
    if (!type) continue;
    const useHead = type !== 'order' ? head : null;
    const win = useHead && useHead[1].match(/第\s*(\d+)\s*販売(?:\s*第\s*(\d+)\s*次)?/);
    const noM = type !== 'order' && lastBefore(/申込番号[:：]?\s*([\d-]{6,})/g, m.index);
    const no = noM && m.index - noM.index < 400 ? noM[1] : '';
    const applied = +(lot ? lot[1] : qty[1]), won = type === 'apply' ? null : +(lot ? lot[2] : qty[1]);
    const date = dateFor(p.mo, p.d, type === 'result' ? refDate(m.index) : now);
    out.push({
      ref: `${{ apply: '申込', result: '抽選', order: '注文' }[type]}:${no || (win ? win[0].replace(/\s/g, '') : '')}:${date}:${p.member}:${p.part}:${applied}:${won}`,
      type, no, relText: (useHead && useHead[2] ? useHead[2].trim() : '') || p.relText, sale: win ? +win[1] : 0, round: win && win[2] ? +win[2] : 0,
      date, venue: p.venue, member: p.member, part: p.part, applied, won, lottery: type !== 'order',
    });
  }
  // 同じ内容が重なってたら1つに（スクショを重ねて撮ったとき用）
  return out.filter((x, i) => out.findIndex((y) => y.ref === x.ref) === i);
}
