// Excel(.xlsx)の最初のシートを「文字列の配列の配列」にする小さな読み取り器。
// 外部ライブラリ・通信なし。zipの展開はブラウザ標準の DecompressionStream を使う。
// 日付・時刻のセルは CSV と同じ見た目（2026/11/05・08:27）の文字列にする。
const XlsxLite = (() => {
    const td = new TextDecoder('utf-8');
    async function inflateRaw(bytes) {
        const ds = new DecompressionStream('deflate-raw');
        const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(out);
    }
    // zipの中央ディレクトリを読んで {名前: 中身} を返す（必要なファイルだけ展開）
    async function unzip(buf, wanted) {
        const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        let eocd = -1;
        for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('Excelファイル（.xlsx）として読めません');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const files = {};
        for (let n = 0; n < count; n++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
            const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
            const off = dv.getUint32(p + 42, true);
            const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
            p += 46 + nlen + elen + clen;
            if (!wanted(name)) continue;
            const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
            const data = u8.subarray(start, start + csize);
            if (method === 0) files[name] = data;
            else if (method === 8) files[name] = await inflateRaw(data);
            else throw new Error('対応していない圧縮形式です');
        }
        return files;
    }
    const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
    // <t>…</t> を全部つなぐ（ふりがな<rPh>は除く）
    const texts = xml => { let s = ''; xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g, (m, t) => { s += unesc(t || ''); }); return s; };
    function sharedStrings(xml) {
        const out = []; if (!xml) return out;
        xml.replace(/<si>([\s\S]*?)<\/si>|<si\s*\/>/g, (m, inner) => { out.push(texts(inner || '')); });
        return out;
    }
    // スタイル番号 → 'date' | 'time' | 'datetime' | null
    const BUILTIN = { 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'datetime', 45: 'time', 46: 'time', 47: 'time', 57: 'date', 58: 'date' };
    function kindOfFormat(code) {
        const c = String(code).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
        if (c === 'general' || c === '@') return null;
        const d = /[yde]/.test(c.replace(/general/g, '')), t = /[hs]/.test(c);
        return d && t ? 'datetime' : d ? 'date' : t ? 'time' : null;
    }
    function styleKinds(xml) {
        if (!xml) return [];
        const custom = {};
        xml.replace(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, (m, id, code) => { custom[id] = kindOfFormat(unesc(code)); });
        const cellXfs = (xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
        const kinds = [];
        cellXfs.replace(/<xf\b([^>]*)\/?>/g, (m, attrs) => { const id = (attrs.match(/numFmtId="(\d+)"/) || [])[1]; kinds.push(id in custom ? custom[id] : BUILTIN[id] || null); });
        return kinds;
    }
    const pad = n => String(n).padStart(2, '0');
    // Excelの日付シリアル値（1900年基準）を文字列に
    function serialToText(v, kind) {
        const ms = Math.round((v - 25569) * 86400) * 1000, d = new Date(ms);
        const date = d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate());
        const time = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
        if (kind === 'time' || (kind !== 'date' && v < 1)) return time;
        return kind === 'datetime' && (d.getUTCHours() || d.getUTCMinutes()) ? date + ' ' + time : date;
    }
    const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    function sheetRows(xml, shared, kinds) {
        const rows = [];
        const sd = (xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/) || [])[1] || '';
        sd.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (m, rattr, inner) => {
            const row = [];
            let next = 0;
            inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (mm, attrs, body) => {
                const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
                const col = ref ? colIndex(ref) : next; next = col + 1;
                const t = (attrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
                const s = +((attrs.match(/\bs="(\d+)"/) || [])[1] || 0);
                body = body || '';
                const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                let out = '';
                if (t === 's') out = v != null ? (shared[+v] || '') : '';
                else if (t === 'inlineStr') out = texts(body);
                else if (t === 'str' || t === 'e') out = v != null ? unesc(v) : '';
                else if (t === 'b') out = v === '1' ? 'TRUE' : 'FALSE';
                else if (t === 'd') out = v ? unesc(v).replace(/-/g, '/').replace('T', ' ').slice(0, 16) : '';
                else if (v != null && v !== '') {
                    const num = Number(v);
                    out = kinds[s] && isFinite(num) ? serialToText(num, kinds[s]) : (isFinite(num) ? String(num) : unesc(v));
                }
                while (row.length < col) row.push('');
                row[col] = out;
            });
            const rn = +((rattr.match(/\br="(\d+)"/) || [])[1] || rows.length + 1);
            while (rows.length < rn - 1) rows.push([]);
            rows.push(row);
        });
        return rows;
    }
    function firstSheetPath(wbXml, relsXml) {
        const first = (wbXml && wbXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)) || (wbXml && wbXml.match(/<sheet\b[^>]*\bid="([^"]+)"/));
        if (first && relsXml) {
            const re = new RegExp('<Relationship\\b[^>]*Id="' + first[1] + '"[^>]*>');
            const rel = (relsXml.match(re) || [''])[0], target = (rel.match(/Target="([^"]+)"/) || [])[1];
            if (target) return target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        }
        return 'xl/worksheets/sheet1.xml';
    }
    async function readFirstSheet(buf) {
        const u8 = new Uint8Array(buf);
        if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('古いExcel形式（.xls）は読めません。.xlsx か CSV で保存したファイルを選んでください');
        if (!(u8[0] === 0x50 && u8[1] === 0x4B)) throw new Error('Excelファイル（.xlsx）ではありません');
        const meta = await unzip(buf, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels');
        const dec = f => f ? td.decode(f) : '';
        const path = firstSheetPath(dec(meta['xl/workbook.xml']), dec(meta['xl/_rels/workbook.xml.rels']));
        const files = await unzip(buf, n => n === path || n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml');
        if (!files[path]) throw new Error('シートが見つかりません');
        return sheetRows(dec(files[path]), sharedStrings(dec(files['xl/sharedStrings.xml'])), styleKinds(dec(files['xl/styles.xml'])));
    }
    function isXlsx(file) {
        const n = (file && file.name || '').toLowerCase(), t = file && file.type || '';
        return /\.xlsx?$/.test(n) || /spreadsheetml|ms-excel/.test(t);
    }
    return { readFirstSheet, isXlsx, serialToText, kindOfFormat, sheetRows, sharedStrings, styleKinds };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = XlsxLite;
