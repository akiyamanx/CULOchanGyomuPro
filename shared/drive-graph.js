// Immutable revisions preserve both uploads when two devices send at the same time.
const DriveGraph = (() => {
    const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
    function heads(files) {
        const revisions = new Map(), parents = new Set();
        for (const file of files) {
            const p = file.appProperties;
            if (!p || !uuid(p.revision) || !/^[a-f0-9]{64}$/.test(p.sha256 || '') || !/^\d{4}-\d{2}-\d{2}T/.test(p.savedAt || '') || !/^[\w-]+$/.test(file.id || '')) throw new Error('共有先の履歴を確認できません。取り込みを中止しました。');
            const previous = revisions.get(p.revision);
            if (previous && JSON.stringify(previous.appProperties) !== JSON.stringify(p)) throw new Error('共有先に一致しない版があります。');
            revisions.set(p.revision, file);
            for (const key of Object.keys(p).filter(key => /^parent\d+$/.test(key))) {
                if (!uuid(p[key]) || p[key] === p.revision) throw new Error('共有先の親版が不正です。');
                parents.add(p[key]);
            }
        }
        for (const parent of parents) if (!revisions.has(parent)) throw new Error('共有先の履歴が不足しています。削除・通信状態を確認してください。');
        const result = [...revisions.values()].filter(file => !parents.has(file.appProperties.revision));
        if (files.length && !result.length) throw new Error('共有先の履歴を解決できません。');
        return result.sort((a,b)=>b.appProperties.savedAt.localeCompare(a.appProperties.savedAt));
    }
    const versions = files => files.map(file=>file.appProperties.revision).sort();
    const equal = (a,b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    function assertSend(heads, baseline, override) {
        if (heads.length > 16) throw new Error('共有版が多すぎます。バックアップを保存してから履歴を確認してください。');
        if (!override && !equal(versions(heads), baseline || [])) throw new Error('別の端末の更新があります。先に共有先の版を取り込むか、「この端末の内容を優先」を確認してください。');
    }
    return {heads,versions,equal,assertSend};
})();
if (typeof module !== 'undefined') module.exports = DriveGraph;
