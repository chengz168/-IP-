const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./support/licensed-service.cjs'),{Store,createDraft}=require('../server/store.cjs');
const {restoreSignature}=require('../server/caption-history.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'caption-source-')),listeners=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!listeners.has(fn));
 t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const asset=name=>{const file=path.join(root,name);fs.writeFileSync(file,'隔离契约字节，不是真实媒体');return s.store.addAsset(file);},a=asset('A.mp4'),b=asset('B.mp4');
 s.media.probe=async()=>({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'10'}});
 const d=s.store.draft();d.edit.sourceId=a.id;d.edit.captions=[{id:'row',start:0,end:4,text:'原视频字幕',pipId:'image',auxiliary:{sourceText:'原视频字幕',translation:'Original',keywords:['原视频']}}];d.edit.resultId='old-render';d.edit.subtitleCustom={fontSize:48};d.edit.pipCategory='手选分类';d.edit.subtitleProofread={runId:'proof'};d.cover.videoId='old-cover-video';d.publish.videoId='old-render';d.publish.recordId='old-publish';s.store.save();return {s,a,b,id:d.id};
}
function change(s,id,source){const next=structuredClone(s.store.draft(id));next.edit.sourceId=source;return s.store.updateDraft(next);}
function history(s,id){return s.store.draft(id).artifacts.captionHistory;}
test('界面先保存手工稿再换源清字幕，保存失败和中途切任务均不改源',async()=>{
 const {changeCaptionSource}=await import('../src/caption-source.mjs');let count=0;const draft={value:createDraft()};draft.value.edit.sourceId='A';draft.value.edit.captions=[{start:0,end:1,text:'未保存的手工稿'}];
 await changeCaptionSource({draft,save:async()=>{count++;if(count===1)assert.equal(draft.value.edit.captions[0].text,'未保存的手工稿');}},'B');assert.equal(count,2);assert.equal(draft.value.edit.sourceId,'B');assert.deepEqual(draft.value.edit.captions,[]);
 await assert.rejects(changeCaptionSource({draft,save:async()=>{throw Error('写盘失败');}},'C'),/写盘失败/);assert.equal(draft.value.edit.sourceId,'B');await assert.rejects(changeCaptionSource({draft,save:async()=>{draft.value=createDraft();}},'C'),/任务或视频已变化/);assert.equal(draft.value.edit.sourceId,'');
});
test('较早的界面快照不删除已经归档的历史',t=>{
 const {s,b,id}=fixture(t);change(s,id,b.id);const old=structuredClone(s.store.draft(id));delete old.artifacts.captionHistory;old.title='用户编辑标题';s.store.updateDraft(old);assert.equal(history(s,id).length,1);
});
test('换源完整归档字幕与校对，不携带旧逐句素材，保留样式分类并失效成片',t=>{
 const {s,a,b,id}=fixture(t),before=structuredClone(s.store.draft(id)),next=change(s,id,b.id),entry=history(s,id)[0];
 assert.equal(entry.sourceId,a.id);assert.deepEqual(entry.rows,before.edit.captions);assert.deepEqual(entry.proofread,before.edit.subtitleProofread);assert.deepEqual(next.edit.captions,[]);assert.equal(next.edit.subtitleProofread,undefined);assert.deepEqual(next.edit.subtitleCustom,before.edit.subtitleCustom);assert.equal(next.edit.pipCategory,'手选分类');assert.equal(next.edit.resultId,'');assert.equal(next.cover.videoId,'');assert.equal(next.publish.videoId,'');assert.equal(next.publish.recordId,'');
});
test('有效手选源不变时生成视频变化不误清字幕；来回切换去重保留历史',t=>{
 const {s,a,b,id}=fixture(t),next=structuredClone(s.store.draft(id));next.video.assetId=b.id;s.store.updateDraft(next);assert.equal(s.store.draft(id).edit.captions.length,1);assert.equal(history(s,id),undefined);change(s,id,b.id);change(s,id,a.id);const d=structuredClone(s.store.draft(id));d.edit.captions=structuredClone(history(s,id)[0].rows);s.store.updateDraft(d);change(s,id,b.id);assert.equal(history(s,id).length,1);
});
test('保存失败回滚内存、当前任务和磁盘，旧任务重载不制造历史来源',t=>{
 const {s,b,id}=fixture(t),bytes=fs.readFileSync(s.store.file),before=structuredClone(s.store.data),save=s.store.save;s.store.save=()=>{throw Error('模拟不可写');};assert.throws(()=>change(s,id,b.id),/不可写/);assert.deepEqual(s.store.data,before);assert.deepEqual(fs.readFileSync(s.store.file),bytes);s.store.save=save;const reopened=new Store(s.store.root);assert.equal(reopened.draft(id).artifacts.captionHistory,undefined);assert.deepEqual(reopened.draft(id).edit.captions,before.drafts[0].edit.captions);
});
test('其他视频拒绝恢复，同源恢复保留完整行、归档手工版本且不抢当前任务',async t=>{
 const {s,a,b,id}=fixture(t);change(s,id,b.id);const entry=history(s,id)[0];await assert.rejects(s.invoke('restoreCaptionHistory',{id,historyId:entry.id,signature:restoreSignature(s.store.draft(id))}),/其他视频/);change(s,id,a.id);let d=structuredClone(s.store.draft(id));d.edit.captions=[{start:0,end:3,text:'恢复前的手工稿'}];s.store.updateDraft(d);const other=createDraft();s.store.data.drafts.push(other);s.store.data.currentId=other.id;s.store.save();const restored=await s.invoke('restoreCaptionHistory',{id,historyId:entry.id,signature:restoreSignature(s.store.draft(id))});assert.deepEqual(restored.edit.captions,entry.rows);assert(history(s,id).some(e=>e.reason==='before-restore'&&e.rows[0].text==='恢复前的手工稿'));assert.equal(restored.edit.resultId,'');assert.equal(s.store.data.currentId,other.id);
});
test('恢复拒绝旧快照、无效时间、缺失视频和自动流程锁',async t=>{
 for(const kind of ['signature','bounds','overlap','missing','lock']){
  const {s,a,b,id}=fixture(t);change(s,id,b.id);change(s,id,a.id);const e=history(s,id)[0];let sig=restoreSignature(s.store.draft(id));if(kind==='signature')sig='old';if(kind==='bounds'){e.rows[0].end=11;sig=restoreSignature(s.store.draft(id));}if(kind==='overlap'){e.rows.push({start:3,end:5,text:'重叠'});sig=restoreSignature(s.store.draft(id));}if(kind==='missing')fs.renameSync(a.path,a.path+'.moved');if(kind==='lock')s.store.data.workflowJobs=[{id:'active',draftId:id,status:'running'}];await assert.rejects(s.invoke('restoreCaptionHistory',{id,historyId:e.id,signature:sig}));assert.deepEqual(s.store.draft(id).edit.captions,[]);
 }
});
test('恢复探测期间字幕、历史或文件变化均拒绝，保存失败可原样重试',async t=>{
 for(const kind of ['captions','history','file','save']){
  const {s,a,b,id}=fixture(t);change(s,id,b.id);change(s,id,a.id);const entry=history(s,id)[0],sig=restoreSignature(s.store.draft(id));
  const probe=s.media.probe;s.media.probe=async file=>{if(kind==='captions')s.store.draft(id).edit.captions=[{start:0,end:2,text:'刚改的字幕'}];if(kind==='history')history(s,id)[0].rows[0].text='已改的历史';if(kind==='file')fs.appendFileSync(file,'变动');return probe(file);};
  const save=s.store.save;if(kind==='save')s.store.save=()=>{throw Error('模拟写盘失败');};const before=structuredClone(s.store.draft(id));await assert.rejects(s.invoke('restoreCaptionHistory',{id,historyId:entry.id,signature:sig}),kind==='save'?/写盘失败/:/已变化/);
  if(kind==='save'){assert.deepEqual(s.store.draft(id),before);s.store.save=save;s.media.probe=probe;await s.invoke('restoreCaptionHistory',{id,historyId:entry.id,signature:sig});assert.equal(s.store.draft(id).edit.captions.length,1);}
 }
});
test('数字人结果附着经过换源归档；新视频自动计划不能复用旧字幕',async t=>{
 const {s,a,b,id}=fixture(t),d=s.store.draft(id);d.video.assetId=a.id;d.edit.sourceId='';d.video.avatarId='shape';d.video.audioId=a.id;s.store.data.avatars.push({id:'shape',assetId:a.id});s.store.data.settings.provider.avatarUrl='http://127.0.0.1:1/fixture';s.store.save();s.providers.avatar=async()=>b;await s.invoke('avatar',{id});assert.equal(s.store.draft(id).video.assetId,b.id);assert.deepEqual(s.store.draft(id).edit.captions,[]);assert.equal(history(s,id)[0].sourceId,a.id);
 const next=s.store.draft(id);next.video.assetId='';next.edit.captions=[{start:0,end:1,text:'无源旧字幕'}];const plan=s.workflows.plan(id);assert.equal(plan.stages.find(stage=>stage.key==='transcribe').action,'generate');
});
test('自动识别校验时长、重叠及文件变化，失败不挂字幕或剪辑产物',async t=>{
 for(const kind of ['valid','bounds','overlap','file']){
  const {s,id}=fixture(t),d=s.store.draft(id);d.edit.captions=[];d.edit.resultId='';d.confirmed=true;d.finalText='已确认的正文';d.cover.title='已有标题';d.publish={...d.publish,title:'标题',description:'描述',tags:['标签']};Object.assign(s.store.data.settings.provider,{baseUrl:'http://127.0.0.1:1',asrModel:'fixture'});
  s.renderCover=async()=>{throw Error('本专项停止于后续封面，不属于效果验收');};s.providers.transcribe=async sourceId=>{if(kind==='file')fs.appendFileSync(s.store.asset(sourceId).path,'变化');return {text:'新视频字幕',segments:kind==='overlap'?[{start:0,end:4,text:'第一句'},{start:3,end:5,text:'重叠句'}]:[{start:0,end:kind==='bounds'?11:4,text:'新视频字幕'}]};};
  let rendered=false;s.pipMatching.render=async()=>{rendered=true;throw Error('时间轴专项在渲染前结束');};s.store.save();await s.invoke('startWorkflow',{id,mode:'auto'});for(let i=0;i<150&&s.store.data.workflowJobs[0].status!=='failed';i++)await new Promise(r=>setTimeout(r,5));const job=s.store.data.workflowJobs[0];assert.equal(job.status,'failed');assert.equal(s.store.draft(id).edit.resultId,'');if(kind==='valid'){assert.equal(s.store.draft(id).edit.captions[0].text,'新视频字幕');assert(rendered);}else{assert.deepEqual(s.store.draft(id).edit.captions,[]);assert.equal(rendered,false);assert.equal(job.stages.find(stage=>stage.key==='transcribe').status,'failed');}
 }
});
test('自动新视频真正重新识别后进入渲染，不复用生成前的旧字幕',async t=>{
 const {s,a,b,id}=fixture(t),d=s.store.draft(id),add=name=>{const file=path.join(s.store.root,name);fs.writeFileSync(file,'自动队列契约夹具，不是真实生成');return s.store.addAsset(file);};
 d.edit.sourceId='';d.video.assetId='';d.edit.resultId='';d.voice.audioId=add('existing.wav').id;d.video.avatarId='avatar';d.confirmed=true;d.finalText='确认正文';d.cover.title='已有封面标题';d.cover.assetId=add('cover.jpg').id;Object.assign(d.publish,{title:'已有发布标题',description:'已有描述',tags:['标签']});s.store.data.avatars=[{id:'avatar',assetId:a.id}];Object.assign(s.store.data.settings.provider,{avatarUrl:'http://127.0.0.1:1/fixture',baseUrl:'http://127.0.0.1:1',asrModel:'fixture'});s.store.save();
 let recognized=0,rendered=0;s.providers.avatar=async()=>b;s.providers.transcribe=async source=>{recognized++;assert.equal(source,b.id);assert.deepEqual(s.store.draft(id).edit.captions,[]);return {text:'新视频专用字幕',segments:[{start:0,end:3,text:'新视频专用字幕'}]};};s.pipMatching.render=async input=>{rendered++;assert.equal(input.video.assetId,b.id);assert.equal(input.edit.captions[0].text,'新视频专用字幕');return b;};await s.invoke('startWorkflow',{id,mode:'background'});for(let i=0;i<200&&['queued','running'].includes(s.store.data.workflowJobs[0].status);i++)await new Promise(r=>setTimeout(r,5));assert.equal(s.store.data.workflowJobs[0].status,'awaiting_publish');assert.equal(recognized,1);assert.equal(rendered,1);assert.equal(history(s,id)[0].rows[0].text,'原视频字幕');assert.equal(s.store.draft(id).edit.captions[0].text,'新视频专用字幕');
});
test('桌面预加载桥允许字幕历史恢复且保留未知动作拒绝',async()=>{
 const vm=require('node:vm');let bridge,forwarded;vm.runInNewContext(fs.readFileSync(path.resolve('electron/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(key,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{forwarded=args;return true;}}})});const payload={id:'draft',historyId:'history',signature:'snapshot'};assert.equal(await bridge.invoke('restoreCaptionHistory',payload),true);assert.deepEqual(forwarded,['studio:invoke','restoreCaptionHistory',payload]);await assert.rejects(bridge.invoke('unknown',{}),/不支持的操作/);
});
