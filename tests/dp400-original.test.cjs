// DP-400月次リスト原本の判定・月の推定・端末内保存。データはすべて架空。実在の会社名・住所・メールは使わない。
const test = require('node:test');
const assert = require('node:assert/strict');
const Dp400Original = require('../map/dp400-original.js');

const xlsBytes = () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5]);

test('件名が「○月 DP-400定期メンテナンスリスト」ならリストと判定する。追加や返信でも同じ', () => {
    assert.equal(Dp400Original.isListMail('12月 DP-400定期メンテナンスリスト', '架空SS.xls'), true);
    assert.equal(Dp400Original.isListMail('6月 DP-400定期メンテナンスリスト(追加)', '架空SS(追加).xls'), true);
    assert.equal(Dp400Original.isListMail('RE: 8月 DP-400定期メンテナンスリスト【追加リスト】', '架空SS追加.xls'), true);
    assert.equal(Dp400Original.isListMail('業務依頼（修理）', '架空SS.xls'), false);
    assert.equal(Dp400Original.isExtra('6月 DP-400定期メンテナンスリスト(追加)', '架空SS.xls'), true);
    assert.equal(Dp400Original.isExtra('12月 DP-400定期メンテナンスリスト', '架空SS.xls'), false);
    assert.equal(Dp400Original.isExtra('12月 DP-400定期メンテナンスリスト', '架空SS追加.xls'), true);
});

test('対象月は件名の月。12月受信の1月リストは翌年、それ以外は受信した年', () => {
    const nov = Date.parse('2026-11-19T06:02:34Z');
    assert.equal(Dp400Original.monthOf('12月 DP-400定期メンテナンスリスト', nov), '2026-12');
    const oct = Date.parse('2026-10-20T08:21:24Z');
    assert.equal(Dp400Original.monthOf('11月 DP-400定期メンテナンスリスト', oct), '2026-11');
    const dec = Date.parse('2025-12-18T06:34:04Z');
    assert.equal(Dp400Original.monthOf('1月 DP-400定期メンテナンスリスト', dec), '2026-01');
    const sep = Date.parse('2026-09-17T06:57:36Z');
    assert.equal(Dp400Original.monthOf('10月 DP-400定期メンテナンスリスト', sep), '2026-10');
    assert.equal(Dp400Original.monthOf('業務依頼', nov), null);
});

test('保存すると月ごとに一覧でき、同じメールの添付は上書きされる。依頼メールは保存しない', async () => {
    const st = Dp400Original.create({ memory: true, now: () => 1_700_000_000_000 });
    const rec = Date.parse('2026-11-19T06:02:34Z');
    const r1 = await st.save({ subject: '12月 DP-400定期メンテナンスリスト', fileName: '架空SS.xls', mime: 'application/vnd.ms-excel', bytes: xlsBytes(), messageId: 'aaaaaaaaaaaa', partKey: 'p1', receivedMs: rec, kind: 'xls' });
    assert.equal(r1.ok, true);
    assert.equal(r1.monthId, '2026-12');
    const rBad = await st.save({ subject: '業務依頼', fileName: '依頼.xls', bytes: xlsBytes(), messageId: 'bbbbbbbbbbbb', partKey: 'p1', receivedMs: rec, kind: 'xls' });
    assert.equal(rBad.ok, false);
    const add = await st.save({ subject: '12月 DP-400定期メンテナンスリスト(追加)', fileName: '架空SS追加.xls', mime: 'application/vnd.ms-excel', bytes: xlsBytes(), messageId: 'cccccccccccc', partKey: 'p1', receivedMs: rec + 1000, kind: 'xls' });
    assert.equal(add.ok, true);
    assert.equal(add.extra, true);
    assert.deepEqual(await st.listMonths(), ['2026-12']);
    const list = await st.listForMonth('2026-12');
    assert.equal(list.length, 2);
    assert.equal(list[0].extra, false);
    assert.equal(list[1].extra, true);
    assert.equal(await st.has('aaaaaaaaaaaa', 'p1'), true);
    const got = await st.get(r1.id);
    assert.equal(got.bytes.length, xlsBytes().length);
    assert.equal(JSON.stringify(list).includes('d0cf'), false);
});

test('メールから原本を取り込む検索は、件名の定型句だけを使い差出人アドレスを埋め込まない', () => {
    const q = Dp400Original.buildListQuery({ days: 366 });
    assert.equal(q, 'has:attachment newer_than:366d subject:"DP-400定期メンテナンスリスト"');
    assert.equal(q.includes('@'), false);
    assert.throws(() => Dp400Original.buildListQuery({ days: 0 }), e => e.code === 'bad_days');
});

test('fetchFromGmail はリスト件名の添付だけを保存し、依頼メールは飛ばす。訪問先は作らない', async () => {
    const st = Dp400Original.create({ memory: true });
    const bytes = xlsBytes();
    const source = {
        listMessageIds: async () => ({ ids: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'], truncated: false }),
        getMessage: async id => id === 'aaaaaaaaaaaa'
            ? { id, subject: '12月 DP-400定期メンテナンスリスト', internalDateMs: Date.parse('2026-11-19T06:02:34Z'), attachments: [{ partKey: 'p1', fileName: '架空SS.xls', mimeType: 'application/vnd.ms-excel', attachmentId: 'ATT1', size: bytes.length }] }
            : { id, subject: '業務依頼（修理）', internalDateMs: Date.parse('2026-11-19T02:00:00Z'), attachments: [{ partKey: 'p1', fileName: '依頼.xls', mimeType: 'application/vnd.ms-excel', attachmentId: 'ATT2', size: 10 }] },
        downloadAttachment: async (id, att) => {
            if (id === 'bbbbbbbbbbbb') throw new Error('should not download request');
            return bytes;
        }
    };
    const r = await Dp400Original.fetchFromGmail({ source, store: st });
    assert.equal(r.ok, true);
    assert.equal(r.saved, 1);
    assert.deepEqual(await st.listMonths(), ['2026-12']);
    const again = await Dp400Original.fetchFromGmail({ source, store: st });
    assert.equal(again.saved, 0);
});

test('表の描画はセルをテキストとして入れ、HTMLを解釈しない', () => {
    const fake = {
        replaceChildren() { this._kids = []; },
        appendChild(el) { (this._kids || (this._kids = [])).push(el); return el; },
        _kids: []
    };
    const make = (tag) => {
        const el = { tagName: tag, children: [], className: '', textContent: '', style: {}, appendChild(c) { this.children.push(c); return c; } };
        return el;
    };
    const saved = { createElement: global.document && global.document.createElement, document: global.document };
    global.document = { createElement: make };
    Dp400Original.fillTable(fake, [{ name: 'Sheet1', rows: [['設置先会社名', '住所'], ['架空商店', '<img src=x>']], colWidths: [80, 200] }]);
    const table = fake._kids[0].children.find(c => c.tagName === 'table') || fake._kids[0].children[0];
    const rows = table.children.filter(c => c.tagName === 'tr');
    const dataCell = rows[1].children[1];
    assert.equal(dataCell.textContent, '<img src=x>');
    assert.equal(dataCell.children.length, 0);
    const cols = table.children.find(c => c.tagName === 'colgroup').children;
    assert.equal(cols[0].style.width, '80px');
    assert.equal(cols[1].style.width, '200px');
    assert.equal(table.style.tableLayout, 'fixed');
    assert.equal(table.style.width, '280px');
    if (!saved.document) delete global.document; else global.document = saved.document;
});

test('列幅はExcelのwchを優先し、無いときは文字数から見積もる。上限と下限を守る', () => {
    const fromMeta = Dp400Original.columnWidths([['aa', 'あ']], [{ wch: 10 }, { wpx: 120 }]);
    assert.deepEqual(fromMeta, [80, 120]);
    const estimated = Dp400Original.columnWidths([['ABCD', 'あいうえおカキクケコ']]);
    // 'ABCD' = 4 chars * 8 + 12 = 44; CJK 10*2=20 capped later *8+12=172
    assert.equal(estimated[0], 44);
    assert.equal(estimated[1], 172);
    const tiny = Dp400Original.columnWidths([['A']], [{ wch: 1 }]);
    assert.equal(tiny[0], 36);
    const huge = Dp400Original.columnWidths([['x']], [{ wpx: 9999 }]);
    assert.equal(huge[0], 480);
});

test('全体表示の縮尺は表が画面に収まる値で、すでに収まるときは1。拡大縮小と移動は範囲内に収める', () => {
    const v = Dp400Original.viewport;
    assert.equal(v.fitScale(1000, 400, 375, 500), 0.375);
    assert.equal(v.fitScale(200, 100, 375, 500), 1);
    assert.equal(v.fitScale(0, 100, 375, 500), 1);
    assert.equal(v.clampScale(0.1, 0.375), 0.375);
    assert.equal(v.clampScale(99, 0.375), 8);
    const fitted = v.clampPan(10, 20, 0.375, 1000, 400, 375, 500);
    assert.equal(fitted.x, 0);
    assert.equal(fitted.y, 0);
    const panned = v.clampPan(-50, -10, 2, 400, 200, 375, 300);
    assert.equal(panned.x, -50);
    assert.equal(panned.y, -10);
    const tooFar = v.clampPan(-999, -999, 2, 400, 200, 375, 300);
    assert.equal(tooFar.x, 375 - 800);
    assert.equal(tooFar.y, 300 - 400);
    const z = v.zoomAt(0, 0, 1, 2, 100, 50);
    assert.equal(z.tx, -100);
    assert.equal(z.ty, -50);
    assert.equal(z.scale, 2);
    assert.equal(v.pinchScale(1, 40, 80, 0.5), 2);
    assert.equal(v.stepScale(1, 1, 0.5), 1.25);
    assert.equal(v.stepScale(1, -1, 0.8), 0.8);
    assert.equal(v.distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('先頭行の見出しは空の列にまたがり、3つ以上の項目がある行を見出しにする', () => {
    const fake = {
        replaceChildren() { this._kids = []; },
        appendChild(el) { (this._kids || (this._kids = [])).push(el); return el; },
        _kids: []
    };
    const make = (tag) => {
        const el = { tagName: tag, children: [], className: '', textContent: '', style: {}, appendChild(c) { this.children.push(c); return c; } };
        return el;
    };
    const saved = { document: global.document };
    global.document = { createElement: make };
    Dp400Original.fillTable(fake, [{
        name: 'Sheet1',
        rows: [
            ['12月のリスト（架空）'],
            ['品番', '品名', '数量', '設置先'],
            ['FX-1', '架空部品', '1', '甲野商店（架空）']
        ],
        colWidths: [80, 160, 40, 120]
    }]);
    const table = fake._kids[0].children.find(c => c.tagName === 'table');
    const rows = table.children.filter(c => c.tagName === 'tr');
    assert.equal(rows[0].children.length, 1);
    assert.equal(rows[0].children[0].tagName, 'td');
    assert.equal(rows[0].children[0].colSpan, 4);
    assert.equal(rows[0].children[0].textContent, '12月のリスト（架空）');
    assert.equal(rows[1].children[0].tagName, 'th');
    assert.equal(rows[1].children.length, 4);
    assert.equal(rows[2].children[1].textContent, '架空部品');
    const spanned = Dp400Original.withTitleSpan([['見出し']], 5, []);
    assert.deepEqual(spanned, [{ r: 0, c: 0, rowspan: 1, colspan: 5 }]);
    const fromSheet = Dp400Original.sheetMerges([{ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }]);
    assert.deepEqual(fromSheet, [{ r: 1, c: 0, rowspan: 1, colspan: 3 }]);
    if (!saved.document) delete global.document; else global.document = saved.document;
});
