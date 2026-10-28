// [メールBOX 画面] スマホ・タブレット向け。3つのBOX(依頼書の結果 / 判別不可 / 通達)。
// 画面の文字は textContent で入れる(メールの件名・会社名をHTMLとして解釈しない)。
const MailBoxUI = (() => {
    const TABS = [['request', '依頼書'], ['unreadable', '判別不可'], ['reference', '通達']];
    const LABEL = { company: '会社名', address: '住所', purpose: '作業内容' };
    let box, overlay, statusEl, bodyEl, tabsEl, opener, tab = 'unreadable';
    const selected = new Set();       // 判別不可でチェックした行
    const choice = new Map();         // 行ごとの月の選択 {ws, newMonth}
    const confirming = new Set();     // 取り消しの確認待ちの行
    let note = { text: '', kind: '' };

    const h = (tag, attrs, ...kids) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === false || v == null) continue;
            if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        return el;
    };
    const dev = () => /[?&]mailboxDev=1(&|$)/.test(location.search);
    const wsText = id => id === 'unscheduled' ? '日程未定' : String(id).replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}年${parseInt(m, 10)}月`);
    const sayAll = (text, kind) => { note = { text, kind: kind || '' }; if (statusEl) { statusEl.textContent = text; statusEl.dataset.kind = kind || ''; } };

    // ---- 画面全体の更新(バッジ・バナー) ----
    function refreshChrome() {
        try {
            const c = box.counts();
            const badge = document.getElementById('mailBoxBadge');
            const btn = document.getElementById('mailBoxBtn');
            if (badge) { badge.hidden = !c.unreadable; badge.textContent = c.unreadable > 99 ? '99+' : String(c.unreadable); }
            if (btn) btn.setAttribute('aria-label', c.unreadable ? `メールBOXを開く。確認が必要な依頼が${c.unreadable}件あります` : 'メールBOXを開く');
            const banner = document.getElementById('mailBoxBanner');
            if (banner) {
                const text = c.unreadable ? `メールBOXに、確認が必要な依頼が${c.unreadable}件あります。` : '';
                banner.hidden = !text; banner.querySelector('.mailbox-banner-text').textContent = text;
            }
        } catch (e) { console.error('mailbox: chrome_failed'); }
    }
    function refreshApp() {
        try {
            if (typeof updateWsButton === 'function') updateWsButton();
            if (typeof MapCore !== 'undefined' && MapCore.refreshAllMarkers) MapCore.refreshAllMarkers();
            if (typeof RouteManager !== 'undefined' && RouteManager.updateRoutePanel) RouteManager.updateRoutePanel();
        } catch (e) { console.error('mailbox: refresh_failed'); }
    }
    const afterChange = () => { refreshChrome(); refreshApp(); render(); };

    // ---- 取り込み(試験用) ----
    function summarize(r) {
        if (!r.ok) return { text: r.code === 'mailbox_corrupt' || r.code === 'ledger_corrupt' ? 'メールBOXのデータを読み込めないため、取り込みを止めました。上書きはしていません。' : '取り込みを完了できませんでした。もう一度お試しください。', kind: 'error' };
        const parts = [];
        if (r.registered) parts.push(`${r.registered}件を自動登録`);
        if (r.duplicates) parts.push(`重複${r.duplicates}件は登録せず`);
        if (r.unreadable) parts.push(`確認が必要${r.unreadable}件`);
        if (r.reference) parts.push(`通達${r.reference}件`);
        if (r.skipped) parts.push(`取り込み済み${r.skipped}件`);
        return { text: parts.length ? '取り込みました: ' + parts.join('、') + '。' : '新しいメールはありませんでした。', kind: r.errors && r.errors.length ? 'warn' : 'ok' };
    }
    function runIngest(mails) {
        const r = box.ingest(mails);
        const s = summarize(r);
        sayAll(s.text, s.kind);
        if (r.registered) tab = 'request'; else if (r.unreadable) tab = 'unreadable';
        afterChange();
    }
    function importDemo() {
        if (!window.confirm('試験用: 架空の訪問先(デモ)をこの端末のデータに自動登録します。実際の業務データでは実行しないでください。続けますか?')) return;
        runIngest(MailBoxDemo.mails());
    }
    function importJson(e) {
        const file = e.target.files && e.target.files[0]; e.target.value = '';
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { sayAll('ファイルが大きすぎます(5MBまで)。', 'error'); return; }
        file.text().then(text => {
            let data; try { data = JSON.parse(text); } catch (err) { sayAll('JSONとして読み込めませんでした。', 'error'); return; }
            const mails = Array.isArray(data) ? data : (data && Array.isArray(data.mails) ? data.mails : null);
            if (!mails) { sayAll('メールの一覧(mails)が見つかりません。', 'error'); return; }
            runIngest(mails.slice(0, 200));
        }, () => sayAll('ファイルを読めませんでした。', 'error'));
    }

    // ---- 行の部品 ----
    const chip = (text, kind) => h('span', { class: 'mailbox-chip ' + (kind || '') }, text);
    function meta(row) {
        const bits = [row.receivedDate ? `受信 ${row.receivedDate}` : '', row.fileName, row.subject && `件名: ${row.subject}`].filter(Boolean);
        return h('p', { class: 'mailbox-meta' }, bits.join(' ／ '));
    }
    function gmailLink(row) {
        if (row.source !== 'gmail' || !row.messageId) return null;
        return h('a', { class: 'btn btn-secondary mailbox-btn-s', href: 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(row.messageId), target: '_blank', rel: 'noopener noreferrer' }, 'Gmailで開く');
    }
    function itemsView(row) {
        const items = row.items || [];
        const missingOf = RequestClassifier.missingOf;
        const list = h('ul', { class: 'mailbox-items' });
        items.slice(0, 3).forEach(item => {
            const miss = missingOf(item).map(k => LABEL[k]).filter(Boolean);
            list.append(h('li', {}, [item.company || '(会社名なし)', ' / ', item.address || '(住所なし)', item.purpose ? ` / ${item.purpose}` : '', miss.length ? h('span', { class: 'mailbox-missing' }, ` 欠け: ${miss.join('・')}`) : null]));
        });
        if (items.length > 3) list.append(h('li', {}, `ほか${items.length - 3}件`));
        return list;
    }
    function newMonthInput(row, c) {
        const wrap = h('label', { class: 'mailbox-newmonth', hidden: c.ws !== '__new' }, '作る月 ',
            h('input', { type: 'month', value: c.newMonth || box.suggestNewMonth(), 'aria-label': '新しく作る月', onchange: ev => { c.newMonth = ev.target.value; } }));
        return wrap;
    }
    function monthSelect(row) {
        const c = choice.get(row.id) || (choice.set(row.id, { ws: row.suggested || '', newMonth: '' }), choice.get(row.id));
        const opts = box.monthOptions();
        const select = h('select', { 'aria-label': '反映する月', class: 'mailbox-select' });
        select.append(h('option', { value: '' }, '月を選ぶ'));
        const known = new Set(opts.map(o => o.id));
        if (row.suggested && !known.has(row.suggested)) select.append(h('option', { value: row.suggested, 'data-create': '1' }, `${wsText(row.suggested)}(新規作成)`));
        opts.forEach(o => select.append(h('option', { value: o.id }, o.label)));
        select.append(h('option', { value: '__new' }, '＋ 新しい月を作る'));
        select.value = c.ws;
        if (select.value !== c.ws) { c.ws = ''; select.value = ''; }
        const nm = newMonthInput(row, c);
        select.addEventListener('change', () => { c.ws = select.value; nm.hidden = c.ws !== '__new'; if (c.ws === '__new' && !c.newMonth) c.newMonth = box.suggestNewMonth(); });
        return [select, nm];
    }
    function entryFor(row) {
        const c = choice.get(row.id) || { ws: '' };
        if (!c.ws) return { error: '月を選んでください。' };
        if (c.ws === '__new') {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(c.newMonth || '')) return { error: '作る月(年と月)を入力してください。' };
            return { entry: { rowId: row.id, workspaceId: c.newMonth }, create: true };
        }
        const monthIds = box.monthOptions().map(o => o.id);
        return { entry: { rowId: row.id, workspaceId: c.ws }, create: c.ws !== 'unscheduled' && !monthIds.includes(c.ws) };
    }
    function applyMany(rows, forceUnscheduled) {
        const plain = [], withCreate = [], errors = [];
        for (const row of rows) {
            const e = forceUnscheduled ? { entry: { rowId: row.id, workspaceId: 'unscheduled' }, create: false } : entryFor(row);
            if (e.error) { errors.push(e.error); continue; }
            (e.create ? withCreate : plain).push(e.entry);
        }
        let applied = 0, failed = errors.length, blocked = false;
        for (const [entries, create] of [[plain, false], [withCreate, true]]) {
            if (!entries.length) continue;
            const r = box.applyRows(entries, { allowCreateMonth: create });
            if (!r.ok && r.code && r.code.endsWith('corrupt')) blocked = true;
            applied += r.applied; failed += r.failed;
            (r.results || []).forEach(x => { if (x.ok) selected.delete(x.rowId); });
        }
        sayAll(blocked ? 'メールBOXのデータを読み込めないため、反映を止めました。' : (applied ? `${applied}件を反映しました。` : '反映できませんでした。') + (failed ? `${applied ? failed + '件は反映できませんでした。' : ''}月の選択や保存を確認してください。` : ''), failed || blocked ? 'warn' : 'ok');
        afterChange();
    }

    // ---- 3つのBOX ----
    function requestPane(rows) {
        const list = rows.filter(r => r.bucket === 'request');
        if (!list.length) return h('p', { class: 'mailbox-empty' }, '自動登録した依頼書はまだありません。');
        return h('div', {}, h('p', { class: 'mailbox-hint' }, '判別できた依頼書は、自動で登録しました(チェックや反映の操作は要りません)。'), list.map(row => {
            const r = row.result || { workspaces: {}, duplicates: 0 };
            const places = Object.entries(r.workspaces).map(([ws, n]) => `${wsText(ws)} ${n}件`);
            const st = row.state === 'cancelled' ? '取り消し済み' : '登録済み';
            const info = row.state === 'registered' ? box.registeredStatus(row.id) : null;
            const missingWarn = info && info.total && info.present < info.total;
            const card = h('article', { class: 'mailbox-card' },
                h('div', { class: 'mailbox-card-head' }, h('strong', {}, row.state === 'cancelled' ? '依頼書(取り消し済み)' : '依頼書が来ました'), chip(st, row.state === 'cancelled' ? '' : 'ok'), row.needsAttention && row.state === 'registered' ? chip('確認推奨', 'warn') : null),
                h('p', {}, places.length ? `登録先: ${places.join('、')}` : '新しく登録した訪問先はありません。', r.duplicates ? `(重複${r.duplicates}件は登録していません)` : ''),
                row.needsAttention && row.state === 'registered' ? h('p', { class: 'mailbox-note' }, row.reason) : null,
                missingWarn ? h('p', { class: 'mailbox-note' }, `登録した訪問先のうち${info.total - info.present}件が見つかりません(バックアップの復元などで消えた可能性)。自動では登録し直しません。必要なら手で追加してください。`) : null,
                meta(row));
            if (info && info.cancellable) {
                const ask = confirming.has(row.id);
                card.append(h('div', { class: 'mailbox-actions' },
                    h('button', { type: 'button', class: 'btn ' + (ask ? 'btn-primary' : 'btn-secondary') + ' mailbox-btn-s', onclick: () => {
                        if (!ask) { confirming.add(row.id); render(); return; }
                        confirming.delete(row.id);
                        const res = box.cancelRegistration(row.id);
                        sayAll(res.ok ? `登録を取り消しました(${res.removed}件を削除)。同じメールは再登録しません。` : (res.code === 'changed' ? '登録後に編集・ルート割当されているため、取り消せません。' : res.code === 'too_late' ? '24時間を過ぎているため、取り消せません。' : '取り消せませんでした。'), res.ok ? 'ok' : 'warn');
                        afterChange();
                    } }, ask ? 'はい、取り消す' : '登録を取り消す'),
                    ask ? h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { confirming.delete(row.id); render(); } }, 'やめる') : null,
                    h('span', { class: 'mailbox-hint-s' }, '登録から24時間以内・編集前のものだけ')));
            }
            return card;
        }));
    }
    function unreadablePane(rows) {
        const list = rows.filter(r => r.bucket === 'unreadable' && r.state === 'new');
        if (!list.length) return h('p', { class: 'mailbox-empty' }, '確認が必要な依頼はありません。');
        const applicable = list.filter(r => r.applicable);
        const bar = h('div', { class: 'mailbox-bar' },
            h('label', { class: 'mailbox-check' }, h('input', { type: 'checkbox', 'aria-label': '反映できる行をすべて選ぶ', checked: applicable.length > 0 && applicable.every(r => selected.has(r.id)), disabled: !applicable.length, onchange: ev => { applicable.forEach(r => ev.target.checked ? selected.add(r.id) : selected.delete(r.id)); render(); } }), 'すべて選ぶ'),
            h('button', { type: 'button', class: 'btn btn-primary mailbox-btn-s', disabled: !selected.size, onclick: () => applyMany(list.filter(r => selected.has(r.id)), false) }, `選んだ${selected.size}件を反映`));
        return h('div', {}, h('p', { class: 'mailbox-hint' }, '自動で判別できなかった依頼です。月を選んで反映するか、日程未定に入れてください。反映した訪問先には「要確認」の印が付きます。'), applicable.length ? bar : null, list.map(row => {
            const card = h('article', { class: 'mailbox-card mailbox-attn' },
                h('div', { class: 'mailbox-card-head' }, row.applicable ? h('label', { class: 'mailbox-check' }, h('input', { type: 'checkbox', 'aria-label': 'この依頼を選ぶ', checked: selected.has(row.id), onchange: ev => { ev.target.checked ? selected.add(row.id) : selected.delete(row.id); render(); } })) : null, h('strong', {}, '確認が必要'), chip('判別不可', 'warn')),
                h('p', {}, row.reason), meta(row));
            if (row.applicable) {
                card.append(itemsView(row), h('div', { class: 'mailbox-actions' }, monthSelect(row),
                    h('button', { type: 'button', class: 'btn btn-primary mailbox-btn-s', onclick: () => applyMany([row], false) }, 'この月に反映'),
                    h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => applyMany([row], true) }, '日程未定に反映')));
            } else card.append(h('p', { class: 'mailbox-note' }, '自動では反映できません。元のメールや添付を確認してください。'));
            card.append(h('div', { class: 'mailbox-actions' }, gmailLink(row), h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { box.dismissRow(row.id); selected.delete(row.id); sayAll('確認済みにしました。', 'ok'); afterChange(); } }, '確認済みにする(登録しない)')));
            return card;
        }));
    }
    function referencePane(rows) {
        const list = rows.filter(r => r.bucket === 'reference' && r.state === 'new');
        if (!list.length) return h('p', { class: 'mailbox-empty' }, '通達・資料はありません。');
        return h('div', {}, h('p', { class: 'mailbox-hint' }, '配置図・連絡など、登録しないメールです。'), list.map(row => h('article', { class: 'mailbox-card' },
            h('div', { class: 'mailbox-card-head' }, h('strong', {}, row.fileName ? '資料' : '連絡メール'), chip('通達', '')),
            h('p', {}, row.reason), meta(row),
            h('div', { class: 'mailbox-actions' }, gmailLink(row),
                h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { box.reclassify(row.id); tab = 'unreadable'; sayAll('判別不可BOXに戻しました。', 'ok'); afterChange(); } }, '依頼書として見直す'),
                h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { box.dismissRow(row.id); sayAll('確認済みにしました。', 'ok'); afterChange(); } }, '確認済みにする')))));
    }
    function devTools() {
        if (!dev()) return null;
        return h('details', { class: 'mailbox-dev' }, h('summary', {}, '試験用の取り込み(開発用)'),
            h('p', { class: 'mailbox-hint-s' }, 'Gmailにはまだ接続していません。架空データまたは解析結果のJSONで動作を確かめます。'),
            h('div', { class: 'mailbox-actions' },
                h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: importDemo }, '架空データを取り込む'),
                h('label', { class: 'btn btn-secondary mailbox-btn-s mailbox-file' }, '解析結果JSONを読み込む', h('input', { type: 'file', accept: 'application/json,.json', onchange: importJson }))));
    }

    function render() {
        if (!overlay) return;
        const health = box.health();
        const rows = box.rows();
        const c = box.counts();
        const counts = { request: c.request, unreadable: c.unreadable, reference: c.reference };
        tabsEl.replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', id: 'mailBoxTab-' + id, 'aria-selected': String(tab === id), 'aria-controls': 'mailBoxBody', class: 'mailbox-tab' + (tab === id ? ' active' : ''), onclick: () => { tab = id; render(); } }, label, h('span', { class: 'mailbox-count' + (id === 'unreadable' && counts[id] ? ' warn' : '') }, String(counts[id])))));
        bodyEl.setAttribute('aria-labelledby', 'mailBoxTab-' + tab);
        const pane = !health.ok ? h('p', { class: 'mailbox-error', role: 'alert' }, 'メールBOXのデータを読み込めません(破損の可能性)。データは上書きしていません。アプリを再読込しても直らない場合は、このBOXのデータだけを消す操作が必要です。')
            : tab === 'request' ? requestPane(rows) : tab === 'unreadable' ? unreadablePane(rows) : referencePane(rows);
        const empty = !rows.length && health.ok ? h('p', { class: 'mailbox-hint' }, 'Gmailからの取り込みはまだ有効になっていません。取り込みが始まると、届いた依頼書がここに並びます。') : null;
        bodyEl.replaceChildren(...[pane, empty, devTools()].filter(Boolean));
        statusEl.textContent = note.text; statusEl.dataset.kind = note.kind;
    }

    // ---- 開閉 ----
    function open() {
        opener = document.activeElement;
        const c = box.counts();
        tab = c.unreadable ? 'unreadable' : (c.request ? 'request' : tab);
        overlay.hidden = false; document.body.classList.add('mailbox-open');
        render();
        overlay.querySelector('#mailBoxTitle').focus();
    }
    function close() {
        overlay.hidden = true; document.body.classList.remove('mailbox-open');
        selected.clear(); confirming.clear();
        refreshChrome();
        if (opener && opener.focus) opener.focus();
    }
    function init() {
        box = MailBox.create();
        overlay = document.getElementById('mailBoxOverlay');
        if (!overlay) return;
        statusEl = document.getElementById('mailBoxStatus'); bodyEl = document.getElementById('mailBoxBody'); tabsEl = document.getElementById('mailBoxTabs');
        document.getElementById('mailBoxBtn').addEventListener('click', open);
        document.getElementById('mailBoxClose').addEventListener('click', close);
        const bannerBtn = document.getElementById('mailBoxBannerOpen'); if (bannerBtn) bannerBtn.addEventListener('click', open);
        overlay.addEventListener('keydown', ev => {
            if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
            if (ev.key !== 'Tab') return;
            const f = [...overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([hidden]),select:not([disabled]),summary,[tabindex="0"],#mailBoxTitle')].filter(el => el.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
            else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        });
        tabsEl.addEventListener('keydown', ev => {
            if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
            const ids = TABS.map(t => t[0]); const i = ids.indexOf(tab);
            tab = ids[(i + (ev.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]; render();
            document.getElementById('mailBoxTab-' + tab).focus();
        });
        refreshChrome();
    }
    return { init, open, close };
})();
