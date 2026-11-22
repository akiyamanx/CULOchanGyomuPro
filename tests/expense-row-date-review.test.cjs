const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function setup() {
    const fields=new Map(), nodes={}, visits=[];
    const row={dataset:{},querySelector(s){
        if(!fields.has(s))fields.set(s,{value:'',hidden:true,textContent:'',closest:()=>row});
        return fields.get(s);
    },querySelectorAll(){return [...fields.values()]}};
    const ctx=vm.createContext({document:{getElementById:id=>nodes[id],querySelectorAll:()=>[row]},
        WorkflowUI:{openParking:()=>visits.push('parking'),jumpExpense:id=>visits.push(id)},
        ParkingManager:{renderParkingList:()=>visits.push('render')}});
    for(const file of ['expense-import','expense-manager']) vm.runInContext(fs.readFileSync(require.resolve('../expense/'+file+'.js'),'utf8'),ctx);
    const app=vm.runInContext('ExpenseManager',ctx);
    const field=key=>row.querySelector('.exp-'+key);
    function change(value){field('date').value=value;app.onRowDateChange(field('date'));}
    change('2026-10-31');
    return {row,nodes,visits,app,field,change};
}
test('取込済みETCと駐車場がある行は月またぎ変更を拒み、元の日と金額・取込履歴を保持',()=>{
    const {row,field,change}=setup();
    row.dataset.etcKeys=JSON.stringify(['old']);
    row.dataset.parkingImports=JSON.stringify({receipt:600});
    field('highway').value='900';field('parking').value='750';
    change('2026-11-01');
    assert.equal(field('date').value,'2026-10-31');
    assert.equal(+field('day').value,31);
    assert.equal(field('highway').value,'900');
    assert.equal(field('parking').value,'750');
    assert.deepEqual(JSON.parse(row.dataset.parkingImports),{receipt:600});
    assert.match(field('date-review-text').textContent,/2026-10-31.*2026-11-01/);
    assert.equal(field('date-review-parking').hidden,false);
    assert.equal(field('date-review-etc').hidden,false);
});
test('駐車場見直しは元の日を絞るだけで、精算金額には触れない',()=>{
    const {row,field,change,app,nodes,visits}=setup();
    Object.assign(nodes,{parkingFilterMonth:{},parkingFilterDay:{},parkingReflectStatus:{}});
    row.dataset.parkingImports='{"receipt":600}';
    field('parking').value='750';
    change('2027-01-01');
    app.reviewRowImports(field('date-review-parking'),'parking');
    assert.equal(nodes.parkingFilterMonth.value,'2026-10');
    assert.equal(nodes.parkingFilterDay.value,'2026-10-31');
    assert.deepEqual(visits,['parking','render']);
    assert.equal(field('parking').value,'750');
});
test('ETC PDFの反映済み行と壊れた取込履歴も自動で動かさない',()=>{
    const {row,field,change}=setup();
    row.dataset.etcPdfFingerprint='fingerprint';
    change('');
    assert.equal(field('date').value,'2026-10-31');
    assert.equal(field('date-review-pdf').hidden,false);
    delete row.dataset.etcPdfFingerprint;
    row.dataset.etcKeys='{broken';
    change('2027-01-01');
    assert.equal(field('date').value,'2026-10-31');
    assert.match(field('date-review-text').textContent,/取込履歴/);
});
test('手入力だけの行は警告なしで変更と空欄化ができる',()=>{
    const {row,field,change}=setup();
    Object.assign(row.dataset,{parkingImports:'{}',etcKeys:'[]',etcEntries:'[]'});
    field('parking').value='700';
    change('2026-11-01');
    assert.equal(field('date').value,'2026-11-01');
    assert.equal(+field('month').value,11);
    assert.equal(field('date-review').hidden,true);
    change('');
    assert.equal(field('date').value,'');
    assert.equal(field('parking').value,'700');
});
