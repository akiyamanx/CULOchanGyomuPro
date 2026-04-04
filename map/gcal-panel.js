// [CULOchanGyomuPro統合] v1.1 2026-04-04 - Phase H: 左スワイプでGCalアプリ起動
// ============================================
// このファイルはマップタブの左スワイプで
// Googleカレンダーアプリを直接起動する機能
// iframeの埋め込み方式は権限問題が発生するため、
// アプリ直接起動方式に変更（v1.1）
// ============================================

const GcalPanel = (() => {
    // v1.0 スワイプ検出の閾値
    const SWIPE_THRESHOLD = 60; // px: この距離以上で発動
    const SWIPE_MAX_Y = 80;     // px: Y方向がこれ以下なら水平スワイプ
    let _startX = 0;
    let _startY = 0;
    let _tracking = false;

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
            // v1.1変更: アプリ直接起動
            openGoogleCalendar();
        }
    }

    // v1.0 タッチ終了
    function _onTouchEnd() {
        _tracking = false;
    }

    // v1.1 Googleカレンダーアプリを直接起動（パネル不要）
    function openGoogleCalendar() {
        window.open('https://calendar.google.com', '_blank', 'noopener');
    }

    // v1.1 互換性維持（未使用だが安全のため残す）
    function initPanelSwipe() { }
    function closePanel() { }
    function reloadCalendar() { }
    function isOpen() { return false; }

    return {
        init: init,
        initPanelSwipe: initPanelSwipe,
        openGoogleCalendar: openGoogleCalendar,
        closePanel: closePanel,
        reloadCalendar: reloadCalendar,
        isOpen: isOpen
    };
})();
