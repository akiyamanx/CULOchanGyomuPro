// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// メンテナンスマップ v2.5 - data-storage.js
// LocalStorage保存・読込・バックアップ・設定管理
// v2.4 - 全ワークスペース一括バックアップ対応
// v2.5 - 顧客データにpurpose(目的)フィールド追加
const DataStorage = (() => {
    // v2.3 - ワークスペース管理キー（共通・月に依存しない）
    const WS_KEYS = {
        workspaces: 'mm_workspaces',
        currentWs: 'mm_workspace_current',
        settings: 'mm_settings',
        geocache: 'mm_geocache'
    };

    // v2.3 - ワークスペース依存キーのベース名
    const WS_DATA_KEYS = ['customers', 'routes', 'segments', 'expenses'];

    // 日程未定の訪問先の置き場(予約済みワークスペース)。保存・バックアップ・一覧は月と同じ仕組みを使う。
    // バックアップ許可リスト(shared/backup-format.js)は mm_*_<英数字とハイフン> を通すため変更不要。
    const UNSCHEDULED_ID = 'unscheduled';
    const UNSCHEDULED_NAME = '日程未定';
    const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
    const isMonthWorkspaceId = id => typeof id === 'string' && MONTH_ID.test(id);
    const isReservedWorkspaceId = id => id === UNSCHEDULED_ID;

    // v2.3 - 現在のワークスペースIDを取得
    function getCurrentWorkspaceId() {
        return AppStorage.getItem(WS_KEYS.currentWs) || null;
    }

    // v2.3 - ワークスペースIDからキーを生成（例: mm_customers_2026-02）
    function wsKey(baseName) {
        const wsId = getCurrentWorkspaceId();
        if (!wsId) return 'mm_' + baseName;
        return 'mm_' + baseName + '_' + wsId;
    }

    // v2.3 - 動的KEYSゲッター（現在のワークスペースに応じたキーを返す）
    function getKeys() {
        return {
            customers: wsKey('customers'),
            routes: wsKey('routes'),
            segments: wsKey('segments'),
            expenses: wsKey('expenses'),
            geocache: WS_KEYS.geocache,
            settings: WS_KEYS.settings
        };
    }

    // v2.3 - ワークスペース一覧を取得
    function getWorkspaces() {
        try {
            const data = AppStorage.getItem(WS_KEYS.workspaces);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('ワークスペース読込エラー:', e);
            return [];
        }
    }

    // v2.3 - ワークスペース一覧を保存
    function saveWorkspaces(workspaces) {
        AppStorage.setItem(WS_KEYS.workspaces, JSON.stringify(workspaces));
    }

    // v2.3 - 新しいワークスペースを作成
    function createWorkspace(yearMonth, name) {
        if (!isMonthWorkspaceId(yearMonth) && !isReservedWorkspaceId(yearMonth)) {
            console.warn('ワークスペースIDが正しくありません:', yearMonth);
            return null;
        }
        const workspaces = getWorkspaces();
        if (workspaces.find(ws => ws.id === yearMonth)) {
            console.warn('ワークスペース既に存在:', yearMonth);
            return null;
        }
        const ws = {
            id: yearMonth,
            name: name || (isReservedWorkspaceId(yearMonth) ? UNSCHEDULED_NAME : yearMonth).replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}年${parseInt(m)}月`),
            createdAt: new Date().toISOString()
        };
        workspaces.push(ws);
        workspaces.sort((a, b) => a.id.localeCompare(b.id));
        saveWorkspaces(workspaces);

        const routeKey = 'mm_routes_' + yearMonth;
        if (!AppStorage.getItem(routeKey)) {
            AppStorage.setItem(routeKey, JSON.stringify([...DEFAULT_ROUTES]));
        }
        return ws;
    }

    // v2.3 - ワークスペースを切り替え
    function switchWorkspace(wsId) {
        const workspaces = getWorkspaces();
        if (!workspaces.find(ws => ws.id === wsId)) {
            console.error('ワークスペースが見つかりません:', wsId);
            return false;
        }
        AppStorage.setItem(WS_KEYS.currentWs, wsId);
        return true;
    }

    // v2.3 - ワークスペースを削除（データも削除）
    function deleteWorkspace(wsId) {
        // 日程未定の置き場は誤操作で消さない(中の訪問先は月へ移して使う)。
        if (isReservedWorkspaceId(wsId)) return false;
        let workspaces = getWorkspaces();
        workspaces = workspaces.filter(ws => ws.id !== wsId);
        saveWorkspaces(workspaces);
        WS_DATA_KEYS.forEach(key => {
            AppStorage.removeItem('mm_' + key + '_' + wsId);
        });
        if (getCurrentWorkspaceId() === wsId) {
            if (workspaces.length > 0) {
                AppStorage.setItem(WS_KEYS.currentWs, workspaces[0].id);
            } else {
                AppStorage.removeItem(WS_KEYS.currentWs);
            }
        }
        return true;
    }

    // v2.3 - ワークスペース名を変更
    function renameWorkspace(wsId, newName) {
        const workspaces = getWorkspaces();
        const ws = workspaces.find(w => w.id === wsId);
        if (ws) {
            ws.name = newName;
            saveWorkspaces(workspaces);
        }
    }

    // v2.3 - 初回マイグレーション（旧キー→ワークスペース形式に変換）
    function migrateIfNeeded() {
        if (getWorkspaces().length > 0) return;

        const oldCustomers = AppStorage.getItem('mm_customers');
        const oldRoutes = AppStorage.getItem('mm_routes');
        if (!oldCustomers && !oldRoutes) {
            const now = new Date();
            const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
            createWorkspace(currentMonth);
            AppStorage.setItem(WS_KEYS.currentWs, currentMonth);
            return;
        }

        const now = new Date();
        const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        createWorkspace(currentMonth);
        AppStorage.setItem(WS_KEYS.currentWs, currentMonth);

        const migrations = [
            { old: 'mm_customers', new: 'mm_customers_' + currentMonth },
            { old: 'mm_routes', new: 'mm_routes_' + currentMonth },
            { old: 'mm_segments', new: 'mm_segments_' + currentMonth },
            { old: 'mm_expenses', new: 'mm_expenses_' + currentMonth }
        ];

        migrations.forEach(m => {
            const data = AppStorage.getItem(m.old);
            if (data) {
                AppStorage.setItem(m.new, data);
                AppStorage.removeItem(m.old);
            }
        });
    }

    // --- 顧客データ ---

    function getCustomers() {
        try {
            const data = AppStorage.getItem(getKeys().customers);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('顧客データ読込エラー:', e);
            return [];
        }
    }

    function saveCustomers(customers) {
        try {
            AppStorage.setItem(getKeys().customers, JSON.stringify(customers));
            return true;
        } catch (e) {
            console.error('顧客データ保存エラー:', e);
            alert('データの保存に失敗しました。ストレージ容量を確認してください。');
            return false;
        }
    }

    // Import review can inspect a destination month without switching the open workspace.
    // Invalid stored data must not be treated as an empty list and overwritten.
    function getCustomersForWorkspace(wsId) {
        const raw = AppStorage.getItem('mm_customers_' + wsId);
        const customers = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(customers)) throw new Error('保存済みの訪問先データを読み込めません。');
        return customers;
    }

    function saveCustomersForWorkspace(wsId, customers) {
        AppStorage.setItem('mm_customers_' + wsId, JSON.stringify(customers));
    }

    // --- 日程未定の置き場 ---

    // 無ければ作る。あれば何も書かない。現在のワークスペースは変えない。
    function ensureUnscheduledWorkspace() {
        const existing = getWorkspaces().find(ws => ws.id === UNSCHEDULED_ID);
        return existing || createWorkspace(UNSCHEDULED_ID, UNSCHEDULED_NAME);
    }

    // 画面表示用の名前。月は「N月」「YYYY年」、日程未定は固定名。
    function workspaceLabel(ws) {
        const id = String(ws && ws.id);
        const match = id.match(/^(\d{4})-(\d{2})$/);
        if (match) return { isMonth: true, short: parseInt(match[2], 10) + '月', year: match[1] + '年', month: parseInt(match[2], 10) + '月' };
        if (isReservedWorkspaceId(id)) return { isMonth: false, short: UNSCHEDULED_NAME, year: '', month: UNSCHEDULED_NAME };
        return { isMonth: false, short: (ws && ws.name) || id, year: '', month: id };
    }

    const normText = value => String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    // 移動前後で「同じ依頼」かを見る既定の判定。日付は片方が未定なら一致扱い(同じ依頼が先に月へ入っている場合を拾うため)。
    function sameVisit(a, b) {
        if (a.mailKey && b.mailKey && a.mailKey === b.mailKey) return true;
        if (a.managementNo && b.managementNo && normText(a.managementNo) !== normText(b.managementNo)) return false;
        if (a.equipType && b.equipType && normText(a.equipType) !== normText(b.equipType)) return false;
        if (!normText(a.company) || !normText(a.address)) return false;
        return normText(a.company) === normText(b.company) && normText(a.address) === normText(b.address)
            && normText(a.purpose) === normText(b.purpose)
            && (!a.appoDate || !b.appoDate || String(a.appoDate).slice(0, 10) === String(b.appoDate).slice(0, 10));
    }
    function validWorkDate(value, monthId) {
        const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/);
        if (!match) return false;
        const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
        if (d.getUTCFullYear() !== +match[1] || d.getUTCMonth() !== +match[2] - 1 || d.getUTCDate() !== +match[3]) return false;
        return match[1] + '-' + match[2] === monthId;
    }

    // 訪問先を別のワークスペースへ移す(日程未定→作業日の月 など)。
    // 手順: 読む(壊れていれば何も書かない) → 重複確認 → 移動先へ書く → 元から消す。
    // 元の削除に失敗したら移動先を元に戻す。戻せなくても元の訪問先は残す(二重登録の可能性は結果で知らせる)。
    function moveCustomerToWorkspace(options) {
        const { id, from, to, force, isDuplicate, updates } = options || {};
        const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra);
        const validId = x => isMonthWorkspaceId(x) || isReservedWorkspaceId(x);
        if (!validId(to)) return fail('invalid_destination');
        if (!validId(from)) return fail('invalid_source');
        if (from === to) return fail('same_workspace');
        const appoDate = options.appoDate === undefined ? (updates && updates.appoDate) : options.appoDate;
        if (isMonthWorkspaceId(to) ? !validWorkDate(appoDate, to) : Boolean(appoDate)) return fail('invalid_date');

        let sourceList, destList;
        try {
            sourceList = getCustomersForWorkspace(from);
            destList = getCustomersForWorkspace(to);
        } catch (e) { return fail('read_failed'); }
        const original = sourceList.find(c => c && c.id === id);
        if (!original) return fail('not_found');
        if (destList.some(c => c && c.id === id)) return fail('id_conflict');

        const moved = Object.assign({}, original, updates || {}, { id: original.id, appoDate: appoDate || '', routeId: null });
        // ルートの訪問順はワークスペースごとなので、移す時はルート指定を外す。
        if (!force) {
            const same = typeof isDuplicate === 'function' ? isDuplicate : sameVisit;
            const hit = destList.find(c => c && same(moved, c));
            if (hit) return fail('duplicate', { duplicateOf: hit.id });
        }

        const destKey = 'mm_customers_' + to, wsRaw = AppStorage.getItem(WS_KEYS.workspaces), routeKey = 'mm_routes_' + to;
        const prevDest = AppStorage.getItem(destKey), prevRoutes = AppStorage.getItem(routeKey);
        const createdWorkspace = !getWorkspaces().some(ws => ws.id === to);
        const undoDestination = () => {
            try {
                if (prevDest === null) AppStorage.removeItem(destKey); else AppStorage.setItem(destKey, prevDest);
                if (createdWorkspace) {
                    if (wsRaw === null) AppStorage.removeItem(WS_KEYS.workspaces); else AppStorage.setItem(WS_KEYS.workspaces, wsRaw);
                    if (prevRoutes === null) AppStorage.removeItem(routeKey);
                }
                return true;
            } catch (e) { return false; }
        };
        try {
            if (createdWorkspace && !createWorkspace(to)) throw new Error('workspace');
            const written = JSON.stringify([...destList, moved]);
            saveCustomersForWorkspace(to, [...destList, moved]);
            if (AppStorage.getItem(destKey) !== written) throw new Error('verify');
        } catch (e) {
            undoDestination();
            return fail('destination_write_failed');
        }
        try {
            saveCustomersForWorkspace(from, sourceList.filter(c => !(c && c.id === id)));
        } catch (e) {
            const rolledBack = undoDestination();
            return fail('source_write_failed', { rolledBack, maybeDuplicated: !rolledBack });
        }
        return { ok: true, id, from, to };
    }

    function addCustomer(customer) {
        const customers = getCustomers();
        customer.id = customer.id || 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        customer.status = customer.status || 'pending';
        customer.routeId = customer.routeId || null;
        customer.appoDate = customer.appoDate || null;
        customer.purpose = customer.purpose || '';
        customer.createdAt = new Date().toISOString();
        customers.push(customer);
        saveCustomers(customers);
        return customer;
    }

    // v2.0 - 顧客更新
    function updateCustomer(id, updates) {
        const customers = getCustomers();
        const idx = customers.findIndex(c => c.id === id);
        if (idx !== -1) {
            customers[idx] = { ...customers[idx], ...updates };
            if (!saveCustomers(customers)) return null;
            return customers[idx];
        }
        return null;
    }

    // v2.0 - 顧客削除
    function deleteCustomer(id) {
        let customers = getCustomers();
        customers = customers.filter(c => c.id !== id);
        saveCustomers(customers);
    }

    // --- ルートデータ ---

    const DEFAULT_ROUTES = [
        { id: 'route_1', name: 'ルート1', color: '#4285f4', order: [] },
        { id: 'route_2', name: 'ルート2', color: '#283593', order: [] },
        { id: 'route_3', name: 'ルート3', color: '#34a853', order: [] },
        { id: 'route_4', name: 'ルート4', color: '#ff9800', order: [] },
        { id: 'route_5', name: 'ルート5', color: '#9c27b0', order: [] },
        { id: 'route_6', name: 'ルート6', color: '#00bcd4', order: [] },
        { id: 'route_7', name: 'ルート7', color: '#00796b', order: [] },
        { id: 'route_8', name: 'ルート8', color: '#795548', order: [] },
        { id: 'route_9', name: 'ルート9', color: '#607d8b', order: [] },
        { id: 'route_10', name: 'ルート10', color: '#8a9400', order: [] }
    ];

    // 赤系の旧初期色だけ置換する。月別データやバックアップにも読込時に適用し、
    // 訪問順・距離などの保存内容と、利用者が個別に変更した色は保持する。
    const LEGACY_ROUTE_COLORS = {
        route_2: '#ea4335', route_7: '#e91e63', route_10: '#ff5722'
    };

    function getRoutes(workspaceId) {
        try {
            const data = AppStorage.getItem(workspaceId ? 'mm_routes_' + workspaceId : getKeys().routes);
            const routes = data ? JSON.parse(data) : DEFAULT_ROUTES;
            return routes.map(route => {
                const oldColor = LEGACY_ROUTE_COLORS[route.id];
                return oldColor && String(route.color).toLowerCase() === oldColor
                    ? { ...route, color: DEFAULT_ROUTES.find(item => item.id === route.id).color }
                    : route;
            });
        } catch (e) {
            return [...DEFAULT_ROUTES];
        }
    }

    function saveRoutes(routes) {
        AppStorage.setItem(getKeys().routes, JSON.stringify(routes));
    }

    // --- 区間データ（高速/下道） ---

    function getSegments(workspaceId) {
        try {
            const data = AppStorage.getItem(workspaceId ? 'mm_segments_' + workspaceId : getKeys().segments);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    }

    function saveSegments(segments) {
        AppStorage.setItem(getKeys().segments, JSON.stringify(segments));
    }

    // --- ジオコーディングキャッシュ ---

    function getGeoCache() {
        try {
            const data = AppStorage.getItem(WS_KEYS.geocache);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    }

    function setGeoCache(address, latLng) {
        const cache = getGeoCache();
        cache[address] = latLng;
        AppStorage.setItem(WS_KEYS.geocache, JSON.stringify(cache));
    }

    // --- 設定 ---

    function getSettings() {
        try {
            const data = AppStorage.getItem(WS_KEYS.settings);
            return data ? JSON.parse(data) : { homeAddress: '', apiKey: '' };
        } catch (e) {
            return { homeAddress: '', apiKey: '' };
        }
    }

    function saveSettings(settings) {
        AppStorage.setItem(WS_KEYS.settings, JSON.stringify(settings));
    }

    // --- 精算書データ ---

    function getExpenses() {
        try {
            const data = AppStorage.getItem(getKeys().expenses);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('精算書データ読込エラー:', e);
            return [];
        }
    }

    function saveExpenses(expenses) {
        try {
            AppStorage.setItem(getKeys().expenses, JSON.stringify(expenses));
            return true;
        } catch (e) {
            console.error('精算書データ保存エラー:', e);
            alert('精算書の保存に失敗しました。ストレージ容量を確認してください。');
            return false;
        }
    }

    function addExpense(expense) {
        const expenses = getExpenses();
        expense.id = expense.id || 'exp_' + Date.now();
        expense.createdAt = new Date().toISOString();
        expenses.unshift(expense);
        if (expenses.length > 20) expenses.splice(20);
        saveExpenses(expenses);
        return expense;
    }

    function deleteExpense(id) {
        let expenses = getExpenses();
        expenses = expenses.filter(e => e.id !== id);
        saveExpenses(expenses);
    }

    // --- バックアップ ---

    function exportBackup() {
        var workspaces = getWorkspaces();
        var currentWsId = getCurrentWorkspaceId();

        var allWorkspaceData = [];
        workspaces.forEach(function(ws) {
            var prefix = 'mm_';
            var suffix = '_' + ws.id;
            allWorkspaceData.push({
                id: ws.id,
                name: ws.name,
                customers: JSON.parse(AppStorage.getItem(prefix + 'customers' + suffix) || '[]'),
                routes: JSON.parse(AppStorage.getItem(prefix + 'routes' + suffix) || '[]'),
                segments: JSON.parse(AppStorage.getItem(prefix + 'segments' + suffix) || '[]'),
                expenses: JSON.parse(AppStorage.getItem(prefix + 'expenses' + suffix) || '[]')
            });
        });

        var data = {
            version: '2.4',
            exportDate: new Date().toISOString(),
            currentWorkspaceId: currentWsId,
            workspaces: workspaces,
            allWorkspaceData: allWorkspaceData,
            settings: getSettings()
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'maintenance_map_all_' + new Date().toISOString().slice(0,10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        var wsNames = workspaces.map(function(ws) { return ws.name || ws.id; }).join(', ');
        alert('💾 全ワークスペースを保存しました！\n📅 ' + wsNames + '\n（' + workspaces.length + '件）');
    }

    function importBackup(event) {
        var file = event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var data = JSON.parse(e.target.result);

                if (data.version === '1.0' && data.data) {
                    var converted = convertV1toV2(data);
                    saveCustomers(converted.customers);
                    converted.customers.forEach(function(c) {
                        if (c.lat && c.lng && c.address) {
                            setGeoCache(c.address, { lat: c.lat, lng: c.lng });
                        }
                    });
                    alert('📂 v1.0バックアップを変換して復元しました！\n' + converted.customers.length + '件のデータを読み込みました。\nページをリロードします。');
                    location.reload();
                    return;
                }

                if (data.version === '2.4' && data.allWorkspaceData) {
                    if (data.workspaces) {
                        saveWorkspaces(data.workspaces);
                    }
                    data.allWorkspaceData.forEach(function(wsData) {
                        var prefix = 'mm_';
                        var suffix = '_' + wsData.id;
                        AppStorage.setItem(prefix + 'customers' + suffix, JSON.stringify(wsData.customers || []));
                        AppStorage.setItem(prefix + 'routes' + suffix, JSON.stringify(wsData.routes || []));
                        AppStorage.setItem(prefix + 'segments' + suffix, JSON.stringify(wsData.segments || []));
                        AppStorage.setItem(prefix + 'expenses' + suffix, JSON.stringify(wsData.expenses || []));
                    });
                    if (data.settings) {
                        var current = getSettings();
                        data.settings.apiKey = current.apiKey;
                        saveSettings(data.settings);
                    }
                    if (data.currentWorkspaceId) {
                        AppStorage.setItem(WS_KEYS.currentWs, data.currentWorkspaceId);
                    }
                    var wsCount = data.allWorkspaceData.length;
                    alert('📂 全ワークスペースを復元しました！\n📅 ' + wsCount + '件のワークスペース\nページをリロードします。');
                    location.reload();
                    return;
                }

                if (data.customers) saveCustomers(data.customers);
                if (data.routes) saveRoutes(data.routes);
                if (data.segments) saveSegments(data.segments);
                if (data.expenses) saveExpenses(data.expenses);
                if (data.settings) {
                    var currentSettings = getSettings();
                    data.settings.apiKey = currentSettings.apiKey;
                    saveSettings(data.settings);
                }
                var wsName = data.workspaceName || '';
                alert('📂 バックアップを復元しました！' + (wsName ? '\n📅 ' + wsName : '') + '\nページをリロードします。');
                location.reload();
            } catch (err) {
                alert('❌ バックアップファイルの読み込みに失敗しました。');
                console.error('バックアップ復元エラー:', err);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    function updateRouteOrder(routeId, orderArray) {
        const routes = getRoutes();
        const route = routes.find(r => r.id === routeId);
        if (route) {
            route.order = orderArray;
            saveRoutes(routes);
        }
    }

    function resetAll() {
        const KEYS = getKeys();
        AppStorage.removeItem(KEYS.customers);
        AppStorage.removeItem(KEYS.routes);
        AppStorage.removeItem(KEYS.segments);
        AppStorage.removeItem(KEYS.expenses);
    }

    return {
        getWorkspaces, createWorkspace, switchWorkspace, deleteWorkspace,
        renameWorkspace, getCurrentWorkspaceId, migrateIfNeeded,
        UNSCHEDULED_ID, UNSCHEDULED_NAME, isMonthWorkspaceId, isReservedWorkspaceId,
        ensureUnscheduledWorkspace, workspaceLabel, moveCustomerToWorkspace,
        getCustomers, saveCustomers, getCustomersForWorkspace, saveCustomersForWorkspace,
        addCustomer, updateCustomer, deleteCustomer,
        getRoutes, saveRoutes, DEFAULT_ROUTES, updateRouteOrder,
        getSegments, saveSegments,
        getGeoCache, setGeoCache,
        getSettings, saveSettings,
        getExpenses, saveExpenses, addExpense, deleteExpense,
        exportBackup, importBackup, resetAll
    };
})();
