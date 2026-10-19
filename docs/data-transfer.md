# 写真入りバックアップと端末間共有

## 目的・合意済みの範囲
スマホ／Galaxy Androidタブレット／Surfaceで、保存した仕事の記録を引き継ぐ。利用者の依頼どおりバックアップ・復元を先に作り、これを共有の土台にする。

| モジュール | 役割 | 依存 |
| --- | --- | --- |
| backup-format | 保存データの形式・検証・整合性チェック | なし |
| backup-store | 保存先の読出し、復元前の退避、中断復旧 | backup-format |
| drive-transfer | 本人のGoogle Drive専用領域で版を保管 | backup-format |
| transfer-ui | 設定内のバックアップ・共有操作 | 上記3つ |

順序：形式 → 端末内復元 → 共有API → 設定画面 → 障害・端末間試験。

## 成功条件・境界
- 保存済みの全対象月、訪問先・ルート・区間・経費、会社住所、通常レシート写真、駐車場写真、下書きと添付写真、ETC証憑を1ファイルで書き出し、空の端末へ復元できる。
- 入力途中で保存していないフォーム、端末のダウンロードフォルダにあるPDF、APIキー・OAuth ID・トークン・Googleカレンダーの取得予定は転送しない。各端末の既存の接続設定を維持。
- 不正形式・改変・過大サイズ・危険なキー・外部画像URLは書込み前に拒否。上限64MiB。JSONとSHA-256は破損検知であり暗号化ではない。
- 復元前の全データをIndexedDBに退避し、途中失敗は戻す。クラッシュ後は初期化前に復旧。失敗した復旧を成功扱いせず、作業画面を止める。
- 新版を複数タブで開いている間は転送を止める。Web Locksと画面の操作停止で、転送中の変更を防ぐ。旧版を含む他のタブも閉じて操作する。
- 初版は明示的な送信／受信。接続だけでは業務データを送らず、受信前に日時・件数を表示して確認する。受信は端末全体の置換で、自動マージしない。
- 共有先は本人の同じGoogleアカウント・同じOAuthプロジェクトのDrive appDataFolder。公開GitHubへ業務記録を置かない。
- 共有版は新しいファイルとして追加し、過去版を上書き・自動削除しない。親版を記録し、並行送信は複数の先頭版として検知する。別端末の更新があれば通常の送信を停止。明示的な確認による版の選び直しでも過去版を残す。
- トークンはメモリのみ。Driveの切断はこの画面のセッションだけを終了し、カレンダーの許可を取り消さない。認可拒否・期限切れ・通信失敗では端末データを書き換えない。
- 現行プレビューの保存prefix・IndexedDB名・SW無効化を維持。本番とプレビューのクラウド履歴を分離。

## 実装・検証
既存の素のJavaScript、IndexedDB、Web Crypto、Web Locksを使用。追加の本番依存ライブラリは不要。保存先は既存3つのDBと、新しい復旧用DB。構文・スタイルは既存IIFEに合わせる。

```js
const backup = await BackupFormat.create(payload);
await BackupFormat.verify(backup); // 復元前に全体を検証
```

- `node --test tests/*.test.cjs`：形式、鍵の除外、壊れた入力、復旧、共有版の競合、API失敗を検証。
- `node tests/transfer-browser.cjs`：架空データのみで、実IndexedDBの写真入り往復、確認取消、別タブ、Google API模擬、スマホ・タブレット・PC表示を検証。
- 起動は`python -m http.server 8765 --bind 127.0.0.1`。ビルド不要。
- 本人のDriveへの初回接続、実機間転送は本人によるGoogle Drive APIの有効化と追加scopeの同意後に確認する。

## 検証結果
- Nodeの既存＋追加試験86件が成功。
- Chromiumの実IndexedDBで、写真入り全保存先の書出し・別プロファイルへの復元、確認取消、破損拒否、途中書込失敗からの巻戻し、再起動時復旧、別タブによる転送停止を確認。
- Google APIは架空応答を使用。2プロファイルで送受信、一覧ページ送り、古い版からの送信停止、同時送信の両版保持、403時の記録維持、トークンを永続保存しないことを確認。
- 320/390/768/1024/1440pxで設定画面の横はみ出しなし。既存のカレンダー設定往復・下書き保持も確認。
- 実Googleアカウント・Galaxy/Surface実機の確認は未実施。追加のAPI有効化・同意後の確認が必要。

## 公式仕様（2026-10-19確認）
- https://developers.google.com/workspace/drive/api/guides/appdata
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get
- https://developers.google.com/workspace/drive/api/guides/properties
