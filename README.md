# CULOchan業務Pro

交通費精算×レシートスキャナー×メンテナンスマップ統合アプリ(ビルド不要の静的PWA)。

## 2026-10-28 本番統合

お試し版(`preview/expense-repair-20261009/`)の内容を本番ルートへ統合した。

- 保存データは旧本番と同じ場所を使う: localStorage の `mm_*` / `gyomupro_*` / `reform_app_settings` / `travelExpenseDrafts`、駐車場IndexedDB `CULOchanGyomuPro`(v1・スキーマ同一)。
- 写真付き下書き・ETC証憑・バックアップ復旧用のIndexedDBは新規(`CULOchanExpenseDrafts` / `CULOchanEtcEvidence` / `CULOchanTransfers`)。
- 旧形式(v2.4)の「訪問先バックアップ」は従来どおり「以前の訪問先バックアップ」から読み込める。
- Service Worker(`sw.js`)は Google 認証付き通信と GET 以外をキャッシュしない。お試し版(`/preview/`)には触れない。
- 旧本番は `main` の統合前のコミットにそのまま残っている(戻す場合はそこへ)。

## テスト

`node --test`(Node 20 以上)。ブラウザ確認用の検証ページは `tests/expense-tests.html`(メモリ上の保存領域のみ使い、実データには触れない)。

## 補足

`docs/` に設定画面の整理メモなど。お試し版は `preview/expense-repair-20261009/` に残してあり、保存領域は本番と分かれている。
