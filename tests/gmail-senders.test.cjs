// 差出人一覧の追加・削除・保存。データはすべて架空(甲野・乙川・example.invalid)。実在のアドレスは使わない。
const test = require('node:test');
const assert = require('node:assert/strict');
const GmailSenders = require('../map/gmail-senders.js');
const BackupFormat = require('../shared/backup-format.js');

function mem(init = {}) {
    const s = new Map(Object.entries(init));
    return {
        getItem: k => (s.has(k) ? s.get(k) : null),
        setItem: (k, v) => { s.set(k, String(v)); },
        raw: s
    };
}

test('以前の差出人キーから読み、追加しても上書きせず一覧に残す', () => {
    const S = mem({ culo_mail_gmail_senders: '甲野' });
    assert.deepEqual(GmailSenders.read(S), ['甲野']);
    const added = GmailSenders.add(GmailSenders.read(S), '乙川');
    assert.equal(added.ok, true);
    GmailSenders.write(S, added.terms);
    assert.deepEqual(GmailSenders.read(S), ['甲野', '乙川']);
    const settings = JSON.parse(S.getItem('mm_settings'));
    assert.deepEqual(settings.gmailSenders, ['甲野', '乙川']);
    assert.equal(S.getItem('culo_mail_gmail_senders'), '甲野,乙川');
});

test('設定側の一覧を優先し、同じ人は重複させない。外すと残らない', () => {
    const S = mem({
        mm_settings: JSON.stringify({ homeAddress: '架空県甲野市1', gmailSenders: ['甲野', '乙川'] }),
        culo_mail_gmail_senders: '古い名前'
    });
    assert.deepEqual(GmailSenders.read(S), ['甲野', '乙川']);
    const again = GmailSenders.add(['甲野', '乙川'], '甲野');
    assert.equal(again.ok, true);
    assert.deepEqual(again.terms, ['甲野', '乙川']);
    assert.deepEqual(GmailSenders.remove(['甲野', '乙川'], '甲野'), ['乙川']);
});

test('使えない文字・11人目は断る。カンマ区切りの正規化', () => {
    assert.equal(GmailSenders.add([], '甲 野').ok, false);
    assert.equal(GmailSenders.add([], '甲野)').reason, 'bad_terms');
    const ten = Array.from({ length: 10 }, (_, i) => '名前' + i);
    const full = GmailSenders.add(ten, '乙川');
    assert.equal(full.ok, false);
    assert.equal(full.reason, 'too_many');
    assert.deepEqual(GmailSenders.normalize('甲野、乙川, otsukawa@example.invalid'), ['甲野', '乙川', 'otsukawa@example.invalid']);
});

test('バックアップの設定に差出人一覧を含めてもよく、APIキーは引き続き拒否', () => {
    const ok = {
        drafts: [], parking: [], etc: { records: [], days: {}, selectedDate: '' },
        local: { mm_settings: JSON.stringify({ homeAddress: '架空県甲野市1', gmailSenders: ['甲野', '乙川'] }) }
    };
    assert.doesNotThrow(() => BackupFormat.validate(ok));
    const old = { ...ok, local: { mm_settings: JSON.stringify({ homeAddress: '' }) } };
    assert.doesNotThrow(() => BackupFormat.validate(old));
    const keyed = { ...ok, local: { mm_settings: JSON.stringify({ homeAddress: '', apiKey: 'KEY-架空' }) } };
    assert.throws(() => BackupFormat.validate(keyed));
});
