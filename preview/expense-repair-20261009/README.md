# 修正確認用画面

Source: repair commit 32cb2b453401ba23058bb17aac1790178097889c.

2026-10-14: 訪問・ルート → レシート → 精算・PDFの画面整理。
index.html が入口。tests/layout-review.htmlで画面幅の確認、tests/expense-tests.htmlで既存の経費検証。
保存キーには culo_preview_expense_20261009: を付け、駐車場IDBも別名。SW・PWAインストールは無効。
確認用の保存データは本番へ自動反映されません。APIキーも本番から引き継ぎません。
