// 握手会・お話し会・写真会の当選メール（AKB48 Official Shop）を読む。docs/index.html と同じロジック（テスト用）
//   ・「抽選結果のお知らせ」…●申込番号ごとに 商品名【1月9日(土) 幕張メッセ】 AKB48 大賀 彩姫 第1部 ／ 申込数：2枚 当選数：2枚
//   ・「ご注文完了のご案内」…商品名: 【10月14日 新宿住友ホール】長友 彩海 第2部 | 〇〇【イベント参加権利付き】 ／ 数量：1（先着販売なのでそのまま持ってる券）
// 何通かまとめて貼っても読める。年はメール内の支払日（なければ今日）から、近い将来の日付になるように決める。
export function parseAkMail(text, now = new Date()) {
  const t = String(text || '').normalize('NFKC').replace(/\r/g, '').replace(/　/g, ' ');
  const out = [];
  const pad = (n) => String(n).padStart(2, '0');
  const refBefore = (pos) => {
    const all = [...t.slice(0, pos).matchAll(/支払開始予定[:：]\s*(20\d{2})-(\d{2})-(\d{2})/g)];
    const m = all[all.length - 1];
    return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`) : now;
  };
  const dateFor = (mo, d, ref) => {
    let y = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(ref));
    const at = (yy) => new Date(`${yy}-${pad(mo)}-${pad(d)}T23:59:59+09:00`);
    if (at(y) < new Date(ref.getTime() - 60 * 864e5)) y += 1;
    return `${y}-${pad(mo)}-${pad(d)}`;
  };
  // 商品名 → 日付・会場・メンバー・部・（リリース名）
  const product = (s) => {
    const m = String(s).match(/【\s*(\d{1,2})月(\d{1,2})日\s*(?:\([^)]*\))?\s*([^】]*)】\s*([\s\S]*)$/);
    if (!m) return null;
    const [who, ...rest] = m[4].split('|');
    const p = who.replace(/AKB48/g, '').match(/^\s*(.+?)\s*第\s*(\d+)\s*部/);
    return { mo: Number(m[1]), d: Number(m[2]), venue: m[3].trim(), member: p ? p[1].replace(/\s+/g, '') : who.replace(/AKB48|\s+/g, ''), part: p ? Number(p[2]) : 0, relText: rest.join('|').trim() };
  };

  // 抽選結果
  const re = /●申込番号[:：]\s*([\w-]+)([\s\S]*?)(?=●申込番号|●抽選\(当落\)結果に関して|━+\n●抽選|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const body = m[2];
    const head = (body.match(/【抽選申込\/([^】]*)】\s*([^\n]*)/) || []);
    const win = (head[1] || '').match(/第\s*(\d+)\s*販売(?:\s*第\s*(\d+)\s*次)?/);
    const items = [...body.matchAll(/商品名[:：]\s*([^\n]+)\n[\s\S]*?申込数[:：]\s*(\d+)[^\n]*?当選数[:：]\s*(\d+)/g)];
    for (const [, name, applied, won] of items) {
      const p = product(name);
      if (!p) continue;
      out.push({ ref: `抽選${m[1]}${items.length > 1 ? ':' + name.trim() : ''}`, relText: head[2] ? head[2].trim() : p.relText, sale: win ? Number(win[1]) : 0, round: win && win[2] ? Number(win[2]) : 0,
        date: dateFor(p.mo, p.d, refBefore(m.index)), venue: p.venue, member: p.member, part: p.part, applied: Number(applied), won: Number(won), lottery: true });
    }
  }
  // ご注文完了（先着）
  for (const om of t.matchAll(/ご注文番号[:：]\s*([\w-]+)([\s\S]*?)(?=ご注文番号[:：]|$)/g)) {
    for (const [, name, qty] of om[2].matchAll(/商品名[:：]\s*([^\n]+)\n[\s\S]*?数量[:：]\s*(\d+)/g)) {
      const p = product(name);
      if (!p) continue;
      out.push({ ref: `注文${om[1]}:${name.trim()}`, relText: p.relText, sale: 0, round: 0, date: dateFor(p.mo, p.d, now), venue: p.venue, member: p.member, part: p.part, applied: Number(qty), won: Number(qty), lottery: false });
    }
  }
  return out;
}
