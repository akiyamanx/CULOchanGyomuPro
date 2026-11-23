// [端末間の自動同期 画面] 画面上部の細い帯で状態を出し、自動で同期する(map/data-sync.js)。
//   Googleへの接続と同期の開始は別。明示的に開始した同じ接続だけで自動同期する。
//   つなぐ許可(トークン)はこの画面の中だけ。アプリを開くたびに「自動同期を始める」を1回押す。
//   一度に多くの訪問先が消えたときは確認する(誤操作や入れ替えで他端末から消さないため)。
const DataSyncUI = (() => {
    // 他の端末の変更を見に行く係(画面に依存しない・テスト用に外から作れる)。
    //   表示中かつ接続中だけ、約20秒ごとに一覧(メタデータ)を1回取り、変わっていたら同期する。
    //   失敗が続くと 40→80→…最大5分 と間隔を延ばす。入力中は反映を待ち、入力が終わったらすぐ反映する。
    function createPoller(o) {
        const base = o.baseMs || 20000, max = o.maxMs || 300000;
        let lastSig = null, interval = base, deferred = false, running = false, version = 0;
        async function check() {
            if (running) return 'busy';
            if (!o.isVisible() || !o.isConnected()) return 'paused';
            if (o.isBusy && o.isBusy()) return 'busy';
            running = true;
            const own = version;
            try {
                if (deferred && o.isEditing()) return 'deferred';
                const r = await o.core.remoteSignature();
                if (own !== version || !o.isConnected()) return 'paused';
                if (!r || !r.ok) { interval = Math.min(interval * 2, max); return 'error'; }
                if (r.sig === lastSig && !o.needsRetry?.()) { interval = base; deferred = false; return 'same'; }
                if (o.isEditing()) { deferred = true; return 'deferred'; }
                deferred = false;
                const res = await o.runSync();
                if (own !== version || !o.isConnected()) return 'paused';
                if (!res || !res.ok || res.warnings?.length) {
                    interval = Math.min(interval * 2, max); return 'sync_failed';
                }
                lastSig = r.sig;
                interval = base;
                return 'synced';
            } finally { running = false; }
        }
        return { check, delay: () => interval, isDeferred: () => deferred, reset: () => { version++; lastSig = null; deferred = false; interval = base; } };
    }

    let core = null, bar, textEl, btn, lastFp = '', approvedSession = null, starting = false, debounce = null, hiddenByUser = false, lastMsg = '';
    const MSG = {
        not_connected: 'Googleドライブに未接続です。', local_corrupt: 'この端末の保存データを読めないため、同期を止めています。',
        state_corrupt: '同期の記録を読めません。', backup_failed: '初回の控えを保存できないため、同期を止めています。',
        busy_local: '同期中に編集されたので、少し後でやり直します。', write_failed: 'この端末へ書き込めませんでした(空き容量を確認)。',
        timeout: '通信に時間がかかっています。', auth_expired: 'Googleの許可が切れました。もう一度接続してください。', forbidden: 'Google Driveを利用できません。',
        network: '通信できませんでした。', http_error: '通信できませんでした。', unexpected: '同期できませんでした。', busy: ''
    };
    const WARN = { device_limit: '接続した端末が多く、一部のデータが未確認です。', too_large: 'データが大きすぎて、この端末の変更を送れません。', push_failed: 'この端末の変更を送れませんでした(次に再送します)。', newer_version: '新しい版のアプリのデータがあります。アプリを更新してください。', file_invalid: '読めないファイルがありました(その分は使っていません)。', file_unreadable: '一部のファイルを読めませんでした。', records_dropped: '形式の正しくない記録を使いませんでした。' };
    const driveState = () => { try { return typeof DriveTransfer !== 'undefined' ? DriveTransfer.state() : null; } catch (e) { return null; } };
    const isAllowed = session => {
        const state = driveState();
        return session != null && approvedSession === session && state?.connected && state.session === session;
    };
    const enabled = () => isAllowed(approvedSession);
    const offText = '自動同期はオフです。バックアップの共有先につないだだけでは始まりません。';
    const busyElsewhere = () => (typeof TransferUI !== 'undefined' && TransferUI.isBusy && TransferUI.isBusy());
    function scope() { return driveState()?.email?.trim().toLowerCase() || ''; }
    function statusLine(r, account) {
        const st = core.status(account), local = st.localState;
        const last = st.lastSuccessAt ? '前回の同期成功: ' + new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(st.lastSuccessAt)
            : 'この接続での同期成功は未確認';
        if (r && !r.ok && r.code === 'write_failed') return last;
        return (local === 'pending' ? 'この端末に保存済み・未同期。' : local === 'unknown' ? 'この端末の保存データ。' : '') + last;
    }
    function show(text, kind) {
        if (!bar) return;
        lastMsg = text;
        textEl.textContent = text; bar.dataset.kind = kind || '';
        btn.textContent = enabled() ? '今すぐ同期' : '自動同期を始める';
        bar.hidden = hiddenByUser && !['error','warn'].includes(kind);
    }
    // 入力中か(文字を打っている・訪問先の編集画面などが開いている)。このときは他端末の変更を書き込まない。
    function isEditing() {
        if (typeof document === 'undefined') return false;
        if (document.getElementById('siteCompletionDialog')?.open) return true;
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
        const session = approvedSession, account = scope(), stillAllowed = () => isAllowed(session);
        if (!core || busyElsewhere() || !stillAllowed()) return null;
        if (how && how.auto && isEditing()) { deferredLocal = true; return { ok: false, code: 'editing' }; }
        deferredLocal = false;
        show('同期中… ' + statusLine(null, account), '');
        let r = await core.sync({ ...opt, stillAllowed, statusScope: account });
        if (!stillAllowed()) return null;
        if (!r.ok && r.code === 'mass_delete') {
            const yes = confirm(`この端末で訪問先が${r.count}件まとめて消えています。\n\nOK: もう1台からも消す\nキャンセル: 消さずに、もう1台から戻す`);
            if (!stillAllowed()) return null;
            r = await core.sync({ massDelete: yes ? 'allow' : 'restore', stillAllowed, statusScope: account });
            if (!stillAllowed()) return null;
        }
        if (r.code === 'busy_local') { schedule(); }
        const fp = core.fingerprint();
        const edited = core.status(account).localState === 'pending' && !r.warnings?.length && r.ok;
        lastFp = fp;
        if (edited) schedule();
        if (r.ok) {
            const s = r.stats; const bits = [];
            if (s.first) bits.push('初回の突き合わせをしました(同期前の控えあり)');
            if (s.added) bits.push(`他の端末から${s.added}件追加`);
            if (s.changed) bits.push(`${s.changed}件更新`);
            if (s.mfMerged) bits.push(`同じMF番号の重複${s.mfMerged}件をまとめました`);
            if (s.conflicts) bits.push(`食い違い${s.conflicts}項目は空欄でない方を採用`);
            const w = (r.warnings || []).map(x => WARN[x]).filter(Boolean);
            show(w.length ? '同期は未完了。' + w.join(' ') + ' ' + statusLine(r, account)
                : (edited ? '' : '同期済み。') + statusLine(r, account) + (bits.length ? ' — ' + bits.join('・') : ''), w.length || edited ? 'warn' : 'ok');
            if (s.writes) { refreshApp(); if (how && how.auto && (s.added || s.changed || s.deletedHere || s.mfMerged)) toast('他の端末の変更を反映しました'); }
        } else if (r.code !== 'busy') show('同期できませんでした: ' + (MSG[r.code] || MSG.unexpected) + ' ' + statusLine(r, account), 'error');
        return r;
    }
    async function onButton() {
        if (starting || busyElsewhere() || typeof DriveTransfer === 'undefined') return;
        if (enabled()) return syncNow();
        starting = true;
        btn.disabled = true;
        try {
            let state = driveState();
            if (!state?.connected) { await DriveTransfer.connect(); state = driveState(); }
            if (!state?.connected) return;
            const details = '接続先: ' + state.email + '\n\n訪問先・ルート・区間・月の一覧・地図で入力した経費・自宅住所とGmail取込の差出人設定を、Google Driveのアプリ専用領域で自動同期します。写真・添付付きの精算書下書き・APIキーは対象外です。\n\nこの接続で自動同期を始めますか？';
            if (!confirm(details)) { show(offText, 'warn'); return; }
            if (driveState()?.session !== state.session || !driveState()?.connected) throw new Error('接続先が変更されました。もう一度お試しください。');
            approvedSession = state.session;
            deferredLocal = false;
            poller?.reset();
            await syncNow();
            if (enabled()) kick();
        } catch (e) { show(String((e && e.message) || '接続できませんでした。').slice(0, 120), 'error'); }
        finally { starting = false; btn.disabled = false; }
    }
    function schedule() {
        if (!enabled()) return;
        clearTimeout(debounce);
        const session = approvedSession;
        debounce = setTimeout(() => { debounce = null; if (isAllowed(session)) syncNow(null, { auto: true }); }, 2000);
    }
    function tick() {
        if (!core) return;
        const c = enabled();
        if (!c && approvedSession !== null) {
            approvedSession = null;
            deferredLocal = false;
            clearTimeout(debounce); debounce = null; poller?.reset();
            show('接続が切れました。' + offText + ' ' + statusLine(null, scope()), 'warn');
        }
        if (deferredLocal && c && !isEditing()) { syncNow(null, { auto: true }); return; }
        if (c && poller && poller.isDeferred() && !isEditing()) { poller.check(); }
        const fp = core.fingerprint();
        if (fp === lastFp) return;
        lastFp = fp;
        const cp = core.checkpoint();   // 通信なしで「いつ変えたか」を記録
        if (cp && cp.code === 'mass_delete' && !c) show(`訪問先が${cp.count}件まとめて消えています。次に同期するときに確認します。`, 'warn');
        else if (cp?.code !== 'busy') show(statusLine(null, scope()) + (c ? '' : '。' + offText), c ? 'warn' : '');
        if (c) schedule();
    }
    let poller = null, loopTimer = null;
    async function loop() {
        clearTimeout(loopTimer);
        try {
            await poller.check();
            // メールBOXを開いている間は、メールの台帳も同じ間隔で取り込む
            if (document.visibilityState === 'visible' && typeof MailBoxUI !== 'undefined' && MailBoxUI.isOpen && MailBoxUI.isOpen() && !MailBoxUI.isSyncing() && !isEditing()) {
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
        document.body.insertBefore(bar, document.body.firstChild);
        const prev = document.getElementById('fullBackupPrevious');
        if (prev && typeof BackupStore !== 'undefined' && BackupStore.beforeSync) {
            const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'btn btn-secondary'; b2.id = 'beforeSyncDownload'; b2.textContent = '初回の自動同期の前の記録を書き出す'; b2.onclick = downloadBeforeSync;
            prev.insertAdjacentElement('afterend', b2);
        }
        show(offText + ' ' + statusLine(null, scope()), '');
        lastFp = core.fingerprint();
        setInterval(tick, 3000);
        poller = createPoller({ core, isVisible: () => document.visibilityState === 'visible', isConnected: enabled, isEditing, isBusy: busyElsewhere, needsRetry: () => { const s = core.status(scope()); return s.localState === 'pending' || !!s.warnings?.length || s.ok === false; }, runSync: () => syncNow(null, { auto: true }) });
        loop();
        document.addEventListener('focusout', () => setTimeout(() => { if (!isEditing()) { if (deferredLocal) syncNow(null, { auto: true }); else if (poller.isDeferred()) poller.check(); } }, 300));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') { if (enabled()) syncNow(null, { auto: true }); kick(); }
            else { try { core.checkpoint(); } catch (e) { /* 次で */ } }
        });
        if (typeof DriveTransfer !== 'undefined' && AppStorage.getItem('culo_google_calendar_client_id')) DriveTransfer.prepare().catch(() => {});
    }
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    return { createPoller, syncNow, afterRestore, _isEditing: () => isEditing(), _toast: t => toast(t), _refresh: () => refreshApp(), status: () => core ? core.status() : null, _core: () => core };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DataSyncUI;
