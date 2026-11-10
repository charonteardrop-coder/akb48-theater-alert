// 取り込み済みの過去公演データに fillFromNeighbors をかけ直す（メンバー変更だけ残っている回を埋める）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fillFromNeighbors } from '../src/history.js';
const DIR = new URL('../docs/data/history/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^\d{4}\.json$/.test(f)).sort();
const all = files.flatMap((f) => JSON.parse(readFileSync(new URL(f, DIR), 'utf8')).map((s) => ({ ...s, _f: f })));
const res = fillFromNeighbors(all);
for (const f of files) writeFileSync(new URL(f, DIR), JSON.stringify(res.filter((s) => s._f === f).map(({ _f, ...s }) => s)));
console.log(`メンバー変更だけ残っていた ${res.filled} 公演を、近い日の同じ演目から埋めた`);
