// PDF（参加メンバーの表）から文字と位置を取り出す。ブラウザ用の描画まわりは使わない。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** @returns {Promise<Array<Array<{s:string,x:number,y:number}>>>} ページごとの文字 */
export async function pdfPages(data) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await getDocument({
    data: new Uint8Array(data), cMapUrl: join(root, 'cmaps') + '/', cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/', useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push(tc.items.map((i) => ({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) })).filter((i) => i.s.trim()));
  }
  await doc.destroy();
  return pages;
}
