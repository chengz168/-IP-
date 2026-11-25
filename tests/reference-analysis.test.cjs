const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');
const {validateAnalysis}=require('../server/reference-analysis.cjs');
const sample='你也遇到这个问题吗？先看看每天的使用习惯。把需要的东西放在手边，再试着调整位置。最后观察是否方便，再决定是否保留。';
const analysis=()=>({summary:'从问题切入，提供观察与调整步骤。',hook:{kind:'问题',quote:'你也遇到这个问题吗？',explanation:'直接向观众提问'},sections:[{label:'提出问题',purpose:'引出需求',quote:'你也遇到这个问题吗？'},{label:'建议',purpose:'提出可执行观察',quote:'先看看每天的使用习惯。'},{label:'结束',purpose:'建议复核',quote:'最后观察是否方便，再决定是否保留。'}],ending:{quote:'最后观察是否方便，再决定是否保留。',explanation:'以观察建议结束'},reusableStructure:['问题—步骤—复核'],uncertainties:['只有转写，不能推断画面']});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'reference-')),before=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!before.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});const d=s.store.draft();d.sourceUrl='https://example.com/video';d.sourceText='当前原稿';s.store.save();const sourceFile=path.join(root,'source.wav');fs.writeFileSync(sourceFile,'参考媒体测试内容');const sourceAsset=s.store.addAsset(sourceFile);let unchanged=true;const collected={source:{url:d.sourceUrl,assetId:sourceAsset.id,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(sourceAsset.path)).digest('hex'),duration:10,basis:'video'},transcript:{text:sample,segments:[{text:sample,start:0,end:10}]},visual:{status:'not-requested',observations:[],limitation:'本次未观察画面'},evidence:{}};s.references.source.collect=async()=>structuredClone(collected);s.references.source.unchanged=async()=>unchanged;s.providers.text=async(system,user,ctx,options)=>({text:options?.schema?JSON.stringify(analysis()):'先检查你每天需要取用的物品，把常用物品放在手边，然后根据实际体验调整摆放。',model:'fixture'});return {s,id:d.id,collected,setChanged:()=>unchanged=false};}
async function report(f){await f.s.invoke('analyzeReferenceVideo',{id:f.id});return f.s.store.data.runs[0];}
test('报告不改原稿，创作与编辑选用接第二步并撤销所有旧产物绑定',async t=>{const f=fixture(t),{s,id}=f,r=await report(f);assert.equal(s.store.draft().sourceText,'当前原稿');assert.equal(r.output.analysis.hook.start,0);await s.invoke('createReferenceScript',{id,runId:r.id,brief:'整理桌面，只给观察建议'});const c=s.store.data.runs[0];assert.equal(c.output.sourceRunId,r.id);const d=s.store.draft();d.finalText='';d.voice.audioId='old-audio';d.video.audioId='old-drive';d.video.assetId='old-video';d.edit.sourceId='manual-source';d.edit.resultId='old-edit';d.cover.assetId='old-cover';d.cover.videoId='old-cover-video';d.publish.videoId='manual-video';d.publish.coverId='manual-cover';d.publish.recordId='old-record';const out=await s.invoke('useReferenceScript',{id,runId:c.id,kind:'created',text:c.output.text+'请先从一小片区域开始。'});assert.equal(out.step,1);assert.equal(out.confirmed,false);assert.equal(out.rewrite,'');for(const [group,keys]of Object.entries({voice:['audioId'],video:['audioId','assetId'],edit:['sourceId','resultId'],cover:['assetId','videoId'],publish:['videoId','coverId','recordId']}))for(const key of keys)assert.equal(out[group][key],'',group+'.'+key);assert.equal(out.referenceSelection.kind,'created');});
test('编造、拼接摘录与错误顺序必须拒绝，模型时间被丢弃',()=>{const a=analysis();a.hook.start=999;assert.equal(validateAnalysis(a,{text:sample,segments:[{start:0,end:10,text:sample}]},10).hook.start,0);for(const quote of ['不存在的台词','先看看调整位置']){a.sections[1].quote=quote;assert.throws(()=>validateAnalysis(a,{text:sample},10),/摘录/);}a.sections=[analysis().sections[2],analysis().sections[1]];assert.throws(()=>validateAnalysis(a,{text:sample},10),/顺序/);});

test('选用编辑后的文案按当前正文重建画像，原参考画像仅留在报告',async t=>{
 const f=fixture(t),r=await report(f),before=structuredClone(r.output.contentProfile),text='这是一份安装教程，按操作步骤完成设置后检查结果。请先核对前置条件，再依次执行。';
 const used=await f.s.invoke('useReferenceScript',{id:f.id,runId:r.id,kind:'transcript',text});
 assert.equal(used.contentProfile.type,'tutorial');assert.equal(used.contentProfile.sourceKind,'text');assert.deepEqual(r.output.contentProfile,before);
});
test('混合音画结构拒绝画面与台词之间的时间倒序',()=>{const a=analysis();a.contentType='mixed';a.sections=[{basis:'visual',visualSamples:[0],quote:'',label:'末段画面',purpose:'观察工具'},analysis().sections[0]];assert.throws(()=>validateAnalysis(a,{text:sample,segments:[{start:0,end:10,text:sample}]},30,{status:'succeeded',observations:[{time:20,description:'工具'}]}),/音画段落时间顺序/);});
test('模型契约错误仅纠正一次且保留失败证据，模型调用失败不盲目补发',async t=>{const f=fixture(t),{s,id}=f;let calls=0;s.providers.text=async()=>{calls++;return {text:JSON.stringify(calls===1?{...analysis(),sections:[{label:'虚构',purpose:'错误',quote:'来源中没有这一句'}]}:analysis())};};const r=await report(f);assert.equal(calls,2);assert.equal(r.output.evidence.validationAttempts.length,1);assert.match(r.output.evidence.repairPrompt.user,/来源中没有这一句/);calls=0;s.providers.text=async()=>{calls++;return {text:'无效JSON'};};await assert.rejects(s.invoke('analyzeReferenceVideo',{id}),/JSON/);assert.equal(calls,2);assert.equal(s.store.data.runs[0].failureOutput.validationAttempts.length,2);calls=0;s.providers.text=async()=>{calls++;throw Error('服务不可用');};await assert.rejects(s.invoke('analyzeReferenceVideo',{id}),/服务不可用/);assert.equal(calls,1);assert.equal(s.store.draft(id).sourceText,'当前原稿');});
test('重复引用不虚构定位，末尾重复句使用最后位置，无轴时间为空',()=>{const text='你知道吗？请先看看。你知道吗？',a={summary:'重复提问',hook:{kind:'提问',quote:'你知道吗？',explanation:'提问'},sections:[{label:'中段',purpose:'提醒',quote:'请先看看。'}],ending:{quote:'你知道吗？',explanation:'重复提问'},reusableStructure:['重复'],uncertainties:[]};const out=validateAnalysis(a,{text,segments:[{text:'你知道吗？',start:0,end:1},{text:'请先看看。',start:1,end:2},{text:'你知道吗？',start:2,end:3}]},3);assert.equal(out.hook.start,null);assert.equal(out.ending.start,2);assert.equal(validateAnalysis(a,{text},3).ending.start,null);});
test('运行中改稿只留stale报告，过期与来源变更拒绝生成和选用',async t=>{const f=fixture(t),{s,id}=f;let resolve;s.providers.text=()=>new Promise(r=>resolve=r);const pending=s.invoke('analyzeReferenceVideo',{id});while(!resolve)await new Promise(r=>setImmediate(r));s.store.draft().sourceText='新稿';resolve({text:JSON.stringify(analysis())});const out=await pending;assert.equal(out.stale,true);const run=s.store.data.runs[0];await assert.rejects(s.invoke('useReferenceScript',{id,runId:run.id,kind:'transcript'}),/失效/);s.providers.text=async()=>({text:JSON.stringify(analysis())});const good=await report(f);f.setChanged();await assert.rejects(s.invoke('createReferenceScript',{id,runId:good.id,brief:'观察日常'}),/来源/);await assert.rejects(s.invoke('useReferenceScript',{id,runId:good.id,kind:'transcript'}),/来源/);});
test('双击和停止不会生成第二run或迟到写稿，unknown不能补发',async t=>{const {s,id}=fixture(t);let resolve;s.providers.text=()=>new Promise(r=>resolve=r);const pending=s.invoke('analyzeReferenceVideo',{id});while(!resolve)await new Promise(r=>setImmediate(r));await assert.rejects(s.invoke('analyzeReferenceVideo',{id}),/正在处理/);assert.equal(s.store.data.runs.length,1);s.runtime.cancel(s.store.data.runs[0].id);resolve({text:JSON.stringify(analysis())});await assert.rejects(pending);assert.equal(s.store.data.runs[0].status,'cancelled');assert.equal(s.store.draft().sourceText,'当前原稿');s.store.data.runs.unshift({id:'unknown',type:'reference-analysis',status:'unknown',draftId:id});await assert.rejects(s.invoke('analyzeReferenceVideo',{id}),/待确认/);});
test('跨稿、类型混用与短稿拒绝，保存失败回滚且不切换当前任务',async t=>{const f=fixture(t),{s,id}=f,r=await report(f),other=await s.invoke('newDraft');await assert.rejects(s.invoke('useReferenceScript',{id:other.id,runId:r.id,kind:'transcript'}),/报告不存在/);await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'created'}),/报告不存在/);await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript',text:'太短'}),/至少20/);const before=structuredClone(s.store.draft(id)),save=s.store.save;s.store.save=()=>{throw Error('模拟ENOSPC');};await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'}),/ENOSPC/);assert.deepEqual(s.store.draft(id),before);assert.equal(s.store.data.currentId,other.id);s.store.save=save;await s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});assert.equal(s.store.data.currentId,other.id);});
test('自动流程保护与持久unknown均阻止选用和改稿',async t=>{const f=fixture(t),r=await report(f),{s,id}=f;s.store.data.workflowJobs=[{id:'job',draftId:id,status:'unknown'}];await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'}),/待确认/);s.store.data.workflowJobs=[];s.store.data.runs.unshift({id:'production',draftId:id,type:'avatar',status:'unknown'});await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'}),/待确认/);});
test('选用最后一次异步校验期间改稿或插入生产任务必须拒绝',async t=>{const f=fixture(t),r=await report(f),{s,id}=f;let release;s.references.source.unchanged=()=>new Promise(resolve=>release=resolve);const pending=s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});s.store.draft(id).sourceText='等待期间新改的文案';release(true);await assert.rejects(pending,/变化/);assert.equal(s.store.draft(id).sourceText,'等待期间新改的文案');s.store.draft(id).sourceText='当前原稿';const next=s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});s.store.data.runs.unshift({id:'new-production',draftId:id,type:'avatar',status:'running'});release(true);await assert.rejects(next,/正在处理/);assert.equal(s.store.draft(id).sourceText,'当前原稿');});
test('非口播用真实采样编号建结构与画面稿，不把歌词选成台词',async t=>{const f=fixture(t),{s,id,collected}=f;collected.visual={status:'succeeded',observations:[{time:0,description:'手持猫砂铲'},{time:8,description:'铲中有结团猫砂'}],limitation:'两张静态采样'};const a={contentType:'music-visual',audioRole:'音轨识别疑似歌词，未独立试听。',summary:'清理猫砂的画面展示',hook:{basis:'visual',kind:'操作画面开场',quote:'',visualSamples:[0],explanation:'直接呈现工具'},sections:[{basis:'visual',label:'工具入画',quote:'',visualSamples:[0],purpose:'近景展示猫砂铲，提供具体的操作对象。'},{basis:'visual',label:'结团细节',quote:'',visualSamples:[1],purpose:'特写展示铲内结团，不推断实际性能。'}],ending:{basis:'visual',quote:'',visualSamples:[1],explanation:'结团近景'},reusableStructure:['工具—细节'],uncertainties:['未观察帧间完整动作']};s.providers.text=async()=>({text:JSON.stringify(a)});const r=await report(f);assert.equal(r.output.analysis.sections[1].start,8);assert(r.output.outline.text.includes('工具入画'));await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'}),/歌词/);const used=await s.invoke('useReferenceScript',{id,runId:r.id,kind:'outline'});assert.equal(used.sourceText,r.output.outline.text);assert.equal(used.referenceSelection.scriptBasis,'visual-analysis');a.sections[0].visualSamples=[99];assert.throws(()=>validateAnalysis(a,collected.transcript,10,collected.visual),/真实采样/);a.sections[0].visualSamples=[0];a.sections[0].quote='可见猫砂铲';assert.throws(()=>validateAnalysis(a,collected.transcript,10,collected.visual),/冒充/);});

test('无声视频只依据真实画面生成结构与画面草案，不产生原片台词',async t=>{
 const f=fixture(t),{s,id,collected}=f;collected.source.hasAudio=false;collected.transcript={text:'',segments:[],timingAvailable:false,evidence:{engine:'none',hasAudio:false}};collected.visual={status:'succeeded',observations:[{time:0,description:'盒子放在桌面'},{time:8,description:'盒盖被移到一侧'}],limitation:'两张静态采样，不能推断完整开盒动作'};
 const a={contentType:'music-visual',audioRole:'无法从采样推断声音',summary:'桌面盒子与盒盖位置变化',hook:{basis:'visual',kind:'实物开场',quote:'',visualSamples:[0],explanation:'开头可见盒子'},sections:[{basis:'visual',label:'盒子整体',quote:'',visualSamples:[0],purpose:'展示桌面盒子的外观。'},{basis:'visual',label:'盒盖位置',quote:'',visualSamples:[1],purpose:'展示盒盖移至一侧的可见状态。'}],ending:{basis:'visual',quote:'',visualSamples:[1],explanation:'盒盖与盒子同框'},reusableStructure:['整体—细节'],uncertainties:['没有音轨，只观察静态采样']};
 let prompt;s.providers.text=async(system,user)=>{prompt=JSON.parse(user);return {text:JSON.stringify(a)};};await s.invoke('analyzeReferenceVideo',{id,includeVisual:true});const r=s.store.data.runs[0];assert.equal(r.status,'succeeded');assert.equal(r.output.transcript.text,'');assert.equal(prompt.audioEvidence.hasAudio,false);assert.equal(r.output.contentProfile.type,'non-verbal-visual');assert.match(r.output.analysis.audioRole,/没有音轨/);assert.equal(r.output.qualityAccepted,false);assert.ok(r.output.outline.text);
 await assert.rejects(s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'}),/主体为画面/);
 for(const invalid of [{...a,contentType:'spoken'},{...a,voiceover:{text:'伪造台词'}},{...a,hook:{...a.hook,basis:'transcript'}},{...a,sections:[{...a.sections[0],quote:'伪造引用'}]}])assert.throws(()=>validateAnalysis(invalid,collected.transcript,10,collected.visual,collected.source),/原片台词/);
 assert.throws(()=>validateAnalysis(a,{text:'伪造的转写',segments:[]},10,collected.visual,collected.source),/补造转写/);
 const used=await s.invoke('useReferenceScript',{id,runId:r.id,kind:'outline'});assert.equal(used.contentProfile.outputMode,'visual');assert.equal(used.referenceSelection.scriptBasis,'visual-analysis');
});

test('无声来源缺少真实画面或不是视频时在模型调用前拒绝，不把空转写当成功',async t=>{
 const {s,id,collected}=fixture(t);collected.source.hasAudio=false;collected.transcript={text:'',segments:[]};let calls=0;s.providers.text=async()=>{calls++;throw Error('不应调用');};
 await assert.rejects(s.invoke('analyzeReferenceVideo',{id,includeVisual:true}),/配置并完成真实画面分析/);assert.equal(calls,0);
 collected.visual={status:'succeeded',observations:[{time:0,description:'桌面'}]};collected.source.basis='audio';await assert.rejects(s.invoke('analyzeReferenceVideo',{id,includeVisual:true}),/配置并完成真实画面分析/);assert.equal(calls,0);
 collected.source.hasAudio=true;collected.source.basis='video';await assert.rejects(s.invoke('analyzeReferenceVideo',{id,includeVisual:true}),/原始转写/);assert.equal(calls,0);
});

test('原视频只分析一次，切换创作预设可复用报告但拒绝旧预设创作稿',async t=>{
 const f=fixture(t),{s,id}=f;
 let collectCount=0;const collect=s.references.source.collect;
 s.references.source.collect=async(...args)=>{collectCount++;return collect(...args);};
 const r=await report(f),before=structuredClone(s.store.draft(id));
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'tutorial',instruction:'写清检查结果'}});
 const first=await s.invoke('createReferenceScript',{id,runId:r.id,brief:'整理桌面，只给观察建议'}),firstRun=s.store.data.runs[0];
 assert.equal(first.stale,false);assert.equal(first.creativePreset.id,'tutorial');assert.equal(first.sourceRunId,r.id);
 assert.deepEqual(firstRun.parameters.contentProfile,first.creativePreset.contentProfile);assert.deepEqual(first.contentProfile,first.creativePreset.contentProfile);
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'knowledge'}});
 await assert.rejects(s.invoke('useReferenceScript',{id,runId:firstRun.id,kind:'created'}),/创作预设.*变化/);
 assert.equal(s.store.draft(id).sourceText,before.sourceText);assert.equal(s.store.draft(id).finalText,before.finalText);
 const second=await s.invoke('createReferenceScript',{id,runId:r.id,brief:'整理桌面，只给观察建议'});
 assert.equal(second.stale,false);assert.equal(second.creativePreset.id,'knowledge');assert.equal(second.sourceRunId,r.id);assert.equal(collectCount,1);
 assert.equal(s.store.data.runs.filter(run=>run.type==='reference-analysis').length,1);assert.equal(s.store.data.runs.filter(run=>run.type==='reference-script').length,2);
});

test('参考创作生成中切换预设仅留下过期候选，不要求重做原始解析',async t=>{
 const f=fixture(t),{s,id}=f,r=await report(f);let release,notify;
 const started=new Promise(resolve=>notify=resolve),before=structuredClone(s.store.draft(id));
 s.providers.text=async()=>{notify();return new Promise(resolve=>release=resolve);};
 const pending=s.invoke('createReferenceScript',{id,runId:r.id,brief:'整理桌面，只给观察建议'});
 await started;await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'review'}});
 release({text:'先检查常用物品的位置，再按拿取习惯尝试调整，最后观察调整后的使用情况。'});
 const result=await pending,run=s.store.data.runs[0];
 assert.equal(result.stale,true);assert.equal(run.output.stale,true);assert.equal(run.status,'succeeded');assert.equal(s.store.draft(id).sourceText,before.sourceText);
 await assert.rejects(s.invoke('useReferenceScript',{id,runId:run.id,kind:'created'}),/失效/);
 s.providers.text=async()=>({text:'把你每天需要的物品集中在容易拿取的位置，再观察实际体验，并按需要逐步调整。'});
 const current=await s.invoke('createReferenceScript',{id,runId:r.id,brief:'整理桌面，只给观察建议'});
 assert.equal(current.stale,false);assert.equal(current.creativePreset.id,'review');assert.equal(s.store.data.runs.filter(item=>item.type==='reference-analysis').length,1);
});

test('选用创作稿最后一次异步校验期间切换预设仍拒绝旧稿',async t=>{
 const f=fixture(t),{s,id}=f,r=await report(f);
 await s.invoke('createReferenceScript',{id,runId:r.id,brief:'整理桌面，只给观察建议'});
 const created=s.store.data.runs[0],before=structuredClone(s.store.draft(id));let release,notify;
 const started=new Promise(resolve=>notify=resolve);
 s.references.source.unchanged=async()=>{notify();return new Promise(resolve=>release=resolve);};
 const pending=s.invoke('useReferenceScript',{id,runId:created.id,kind:'created'});
 await started;await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'story'}});release(true);
 await assert.rejects(pending,/创作预设.*变化/);
 assert.equal(s.store.draft(id).sourceText,before.sourceText);assert.equal(s.store.draft(id).referenceSelection,undefined);
});


const verifiedFacts=()=>[{id:'box',sample:0,name:'接砂盒',color:'米白色',structure:'盒内壁光滑，无筛孔',use:'接取猫砂结块'}];
async function visualReport(f){f.collected.visual={status:'succeeded',observations:[{time:0,description:'模型误认猫砂铲'}],limitation:'只采样一帧'};return report(f);}
test('独立实体核对保留原观察并关联来源哈希、执行ID与修订历史，普通草稿不能伪造凭据',async t=>{
 const f=fixture(t),{s,id}=f,r=await visualReport(f),original=structuredClone(r.output.visual);
 const review=await s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:verifiedFacts()});assert.equal(review.analysisRunId,r.id);assert.equal(review.sourceSha256,r.output.source.sha256);assert.equal(review.revision,1);assert.deepEqual(r.output.visual,original);assert.equal(r.output.qualityAccepted,false);
 const used=await s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});assert.equal(used.referenceSelection.visualFactsRequired,true);assert.equal(s.references.selectionFacts(s.store.draft(id)).facts[0].name,'接砂盒');
 const forged=structuredClone(s.store.draft(id));forged.referenceSelection.visualFactsRequired=false;forged.referenceSelection.sourceSha256='fake';s.store.updateDraft(forged);assert.equal(s.store.draft(id).referenceSelection.sourceSha256,review.sourceSha256);
 const changed=verifiedFacts();changed[0].color='浅米白色';const second=await s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:changed});assert.equal(second.revision,2);assert.equal(r.output.visualFactsHistory.length,1);assert.deepEqual(r.output.visualFactsHistory[0],review);assert.equal(s.references.selectionFacts(s.store.draft(id)).reviewSha256,second.reviewSha256);
});
test('未确认画面不能作为生成事实，来源链接、原文件和核对内容变化均使凭据失效',async t=>{
 const f=fixture(t),{s,id}=f,r=await visualReport(f);await s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});assert.throws(()=>s.references.selectionFacts(s.store.draft(id)),/尚未确认/);
 await s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:verifiedFacts()});const d=s.store.draft(id),url=d.sourceUrl;d.sourceUrl='https://example.com/other';assert.throws(()=>s.references.selectionFacts(d),/失效/);d.sourceUrl=url;
 r.output.visualFactsReview.facts[0].color='被篡改';assert.throws(()=>s.references.selectionFacts(d),/尚未确认/);r.output.visualFactsReview.facts[0].color='米白色';
 fs.writeFileSync(s.store.asset(r.output.source.assetId).path,'changed');assert.throws(()=>s.references.selectionFacts(d),/文件已变化/);await assert.rejects(s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:verifiedFacts()}),/文件内容已变化/);
});
test('实体核对字段及采样严格校验，落盘失败回滚修订和已选用凭据',async t=>{
 const f=fixture(t),{s,id}=f,r=await visualReport(f);for(const facts of [[],[{...verifiedFacts()[0],sample:99}],[{...verifiedFacts()[0],color:''}],[...verifiedFacts(),...verifiedFacts()]])await assert.rejects(s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts}));
 await s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:verifiedFacts()});await s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});const before=structuredClone(r.output),selection=structuredClone(s.store.draft(id).referenceSelection),save=s.store.save;s.store.save=()=>{throw Error('ENOSPC');};const facts=verifiedFacts();facts[0].color='浅米白';await assert.rejects(s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts}),/ENOSPC/);s.store.save=save;assert.deepEqual(r.output,before);assert.deepEqual(s.store.draft(id).referenceSelection,selection);
});


test('脱离参考归档凭据保留文案素材，撤销旧选用，普通保存不能恢复关联',async t=>{
 const f=fixture(t),{s,id}=f,r=await visualReport(f);await s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:verifiedFacts()});await s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});
 const d=s.store.draft(id);d.video.assetId='old';d.edit.sourceId='old';d.edit.captions=[{start:0,end:1,text:'旧字幕'}];d.story=require('../server/story-contract.cjs').createStory(d);d.story.referenceFacts=s.references.selectionFacts(d);const before=structuredClone(d),assets=structuredClone(s.store.data.assets),settings=structuredClone(s.store.data.settings);
 d.sourceUrl='https://example.com/other';const result=await s.invoke('detachReferenceSource',{id});assert.equal(result.referenceSelection,undefined);assert.equal(s.references.selectionFacts(result),null);assert.equal(result.story.referenceFacts,undefined);assert.equal(result.sourceText,before.sourceText);assert.equal(result.video.assetId,'');assert.equal(result.edit.sourceId,'');assert.deepEqual(s.store.data.assets,assets);assert.deepEqual(s.store.data.settings,settings);assert.deepEqual(result.artifacts.referenceDetachments[0].selection,before.referenceSelection);
 const forged=structuredClone(result);forged.referenceSelection=before.referenceSelection;delete forged.artifacts.referenceDetachments;s.store.updateDraft(forged);assert.equal(s.store.draft(id).referenceSelection,undefined);assert.deepEqual(s.store.draft(id).artifacts.referenceDetachments,result.artifacts.referenceDetachments);
});
test('脱离参考保存失败完整回滚，未结束的任务拒绝解除',async t=>{
 const f=fixture(t),{s,id}=f,r=await visualReport(f);await s.invoke('confirmReferenceVisualFacts',{id,runId:r.id,facts:verifiedFacts()});await s.invoke('useReferenceScript',{id,runId:r.id,kind:'transcript'});const before=structuredClone(s.store.draft(id)),save=s.store.save;s.store.save=()=>{throw Error('ENOSPC');};await assert.rejects(s.invoke('detachReferenceSource',{id}),/ENOSPC/);s.store.save=save;assert.deepEqual(s.store.draft(id),before);
 s.store.data.runs.push({id:'pending',draftId:id,type:'story-video',status:'unknown'});await assert.rejects(s.invoke('detachReferenceSource',{id}),/处理或结果待确认/);assert.deepEqual(s.store.draft(id),before);
});
