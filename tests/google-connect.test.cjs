// 1回の許可操作で Gmail と Drive の両方の範囲を求める。偽のGISだけを使う。トークンは戻り値に出さない。
const test = require('node:test');
const assert = require('node:assert/strict');
const GoogleConnect = require('../shared/google-connect.js');
const GmailTransport = require('../map/gmail-transport.js');

const CLIENT_ID = '123456-abc.apps.googleusercontent.com';
const TOKEN = 'ya29.FAKE-TOKEN-FOR-TEST-COMBINED';
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const DRIVE = 'https://www.googleapis.com/auth/drive.appdata';

function env(opts = {}) {
    const store = new Map([['culo_google_calendar_client_id', CLIENT_ID]]);
    const tokenClients = [];
    const granted = opts.granted || { [GMAIL]: true, [DRIVE]: true };
    const fakeGoogle = {
        accounts: {
            oauth2: {
                initTokenClient: c => { tokenClients.push(c); return { requestAccessToken: () => {
                    if (opts.deny) return c.callback({ error: 'access_denied' });
                    const scope = [granted[GMAIL] ? GMAIL : '', granted[DRIVE] ? DRIVE : ''].filter(Boolean).join(' ');
                    c.callback({ access_token: TOKEN, expires_in: 3600, scope });
                } }; },
                hasGrantedAllScopes: (response, ...scopes) => scopes.every(s => granted[s])
            }
        }
    };
    const accepted = { gmail: [], drive: [] };
    const gmail = GmailTransport.create({
        storage: { getItem: k => store.get(k) || null },
        win: { google: fakeGoogle, addEventListener: () => {} },
        doc: {},
        fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }),
        now: () => 1_000_000
    });
    const drive = {
        acceptToken: async (response, o) => {
            if (opts.driveFail) throw Object.assign(new Error('profile_failed'), { code: 'profile_failed' });
            accepted.drive.push({ hasToken: !!(response && response.access_token), scope: o && o.scope });
            drive._connected = true;
            return { ok: true, connected: true };
        },
        state: () => ({ connected: !!drive._connected })
    };
    const gc = GoogleConnect.create({
        storage: { getItem: k => store.get(k) || null },
        win: { google: fakeGoogle }
    });
    return { gc, gmail, drive, tokenClients, accepted, store };
}

test('1回のトークン要求で Gmail と Drive の範囲を並べ、両方つながる', async () => {
    const e = env();
    const r = await e.gc.connectBoth({ gmail: e.gmail, drive: e.drive });
    assert.equal(e.tokenClients.length, 1);
    assert.equal(e.tokenClients[0].scope, GMAIL + ' ' + DRIVE);
    assert.equal(e.tokenClients[0].include_granted_scopes, false);
    assert.equal(r.gmail, true);
    assert.equal(r.drive, true);
    assert.equal(e.gmail.state().connected, true);
    assert.equal(JSON.stringify(r).includes('FAKE-TOKEN'), false);
    assert.equal(JSON.stringify(e.gmail.state()).includes('FAKE-TOKEN'), false);
});

test('片方の許可だけだと、つながった方と失敗した方が分かる', async () => {
    const onlyG = env({ granted: { [GMAIL]: true, [DRIVE]: false } });
    const r1 = await onlyG.gc.connectBoth({ gmail: onlyG.gmail, drive: onlyG.drive });
    assert.equal(r1.gmail, true);
    assert.equal(r1.drive, false);
    assert.equal(r1.gmailGranted, true);
    assert.equal(r1.driveGranted, false);
    assert.equal(onlyG.gmail.state().connected, true);
    assert.equal(onlyG.drive.state().connected, false);

    const onlyD = env({ granted: { [GMAIL]: false, [DRIVE]: true } });
    const r2 = await onlyD.gc.connectBoth({ gmail: onlyD.gmail, drive: onlyD.drive });
    assert.equal(r2.gmail, false);
    assert.equal(r2.drive, true);
    assert.equal(onlyD.gmail.state().connected, false);
});

test('ドライブの許可は取れても確認に失敗したら drive は false、Gmail は残る', async () => {
    const e = env({ driveFail: true });
    const r = await e.gc.connectBoth({ gmail: e.gmail, drive: e.drive });
    assert.equal(r.gmail, true);
    assert.equal(r.drive, false);
    assert.equal(r.driveGranted, true);
    assert.equal(e.gmail.state().connected, true);
});

test('どちらも許可されない・拒否されたときはつながった扱いにしない', async () => {
    const deny = env({ deny: true });
    await assert.rejects(() => deny.gc.connectBoth({ gmail: deny.gmail, drive: deny.drive }), x => x.code === 'consent_denied');
    assert.equal(deny.gmail.state().connected, false);
    const none = env({ granted: { [GMAIL]: false, [DRIVE]: false } });
    await assert.rejects(() => none.gc.connectBoth({ gmail: none.gmail, drive: none.drive }), x => x.code === 'scope_missing');
    assert.equal(none.gmail.state().connected, false);
});
