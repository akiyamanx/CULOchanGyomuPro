// メールBOX用の仕分け(純関数)。添付1つ、または本文だけのメール1通を、次の3つに分ける。
//   request    … 依頼書。会社名・住所・作業内容が読めて揃う(自動登録の対象)
//   unreadable … 判別不可BOX。欠けのある依頼書・開けないファイル・形式不明・迷うもの(本人が確認)
//   reference  … 通達BOX。配置図・店舗リスト・精算書・納品書・送り状・調査票・報告メールなど
// 迷ったら unreadable に倒す(取りこぼし防止)。reason に件名・ファイル名・会社名などは入れない。
// 保存・通信・DOM は行わない。
const RequestClassifier = (() => {
    const norm = value => String(value ?? '').normalize('NFKC');
    const LABEL = {company: '会社名', address: '住所', purpose: '作業内容'};
    const BUCKET_LABELS = {request: '依頼書', unreadable: '判別不可BOX', reference: '通達BOX'};
    // 依頼書らしさの手掛かり
    const REQUEST_NAME = /業務依頼|依頼書/;
    const REQUEST_HEADING = /業務依頼書/;
    const REQUEST_SUBJECT = /業務依頼/;
    // 参考資料・通達らしさの手掛かり(ファイル名・見出し)
    const REFERENCE_NAME = /配置図|設置場所|設置位置|位置図|案内図|地図|マップ|図面|レイアウト|店舗リスト|対象店舗|店舗一覧|実施店舗|送り状|伝票|納品書|精算書|請求書|見積書|コスト試算|調査票|現地調査|現調|報告書|領収書|指示書|通達|写真|周知/;
    // 参考資料・通達らしさの手掛かり(件名。ファイル名より弱い)
    const REFERENCE_SUBJECT = /精算|納品|請求|見積|調査|配置図|店舗リスト|対象店舗|送り状|通達|指示書|周知|お知らせ|ご案内|報告|レポート|日程|お届け|配送|保守/;
    const KNOWN_KINDS = ['pdf', 'xls', 'xlsx', 'csv', 'image'];

    const meaningful = (value, min) => new RegExp('[\\p{L}\\p{N}]{' + min + ',}', 'u').test(norm(value));
    // OCRの崩れ(�・□・■)が混ざる値は、読めたことにしない。
    const garbled = value => /[\ufffd□■]/.test(norm(value));
    function missingOf(item) {
        const miss = [];
        if (!meaningful(item?.company, 2) || garbled(item?.company)) miss.push('company');
        if (!meaningful(item?.address, 3) || garbled(item?.address)) miss.push('address');
        // パーサーが作業内容をファイル名から推定した/読み取れなかった場合は、読めたことにしない。
        const inferred = (Array.isArray(item?.warnings) ? item.warnings : []).some(w => /作業内容/.test(norm(w)) && /推定|読み取れ/.test(norm(w)));
        if (!meaningful(item?.purpose, 2) || inferred) miss.push('purpose');
        return miss;
    }
    const lines = raw => norm(raw).split(/\r?\n/).map(line => line.replace(/\s+/g, '')).filter(Boolean);
    function headingSignals(raw) {
        const all = lines(raw);
        const head = all.slice(0, 6).join('\n');
        const body = all.join('\n');
        return {
            request: REQUEST_HEADING.test(head) || (/顧客名/.test(body) && /所在地/.test(body)) || (/設置先名/.test(body) && /設置先住所/.test(body)),
            reference: REFERENCE_NAME.test(head)
        };
    }
    const result = (bucket, reason, extra = {}) => ({bucket, reason, needsAttention: bucket === 'unreadable' || !!extra.attention, missing: extra.missing || [], ...(extra.cues ? {cues: extra.cues} : {})});

    const FAILURE_REASON = {
        too_large: 'ファイルが大きすぎるため、開いていません。',
        type_blocked: '対応していない種類のファイルです(PDF・Excel・CSV・画像以外)。',
        content_mismatch: '拡張子と中身が一致しないため、開いていません。',
        no_body: 'メールから添付の中身を取り出せませんでした。',
        over_limit: '添付が多すぎる(または構造が複雑な)ため、一部を確認していません。元のメールで確認してください。',
        read_failed: 'ファイルを読み取れませんでした(壊れている・パスワード付き・対応していない作りのいずれか)。元のメールで確認してください。',
        pdf_tool_failed: 'PDFを読む道具を読み込めませんでした(通信が不安定な可能性)。次の取り込みで自動で読み直します。',
        ocr_tool_failed: '画像だけのPDFの文字読取ツールを読み込めませんでした(通信が不安定な可能性)。次の取り込みで自動で読み直します。',
        too_many_pages: 'PDFが10ページを超えるため読んでいません。元のメールで確認してください。'
    };
    function classifyAttachment(input) {
        const a = input && typeof input === 'object' ? input : {};
        const subject = norm(a.subject);
        const fileName = norm(a.fileName);
        const kind = String(a.kind || '').toLowerCase();
        const unknownSender = a.senderKind === 'unknown';

        // 添付なし(本文だけのメール): 通達BOX。ただし件名が業務依頼なら取りこぼさないよう判別不可へ。
        if (kind === 'none') {
            if (REQUEST_SUBJECT.test(subject)) return result('unreadable', '件名は依頼のようですが、添付がありません。確認してください。');
            return result('reference', '添付のない連絡メールです。通達BOXに入れます。');
        }
        // Gmail取り込みで「開く前に分かった」理由。どれも判別不可(登録しない)。
        if (kind === 'tnef' || a.failure === 'tnef_unsupported') return result('unreadable', 'Outlook形式(winmail.dat)の添付です。中身を開けません。元のメールで確認してください。');
        if (a.opened === false && Object.prototype.hasOwnProperty.call(FAILURE_REASON, a.failure)) return result('unreadable', FAILURE_REASON[a.failure]);
        if (!KNOWN_KINDS.includes(kind)) return result('unreadable', '形式が分からないか、対応していないファイルです。');
        if (a.opened === false) return result('unreadable', 'ファイルを開けませんでした。');

        const items = Array.isArray(a.items) ? a.items : [];
        const complete = items.filter(item => !missingOf(item).length);
        const incomplete = items.filter(item => missingOf(item).length);
        const missing = [...new Set(incomplete.flatMap(missingOf))];
        const warned = Array.isArray(a.warnings) && a.warnings.length > 0;
        const heading = headingSignals(a.headingText);
        const nameRequest = REQUEST_NAME.test(fileName);
        const requestStrong = nameRequest || heading.request;
        const referenceFile = REFERENCE_NAME.test(fileName) || heading.reference;
        const referenceSubject = REFERENCE_SUBJECT.test(subject) && !REQUEST_SUBJECT.test(subject);
        const sibling = a.mailHasRequest === true;

        if (complete.length) {
            if (unknownSender) return result('unreadable', '送信者が登録外のため、自動登録せず確認に回します。', {missing});
            if (referenceFile && !requestStrong) return result('unreadable', '中身は依頼書のように読めますが、参考資料らしい名前です。確認してください。', {missing});
            if (incomplete.length || warned) {
                const reason = incomplete.length ? `一部(${incomplete.length}件)の項目に欠けがあります。確認してください。` : '読めましたが、確認が必要な点があります。';
                return result('request', reason, {attention: true, missing});
            }
            return result('request', '会社名・住所・作業内容が揃っています。', {});
        }
        if (requestStrong) {
            if (referenceFile) return result('unreadable', '依頼書らしさと参考資料らしさが混ざっています。確認してください。', {missing});
            if (items.length) {
                const names = missing.map(key => LABEL[key]).join('・');
                return result('unreadable', `依頼書らしいですが、${names || '項目'}が読めません。確認してください。`, {missing});
            }
            return result('unreadable', '依頼書らしいですが、内容を読み取れませんでした。確認してください。');
        }
        if (referenceFile) return result('reference', '配置図・精算書・納品書などの参考資料です。通達BOXに入れます。');
        if (referenceSubject) return result('reference', '件名から参考資料・連絡と判断しました。通達BOXに入れます。');
        if (sibling) return result('reference', '同じメールの依頼書に添えられた資料です。通達BOXに入れます。');
        return result('unreadable', '依頼書か参考資料か判別できませんでした。確認してください。', {missing});
    }

    // メール1通(添付0個以上)を仕分ける。同じメールに依頼書があれば、手掛かりのない添付は資料として扱う。
    function classifyMail(mail) {
        const m = mail && typeof mail === 'object' ? mail : {};
        const attachments = Array.isArray(m.attachments) ? m.attachments : [];
        const common = {subject: m.subject, senderKind: m.senderKind};
        let results;
        if (!attachments.length) results = [classifyAttachment({...common, kind: 'none'})];
        else {
            results = attachments.map(att => classifyAttachment({...common, ...att}));
            if (results.some(r => r.bucket === 'request')) {
                results = results.map((r, i) => r.bucket === 'request' ? r : classifyAttachment({...common, ...attachments[i], mailHasRequest: true}));
            }
        }
        const summary = {request: 0, unreadable: 0, reference: 0};
        results.forEach(r => { summary[r.bucket] += 1; });
        return {results, summary, notify: summary.unreadable > 0};
    }
    return {classifyAttachment, classifyMail, BUCKET_LABELS, missingOf};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RequestClassifier;
