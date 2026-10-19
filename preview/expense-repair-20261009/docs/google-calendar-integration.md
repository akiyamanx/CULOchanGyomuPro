# Googleの予定を確認しながら訪問日時を入力 — 2026-10-19

## 利用者の目的
地図の訪問先を選び、電話しながら既存のGoogleカレンダーの予定（時間・内容・場所）を見て、新しい訪問日時・備考を入力する。地図の拡大機能を維持する。

## 実装
- 訪問編集の予定欄には更新と「連携設定」の入口を表示。Google接続・アカウント変更・解除・複数カレンダーの選択・連携用IDは、設定の「Googleカレンダー」に集約。詳細は `settings-organization.md`。
- その日のGoogle予定を先に表示。アプリ保存分は出所を分けて表示。月のカレンダーは折りたたみ、前日／翌日でも日付を選べる。
- Google Identity ServicesのブラウザToken model。OAuthクライアントIDだけブラウザに保存。トークン・Googleの予定・選択カレンダーはメモリのみ。別アカウント接続・解除・期限切れ・pagehideで消去。
- Google Calendar APIへBearerヘッダー付きGETで直接通信。カレンダー一覧と予定の読み取り専用スコープ2つ。地図APIキー・クライアントシークレット・外部中継サーバーは使わない。
- 正常な全ページ取得後だけ `ready`。未接続・認可待ち・読み込み中・期限切れ・未選択・エラーを予定ゼロと分ける。日付変更・アカウント切替後の古い応答を無視する。
- 表示期間42日、繰り返しはAPI側で展開、キャンセル除外、終日終了日は排他的、跨日を表示。APIと表示のタイムゾーンは日本時間。複数カレンダーに同じ予定がある場合は出所を残して表示する。
- 訪問開始時刻が既存Google予定内なら注意表示。終日予定も対象。不参加・透明予定は表示しても衝突扱いしない。作業時間・移動時間・自動空き時間の保証は対象外。
- カレンダー一覧・予定のAPIページング上限を超える／一部失敗する場合は全体を未確認扱い。共有権限不足のカレンダーは選択不可、非公開イベントは「予定あり（詳細非公開）」表示。
- Service Workerは認証付き通信とGoogle認可／Calendar APIの通信をキャッシュしない。
- マップ上や編集入力中の左スワイプで、旧機能が別アプリを突然開かないよう除外。

## 境界
`GoogleCalendarData.createReader(fetcher)` の `calendars(token, signal)` と `events(calendars, firstDay, lastDay, token, signal)` は完全な配列を返すかthrowする。エラーにHTTP statusを付け、認証期限401を区別。リモートの題名・場所・カレンダー名はHTMLエスケープして表示する。

`GoogleVisitCalendar.init(onChange)` / `setRange(first,last)` / `refresh()` / `snapshot()` がUIとの境界。snapshotにトークンは含めない。保存済み訪問の編集・下書き・精算・PDFへGoogleデータを書き込まない。

## 初回設定と確認範囲
2026-10-19に利用者から、実Googleアカウントの接続後に予定が表示されたと報告があり、提供画面でも表示を確認。実データやクライアントIDは記録しない。今回のUI変更の自動ブラウザ検証は架空データで実施し、実アカウントでの再認可は行っていない。設定手順は `docs/google-calendar-setup.html`。

以下の「検証」は初回実装時点の記録。設定集約後の検証は `settings-organization.md` を参照。

## 検証
- Node 80件成功（新規12件）：日本時間・終日排他境界・跨日・非公開・不参加・キャンセル・ページング・403/401・部分取得失敗・認可拒否・部分許可・日付変更レース・解除後応答・期限切れ・XSS・Service Workerキャッシュ除外。
- `tests/google-calendar-review.html` は架空予定のブラウザ確認専用。Google接続／通信を模擬し、保存もページ内だけ。本物の接続成功の証拠ではない。
- `tests/google-calendar-layout.html` は確認専用ページを320/768/1024/1440pxで表示する。
- 2026-10-19 14:27 JSTの利用者了承後、確認用フォルダだけをmainへ反映。初回Pages run 39204769567成功。本番ルートの変更なしをコミット比較で確認。
- 実ブラウザ・架空予定：2カレンダーの時間順表示（時間／内容／場所）、終日予定、開始時刻の重複案内、前日／翌日・月カレンダー選択、備考の入力保持、ページ内の架空保存を確認。
- カレンダー個別選択／全解除、通信失敗、接続期限切れ、閲覧拒否、正常状態への再接続を確認。未確認を予定ゼロとして表示せず、古い予定も残さない。
- 320／768／1024／1440pxのiframeで、架空予定を表示した編集領域・予定欄のscrollWidthがclientWidthと一致。実アプリ本体も320／1024pxで横はみ出しなし、モーダルの高さが画面内に収まることを確認。
- 実アプリの拡大地図→一覧→訪問編集、新しいGoogle欄、未設定時の設定案内を確認。以前保存した日時・アポ状態・ルート・備考は維持。Google接続は未実施。
- 目視確認で接続後ボタンの折り返しを発見し、短い表記とボタン幅を修正。画面確認ログで見えたエラーはブラウザ拡張側のメタデータ送信で、アプリの例外は確認していない。実Google認可・実予定取得・実電話・実Mapsキーは未検証。

## 公式仕様
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/oauth2/web/reference/js-reference
- https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/quickstart/js
