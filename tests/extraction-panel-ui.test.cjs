const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {ref,computed,watch,nextTick}=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc');
const filename=path.resolve(__dirname,'../src/components/ExtractionPanel.vue');
const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
const helpers=import('../src/extract-batch-ui.mjs');
function actualAppRefresh(call,state,draft){
 const source=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const begin=source.indexOf('async function refresh('),end=source.indexOf('async function save()',begin);
 const core=value=>JSON.stringify(value?{...value,updatedAt:undefined}:null);
 return new Function('call','state','draft','core','lastSaved','let environmentPolledAt=0,applyingSavedDraft=false,refreshRequestVersion=0,refreshExplicitVersion=0,refreshExplicitPending=0;'+source.slice(begin,end)+';return refresh;')(call,state,draft,core,core(draft.value));
}
function makeBatch(status='running'){
 return {id:'batch-1',draftId:'draft-1',status,progress:30,counts:{total:3,succeeded:1,failed:1,running:1},items:[{id:'item-ok',url:'https://example.test/one',status:'succeeded',text:'协议夹具识别正文，不是真实视频验证。'},{id:'item-fail',url:'https://example.test/two',status:'failed',error:'平台来源无法获取'},{id:'item-running',url:'https://example.test/three',status:'running',progress:40,message:'正在静默提取'}]};
}
async function fixture(t,options={}){
 const ui=await helpers,{runExtractAction}=await import('../src/extract-action.mjs');
 const draft=ref({id:'draft-1',sourceUrl:'https://example.test/source',sourceText:'保留当前原稿',rewrite:'保留当前改写',finalText:'保留当前最终稿',confirmed:true,step:0});
 const state=ref({extractionBatches:options.batches||[],runs:[]}),busy=ref(''),workflowLocked=ref(false),calls=[],notices=[],refreshes=[],timers=new Map();
 let saved=0,nextTimer=1,unmount;
 const studio={draft,state,busy,workflowLocked,save:async()=>{saved++;await options.save?.({draft,state,calls});},refresh:async(replace,guardOptions)=>{refreshes.push(replace);if(options.refresh)return options.refresh({draft,state,calls,replace,guardOptions});return {currentId:draft.value.id,drafts:[draft.value]};},notify:(...args)=>notices.push(args),act:async(label,work)=>work()};
 const call=async(action,payload)=>{calls.push({action,payload});if(options.call)return options.call(action,payload,{draft,state});if(action==='startExtractBatch'){const batch=makeBatch();state.value.extractionBatches.unshift(batch);return structuredClone(batch);}if(action==='extractBatchStatus')return makeBatch('partial');if(action==='cancelExtractBatch')return makeBatch('stopping');if(action==='useExtractBatchItem')return {...draft.value,step:1};if(action==='extract')return {text:'单条提取协议正文'};return true;};
 const source=compileScript(descriptor,{id:'extraction-panel-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const component=new Function('computed','inject','onBeforeUnmount','ref','watch','I','AssetPicker','call','runExtractAction','extractionBatchActive','extractionBatchUnsettled','extractionItemMessage','extractionProgress','extractionStatusLabel','previewExtractionLinks','setTimeout','clearTimeout',source)(computed,()=>studio,fn=>{unmount=fn;},ref,watch,{},{},call,runExtractAction,ui.extractionBatchActive,ui.extractionBatchUnsettled,ui.extractionItemMessage,ui.extractionProgress,ui.extractionStatusLabel,ui.previewExtractionLinks,fn=>{const id=nextTimer++;timers.set(id,fn);return id;},id=>timers.delete(id));
 const vm=component.setup({}, {expose(){},emit(){}});t.after(()=>unmount?.());
 return {vm,draft,state,busy,workflowLocked,calls,notices,refreshes,timers,saved:()=>saved,unmount:()=>unmount?.()};
}

test('提取面板及新旧工作流真实模板均可编译，批量沿用现有提取页签',()=>{
 for(const file of [filename,path.resolve(__dirname,'../src/views/Workflow.vue'),path.resolve(__dirname,'../src/views/LegacyWorkflow.vue')]){
  const result=parse(fs.readFileSync(file,'utf8'),{filename:file});assert.deepEqual(result.errors,[]);compileScript(result.descriptor,{id:file});assert.deepEqual(compileTemplate({id:file,source:result.descriptor.template.content,filename:file}).errors,[]);
 }
 const workflow=fs.readFileSync(path.resolve(__dirname,'../src/views/Workflow.vue'),'utf8');assert.match(workflow,/<ExtractionPanel v-if="d.tab==='extract'"/);assert.equal((workflow.match(/import ExtractionPanel/g)||[]).length,1);
});

test('输入预览与后端一致：分享文本、多URL、hash去重、中文标点与无效行',async()=>{
 const {previewExtractionLinks}=await helpers,{linkItems}=require('../server/batch-link-extraction.cjs');
 for(const text of ['打开视频 https://example.test/a#first。\nhttps://example.test/a#other\n这不是链接','https://example.test/a https://example.test/b\nhttps://example.test/a','https://u:p@example.test/a\nhttps://example.test/good','https://example.test/a)。\n\nhttps://example.test/b']){
  const preview=previewExtractionLinks(text),items=linkItems(text);assert.equal(preview.total,items.length);assert.equal(preview.unique,items.filter(row=>row.status==='queued').length);assert.equal(preview.duplicates,items.filter(row=>row.status==='duplicate').length);assert.equal(preview.invalid,items.filter(row=>row.status==='failed').length);
 }
});

test('超过50项不提交；单条输入多个链接必须切换批量，原文案保持',async t=>{
 const f=await fixture(t);f.draft.value.sourceUrl='https://example.test/a\nhttps://example.test/b';assert.equal(f.vm.singleReady.value,false);f.vm.moveToBatch();assert.equal(f.vm.mode.value,'batch');assert.equal(f.vm.inputPreview.value.unique,2);assert.equal(f.draft.value.sourceText,'保留当前原稿');f.vm.batchInput.value=Array.from({length:51},(_,index)=>'https://example.test/'+index).join('\n');await f.vm.startBatch();assert.equal(f.calls.length,0);assert.equal(f.vm.batchReady.value,false);
});

test('批次开始先保存、多行原样传递，批量结果不覆盖任何已有稿件',async t=>{
 const f=await fixture(t);f.vm.batchInput.value='分享一 https://example.test/a\n分享二 https://example.test/b';await f.vm.startBatch();assert.equal(f.saved(),1);assert.deepEqual(f.calls[0],{action:'startExtractBatch',payload:{id:'draft-1',links:f.vm.batchInput.value}});assert.equal(f.vm.batch.value.id,'batch-1');assert.equal(f.draft.value.sourceText,'保留当前原稿');assert.equal(f.draft.value.rewrite,'保留当前改写');assert.equal(f.draft.value.finalText,'保留当前最终稿');assert.equal(f.draft.value.confirmed,true);assert.equal(f.vm.batchReady.value,false);assert(f.timers.size>0);
});

test('服务端失败显示真实错误、保留当前原稿；保存失败不启动批次',async t=>{
 const f=await fixture(t,{call:async()=>{throw Error('真实协议错误：来源不可访问');}});f.vm.batchInput.value='https://example.test/a';await f.vm.startBatch();assert.match(f.vm.error.value,/来源不可访问/);assert.equal(f.draft.value.sourceText,'保留当前原稿');assert.equal(f.vm.pending.value,'');
 const g=await fixture(t,{save:async()=>{throw Error('磁盘保存失败');}});g.vm.batchInput.value='https://example.test/a';await g.vm.startBatch();assert.equal(g.calls.length,0);assert.match(g.vm.error.value,/磁盘保存失败/);
});

test('停止直接调用批次取消、显示stopping，未用单条取消覆盖批次状态',async t=>{
 const f=await fixture(t,{batches:[makeBatch()]});await f.vm.stopBatch();assert.deepEqual(f.calls[0],{action:'cancelExtractBatch',payload:{id:'draft-1',batchId:'batch-1'}});assert.equal(f.vm.batch.value.status,'stopping');assert.equal(f.draft.value.sourceText,'保留当前原稿');await f.vm.stopBatch();assert.equal(f.calls.length,1);
});

test('轮询最终状态更新逐条错误与进度，失败只提示刷新，不重复提交',async t=>{
 const f=await fixture(t,{batches:[makeBatch()]});await f.vm.pollBatch();assert.equal(f.vm.batch.value.status,'partial');assert.equal(f.calls[0].action,'extractBatchStatus');assert.equal(f.refreshes.length,1);assert.equal(f.vm.finishedCount.value,2);
 const g=await fixture(t,{batches:[makeBatch()],call:async()=>{throw Error('暂时无法读取');}});await g.vm.pollBatch();assert.match(g.vm.error.value,/任务未重新提交/);assert.equal(g.calls.length,1);assert.equal(g.calls[0].action,'extractBatchStatus');assert.equal(g.vm.batch.value.status,'running');assert(g.timers.size>0);
});

test('运行中或未知批次阻止再启动，历史成功结果显式选用并携带完整稿件冲突检查',async t=>{
 const active=await fixture(t,{batches:[makeBatch()]});await active.vm.useItem(active.vm.batch.value.items[0]);assert.equal(active.calls.length,0);
 const unknown=await fixture(t,{batches:[makeBatch('unknown')]});unknown.vm.batchInput.value='https://example.test/a';await unknown.vm.startBatch();assert.equal(unknown.calls.length,0);
 const f=await fixture(t,{batches:[makeBatch('partial')]});await f.vm.useItem(f.vm.batch.value.items[1]);assert.equal(f.calls.length,0);await f.vm.useItem(f.vm.batch.value.items[0]);assert.deepEqual(f.calls[0],{action:'useExtractBatchItem',payload:{id:'draft-1',batchId:'batch-1',itemId:'item-ok',expectedDraft:{sourceUrl:'https://example.test/source',sourceText:'保留当前原稿',rewrite:'保留当前改写',finalText:'保留当前最终稿',confirmed:true}}});assert.deepEqual(f.refreshes,[true]);assert.match(f.notices.at(-1)[0],/原稿已归档/);
});

test('切换任务后迟到启动、轮询和选用回包均不刷新覆盖新任务',async t=>{
 for(const action of ['startExtractBatch','extractBatchStatus','useExtractBatchItem']){
  let finish;const wait=new Promise(resolve=>{finish=resolve;});const f=await fixture(t,{batches:action==='startExtractBatch'?[]:[makeBatch(action==='extractBatchStatus'?'running':'partial')],call:async()=>wait});
  f.vm.batchInput.value='https://example.test/a';const work=action==='startExtractBatch'?f.vm.startBatch():action==='extractBatchStatus'?f.vm.pollBatch():f.vm.useItem(f.vm.batch.value.items[0]);await nextTick();f.draft.value={...f.draft.value,id:'new-draft',sourceText:'新任务文案'};await nextTick();finish(makeBatch('partial'));await work;assert.equal(f.draft.value.sourceText,'新任务文案');assert.equal(f.refreshes.length,0);
 }
});

test('保存期间原稿改变或任务切换，不误选用旧结果；组件卸载清理进度计时器',async t=>{
 const f=await fixture(t,{batches:[makeBatch('partial')],save:async({draft})=>{draft.value.sourceText='保存期间编辑的新原稿';}});await f.vm.useItem(f.vm.batch.value.items[0]);assert.equal(f.calls.length,0);assert.equal(f.draft.value.sourceText,'保存期间编辑的新原稿');
 const g=await fixture(t,{batches:[makeBatch()]});assert(g.timers.size>0);g.unmount();assert.equal(g.timers.size,0);
});

test('选用回包期间下游稿件被修改，不以强制刷新覆盖最新编辑',async t=>{
 for(const field of ['sourceUrl','sourceText','rewrite','finalText']){
  const f=await fixture(t,{batches:[makeBatch('partial')],call:async(action,payload,{draft})=>{draft.value[field]='选用期间的新编辑';return {...draft.value,step:1};}});
  await f.vm.useItem(f.vm.batch.value.items[0]);assert.equal(f.draft.value[field],'选用期间的新编辑');assert.equal(f.refreshes.length,0);assert.match(f.notices.at(-1)[0],/已变化/);
 }
});

test('批次进度仅隐藏同任务同批次的重复底部进度，其他状态继续显示',async()=>{
 const {batchOwnsOperationStatus}=await helpers;
 const input={step:0,tab:'extract',draftId:'a',batchId:'b',run:{type:'extract',draftId:'a',parameters:{batchId:'b'}},busy:''};
 assert.equal(batchOwnsOperationStatus(input),true);
 for(const change of [{step:1},{tab:'ref-analysis'},{draftId:'other'},{batchId:'other'},{run:{type:'extract',draftId:'a',parameters:{}}},{run:{type:'speech',draftId:'a',parameters:{batchId:'b'}}},{busy:'正在保存'}])assert.equal(batchOwnsOperationStatus({...input,...change}),false);
 const workflow=fs.readFileSync(path.resolve(__dirname,'../src/views/Workflow.vue'),'utf8');assert.match(workflow,/OperationStatus v-if="\(busy\|\|activeRecognition\)&&!extractionOwnsStatus" inline/);assert.match(workflow,/class="previous"/);assert.match(workflow,/class="primary next"/);
});

test('实际App.refresh延迟回包：开始、停止、选用期间切任务均不产生state/draft覆盖副作用',async t=>{
 for(const action of ['startExtractBatch','cancelExtractBatch','useExtractBatchItem']){
  let finishState,enteredRefresh;const ready=new Promise(resolve=>{enteredRefresh=resolve;}),waiting=new Promise(resolve=>{finishState=resolve;});let productionRefresh;
  const f=await fixture(t,{batches:action==='startExtractBatch'?[]:[makeBatch(action==='cancelExtractBatch'?'running':'partial')],refresh:({replace,guardOptions})=>{enteredRefresh();return productionRefresh(replace,guardOptions);}});
  productionRefresh=actualAppRefresh(async()=>waiting,f.state,f.draft);
  const oldData={currentId:'draft-1',drafts:[structuredClone({...f.draft.value,sourceText:'旧任务回执',step:1})],extractionBatches:[makeBatch('partial')],marker:'旧状态'};
  f.vm.batchInput.value='https://example.test/a';const work=action==='startExtractBatch'?f.vm.startBatch():action==='cancelExtractBatch'?f.vm.stopBatch():f.vm.useItem(f.vm.batch.value.items[0]);
  await ready;f.draft.value={...f.draft.value,id:'new-draft',sourceText:'切换后的新稿'};f.state.value={extractionBatches:[],marker:'切换后的新状态'};finishState(oldData);await work;
  assert.equal(f.draft.value.id,'new-draft');assert.equal(f.draft.value.sourceText,'切换后的新稿');assert.equal(f.state.value.marker,'切换后的新状态');
 }
});

test('实际App.refresh延迟回包：选用期间当前稿件变化，守卫在写state前拒绝旧回包',async t=>{
 let finishState,enteredRefresh;const ready=new Promise(resolve=>{enteredRefresh=resolve;}),waiting=new Promise(resolve=>{finishState=resolve;});let productionRefresh;
 const f=await fixture(t,{batches:[makeBatch('partial')],refresh:({replace,guardOptions})=>{enteredRefresh();return productionRefresh(replace,guardOptions);}});productionRefresh=actualAppRefresh(async()=>waiting,f.state,f.draft);
 const oldData={currentId:'draft-1',drafts:[structuredClone({...f.draft.value,sourceText:'服务端旧稿'})],extractionBatches:[],marker:'旧状态'};
 const work=f.vm.useItem(f.vm.batch.value.items[0]);await ready;f.draft.value.finalText='刷新期间用户编辑的最终稿';f.state.value.marker='最新状态';finishState(oldData);await work;assert.equal(f.draft.value.finalText,'刷新期间用户编辑的最终稿');assert.equal(f.state.value.marker,'最新状态');assert(!f.notices.some(notice=>notice[1]==='success'));
});

test('App.refresh不传守卫保持原有替换与保留未保存编辑语义',async()=>{
 const draft=ref({id:'a',sourceText:'本地稿'}),state=ref({marker:'旧'}),data={currentId:'b',drafts:[{id:'a',sourceText:'服务端a'},{id:'b',sourceText:'服务端b'}],marker:'新'};
 const refresh=actualAppRefresh(async()=>structuredClone(data),state,draft);await refresh(true);assert.equal(draft.value.id,'b');assert.equal(draft.value.sourceText,'服务端b');assert.equal(state.value.marker,'新');draft.value.sourceText='未保存编辑';await refresh(false);assert.equal(draft.value.sourceText,'未保存编辑');
});

test('实际App.refresh旧后台轮询比新选用刷新晚返回，旧state不能反向覆盖新草稿',async()=>{
 const resolvers=[],draft=ref({id:'a',sourceText:'选用前'}),state=ref({marker:'原状态'});
 const refresh=actualAppRefresh(async()=>new Promise(resolve=>resolvers.push(resolve)),state,draft);
 const oldPoll=refresh(false),newSelection=refresh(true,{expectedId:'a'});
 resolvers[1]({currentId:'a',drafts:[{id:'a',sourceText:'新选用正文'}],marker:'新回执'});await newSelection;
 resolvers[0]({currentId:'a',drafts:[{id:'a',sourceText:'选用前的旧稿'}],marker:'旧轮询'});const dropped=await oldPoll;
 assert.equal(dropped,undefined);assert.equal(draft.value.sourceText,'新选用正文');assert.equal(state.value.marker,'新回执');
});

test('实际App.refresh显式导航后发起的后台轮询先回包，不得吞掉切换任务意图',async()=>{
 const resolvers=[],draft=ref({id:'a',sourceText:'任务a'}),state=ref({marker:'初始'});
 const refresh=actualAppRefresh(async()=>new Promise(resolve=>resolvers.push(resolve)),state,draft);
 const navigation=refresh(true),poll=refresh(false),data={currentId:'b',drafts:[{id:'a',sourceText:'任务a'},{id:'b',sourceText:'任务b'}],marker:'导航到b'};
 resolvers[1](structuredClone(data));assert.equal(await poll,undefined);assert.equal(draft.value.id,'a');assert.equal(state.value.marker,'初始');
 resolvers[0](structuredClone(data));assert.equal((await navigation).currentId,'b');assert.equal(draft.value.id,'b');assert.equal(draft.value.sourceText,'任务b');
});

test('实际App.refresh显式选用后发起的后台轮询先回包，选用仍回填并返回有效回执',async()=>{
 const resolvers=[],draft=ref({id:'a',sourceText:'选用前'}),state=ref({marker:'初始'});
 const refresh=actualAppRefresh(async()=>new Promise(resolve=>resolvers.push(resolve)),state,draft);
 const selection=refresh(true,{expectedId:'a',guard:()=>draft.value.sourceText==='选用前'}),poll=refresh(false,{expectedId:'a',guard:()=>true});
 resolvers[1]({currentId:'a',drafts:[{id:'a',sourceText:'后台所见新稿'}],marker:'后台'});assert.equal(await poll,undefined);assert.equal(draft.value.sourceText,'选用前');
 resolvers[0]({currentId:'a',drafts:[{id:'a',sourceText:'显式选用的新稿'}],marker:'选用'});assert.equal((await selection).marker,'选用');assert.equal(draft.value.sourceText,'显式选用的新稿');
});

test('实际App.refresh较早显式finally不能清除较新显式优先级，完成后普通轮询可恢复',async()=>{
 const resolvers=[],draft=ref({id:'a',sourceText:'原稿'}),state=ref({marker:'初始'});
 const refresh=actualAppRefresh(async()=>new Promise(resolve=>resolvers.push(resolve)),state,draft);
 const first=refresh(true),second=refresh(true),poll=refresh(false);
 resolvers[0]({currentId:'a',drafts:[{id:'a',sourceText:'较早显式'}],marker:'较早'});assert.equal(await first,undefined);
 resolvers[2]({currentId:'a',drafts:[{id:'a',sourceText:'期间后台'}],marker:'期间后台'});assert.equal(await poll,undefined);assert.equal(state.value.marker,'初始');
 resolvers[1]({currentId:'a',drafts:[{id:'a',sourceText:'较新显式'}],marker:'较新'});await second;assert.equal(draft.value.sourceText,'较新显式');
 const resumed=refresh(false);resolvers[3]({currentId:'a',drafts:[{id:'a',sourceText:'后续同步'}],marker:'恢复'});await resumed;assert.equal(state.value.marker,'恢复');assert.equal(draft.value.sourceText,'后续同步');
});

test('实际App.refresh显式失败或守卫拒绝后释放优先级，之后轮询继续同步',async()=>{
 for(const mode of ['failure','guard']){
  let index=0;const draft=ref({id:'a',sourceText:'原稿'}),state=ref({marker:'初始'}),data={currentId:'a',drafts:[{id:'a',sourceText:'恢复的新稿'}],marker:'已恢复'};
  const refresh=actualAppRefresh(async()=>{index++;if(index===1&&mode==='failure')throw Error('暂时读取失败');return structuredClone(data);},state,draft);
  if(mode==='failure')await assert.rejects(refresh(true),/暂时读取失败/);else assert.equal(await refresh(true,{guard:()=>false}),undefined);
  assert.equal(state.value.marker,'初始');await refresh(false);assert.equal(state.value.marker,'已恢复');assert.equal(draft.value.sourceText,'恢复的新稿');
 }
});

test('剪贴板延迟回包：切任务、改输入或切模式都不把旧粘贴写入新目标',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
 for(const change of ['task','input','mode']){
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{readText:async()=>waiting}}});
  const f=await fixture(t);const work=f.vm.paste();if(change==='task')f.draft.value={...f.draft.value,id:'new-draft',sourceUrl:'新任务来源'};if(change==='input')f.draft.value.sourceUrl='用户新输入';if(change==='mode')f.vm.mode.value='batch';await nextTick();finish('https://old.test/clipboard');await work;
  assert.notEqual(f.draft.value.sourceUrl,'https://old.test/clipboard');assert.equal(f.vm.batchInput.value,'');
 }
});

test('未知结果只可主动核对；人工终止必须勾选、说明并绑定原始远程编号',async t=>{
 const source=makeBatch('unknown');source.items[2]={id:'unknown-item',status:'unknown',runId:'run-old',remoteId:'remote-old'};
 const f=await fixture(t,{batches:[source],call:async()=>structuredClone(source)});const item=f.vm.batch.value.items[2];await f.vm.confirmTerminated(item);assert.equal(f.calls.length,0);f.vm.terminationNotes.value[item.id]='已经通过服务后台核实任务终止';await f.vm.confirmTerminated(item);assert.equal(f.calls.length,0);f.vm.terminationChecks.value[item.id]=true;await f.vm.confirmTerminated(item);assert.deepEqual(f.calls[0],{action:'confirmExtractBatchTerminated',payload:{id:'draft-1',batchId:'batch-1',itemId:'unknown-item',expectedRunId:'run-old',expectedRemoteId:'remote-old',confirmed:true,note:'已经通过服务后台核实任务终止'}});
 await f.vm.reconcileBatch();assert.equal(f.calls[1].action,'reconcileExtractBatch');assert.match(descriptor.template.content,/不会查询远程服务/);
});

test('人工终止后展示回执依据和历史未知错误，不以旧error盖住人工核实消息',async()=>{
 const {extractionItemMessage}=await helpers;
 assert.equal(extractionItemMessage({error:'旧未知错误',message:'用户已核对原远程任务终止',terminationReceipt:{basis:'user-confirmed-remote-termination'}}),'用户已核对原远程任务终止');assert.equal(extractionItemMessage({error:'真实当前错误',message:'本条失败'}),'真实当前错误');
 for(const token of ['item.terminationReceipt.note','item.terminationReceipt.remoteId','item.terminationReceipt.runId','item.terminationReceipt.confirmedAt','item.unresolvedHistory','人工核实回执'])assert(descriptor.template.content.includes(token));
});
