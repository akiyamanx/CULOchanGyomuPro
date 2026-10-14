# 修正確認用画面

Source: repair commit e5e433b10a61af46e48d269e461646124f0ee3e3.

2026-10-14: 訪問・ルート → レシート → 精算・PDFの画面整理。
index.html が入口。tests/layout-review.htmlで画面幅の確認、tests/expense-tests.htmlで既存の経費検証。
保存キーには culo_preview_expense_20261009: を付け、駐車場IDBも別名。SW・PWAインストールは無効。
確認用データは本番へ自動反映されません。APIキーも引き継ぎません。
Node14検証PASS。初回公開版でPC/320pxの主要操作と下書き復元を確認。ブラウザ操作基盤切断により微調整後の実画面と768/1024/1440pxの最終検証は未完了。
