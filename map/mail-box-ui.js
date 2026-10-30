// [メールBOX 画面] スマホ・タブレット向け。3つのBOX(依頼書の結果 / 判別不可 / 通達)。
// 画面の文字は textContent で入れる(メールの件名・会社名をHTMLとして解釈しない)。
const MailBoxUI = (() => {
    const TABS = [['request', '依頼書'], ['unreadable', '判別不可'], ['reference', '通達'], ['favorite', '⭐お気に入り']];
    const LABEL = { company: '会社名', address: '住所', purpose: '作業内容' };
    let box, syncer, gTransport, gImport, gSource = null, gAccount = '', gRunning = false, gAbort = null, gProgressEl = null, overlay, statusEl, bodyEl, tabsEl, opener, tab = 'unreadable', syncing = false;
    const selected = new Set();       // 判別不可でチェックした行
    const choice = new Map();         // 行ごとの月の選択 {ws, newMonth}
    const confirming = new Set();     // 取り消しの確認待ちの行
    let note = { text: '', kind: '' };
    let gNote = null;                 // Gmail取り込みの直近の結果 {lines, kind}

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
                const parts = [];
                if (c.unreadable) parts.push(`確認が必要な依頼が${c.unreadable}件あります`);
                const ss = syncStatus();
                if (ss && ss.conflicts) parts.push(`同じ依頼書が2台で登録された可能性が${ss.conflicts}件あります`);
                else if (ss && ss.level === 'error') parts.push('端末間の同期に失敗しています');
                const text = parts.length ? 'メールBOXに、' + parts.join('。') + '。' : '';
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
        if (r.excluded) parts.push(`対象外${r.excluded}件`);
        if (r.skipped) parts.push(`取り込み済み${r.skipped}件`);
        return { text: parts.length ? '取り込みました: ' + parts.join('、') + '。' : '新しいメールはありませんでした。', kind: r.errors && r.errors.length ? 'warn' : 'ok' };
    }
    async function runIngest(mails) {
        let r;
        if (syncer) r = await syncer.ingestMails(mails);   // 同期は補助。失敗しても取り込みは行われる
        else r = box.ingest(mails);
        const s = summarize(r);
        const sy = r.sync;
        if (sy && !sy.ok && sy.code !== 'not_connected' && sy.code !== 'busy') { s.text += ' 端末間の同期には失敗しました(この端末の記録だけで重複を防いでいます)。'; s.kind = s.kind === 'error' ? 'error' : 'warn'; }
        else if (sy && sy.conflicts) { s.text += ' 同じ依頼書が2台で登録された可能性があります。確認してください。'; s.kind = 'warn'; }
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


    // ---- Gmail取り込み(読み取り専用。トークンはメモリ内だけ。仕様書 §20) ----
    const SENDERS_KEY = 'culo_mail_gmail_senders';
    const GMAIL_MSG = {
        not_configured: 'Googleの接続設定(クライアントID)がまだ入っていません。手順書のとおりに設定してから、もう一度「Googleにつなぐ」を押してください。',
        google_not_ready: 'Googleのログイン部品を読み込めませんでした。通信状態を確認して、もう一度お試しください。',
        consent_denied: 'Googleでの許可が完了しませんでした。「Googleにつなぐ」からやり直してください。',
        consent_timeout: 'Googleでの許可が時間内に終わりませんでした。「Googleにつなぐ」からやり直してください。',
        scope_missing: 'Gmailの読み取りが許可されていません。「Googleにつなぐ」からやり直し、許可の画面でGmailの読み取りにチェックを入れてください。',
        not_connected: 'Googleにつながっていません。「Googleにつなぐ」を押してください。',
        auth_expired: '許可の有効期限が切れました。「Googleにつなぐ」からもう一度つないでください。',
        rate_limited: 'Gmailの利用回数の上限に達しました。しばらく(数分〜)待ってから、もう一度お試しください。',
        forbidden: 'Gmailへのアクセスが許可されていません(アカウントや組織の設定の可能性)。',
        api_disabled: 'Googleの設定で Gmail API がまだ有効になっていません。手順書の「Gmail APIを有効にする」を確認してください。',
        network: '通信に失敗しました。電波の良い場所で、もう一度お試しください。',
        timeout: 'Googleからの返事が時間内にありませんでした。もう一度お試しください。',
        server_error: 'Google側で一時的な問題が起きています。しばらく待ってからお試しください。',
        bad_response: 'Googleから想定外の返事が返りました。取り込みを止めました。',
        http_error: 'Googleからエラーが返りました。取り込みを止めました。',
        aborted: '取り込みを中止しました。',
        no_senders: '差出人が入っていません。上の「差出人」に、名前やメールアドレスの一部を入れてください。',
        bad_terms: '差出人に使えない文字(スペース・かっこ・引用符など)が入っています。',
        busy: 'すでに取り込み中です。',
        ledger_save_failed: 'BOXへの保存に失敗しました。',
        ingest_failed: 'BOXへの登録に失敗しました。'
    };
    const gErrText = code => GMAIL_MSG[code] || '取り込みを完了できませんでした。';
    function readTerms() {
        let raw = ''; try { raw = String(AppStorage.getItem(SENDERS_KEY) || ''); } catch (e) { raw = ''; }
        if (!raw && typeof MailBoxDemo !== 'undefined' && MailBoxDemo.gmail && gMock()) return MailBoxDemo.defaultTerms;
        return raw.split(/[,、，\n]+/).map(x => x.trim()).filter(Boolean);
    }
    const gMock = () => dev() && /[?&]mockGmail=1(&|$)/.test(location.search);
    function gmailSummary(r) {
        const lines = []; let kind = r.ok ? 'ok' : 'error';
        const A = r.attachments || {}, S = r.ingest || {};
        if (!r.ok) { lines.push(gErrText(r.code) + (r.stage === 'fetch' || r.stage === 'ingest' ? (r.mails ? `ここまでの${r.mails}通は取り込みました。` : '') : '')); if (r.code === 'aborted') kind = ''; }
        else if (!r.found) lines.push('条件に合う新しいメールはありませんでした。');
        else {
            const parts = [];
            if (S.registered) parts.push(`${S.registered}件を自動登録`); if (S.unreadable) parts.push(`確認が必要${S.unreadable}件`); if (S.reference) parts.push(`通達${S.reference}件`); if (S.duplicates) parts.push(`重複${S.duplicates}件は登録せず`); if (S.moved) parts.push(`日程未定から${S.moved}件を作業日の月へ移動`);
            // 1行目だけが画面上部の通知に出るため、1行目だけで「新しく何通か」が分かるように書く。
            const known = r.knownMails || 0;
            if (r.mails) lines.push(`${r.found}通を確認し、新しく${r.mails}通を取り込みました` + (parts.length ? '(' + parts.join('、') + ')' : '') + '。' + (known ? `${known}通は前回までに取り込み済みです。` : ''));
            else if (known || A.skippedKnown) lines.push(`${r.found}通を確認しました。新しいメールはありませんでした(${known || r.found}通は前回までに取り込み済み)。`);
            else lines.push(`${r.found}通を確認しましたが、取り込めるメールはありませんでした。`);
            if (S.retried) lines.push(`前回読めなかった添付${S.retried}件を読み直しました。`);
            if (r.skippedSender) lines.push(`${r.skippedSender}通は差出人が設定と一致しないため取り込んでいません。`);
            if (r.skippedOld) lines.push(`${r.skippedOld}通は期間(約2か月)より古いため取り込んでいません。`);
            lines.push('上のタブの件数は、BOXにたまっている合計(添付ごと)です。');
        }
        if (r.failedMails) { lines.push(`${r.failedMails}通は取得に失敗しました(登録していません。次回また取りに行きます)。`); if (kind === 'ok') kind = 'warn'; }
        if (r.truncated) { lines.push(r.stoppedBy === 'run_limit' ? '1回の取り込み量の上限に達したため、残りは次回に取り込みます。もう一度押してください。' : '1回の取り込み件数の上限のため、残りがあります。もう一度押してください。'); if (kind === 'ok') kind = 'warn'; }
        if (A.tnef) { lines.push(`Outlook形式(winmail.dat)の添付が${A.tnef}件あり、開けないため判別不可に入れました。`); if (kind === 'ok') kind = 'warn'; }
        if (r.senderUnverified) lines.push(`差出人を確かめられなかったメールが${r.senderUnverified}通あります(Gmailの検索結果を信じて取り込みました)。`);
        if (r.syncOk === false) lines.push('端末間の同期には失敗しました(この端末の記録だけで重複を防いでいます)。');
        return { lines, kind };
    }
    async function connectGmail() {
        if (!gTransport || gRunning) return;
        gNote = { lines: ['Googleの画面で許可してください…'], kind: '' }; render();
        try {
            await gTransport.connect(); gNote = { lines: ['つながりました。「Gmailから取り込む」を押してください。'], kind: 'ok' };
            gAccount = gSource && gSource.getProfile ? await gSource.getProfile() : '';   // メモリだけ(保存しない)
        }
        catch (e) { gNote = { lines: [gErrText(e && e.code)], kind: 'error' }; }
        render();
    }
    async function importGmail() {
        if (!gImport || gRunning) return;
        gRunning = true; gAbort = new AbortController(); gNote = null; render();
        let r;
        try {
            r = await gImport.run({ signal: gAbort.signal, onProgress: p => {
                if (!gProgressEl) return;
                gProgressEl.textContent = p.stage === 'list' ? 'メールを探しています…' : p.stage === 'fetch' ? `メールを確認中 ${p.done}/${p.total}` : p.stage === 'ingest' ? 'BOXに登録中…' : '';
            } });
        } catch (e) { r = { ok: false, code: 'network', stage: 'fetch', attachments: {}, mails: 0 }; }
        gRunning = false; gAbort = null;
        const sum = gmailSummary(r);
        gNote = sum;
        sayAll(sum.lines[0] || '', sum.kind);
        if (r.ingest && r.ingest.registered) tab = 'request'; else if (r.ingest && r.ingest.unreadable) tab = 'unreadable';
        afterChange();
    }
    function gmailCard() {
        if (!gTransport || !gImport) return null;
        const st = gTransport.state();
        const label = gRunning ? '取り込み中…' : st.connected ? '接続済み' : st.configured ? '未接続' : '設定が必要';
        const kind = gRunning ? '' : st.connected ? 'ok' : 'warn';
        gProgressEl = h('p', { class: 'mailbox-hint-s', role: 'status', 'aria-live': 'polite' }, gRunning ? 'メールを探しています…' : '');
        const input = h('input', { type: 'text', id: 'mailGmailSenders', class: 'mailbox-input', value: readTerms().join(', '), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', disabled: gRunning, placeholder: '名前やアドレスの一部(カンマ区切り)',
            onchange: ev => { const v = ev.target.value.split(/[,、，\n]+/).map(x => x.trim()).filter(Boolean).join(','); try { AppStorage.setItem(SENDERS_KEY, v); } catch (e) { /* 保存できなくても今回の取り込みには使う */ } } });
        const card = h('section', { class: 'mailbox-sync mailbox-gmail', 'aria-label': 'Gmailから取り込み' },
            h('div', { class: 'mailbox-card-head' }, h('strong', {}, 'Gmailから取り込み'), chip(label, kind)),
            h('p', { class: 'mailbox-sync-msg' }, '直近2か月の、下の差出人から届いた添付つきメールを読み、依頼書を自動で仕分けます。Gmailは読み取りだけで、送信・削除・書き換えはできません。'),
            h('label', { class: 'mailbox-field', for: 'mailGmailSenders' }, h('span', {}, '差出人(名前やメールアドレスの一部)'), input),
            h('p', { class: 'mailbox-hint-s' }, 'メール本文は読みません・保存しません。BOXに残るのは、件名・ファイル名・受信日と、登録した訪問先だけです。'));
        if (!st.connected) {
            card.append(h('div', { class: 'mailbox-note' },
                h('p', {}, st.configured ? 'まだGoogleにつながっていません。先に「Googleにつなぐ」を押して、Gmailの読み取りを許可してください。' : 'Googleの接続設定(クライアントID)がまだありません。手順書のとおりに設定してから「Googleにつなぐ」を押してください。'),
                h('p', { class: 'mailbox-hint-s' }, '許可の画面で「このアプリは確認されていません」と出ることがあります(アキヤさんが自分のアプリとして公開している場合)。出たときの進み方は手順書に書いてあります。つなぐのはアプリを開くたびに必要です(許可の情報を端末に保存しないため)。')));
            card.append(h('div', { class: 'mailbox-actions' }, h('button', { type: 'button', class: 'btn btn-primary mailbox-btn-s', onclick: connectGmail }, 'Googleにつなぐ')));
        } else {
            card.append(h('div', { class: 'mailbox-actions' },
                h('button', { type: 'button', class: 'btn btn-primary mailbox-btn-s', id: 'mailGmailImport', disabled: gRunning, onclick: importGmail }, gRunning ? '取り込み中…' : 'Gmailから取り込む'),
                gRunning ? h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { if (gAbort) gAbort.abort(); } }, '中止') : null,
                !gRunning ? h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { try { gTransport.disconnect(); } catch (e) { /* 何もしない */ } gAccount = ''; gNote = { lines: ['Googleとの接続を切りました。'], kind: '' }; render(); } }, '接続を切る') : null));
        }
        card.append(gProgressEl);
        if (gNote && gNote.lines.length) card.append(h('div', { class: 'mailbox-note mailbox-gmail-result', 'data-kind': gNote.kind, role: gNote.kind === 'error' ? 'alert' : 'status' }, gNote.lines.map(t => h('p', {}, t))));
        return card;
    }

    // ---- 端末間の台帳(スマホ・タブレットで同じメールを二重に登録しない) ----
    const syncStatus = () => { try { return syncer ? syncer.status() : null; } catch (e) { return null; } };
    const SYNC_LEVEL = { off: ['未接続', ''], idle: ['未同期', ''], ok: ['同期済み', 'ok'], warn: ['要確認', 'warn'], error: ['失敗', 'warn'] };
    const when = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
    async function syncNow() {
        if (!syncer || syncing) return;
        syncing = true; render();
        let r; try { r = await syncer.sync(); } catch (e) { r = { ok: false, code: 'unexpected' }; }
        syncing = false;
        const st = syncStatus();
        if (r.ok && !(st && st.level === 'warn')) sayAll('同期しました。', 'ok');
        else if (r.code === 'busy') sayAll('同期中です。少し待ってください。', '');
        else sayAll(st ? st.message : '同期できませんでした。', r.ok ? 'warn' : 'error');
        afterChange();
    }
    async function connectDrive() {
        if (typeof DriveTransfer === 'undefined' || syncing) return;
        syncing = true; render();
        try { await DriveTransfer.connect(); }
        catch (e) { syncing = false; sayAll(String((e && e.message) || '接続できませんでした。').slice(0, 120), 'warn'); render(); return; }
        syncing = false;
        await syncNow();
    }
    function syncCard() {
        const st = syncStatus();
        if (!st) return null;
        const [label, kind] = SYNC_LEVEL[st.level] || ['', ''];
        const card = h('section', { class: 'mailbox-sync', 'aria-label': '端末間の同期' },
            h('div', { class: 'mailbox-card-head' }, h('strong', {}, '端末間の同期'), chip(syncing ? '同期中…' : label, syncing ? '' : kind)),
            h('p', { class: 'mailbox-sync-msg', role: st.level === 'error' ? 'alert' : null }, st.message),
            st.lastOkAt ? h('p', { class: 'mailbox-hint-s' }, `最後に同期できた時刻: ${when(st.lastOkAt)}`) : null,
            st.remote.registeredNotHere ? h('p', { class: 'mailbox-hint-s' }, `他の端末で登録済みで、この端末にまだ訪問先が無いメール: ${st.remote.registeredNotHere}件(バックアップの受け渡しで届きます)`) : null,
            st.remote.unreadableElsewhere ? h('p', { class: 'mailbox-hint-s' }, `他の端末で確認待ちのメール: ${st.remote.unreadableElsewhere}件(その端末のメールBOXで確認してください)`) : null,
            h('div', { class: 'mailbox-actions' },
                st.connected
                    ? h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', disabled: syncing, onclick: syncNow }, '今すぐ同期')
                    : (typeof DriveTransfer !== 'undefined' ? h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', disabled: syncing, onclick: connectDrive }, 'Googleドライブに接続') : null),
                !st.connected ? h('span', { class: 'mailbox-hint-s' }, '接続はアプリを開くたびに必要です(許可の情報を端末に保存しないため)。') : null));
        const conflicts = box.conflicts();
        conflicts.slice(0, 20).forEach(c => card.append(h('div', { class: 'mailbox-note mailbox-conflict', role: 'alert' },
            h('p', {}, '同じ依頼書が2台で登録された可能性があります。自動では消していません。'),
            h('p', {}, c.keep ? 'この端末の分を残す側です。もう一方の端末で、重複した訪問先を確認して削除してください。' : 'もう一方の端末の分を残す側です。この端末で、重複した訪問先を確認して削除してください。'),
            h('div', { class: 'mailbox-actions' }, h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { const res = box.ackConflict(c.key, c.kind); sayAll(res.ok ? '確認済みにしました。' : '操作できませんでした。', res.ok ? 'ok' : 'warn'); afterChange(); } }, '確認した(この表示を消す)')))));
        if (conflicts.length > 20) card.append(h('p', { class: 'mailbox-hint-s' }, `ほか${conflicts.length - 20}件`));
        return card;
    }

    // ---- 行の部品 ----
    const chip = (text, kind) => h('span', { class: 'mailbox-chip ' + (kind || '') }, text);
    function meta(row) {
        const bits = [row.receivedDate ? `受信 ${row.receivedDate}` : '', row.fileName, row.subject && `件名: ${row.subject}`].filter(Boolean);
        return h('p', { class: 'mailbox-meta' }, bits.join(' ／ '));
    }
    function gmailLink(row) {
        if (row.source !== 'gmail' || !row.messageId) return null;
        const links = MailGmailLinks.of(row, gAccount, { userAgent: navigator.userAgent });
        if (!links) return null;
        const copyBtn = links.subject ? h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: e => copySubject(links.subject, e.currentTarget) }, '件名をコピー') : null;
        return h('span', { class: 'mailbox-gmail-links' }, [
            // スマホは直接開く形が白画面になるため、件名検索だけを主ボタンにする(実機確認 2026-10-30)。
            links.open ? h('a', { class: 'btn btn-secondary mailbox-btn-s', href: links.open, target: '_blank', rel: 'noopener noreferrer' }, 'Gmailで開く') : null,
            links.search ? h('a', { class: 'btn btn-secondary mailbox-btn-s', href: links.search, target: '_blank', rel: 'noopener noreferrer' }, links.mobile ? 'Gmailで探す' : '開かないとき: 件名で探す') : null,
            copyBtn
        ]);
    }
    // 件名をコピーして、Gmailアプリの検索欄に貼り付けてもらう(リンクで開けない端末の確実な代替)。
    async function copySubject(text, btn) {
        let ok = false;
        try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
        if (!ok) {
            try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e) { ok = false; }
        }
        if (btn) btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
        sayAll(ok ? '件名をコピーしました。Gmailアプリの検索欄に貼り付けてください。' : '件名をコピーできませんでした。', ok ? 'ok' : 'warn');
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

    // ---- ⭐お気に入り ----
    function starBtn(row) {
        const on = row.starred === true;
        return h('button', { type: 'button', class: 'mailbox-star' + (on ? ' on' : ''), 'aria-pressed': String(on), 'aria-label': on ? 'お気に入りから外す' : 'お気に入りに入れる', title: on ? 'お気に入りから外す' : 'お気に入りに入れる',
            onclick: () => { const r = box.setStar(row.id, !on); sayAll(r.ok ? (on ? 'お気に入りから外しました。' : 'お気に入りに入れました(⭐お気に入りタブでいつでも開けます)。') : 'お気に入りを保存できませんでした。', r.ok ? 'ok' : 'warn'); render(); } }, on ? '★' : '☆');
    }
    const CAT = { request: '依頼書', unreadable: '判別不可', reference: '通達' };
    const STATE = { dismissed: '確認済み', applied: '反映済み', cancelled: '取り消し済み' };
    function favoritePane() {
        const list = box.favorites();
        if (!list.length) return h('p', { class: 'mailbox-empty' }, 'お気に入りはまだありません。各BOXのメールの ☆ を押すと、ここに集まります。');
        return h('div', {}, h('p', { class: 'mailbox-hint' }, '大事なメールをいつでも開けます。★を押すとお気に入りから外れます(メール自体は消えません)。'), list.map(row => h('article', { class: 'mailbox-card' },
            h('div', { class: 'mailbox-card-head' }, starBtn(row), h('strong', { class: 'mailbox-fav-subject' }, row.subject || '(件名なし)'), chip(CAT[row.bucket] || 'その他', row.bucket === 'unreadable' ? 'warn' : ''), STATE[row.state] ? chip(STATE[row.state], '') : null),
            row.from ? h('p', { class: 'mailbox-meta' }, `差出人: ${row.from}`) : null,
            meta(row),
            h('div', { class: 'mailbox-actions' }, gmailLink(row)))));
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
                h('div', { class: 'mailbox-card-head' }, starBtn(row), h('strong', {}, row.state === 'cancelled' ? '依頼書(取り消し済み)' : '依頼書が来ました'), chip(st, row.state === 'cancelled' ? '' : 'ok'), row.needsAttention && row.state === 'registered' ? chip('確認推奨', 'warn') : null),
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
                h('div', { class: 'mailbox-card-head' }, starBtn(row), row.applicable ? h('label', { class: 'mailbox-check' }, h('input', { type: 'checkbox', 'aria-label': 'この依頼を選ぶ', checked: selected.has(row.id), onchange: ev => { ev.target.checked ? selected.add(row.id) : selected.delete(row.id); render(); } })) : null, h('strong', {}, '確認が必要'), chip('判別不可', 'warn'), row.elsewhere ? chip('他端末で登録済みの可能性', 'warn') : null),
                h('p', {}, row.reason), row.elsewhere ? h('p', { class: 'mailbox-note' }, '他の端末でこの依頼書が登録された可能性があります。反映する前に、訪問先の一覧に同じものが無いか確認してください。') : null, meta(row));
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
            h('div', { class: 'mailbox-card-head' }, starBtn(row), h('strong', {}, row.fileName ? '資料' : '連絡メール'), chip('通達', '')),
            h('p', {}, row.reason), meta(row),
            h('div', { class: 'mailbox-actions' }, gmailLink(row),
                h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { box.reclassify(row.id); tab = 'unreadable'; sayAll('判別不可BOXに戻しました。', 'ok'); afterChange(); } }, '依頼書として見直す'),
                h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: () => { box.dismissRow(row.id); sayAll('確認済みにしました。', 'ok'); afterChange(); } }, '確認済みにする')))));
    }
    const gmailCardAvailable = () => !!(gTransport && gImport);
    function devTools() {
        if (!dev()) return null;
        return h('details', { class: 'mailbox-dev' }, h('summary', {}, '試験用の取り込み(開発用)'),
            h('p', { class: 'mailbox-hint-s' }, 'ここは試験用です。架空データまたは解析結果のJSONで動作を確かめます(Gmailの取り込みは上のカードです)。'),
            h('div', { class: 'mailbox-actions' },
                h('button', { type: 'button', class: 'btn btn-secondary mailbox-btn-s', onclick: importDemo }, '架空データを取り込む'),
                h('label', { class: 'btn btn-secondary mailbox-btn-s mailbox-file' }, '解析結果JSONを読み込む', h('input', { type: 'file', accept: 'application/json,.json', onchange: importJson }))));
    }

    function render() {
        if (!overlay) return;
        const health = box.health();
        const rows = box.rows();
        const c = box.counts();
        const counts = { request: c.request, unreadable: c.unreadable, reference: c.reference, favorite: c.favorite || 0 };
        tabsEl.replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', id: 'mailBoxTab-' + id, 'aria-selected': String(tab === id), 'aria-controls': 'mailBoxBody', class: 'mailbox-tab' + (tab === id ? ' active' : ''), onclick: () => { tab = id; render(); } }, label, h('span', { class: 'mailbox-count' + (id === 'unreadable' && counts[id] ? ' warn' : '') }, String(counts[id])))));
        bodyEl.setAttribute('aria-labelledby', 'mailBoxTab-' + tab);
        const pane = !health.ok ? h('p', { class: 'mailbox-error', role: 'alert' }, 'メールBOXのデータを読み込めません(破損の可能性)。データは上書きしていません。アプリを再読込しても直らない場合は、このBOXのデータだけを消す操作が必要です。')
            : tab === 'request' ? requestPane(rows) : tab === 'unreadable' ? unreadablePane(rows) : tab === 'favorite' ? favoritePane() : referencePane(rows);
        const empty = !rows.length && health.ok ? h('p', { class: 'mailbox-hint' }, gmailCardAvailable() ? 'まだ取り込んだメールはありません。上の「Gmailから取り込み」から始めます。' : 'まだ取り込んだメールはありません。') : null;
        bodyEl.replaceChildren(...[gmailCard(), syncCard(), pane, empty, devTools()].filter(Boolean));
        statusEl.textContent = note.text; statusEl.dataset.kind = note.kind;
    }

    // ---- 開閉 ----
    function open() {
        opener = document.activeElement;
        const c = box.counts();
        tab = c.unreadable ? 'unreadable' : (c.request ? 'request' : tab);
        overlay.hidden = false; document.body.classList.add('mailbox-open');
        render();
        const ss = syncStatus();
        if (ss && ss.connected) syncNow();   // 接続済みなら開いたときに同期(待たせない)
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
        syncer = null;
        try {
            const adapter = dev() && /[?&]mockSync=1(&|$)/.test(location.search) && typeof MailBoxDemo !== 'undefined' && MailBoxDemo.ledgerAdapter ? MailBoxDemo.ledgerAdapter()
                : (typeof DriveLedgerAdapter !== 'undefined' && typeof DriveTransfer !== 'undefined' && typeof BackupStore !== 'undefined' ? DriveLedgerAdapter.create({ transport: DriveTransfer, channel: BackupStore.channel }) : null);
            if (adapter && typeof MailLedgerSync !== 'undefined') syncer = MailLedgerSync.create({ mailBox: box, adapter });
        } catch (e) { syncer = null; console.error('mailbox: sync_init_failed'); }
        gTransport = null; gImport = null;
        try {
            if (typeof GmailImport !== 'undefined' && typeof GmailSource !== 'undefined') {
                const g = gMock() && typeof MailBoxDemo !== 'undefined' && MailBoxDemo.gmail ? MailBoxDemo.gmail() : (typeof GmailTransport !== 'undefined' && typeof RequestReader !== 'undefined' ? { transport: GmailTransport.create(), reader: RequestReader } : null);
                if (g) { gTransport = g.transport; gSource = GmailSource.create({ transport: g.transport }); gImport = GmailImport.create({ source: gSource, reader: g.reader, mailBox: box, syncer, getTerms: readTerms, makeFile: g.makeFile }); }
            }
        } catch (e) { gTransport = null; gImport = null; console.error('mailbox: gmail_init_failed'); }
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
