// 確認用画面専用。普段のアプリの保存キーにはアクセスしない。
const PreviewStorage = Object.freeze({
    getItem(key) { return window.localStorage.getItem('culo_preview_expense_20261009:' + key); },
    setItem(key, value) { window.localStorage.setItem('culo_preview_expense_20261009:' + key, value); },
    removeItem(key) { window.localStorage.removeItem('culo_preview_expense_20261009:' + key); }
});
