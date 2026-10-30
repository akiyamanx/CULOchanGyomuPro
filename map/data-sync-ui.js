// [端末間の自動同期 画面] 画面上部の細い帯で状態を出し、自動で同期する(map/data-sync.js)。
//   いつ同期するか: Googleドライブにつないだとき・アプリに戻ったとき・変更の約2秒後(数秒ごとに変更を確認)・「今すぐ同期」。
//   つなぐ許可(トークン)はこの画面の中だけ。アプリを開くたびに「接続して同期」を1回押す。
//   一度に多くの訪問先が消えたときは確認する(誤操作や入れ替えで他端末から消さないため)。
const DataSyncUI = (() => {
    // 他の端末の変更を見に行く係(画面に依存しない・テスト用に外から作れる)。
    //   表示中かつ接続中だけ、約20秒ごとに一覧(メタデータ)を1回取り、変わっていたら同期する。
    //   失敗が続くと 40→80→…最大5分 と間隔を延ばす。入力中は反映を待ち、入力が終わったらすぐ反映する。
    function createPoller(o) {
        const base = o.baseMs || 20000, max = o.maxMs || 300000;
        let lastSig = null, pendingSig = null, interval = base, deferred = false, running = false;
        async function check() {
            if (running) return 'busy';
            if (!o.isVisible() || !o.isConnected()) return 'paused';
            if (o.isBusy && o.isBusy()) return 'busy';
            running = true;
            try {
                if (deferred) { if (o.isEditing()) return 'deferred'; lastSig = pendingSig; }
                else {
                    const r = await o.core.remoteSignature();
                    if (!r || !r.ok) { interval = Math.min(interval * 2, max); return 'error'; }
                    interval = base;
                    if (r.sig === lastSig) return 'same';
                    if (o.isEditing()) { deferred = true; pendingSig = r.sig; return 'deferred'; }
                    lastSig = r.sig;
                }
                deferred = false;
                const res = await o.runSync();
                if (!res || !res.ok) { lastSig = null; if (res && /timeout|network|http_error|forbidden/.test(res.code || '')) interval = Math.min(interval * 2, max); return 'sync_failed'; }
                return 'synced';
            } finally { running = false; }
        }
        return { check, delay: () => interval, isDeferred: () => deferred, reset: () => { lastSig = null; interval = base; } };
    }

    let core = null, bar, textEl, btn, lastFp = '', wasConnected = false, timer = null, debounce = null, hiddenByUser = false, lastMsg = '';
    const MSG = {
        not_connected: 'Googleドライブに未接続です。', local_corrupt: 'この端末の保存データを読めないため、同期を止めています。',
        state_corrupt: '同期の記録を読めません。', backup_failed: '初回の控えを保存できないため、同期を止めています。',
        busy_local: '同期中に編集されたので、少し後でやり直します。', write_failed: 'この端末へ書き込めませんでした(空き容量を確認)。',
        timeout: '通信に時間がかかっています。', auth_expired: 'Googleの許可が切れました。もう一度接続してください。', forbidden: 'Google Driveを利用できません。',
        network: '通信できませんでした。', http_error: '通信できませんでした。', unexpected: '同期できませんでした。', busy: ''
    };
    const WARN = { too_large: 'データが大きすぎて、この端末の変更を送れません。', push_failed: 'この端末の変更を送れませんでした(次に再送します)。', newer_version: '新しい版のアプリのデータがあります。アプリを更新してください。', file_invalid: '読めないファイルがありました(その分は使っていません)。', file_unreadable: '一部のファイルを読めませんでした。', records_dropped: '形式の正しくない記録を使いませんでした。' };
    const connected = () => { try { return typeof DriveTransfer !== 'undefined' && DriveTransfer.state().connected; } catch (e) { return false; } };
    const busyElsewhere = () => (typeof TransferUI !== 'undefined' && TransferUI.isBusy && TransferUI.isBusy());
    const hm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    function show(text, kind) {
        if (!bar) return;
        lastMsg = text;
        textEl.textContent = text; bar.dataset.kind = kind || '';
        const c = connected();
        btn.textContent = c ? '今すぐ同期' : '接続して同期';
        bar.hidden = hiddenByUser && kind !== 'error';
    }
    // 入力中か(文字を打っている・訪問先の編集画面などが開いている)。このときは他端末の変更を書き込まない。
    function isEditing() {
        if (typeof document === 'undefined') return false;
        const a = document.activeElement;
        if (a && !(bar && bar.contains(a))) {
            const tag = a.tagName;
            if (a.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(button|submit|checkbox|radio|range|file|reset|image)$/i.test(a.type || ''))) return true;
        }
        for (const m of document.querySelectorAll('.modal-overlay')) if (m.style.display && m.style.display !== 'none' && getComputedStyle(m).display !== 'none') return true;
        return false;
    }
    // 画面を描き直してもスクロール位置を戻す
    function keepScroll(fn) {
        const y = window.scrollY, saved = [];
        for (const el of document.querySelectorAll('body *')) if (el.scrollTop > 0) saved.push([el, el.scrollTop]);
        try { return fn(); } finally {
            const back = () => { window.scrollTo(0, y); for (const [el, t] of saved) if (el.isConnected) el.scrollTop = t; };
            back(); requestAnimationFrame(back);
        }
    }
    let toastEl = null, toastTimer = null;
    function toast(text) {
        if (!toastEl) {
            toastEl = document.createElement('div'); toastEl.id = 'dataSyncToast'; toastEl.setAttribute('role', 'status');
            toastEl.style.cssText = 'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);max-width:92vw;white-space:nowrap;padding:8px 14px;border-radius:18px;background:rgba(20,40,60,.88);color:#fff;font:13px/1.4 sans-serif;z-index:9500;pointer-events:none;transition:opacity .3s;opacity:0;';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = text; toastEl.style.opacity = '1';
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2500);
    }
    function refreshApp() { keepScroll(refreshInner); }
    function refreshInner() {
        try {
            if (typeof updateWsButton === 'function') updateWsButton();
            if (typeof MapCore !== 'undefined' && MapCore.refreshAllMarkers) MapCore.refreshAllMarkers();
            if (typeof RouteManager !== 'undefined' && RouteManager.updateRoutePanel) RouteManager.updateRoutePanel();
        } catch (e) { console.error('datasync: refresh_failed'); }
    }
    let deferredLocal = false;
    async function syncNow(opt, how) {
        if (!core || busyElsewhere()) return null;
        if (how && how.auto && isEditing()) { deferredLocal = true; return { ok: false, code: 'editing' }; }
        deferredLocal = false;
        if (!connected()) { show('自動同期: Googleドライブに未接続(この端末だけに保存中)', 'warn'); return null; }
        show('同期中…', '');
        let r = await core.sync(opt);
        if (!r.ok && r.code === 'mass_delete') {
            const yes = confirm(`この端末で訪問先が${r.count}件まとめて消えています。\n\nOK: もう1台からも消す\nキャンセル: 消さずに、もう1台から戻す`);
            r = await core.sync({ massDelete: yes ? 'allow' : 'restore' });
        }
        if (r.code === 'busy_local') { schedule(); }
        if (r.ok && poller) poller.reset();
        lastFp = core.fingerprint();
        if (r.ok) {
            const s = r.stats; const bits = [];
            if (s.first) bits.push('初回の突き合わせをしました(同期前の控えあり)');
            if (s.added) bits.push(`他の端末から${s.added}件追加`);
            if (s.changed) bits.push(`${s.changed}件更新`);
            if (s.mfMerged) bits.push(`同じMF番号の重複${s.mfMerged}件をまとめました`);
            if (s.conflicts) bits.push(`食い違い${s.conflicts}項目は空欄でない方を採用`);
            const w = (r.warnings || []).map(x => WARN[x]).filter(Boolean);
            show(`同期済み ${hm(Date.now())}` + (bits.length ? ' — ' + bits.join('・') : '') + (w.length ? ' ⚠ ' + w.join(' ') : ''), w.length ? 'warn' : 'ok');
            if (s.writes) { refreshApp(); if (how && how.auto && (s.added || s.changed || s.deletedHere || s.mfMerged)) toast('他の端末の変更を反映しました'); }
        } else if (r.code !== 'busy') show('同期できませんでした: ' + (MSG[r.code] || MSG.unexpected), 'error');
        return r;
    }
    async function onButton() {
        if (connected()) { syncNow(); return; }
        if (typeof DriveTransfer === 'undefined') return;
        try { await DriveTransfer.prepare(); await DriveTransfer.connect(); } catch (e) { show(String((e && e.message) || '接続できませんでした。').slice(0, 120), 'error'); return; }
        wasConnected = true; syncNow();
    }
    function schedule() { clearTimeout(debounce); debounce = setTimeout(() => { debounce = null; syncNow(null, { auto: true }); }, 2000); }
    function tick() {
        if (!core) return;
        const c = connected();
        if (c && !wasConnected) { wasConnected = true; syncNow(null, { auto: true }); return; }
        if (deferredLocal && c && !isEditing()) { syncNow(null, { auto: true }); return; }
        if (poller && poller.isDeferred() && !isEditing()) { poller.check(); }   // どこかの画面(メールBOX・設定)でつないだ
        if (!c && wasConnected) { wasConnected = false; show('自動同期: 接続が切れました(この端末だけに保存中)', 'warn'); }
        const fp = core.fingerprint();
        if (fp === lastFp) return;
        lastFp = fp;
        const cp = core.checkpoint();   // 通信なしで「いつ変えたか」を記録
        if (cp && cp.code === 'mass_delete' && !c) show(`訪問先が${cp.count}件まとめて消えています。接続して同期するときに確認します。`, 'warn');
        if (c) schedule();
    }
    let poller = null, loopTimer = null;
    async function loop() {
        clearTimeout(loopTimer);
        try {
            await poller.check();
            // メールBOXを開いている間は、メールの台帳も同じ間隔で取り込む
            if (document.visibilityState === 'visible' && connected() && typeof MailBoxUI !== 'undefined' && MailBoxUI.isOpen && MailBoxUI.isOpen() && !MailBoxUI.isSyncing() && !isEditing()) {
                const ov = document.getElementById('mailBoxOverlay'); const saved = ov ? [...ov.querySelectorAll('*')].filter(e => e.scrollTop > 0).map(e => [e, e.scrollTop]) : [];
                await MailBoxUI.syncQuiet();
                for (const [e, t] of saved) if (e.isConnected) e.scrollTop = t;
            }
        } catch (e) { /* 次の回で */ }
        loopTimer = setTimeout(loop, document.visibilityState === 'visible' ? poller.delay() : 60000);
    }
    function kick() { if (poller) { clearTimeout(loopTimer); loopTimer = setTimeout(loop, 500); } }
    function afterRestore() { if (core) core.rebase(); }
    async function downloadBeforeSync() {
        try {
            const b = await BackupStore.beforeSync(); if (!b) { alert('この端末には、初回同期の前の記録はまだありません。'); return; }
            const blob = new Blob([JSON.stringify(b)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'CULOchan-before-sync.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) { alert('書き出せませんでした。'); }
    }
    function init() {
        if (typeof DataSync === 'undefined' || typeof AppStorage === 'undefined') return;
        try {
            const adapter = typeof DriveLedgerAdapter !== 'undefined' && typeof DriveTransfer !== 'undefined' && typeof BackupStore !== 'undefined'
                ? DriveLedgerAdapter.create({ transport: DriveTransfer, channel: BackupStore.channel, app: DataSync.APP, prefix: 'CULOchan-data-', maxBytes: DataSync.MAX_FILE_BYTES }) : null;
            core = DataSync.create({ storage: AppStorage, adapter, backup: async () => { await BackupStore.keepBeforeSync(await BackupStore.capture()); } });
        } catch (e) { core = null; console.error('datasync: init_failed'); return; }
        bar = document.createElement('div'); bar.id = 'dataSyncBar'; bar.setAttribute('role', 'status');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;font:13px/1.35 sans-serif;background:#eef4fb;border-bottom:1px solid #c9d8ea;color:#123;';
        textEl = document.createElement('span'); textEl.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere;';
        btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-secondary'; btn.style.cssText = 'flex:0 0 auto !important;width:auto !important;margin:0;min-height:44px;padding:0 10px;font-size:13px;white-space:nowrap;'; btn.onclick = onButton;
        const x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', '同期の帯をしまう'); x.textContent = '×'; x.style.cssText = 'flex:0 0 auto;width:auto;min-width:44px;min-height:44px;border:0;background:transparent;font-size:18px;';
        x.onclick = () => { hiddenByUser = true; bar.hidden = true; };
        bar.append(textEl, btn, x);
        const staging = document.getElementById('stagingBanner');
        if (staging && staging.nextSibling) staging.parentNode.insertBefore(bar, staging.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
        const prev = document.getElementById('fullBackupPrevious');
        if (prev && typeof BackupStore !== 'undefined' && BackupStore.beforeSync) {
            const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'btn btn-secondary'; b2.id = 'beforeSyncDownload'; b2.textContent = '初回の自動同期の前の記録を書き出す'; b2.onclick = downloadBeforeSync;
            prev.insertAdjacentElement('afterend', b2);
        }
        const st = core.status();
        show(st.everSynced ? '自動同期: 接続すると、もう1台と自動で揃えます' : '自動同期: 接続すると、もう1台と訪問先・ルートなどを自動で揃えます(初回は合わせる前に控えを取ります)', 'warn');
        lastFp = '';
        timer = setInterval(tick, 3000);
        poller = createPoller({ core, isVisible: () => document.visibilityState === 'visible', isConnected: connected, isEditing, isBusy: busyElsewhere, runSync: () => syncNow(null, { auto: true }) });
        loop();
        document.addEventListener('focusout', () => setTimeout(() => { if (!isEditing()) { if (deferredLocal) syncNow(null, { auto: true }); else if (poller.isDeferred()) poller.check(); } }, 300));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') { if (connected()) syncNow(null, { auto: true }); kick(); }
            else { try { core.checkpoint(); } catch (e) { /* 次で */ } }
        });
        if (typeof DriveTransfer !== 'undefined' && AppStorage.getItem('culo_google_calendar_client_id')) DriveTransfer.prepare().catch(() => {});
    }
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    return { createPoller, syncNow, afterRestore, _isEditing: () => isEditing(), _toast: t => toast(t), _refresh: () => refreshApp(), status: () => core ? core.status() : null, _core: () => core };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DataSyncUI;
