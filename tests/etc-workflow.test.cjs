const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const J=require('../expense/etc-journey.js');
async function fixture() {
    const elements=new Map();
    const el=id=>{if(!elements.has(id))elements.set(id,{value:'',dataset:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return elements.get(id);};
    const day=J.rebuild({date:'2026-09-03',stops:[{id:'home_start',name:'会社',job:'hq'},{id:'a',name:'A社',job:'hq',machineName:'',purpose:''},{id:'home_end',name:'会社',job:'hq'}]});
    let saved={selectedDate:day.date,records:[{id:'one',date:day.date,time:'08:30',amount:800,claimAmount:800,owner:'hold'}],days:{[day.date]:day}},fail=false;
    const ctx=vm.createContext({console,setTimeout,clearTimeout,document:{getElementById:el,activeElement:null},
        alert:()=>{},confirm:()=>true,localStorage:{getItem:()=>null},
        ExpenseImport:{normalizeDate:s=>s},ExpenseManager:{getRowsData:()=>[]},
        DataStorage:{getSettings:()=>({}),getCustomersForWorkspace:()=>[],getCurrentWorkspaceId:()=>'',getRoutes:()=>[]},
        EtcStore:{read:async()=>structuredClone(saved),save:async value=>{if(fail)throw Error('quota');saved=structuredClone(value);}},
        EtcJourney:J,EtcView:{mount(){},trip(){},records(){},totals(){},legs(){},options:()=>''}});
    vm.runInContext(fs.readFileSync('expense/etc-workflow.js','utf8')+'\nthis.workflow=EtcWorkflow;',ctx);await ctx.workflow.init();
    return {ctx,el,workflow:ctx.workflow,saved:()=>saved,fail:()=>{fail=true},input:(scope,index,key,value)=>el('etcWorkflow').listeners.input({type:'input',target:{tagName:'INPUT',dataset:{scope,index:String(index),key},value}})};
}
test('入力イベントで機種・目的・距離を保持し、すぐ下書き保存しても値が落ちない',async()=>{
    const f=await fixture();f.input('stop',1,'machineName','DP400');f.input('stop',1,'purpose','修理');f.input('leg',0,'km','30');f.input('record',0,'visitCompany','A社');
    const snap=await f.workflow.capture();a.equal(snap.days['2026-09-03'].stops[1].machineName,'DP400');a.equal(snap.days['2026-09-03'].stops[1].purpose,'修理');a.equal(snap.days['2026-09-03'].legs[0].km,'30');a.equal(f.saved().records[0].visitCompany,'A社');
});
test('下書きの編集は通常ETC保管を上書きせず、保存失敗時も退避用スナップショットを返す',async()=>{
    const f=await fixture(),snap=await f.workflow.capture();f.workflow.load(snap);f.input('record',0,'visitCompany','下書き専用');const changed=await f.workflow.capture();a.equal(changed.records[0].visitCompany,'下書き専用');a.equal(f.saved().records[0].visitCompany,undefined);
    const g=await fixture();g.fail();g.input('record',0,'visitCompany','退避する入力');const backup=await g.workflow.capture();a.equal(backup.records[0].visitCompany,'退避する入力');a.match(g.el('etcSaveStatus').textContent,/保存できません/);
});
