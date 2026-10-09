# 修正確認用画面

Source: repair commit 7e4277d0092aa7181d69268f3ae0dfeb6d7bfa45.

index.html と tests/expense-tests.html が入口。保存キーには culo_preview_expense_20261009: を付け、駐車場IDBも別名。SW・PWAインストールは無効。元の本番画面と保存データを共有しない。確認用に独立保存されるデータは本番へ自動反映されない。APIキーは本番から引き継がない。

公開物はアプリの静的コードのみ。実データやAPIキーは含めていない。
