// [CULOchanGyomuPro統合] v1.0 2026-04-04 - Phase H: GCalスワイプパネル
// ============================================
// このファイルはマップタブの左スワイプで
// Googleカレンダーを右からスライド表示する機能
// タッチスワイプ検出 + パネル開閉 + iframe管理
// ============================================

const GcalPanel = (() => {
    // v1.0 スワイプ検出の閾値
    const SWIPE_THRESHOLD = 60; // px: この距離以上で発動
    const SWIPE_MAX_Y = 80;     // px: Y方向がこれ以下なら水平スワイプ
    let _startX = 0;
    let _startY = 0;
    let _tracking = false;
    let _panelOpen = false;
    let _iframeLoaded = false;

    // v1.0 初期化
    function init() {
        var mapTab = document.getElementById('tab-map');
        if (!mapTab) return;

        // タッチイベント登録（マップタブ内のみ）
        mapTab.addEventListener('touchstart', _onTouchStart, { passive: true });
        mapTab.addEventListener('touchmove', _onTouchMove, { passive: false });
        mapTab.addEventListener('touchend', _onTouchEnd, { passive: true });
    }

    // v1.0 タッチ開始
    function _onTouchStart(e) {
        if (_panelOpen) return; // パネル表示中はマップ側のスワイプ無効
        var touch = e.touches[0];
        _startX = touch.clientX;
        _startY = touch.clientY;
        _tracking = true;
    }

    // v1.0 タッチ移動
    function _onTouchMove(e) {
        if (!_tracking) return;
        var touch = e.touches[0];
        var dx = touch.clientX - _startX;
        var dy = Math.abs(touch.clientY - _startY);
        // 左にスワイプ（dx < 0）かつ水平方向メイン
        if (dx < -SWIPE_THRESHOLD && dy < SWIPE_MAX_Y) {
            _tracking = false;
            openPanel();
        }
    }

    // v1.0 タッチ終了
    function _onTouchEnd() {
        _tracking = false;
    }

    // v1.0 パネルを開く
    function openPanel() {
        var panel = document.getElementById('gcalSlidePanel');
        if (!panel) return;
        _panelOpen = true;
        panel.classList.add('open');
        _loadCalendarIfNeeded();
    }

    // v1.0 パネルを閉じる
    function closePanel() {
        var panel = document.getElementById('gcalSlidePanel');
        if (!panel) return;
        _panelOpen = false;
        panel.classList.remove('open');
    }

    // v1.0 パネル内スワイプで閉じる（右スワイプ）
    function initPanelSwipe() {
        var panel = document.getElementById('gcalSlidePanel');
        if (!panel) return;
        var pStartX = 0;
        panel.addEventListener('touchstart', function(e) {
            pStartX = e.touches[0].clientX;
        }, { passive: true });
        panel.addEventListener('touchend', function(e) {
            var dx = e.changedTouches[0].clientX - pStartX;
            if (dx > SWIPE_THRESHOLD) {
                closePanel();
            }
        }, { passive: true });
    }

    // v1.0 iframe読み込み（初回のみ）
    function _loadCalendarIfNeeded() {
        if (_iframeLoaded) return;
        var iframe = document.getElementById('gcalIframe');
        var placeholder = document.getElementById('gcalPlaceholder');
        var calUrl = localStorage.getItem('gyomupro_gcal_embed_url') || '';

        if (!calUrl) {
            // URL未設定 → 設定誘導を表示
            if (iframe) iframe.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
            return;
        }

        // URL設定済み → iframe表示
        if (placeholder) placeholder.style.display = 'none';
        if (iframe) {
            iframe.src = calUrl;
            iframe.style.display = 'block';
            _iframeLoaded = true;
        }
    }

    // v1.0 カレンダーURLを再読み込み（設定変更時）
    function reloadCalendar() {
        _iframeLoaded = false;
        var iframe = document.getElementById('gcalIframe');
        if (iframe) {
            iframe.src = '';
            iframe.style.display = 'none';
        }
        _loadCalendarIfNeeded();
    }

    // v1.0 パネルが開いてるか
    function isOpen() {
        return _panelOpen;
    }

    return {
        init: init,
        initPanelSwipe: initPanelSwipe,
        openPanel: openPanel,
        closePanel: closePanel,
        reloadCalendar: reloadCalendar,
        isOpen: isOpen
    };
})();
