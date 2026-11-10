// 出演メンバーとポジション表から、ユニット曲ごとの担当を割り出す（docs/index.html と同じロジック。テスト用）
// ルール：ポジション表の1行＝1ポジション（先頭がオリジナル、続きがアンダー）。出演者はちょうど1つのポジションに入る
const norm = (s) => String(s || '').normalize('NFKC').replace(/髙/g, '高').replace(/﨑/g, '崎').replace(/\s/g, '');
export function assignUnits(songs, members) {
  const cast = new Map(members.map((m) => [norm(m), m]));
  const pos = songs.flatMap((song, si) => song.positions.map((row, pi) => ({ si, pi, cand: row.filter((n) => cast.has(norm(n))).map((n) => cast.get(norm(n))) })));
  // 候補の少ないポジションから決める
  const order = pos.map((_, i) => i).sort((a, b) => pos[a].cand.length - pos[b].cand.length);
  const sols = [];
  const used = new Set(); const pick = new Array(pos.length).fill(null);
  let best = -1;
  (function go(k, filled) {
    if (sols.length >= 200) return;
    if (filled + (order.length - k) < best) return;
    if (k === order.length) {
      if (filled > best) { best = filled; sols.length = 0; }
      if (filled === best) sols.push([...pick]);
      return;
    }
    const i = order[k];
    let any = false;
    for (const n of pos[i].cand) { if (used.has(n)) continue; any = true; used.add(n); pick[i] = n; go(k + 1, filled + 1); pick[i] = null; used.delete(n); }
    if (!any || pos[i].cand.length === 0) go(k + 1, filled);
  })(0, 0);
  // 決めきれないときは「オリジナル→アンダーの並び順で前にいる人」が多い組み合わせを採る
  const cost = (s) => s.reduce((c, n, i) => c + (n ? songs[pos[i].si].positions[pos[i].pi].findIndex((x) => norm(x) === norm(n)) : 0), 0);
  const top = sols.length ? sols.reduce((a, b) => (cost(b) < cost(a) ? b : a)) : [];
  return songs.map((song, si) => ({
    ...song,
    slots: song.positions.map((row, pi) => {
      const i = pos.findIndex((p) => p.si === si && p.pi === pi);
      const name = top[i] || null;
      return { original: row[0], name, sure: !!name && sols.every((s) => s[i] === name) };
    }),
  }));
}
