const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
    const records = new Map();
    const buttons = {expDraftSave:{},expDraftCopy:{},expDraftSaveHint:{},expDestCompany:{value:'架空会社'}};
    const ctx = vm.createContext({
        document:{getElementById:id=>buttons[id],querySelectorAll:()=>[]},
        alert:()=>{}, confirm:()=>true,
        ExpenseDraftReceipts:{capture:async()=>({items:[{id:'photo'}]}),load:()=>{},reset:()=>{}},
        EtcWorkflow:{markDraftSaved:()=>{},captureForDraft:async()=>({records:[{id:'etc'}]}),leaveDraft:()=>{}},
        ExpenseDraftStore:{
            save:async draft=>records.set(draft.id,draft),
            remove:async id=>records.delete(id)
        }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../expense/expense-manager.js'),'utf8'),ctx);
    return {manager:vm.runInContext('ExpenseManager',ctx),records,buttons};
}

test('最初の保存後にまた保存しても同じIDで更新し、明示的な別保存だけ追加する',async()=>{
    const {manager,records,buttons} = setup();
    const id = await manager.saveDraft();
    const first = records.get(id);
    buttons.expDestCompany.value = '架空会社（修正）';
    assert.equal(await manager.saveDraft(),id);
    const current=records.get(id);
    assert.equal(records.size,1);
    assert.equal(current.destCompany,'架空会社（修正）');
    assert.equal(current.createdAt,first.createdAt);
    assert.ok(current.updatedAt>first.updatedAt);
    assert.equal(current.parkingReceipts.items[0].id,'photo');
    assert.equal(current.etcEvidence.records[0].id,'etc');
    assert.equal(buttons.expDraftSave.textContent,'この下書きを更新');
    const copy = await manager.saveDraft({asCopy:true});
    assert.notEqual(copy,id);
    assert.equal(records.size,2);
    await manager.deleteDraft(copy);
    assert.equal(buttons.expDraftCopy.hidden,true);
    assert.equal(records.size,1);
});
