// タブレット幅でメールBOXのタブが縮んで隠れた不具合の再発防止(縮むのは一覧だけ)
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs');
test('メールBOX: 見出し・お知らせ・タブは縮まない', () => {
    const css = fs.readFileSync(require.resolve('../styles/mail-box.css'), 'utf8');
    assert.match(css, /\.mailbox-sheet > :not\(\.mailbox-body\) \{ flex-shrink: 0; \}/);
    assert.match(css, /\.mailbox-body \{ min-height: 0; \}/);
});
