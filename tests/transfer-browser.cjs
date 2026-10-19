// Actual IndexedDB, independent browser profiles and synthetic Google responses only.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),http=require('node:http');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=path.resolve(process.env.TRANSFER_TEST_ROOT||path.join(__dirname,'..')),prefix=process.env.SETTINGS_STORAGE_PREFIX||'';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=';
let server,browser,base,files=[],uploads=new Map(),denied=false,incomplete=false,postBarrier=[];
let barrierEnabled=false,pages=[];
(async()=>{
 server=http.createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});res.end(await fs.readFile(file));}catch(_){res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.TEST_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[];
 async function make(width){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'ja-JP',timezoneId:'Asia/Tokyo'});context.setDefaultTimeout(12000);
  await context.addInitScript(({prefix})=>{
   localStorage.setItem(prefix+'culo_google_calendar_client_id','123-transfer-test.apps.googleusercontent.com');
   window.google={accounts:{oauth2:{initTokenClient(options){return{requestAccessToken(){options.callback({access_token:'synthetic-drive-token',expires_in:3600});}};},hasGrantedAllScopes:()=>true,revoke(){throw new Error('Drive must not revoke Calendar grants');}}}};
  },{prefix});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.url().startsWith(base))return route.continue();
   if(process.env.TEST_FONT_DIR && url.hostname==='fonts.googleapis.com'){
    if(url.pathname.startsWith('/files/'))return route.fulfill({body:await fs.readFile(path.join(process.env.TEST_FONT_DIR,'files',path.basename(url.pathname))),contentType:'font/woff2',headers:{'Access-Control-Allow-Origin':'*'}});
    return route.fulfill({body:(await Promise.all(['400.css','600.css'].map(f=>fs.readFile(path.join(process.env.TEST_FONT_DIR,f),'utf8')))).join('\n'),contentType:'text/css'});
   }
   if(url.hostname==='www.googleapis.com' && /\/(drive|upload)\//.test(url.pathname)){
    assert.equal(request.headers().authorization,'Bearer synthetic-drive-token');assert.equal(url.searchParams.has('access_token'),false);
    if(denied)return route.fulfill({status:403,json:{error:'synthetic denial'}});
    if(url.pathname.endsWith('/about'))return route.fulfill({json:{user:{permissionId:'test-account',emailAddress:'example@example.test'}}});
    if(url.pathname.startsWith('/upload/') && request.method()==='POST'){
     const id='file'+(uploads.size+1);uploads.set(id,{id,...request.postDataJSON()});
     if(barrierEnabled){await new Promise(resolve=>{postBarrier.push(resolve);if(postBarrier.length===2){barrierEnabled=false;postBarrier.forEach(r=>r());postBarrier=[];}});}
     return route.fulfill({status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id='+id,'Access-Control-Expose-Headers':'Location'},body:''});
    }
    if(url.pathname.startsWith('/upload/') && request.method()==='PUT'){
     const item=uploads.get(url.searchParams.get('upload_id')),body=request.postData();item.body=body;item.size=String(Buffer.byteLength(body));files.push(item);
     return route.fulfill({json:{id:item.id}});
    }
    if(url.searchParams.get('alt')==='media')return route.fulfill({contentType:'application/json',body:files.find(f=>url.pathname.endsWith('/'+f.id)).body});
    if(url.pathname.endsWith('/files')){
     // Deliberately paginate to exercise all-pages checks.
     const offset=Number(url.searchParams.get('pageToken')||0),slice=files.slice(offset,offset+1).map(({body,...file})=>file);
     return route.fulfill({json:{files:slice,incompleteSearch:incomplete,...(offset+1<files.length?{nextPageToken:String(offset+1)}:{})}});
    }
   }
   return route.fulfill({status:200,body:'',contentType:'text/plain'});
  });
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>page.acceptDialogs?dialog.accept():dialog.dismiss());
  await page.goto(base+'/index.html');await page.waitForFunction(()=>!document.body.inert);
  return {context,page};
 }
 const A=await make(390),B=await make(768),a=A.page,b=B.page;
 await a.evaluate(async({photo,prefix})=>{
  DataStorage.addCustomer({company:'共有確認用の訪問先（架空）',address:'架空の住所',note:'持ち替えても残す記録'});
  localStorage.setItem(prefix+'mm_settings',JSON.stringify({homeAddress:'架空の会社住所',apiKey:'device-A-secret'}));
  localStorage.setItem(prefix+'gyomupro_gemini_key','device-A-ai-secret');
  localStorage.setItem(prefix+'gyomupro_receipts',JSON.stringify([{id:'receipt',imageDataUrl:photo,store:'架空レシート',total:500}]));
  await ParkingManager.append([{id:'park',imageDataUrl:photo,originalImageDataUrl:photo,amount:800,date:'2026-10-19',visitCompany:'架空の訪問先'}]);
  await ExpenseDraftStore.save({id:'draft',date:'2026-10-19',createdAt:1,rows:[],parkingReceipts:{items:[{id:'draft-photo',imageDataUrl:photo}]},etcEvidence:{records:[{id:'draft-etc',imageDataUrl:photo}]}});
  await EtcStore.save({records:[{id:'etc',imageDataUrl:photo}],days:{},selectedDate:'2026-10-19'});
 },{photo,prefix});
 await a.reload();await a.waitForFunction(()=>!document.body.inert);
 const original=await a.evaluate(()=>BackupStore.exclusive(()=>BackupStore.capture()));
 assert.equal(original.payload.parking[0].imageDataUrl,photo);assert.equal(original.payload.drafts[0].parkingReceipts.items[0].imageDataUrl,photo);
 assert.doesNotMatch(JSON.stringify(original),/secret|synthetic-drive-token|apps.googleusercontent.com/);
 await a.evaluate(()=>SettingsPanel.open('data'));
 const downloading=a.waitForEvent('download');await a.locator('#fullBackupSave').click();const download=await downloading;
 const exported=await fs.readFile(await download.path(),'utf8');assert.equal(JSON.parse(exported).sha256,original.sha256);
 console.log('PASS photo-inclusive file backup; credentials excluded');
 await b.evaluate(prefix=>{localStorage.setItem(prefix+'mm_settings','{"apiKey":"device-B-secret","homeAddress":"B address"}');SettingsPanel.open('data');},prefix);
 const beforeB=await b.evaluate(()=>BackupStore.capture());
 const upload={name:'backup.json',mimeType:'application/json',buffer:Buffer.from(exported)};
 await b.locator('#fullBackupInput').setInputFiles(upload);await b.waitForFunction(()=>document.getElementById('transferStatus').textContent.includes('取り消し'));
 assert.equal((await b.evaluate(()=>BackupStore.capture())).sha256,beforeB.sha256);
 b.acceptDialogs=true;await b.locator('#fullBackupInput').setInputFiles(upload);await b.waitForEvent('load');await b.waitForFunction(()=>!document.body.inert);b.acceptDialogs=false;
 assert.equal((await b.evaluate(()=>BackupStore.capture())).sha256,original.sha256);
 assert.equal(await b.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'mm_settings')).apiKey,prefix),'device-B-secret');
 assert.equal((await b.evaluate(()=>BackupStore.previous())).sha256,beforeB.sha256);
 console.log('PASS Android-width restore; all photos preserved; cancel and previous-copy recovery');
 await b.evaluate(()=>SettingsPanel.open('data'));
 const corrupt=JSON.parse(exported);corrupt.payload.parking[0].amount=99;
 await b.locator('#fullBackupInput').setInputFiles({...upload,buffer:Buffer.from(JSON.stringify(corrupt))});await b.waitForFunction(()=>document.getElementById('transferStatus').textContent.includes('破損'));
 assert.equal((await b.evaluate(()=>BackupStore.capture())).sha256,original.sha256);
 const rollback=await b.evaluate(async original=>{
  const before=await BackupStore.capture(),target=structuredClone(original);target.payload.parking=[];target.sha256=await BackupFormat.hash(target.payload);
  const save=EtcStore.save;let fail=true;EtcStore.save=async p=>{if(fail){fail=false;throw new Error('synthetic write failure');}return save(p);};
  let error;try{await BackupStore.exclusive(()=>BackupStore.restore(target));}catch(e){error=e.message;}finally{EtcStore.save=save;}
  return {error,before:before.sha256,after:(await BackupStore.capture()).sha256};
 },original);
 assert.match(rollback.error,/元の保存データに戻しました/);assert.equal(rollback.before,rollback.after);
 await b.evaluate(async original=>{
  const target=structuredClone(original);target.payload.parking=[];target.sha256=await BackupFormat.hash(target.payload);
  EtcStore.save=async()=>{throw new Error('synthetic persistent failure');};
  try{await BackupStore.exclusive(()=>BackupStore.restore(target));}catch(e){if(!e.message.includes('復旧用データ'))throw e;}
 },original);
 await b.reload();await b.waitForFunction(()=>!document.body.inert);
 assert.equal((await b.evaluate(()=>BackupStore.capture())).sha256,original.sha256);
 console.log('PASS corrupt file rejected; interrupted multi-store restore rolls back on restart');
 const other=await A.context.newPage();await other.goto(base+'/index.html');await other.waitForFunction(()=>!document.body.inert);
 await a.locator('#fullBackupSave').click();await a.waitForFunction(()=>document.getElementById('transferStatus').textContent.includes('別のタブ'));
 await other.close();
 console.log('PASS second tab blocks transfer');
 await a.locator('#driveConnect').click();await a.waitForFunction(()=>DriveTransfer.state().connected && !TransferUI.isBusy());
 a.acceptDialogs=true;await a.locator('#driveSend').click();await a.waitForFunction(()=>document.getElementById('transferStatus').textContent.includes('共有先へ保存しました'));a.acceptDialogs=false;
 assert.equal(files.length,1);
 await b.evaluate(()=>SettingsPanel.open('data'));await b.locator('#driveConnect').click();await b.waitForFunction(()=>DriveTransfer.state().connected && !TransferUI.isBusy());
 b.acceptDialogs=true;await b.locator('#driveSend').click();await b.waitForFunction(()=>document.getElementById('transferStatus').textContent.includes('別の端末の更新'));b.acceptDialogs=false;assert.equal(files.length,1);
 b.acceptDialogs=true;await b.locator('#driveReceive').click();await b.waitForEvent('load');await b.waitForFunction(()=>!document.body.inert);b.acceptDialogs=false;
 assert.equal((await b.evaluate(()=>BackupStore.capture())).sha256,original.sha256);
 await b.evaluate(()=>SettingsPanel.open('data'));await b.locator('#driveConnect').click();await b.waitForFunction(()=>DriveTransfer.state().connected && !TransferUI.isBusy());
 // Both profiles have the same acknowledged parent; concurrent sends must retain both children.
 barrierEnabled=true;
 const send=page=>page.evaluate(()=>BackupStore.exclusive(async()=>{
  const bundle=await BackupStore.capture(),remote=await DriveTransfer.list();return (await DriveTransfer.send(bundle,DriveGraph.versions(remote.heads))).heads.length;
 }));
 await Promise.all([send(a),send(b)]);
 assert.equal(files.length,3);assert.equal(await a.evaluate(async()=>(await DriveTransfer.list()).heads.length),2);
 console.log('PASS Drive send/receive across profiles, pagination, stale-version block, concurrent branches retained');
 incomplete=true;assert.match(await a.evaluate(async()=>{try{await DriveTransfer.list();return 'bad';}catch(e){return e.message;}}),/全履歴/);incomplete=false;
 denied=true;const unchanged=await a.evaluate(()=>BackupStore.capture());assert.match(await a.evaluate(async()=>{try{await DriveTransfer.list();return 'bad';}catch(e){return e.message;}}),/Drive/);denied=false;
 assert.equal((await a.evaluate(()=>BackupStore.capture())).sha256,unchanged.sha256);
 await a.evaluate(()=>DriveTransfer.disconnect());assert.equal(await a.evaluate(()=>DriveTransfer.state().connected),false);
 for(const page of [a,b])assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(localStorage)),/synthetic-drive-token/);
 for(const width of [320,390,768,1024,1440]){
  await a.setViewportSize({width,height:900});await a.evaluate(()=>TransferUI.opened());
  assert.equal(await a.locator('#settingsModal .modal-content').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'overflow '+width);
  if(process.env.TRANSFER_REVIEW_OUTPUT && [390,768].includes(width))await a.screenshot({path:path.join(process.env.TRANSFER_REVIEW_OUTPUT,'transfer-'+width+'.png')});
 }
 assert.deepEqual(errors,[]);console.log('PASS connection failures preserve records; no persisted token; responsive settings 320–1440px');
 await A.context.close();await B.context.close();
})().catch(async error=>{console.error(error);for(const page of pages)console.error(await page.evaluate(()=>document.getElementById('transferStatus')?.textContent).catch(()=>''));process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
