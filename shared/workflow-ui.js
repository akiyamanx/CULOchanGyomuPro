// Presentation and navigation only. Existing storage/calculation modules own data.
const WorkflowUI = (() => {
    let fieldNumber = 0;
    let activeDialog = null;
    let returnFocus = null;

    function openRouteImport() {
        AppCore.switchTab('expense');
        const section = document.getElementById('routeImport');
        section.open = true;
        section.scrollIntoView({ block: 'start' });
        section.querySelector('summary').focus({ preventScroll: true });
    }

    function openParking() {
        AppCore.switchTab('expense');
        const section = document.getElementById('parkingSection');
        section.open = true;
        section.scrollIntoView({ block: 'start' });
        section.querySelector('summary').focus({ preventScroll: true });
    }

    function labelControls() {
        document.querySelectorAll('.main-content input, .main-content select, .main-content textarea, .modal-overlay input, .modal-overlay select, .modal-overlay textarea').forEach(input => {
            if (input.type === 'hidden' || input.closest('label') || input.getAttribute('aria-label')) return;
            const group = input.closest('.exp-fg, .parking-fg, .modal-row, .setting-group');
            const label = group && group.querySelector('label');
            if (label) {
                if (!input.id) input.id = 'workflow-field-' + (++fieldNumber);
                if (!label.htmlFor) label.htmlFor = input.id;
            }
        });
        const names = { '.parking-pick-btn': '登録した訪問先から選ぶ', '.parking-match-btn': '訪問先の候補を探す', '.parking-del-btn': 'この駐車場記録を削除', '.exp-draft-del': 'この下書きを削除', '.parking-rotate-btn': 'レシート画像を回転' };
        Object.entries(names).forEach(([selector, name]) => {
            document.querySelectorAll(selector).forEach(button => button.setAttribute('aria-label', name));
        });
        document.querySelectorAll('.route-header[onclick], .route-stop[onclick], .ws-menu-item[onclick], .exp-draft-info[onclick]').forEach(el => {
            if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(el.tagName)) return;
            // Preserve existing custom controls while exposing their action to keyboards.
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
        });
    }

    function syncDialog() {
        const dialog = Array.from(document.querySelectorAll('.modal-overlay:not(.loading-overlay)'))
            .find(el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
        if (dialog === activeDialog) return;
        if (dialog) {
            if (!activeDialog) returnFocus = document.activeElement;
            activeDialog = dialog;
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            const heading = dialog.querySelector('h2, .modal-title');
            if (heading) dialog.setAttribute('aria-label', heading.textContent.trim());
            const first = dialog.querySelector('input:not([type="hidden"]), select, textarea, button');
            if (first) first.focus();
        } else {
            activeDialog = null;
            if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
            returnFocus = null;
        }
    }

    function onKeydown(event) {
        if (activeDialog && event.key === 'Tab') {
            const items = Array.from(activeDialog.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]'))
                .filter(el => !el.disabled && el.getClientRects().length);
            const first = items[0], last = items[items.length - 1];
            if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        if (activeDialog && event.key === 'Escape') {
            const close = activeDialog.querySelector('.modal-cancel, .modal-header .btn-clear');
            if (close) { event.preventDefault(); close.click(); }
        }
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][onclick]') && event.target.tagName !== 'BUTTON') {
            event.preventDefault(); event.target.click();
        }
    }

    function init() {
        MapCore.updateCustomerList();
        RouteManager.updateRoutePanel();
        MapExpenseForm.init();
        labelControls();
        document.addEventListener('keydown', onKeydown);
        document.addEventListener('app:tabchange', event => {
            if (event.detail === 'expense') MapExpenseForm.init();
            const heading = document.querySelector('#tab-' + event.detail + ' h2');
            if (heading) heading.focus({ preventScroll: true });
            window.scrollTo({ top: 0, behavior: 'instant' });
        });
        document.getElementById('customerList').addEventListener('click', event => {
            const button = event.target.closest('[data-customer-id]');
            if (button) MapCore.focusMarker(button.dataset.customerId);
        });
        new MutationObserver(() => { labelControls(); syncDialog(); })
            .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    return { init, openRouteImport, openParking };
})();
