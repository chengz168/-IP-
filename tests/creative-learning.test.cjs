const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');
const {learningPrompt,selectLearning}=require('../server/creative-learning.mjs');
const {runScope}=require('../server/creative-feedback.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'creative-learning-')),before=new Set(process.listeners('exit')),s=createService(root);
 const listeners=process.listeners('exit').filter(fn=>!before.has(fn));t.after(()=>{for(const fn of listeners)process.removeListener('exit',fn);fs.rmSync(root,{recursive:true,force:true});});
 const d=s.store.draft();Object.assign(d,{template:'default',sourceText:'把桌面上散落的物品整理到固定位置，用完放回原处。',wordLimit:'60',creativePreset:{mode:'manual',presetId:'general',instruction:''}});
 Object.assign(s.store.data.settings.provider,{baseUrl:'http://127.0.0.1:11434',model:'test-local-model',textProtocol:'ollama',textMaxTokens:'1024'});
 s.requests=[];s.providers.request=async(url,options)=>{const body=JSON.parse(options.body);s.requests.push(body);return {json:async()=>({message:{content:'先把眼前的物品归到固定位置。每次使用后，再放回原处，下一次拿取时更容易找到。'},done_reason:'stop',prompt_eval_count:100,eval_count:50})};};
 s.store.save();return s;
}
const latest=s=>s.store.data.runs[0];
async function source(s){await s.invoke('text',{id:s.store.draft().id,kind:'rewrite'});return latest(s);}
async function add(s,run,rule='开头直接进入具体动作，避免问候和空泛铺垫。'){
 const data=await s.invoke('creativeLearningState',{});return s.invoke('saveCreativeFeedback',{runId:run.id,rule,rating:'improve',revision:data.revision});
}
test('没有反馈时保持原请求；保存反馈后实际模型消息包含经验且正式文案不被修改',async t=>{
 const s=fixture(t),run=await source(s),before=structuredClone(s.store.draft()),prompts=structuredClone(s.store.data.prompts),saved=await add(s,run);
 assert.equal(s.requests[0].messages.some(m=>m.content.includes('创作反馈经验')),false);
 await source(s);const used=latest(s);assert.match(s.requests[1].messages[1].content,/开头直接进入具体动作/);
 assert.equal(used.creativeLearning.applications.length,1);assert.equal(used.output.creativeLearning.entries[0].id,saved.entries[0].id);
 assert.deepEqual(s.store.draft(),before);assert.deepEqual(s.store.data.prompts,prompts);assert.equal(used.output.request.messages[1].content,s.requests[1].messages[1].content);
 assert.equal(saved.entries[0].source.runId,run.id);assert.match(saved.entries[0].source.outputSha256,/^[a-f0-9]{64}$/);
 const disk=JSON.parse(fs.readFileSync(s.store.file,'utf8'));assert.equal(disk.creativeLearning.entries[0].rule,saved.entries[0].rule);
});
test('经验精确隔离阶段与内容类型，取证/法务/翻译/标题不会调用创作经验',async t=>{
 const s=fixture(t),run=await source(s);await add(s,run);
 for(const type of ['reference-analysis','legal','translate','title','story-split-shots']){
  await s.runtime.run(type,s.store.draft().id,{},ctx=>s.providers.text('原有约束','测试输入',ctx));assert.equal(s.requests.at(-1).messages[1].content,'测试输入',type);
 }
 s.store.draft().sourceText='这是猫咪的生活记录，小猫在窗边走动。';s.store.draft().creativePreset={mode:'auto'};await source(s);
 assert.equal(latest(s).creativeLearning.snapshot.entries.length,0);assert.equal(s.requests.at(-1).messages[1].content.includes('创作反馈经验'),false);
});
test('暂停、恢复和停用单条规则只影响新任务，旧任务快照保持原版本',async t=>{
 const s=fixture(t),run=await source(s);let state=await add(s,run);await source(s);const original=structuredClone(latest(s).creativeLearning);
 state=await s.invoke('updateCreativeFeedback',{revision:state.revision,enabled:false});await source(s);assert.equal(latest(s).creativeLearning.snapshot.entries.length,0);
 state=await s.invoke('updateCreativeFeedback',{revision:state.revision,enabled:true});const e=state.entries[0];state=await s.invoke('updateCreativeFeedback',{revision:state.revision,entryId:e.id,entryRevision:e.revision,enabled:false});await source(s);assert.equal(latest(s).creativeLearning.snapshot.entries.length,0);
 assert.deepEqual(s.store.data.runs.find(r=>r.id!==run.id&&r.creativeLearning?.applications.length).creativeLearning,original);
});
test('经验编辑带并发保护和历史版本，可恢复内容；删除不清理旧运行证据',async t=>{
 const s=fixture(t),run=await source(s);let state=await add(s,run),entry=state.entries[0],original=entry.rule;
 await source(s);const used=latest(s);
 state=await s.invoke('updateCreativeFeedback',{revision:state.revision,entryId:entry.id,entryRevision:1,rule:'段落少用同义重复，逐段推进不同信息。'});
 assert.equal(state.entries[0].revision,2);assert.equal(state.entries[0].history[0].rule,original);
 await assert.rejects(s.invoke('updateCreativeFeedback',{revision:state.revision-1,enabled:false}),/已变化/);
 await assert.rejects(s.invoke('updateCreativeFeedback',{revision:state.revision,entryId:entry.id,entryRevision:1,rule:original}),/已变化/);
 state=await s.invoke('updateCreativeFeedback',{revision:state.revision,entryId:entry.id,entryRevision:2,rule:original});assert.equal(state.entries[0].revision,3);
 await s.invoke('deleteCreativeFeedback',{revision:state.revision,entryId:entry.id,entryRevision:3});assert.equal(s.store.data.creativeLearning.entries.length,0);assert.equal(used.creativeLearning.snapshot.entries[0].rule,original);
});
test('写盘失败完整回滚，重复或无效反馈不改变经验库',async t=>{
 const s=fixture(t),run=await source(s);const save=s.store.save;s.store.save=()=>{throw Error('测试写盘失败');};await assert.rejects(add(s,run),/写盘失败/);assert.equal(s.store.data.creativeLearning,undefined);s.store.save=save;
 let state=await add(s,run),before=structuredClone(state);await assert.rejects(add(s,run),/相同经验/);assert.deepEqual(s.store.data.creativeLearning,before);
 await assert.rejects(add(s,run,'短'),/4至300/);
 s.store.save=()=>{throw Error('第二次写盘失败');};await assert.rejects(s.invoke('updateCreativeFeedback',{revision:state.revision,enabled:false}),/写盘失败/);assert.deepEqual(s.store.data.creativeLearning,before);s.store.save=save;
});
test('失败、过期、确定性拆集和被拒绝输出不能作为本入口反馈依据',async t=>{
 const s=fixture(t),run=await source(s);for(const patch of [{status:'failed'},{output:{text:'过期',stale:true}},{output:{text:'本地范围',modelExecuted:false}},{output:{text:'拒绝',quality:{status:'rejected'}}}]){
  const before=structuredClone(run);Object.assign(run,patch);await assert.rejects(add(s,run),/仅支持/);Object.assign(run,before);
 }assert.equal(s.store.data.creativeLearning,undefined);
});
test('反馈不自动转成评价，结果成功本身不新增长期经验',async t=>{
 const s=fixture(t);await source(s);await source(s);assert.equal(s.store.data.creativeLearning,undefined);
 const state=await s.invoke('creativeLearningState',{id:s.store.draft().id,stage:'rewrite'});assert.equal(state.entries.length,0);assert.equal(state.runs.length,2);assert.equal(state.runs[0].used.length,0);
});
test('调用选最近四条并限当前作用域，不把其他类型泛化',async t=>{
 const s=fixture(t),run=await source(s);for(let i=0;i<6;i++)await add(s,run,'逐段推进信息，避免同义重复，条目'+i+'。');
 await source(s);const entries=latest(s).creativeLearning.snapshot.entries;assert.equal(entries.length,4);assert.match(entries[0].rule,/条目2/);assert.match(entries[3].rule,/条目5/);
 const scope=runScope(run);assert.equal(selectLearning(s.store.data,{...scope,stage:'script'}).entries.length,0);assert.equal(selectLearning(s.store.data,{...scope,profileType:'pet-animal'}).entries.length,0);
 const state=await s.invoke('creativeLearningState'),first=state.entries[0];await s.invoke('updateCreativeFeedback',{revision:state.revision,entryId:first.id,entryRevision:first.revision,rule:'最新修改的旧经验也应优先用于下一次创作。'});assert.ok(selectLearning(s.store.data,scope).entries.some(e=>e.id===first.id&&e.revision===2));
});
test('任务在开始时冻结经验，途中修改规则不会改变本次请求，下一任务才用新版',async t=>{
 const s=fixture(t),run=await source(s);let state=await add(s,run),begin,finish;const ready=new Promise(r=>begin=r),wait=new Promise(r=>finish=r);
 const pending=s.runtime.run('rewrite',s.store.draft().id,{},async ctx=>{begin();await wait;return s.providers.text('约束','继续创作',ctx);});await ready;
 state=await s.invoke('updateCreativeFeedback',{revision:state.revision,entryId:state.entries[0].id,entryRevision:1,rule:'新版偏好要求句子长短交替，减少连续排比。'});finish();await pending;
 assert.match(s.requests.at(-1).messages[1].content,/开头直接进入具体动作/);assert.doesNotMatch(s.requests.at(-1).messages[1].content,/新版偏好/);await source(s);assert.match(s.requests.at(-1).messages[1].content,/新版偏好/);
});
test('模型断网的请求仍保留经验版本与尝试记录，不新增反馈也不改稿',async t=>{
 const s=fixture(t),run=await source(s);await add(s,run);const before=structuredClone(s.store.draft());s.providers.request=async()=>{throw Error('测试断网');};await assert.rejects(source(s),/断网/);
 assert.equal(latest(s).status,'failed');assert.equal(latest(s).creativeLearning.applications.length,1);assert.equal(s.store.data.creativeLearning.entries.length,1);assert.deepEqual(s.store.draft(),before);
 const state=await s.invoke('creativeLearningState',{});assert.equal(state.history[0].status,'failed');assert.equal(state.history[0].id,latest(s).id);assert.equal(state.history[0].appliedEntries[0].revision,1);
});
test('关闭创作预设后不调用反馈经验；低优先级经验提示保留事实和当前任务边界',async t=>{
 const s=fixture(t),run=await source(s);await add(s,run);s.store.draft().creativePreset={mode:'off'};await source(s);assert.equal(s.requests.at(-1).messages[1].content.includes('创作反馈经验'),false);
 const prompt=learningPrompt({enabled:true,entries:[{rating:'keep',rule:'少用空泛形容词'}]});assert.match(prompt,/冲突时忽略历史偏好/);assert.match(prompt,/不得复用历史产品参数/);
});
