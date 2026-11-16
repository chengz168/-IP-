const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createService}=require('../server/service.cjs'),{createDraft}=require('../server/store.cjs');
const load=()=>import('../server/copy-confirmation.mjs');
function serviceFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'copy-confirmation-')),before=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!before.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});return s;}
function actionFixture(){
 const d=Object.assign(createDraft(),{sourceText:'原稿',rewrite:'已经核对的改写稿',finalText:'旧最终稿',confirmed:false}),draft={value:d},messages=[],started=[];
 const ctx={draft,save:async()=>{},act:async(label,work)=>work(),call:async(action,{input})=>({...draft.value,finalText:input.rewrite,confirmed:true}),notify:(...args)=>messages.push(args),startWorkflow:async(...args)=>started.push(args)};
 return {d,draft,ctx,messages,started};
}

test('空白改写回退原稿，非空改写保持空白及正文原写法',async()=>{
 const {copyCandidate}=await load();assert.equal(copyCandidate({sourceText:' 原稿。 ',rewrite:' \n '}),' 原稿。 ');assert.equal(copyCandidate({sourceText:'原稿',rewrite:' 改写。 '}),' 改写。 ');
});

test('确认原子保存并失效旧媒体引用，重开后仍为选定稿件',async t=>{
 const s=serviceFixture(t),d=s.store.draft();Object.assign(d,{sourceText:'旧原稿',rewrite:'新改写稿',finalText:'旧最终稿',confirmed:false});Object.assign(d.voice,{audioId:'旧声音'});d.video.assetId='旧视频';d.edit.resultId='旧剪辑';d.publish.videoId='旧剪辑';d.publish.recordId='旧发布包';s.store.save();const {confirmationInput}=await load(),saved=await s.invoke('confirmCopy',{id:d.id,input:confirmationInput(d)});
 assert.equal(saved.finalText,'新改写稿');assert.equal(saved.confirmed,true);assert.equal(saved.voice.audioId,'');assert.equal(saved.video.assetId,'');assert.equal(saved.edit.resultId,'');assert.equal(saved.publish.recordId,'');assert.equal(JSON.parse(fs.readFileSync(s.store.file,'utf8')).drafts[0].finalText,'新改写稿');
});

test('快照已变化、空输入或缺少快照均拒绝，不改变当前最终稿',async t=>{
 const s=serviceFixture(t),d=s.store.draft(),{confirmationInput}=await load();Object.assign(d,{sourceText:'原稿',rewrite:'改写',finalText:'手工最终稿',confirmed:false});s.store.save();const input=confirmationInput(d);d.rewrite='后改稿';s.store.save();await assert.rejects(s.invoke('confirmCopy',{id:d.id,input}),/输入已变化/);await assert.rejects(s.invoke('confirmCopy',{id:d.id}),/输入已变化/);assert.equal(d.finalText,'手工最终稿');d.sourceText=' ';d.rewrite='\n';s.store.save();await assert.rejects(s.invoke('confirmCopy',{id:d.id,input:confirmationInput(d)}),/请先输入/);
});

test('写盘失败回滚确认及所有媒体引用，不改变磁盘和当前任务',async t=>{
 const s=serviceFixture(t),d=s.store.draft(),{confirmationInput}=await load();Object.assign(d,{sourceText:'原稿',rewrite:'新稿',finalText:'旧稿',confirmed:false});d.voice.audioId='旧声音';d.edit.resultId='旧视频';s.store.save();const before=structuredClone(s.store.data),bytes=fs.readFileSync(s.store.file,'utf8'),save=s.store.save;s.store.save=()=>{throw Error('受控写盘失败');};try{await assert.rejects(s.invoke('confirmCopy',{id:d.id,input:confirmationInput(d)}),/写盘失败/);}finally{s.store.save=save;}assert.deepEqual(s.store.data,before);assert.equal(fs.readFileSync(s.store.file,'utf8'),bytes);
});

test('源稿或改写稿改变撤销旧确认，保留独立最终稿与已有素材引用；切页不撤销',async t=>{
 const s=serviceFixture(t),d=s.store.draft();Object.assign(d,{sourceText:'原稿',rewrite:'改写',finalText:'独立编辑的最终稿',confirmed:true});d.voice.audioId='既有音频';s.store.save();let next=structuredClone(d);next.step=3;assert.equal((await s.invoke('saveDraft',next)).confirmed,true);next=structuredClone(s.store.draft());next.rewrite='新改写';let saved=await s.invoke('saveDraft',next);assert.equal(saved.confirmed,false);assert.equal(saved.finalText,'独立编辑的最终稿');assert.equal(saved.voice.audioId,'既有音频');saved.confirmed=true;s.store.save();next=structuredClone(saved);next.sourceText='新原文';assert.equal((await s.invoke('saveDraft',next)).confirmed,false);
});

test('确认后台任务不抢当前任务，活动流程拒绝改确认',async t=>{
 const s=serviceFixture(t),first=s.store.draft(),{confirmationInput}=await load();first.sourceText='第一稿';s.store.save();const second=await s.invoke('newDraft');await s.invoke('confirmCopy',{id:first.id,input:confirmationInput(first)});assert.equal(s.store.data.currentId,second.id);s.store.data.workflowJobs=[{id:'active',draftId:first.id,status:'running'}];await assert.rejects(s.invoke('confirmCopy',{id:first.id,input:confirmationInput(s.store.draft(first.id))}),/先停止/);
});

test('保存失败不先写已确认，也不调用后端确认或后续流程',async()=>{
 const f=actionFixture(),before=structuredClone(f.d);let calls=0;f.ctx.save=async()=>{throw Error('受控保存失败');};f.ctx.call=async()=>calls++;const r=await(await import('../src/copy-confirmation-action.mjs')).confirmCopyAction(f.ctx);assert.equal(r,false);assert.equal(calls,0);assert.deepEqual(f.d,before);assert.equal(f.started.length,0);assert.match(f.messages[0][0],/保存文案失败/);
});

for(const change of ['任务','改写','最终稿'])test('等待初次保存时变化'+change+'不确认、不启动其他任务',async()=>{
 const f=actionFixture();f.d.mode='auto';let calls=0;f.ctx.save=async()=>{if(change==='任务')f.draft.value=createDraft();if(change==='改写')f.d.rewrite='新改写';if(change==='最终稿')f.d.finalText='手工新最终稿';};f.ctx.call=async()=>calls++;assert.equal(await(await import('../src/copy-confirmation-action.mjs')).confirmCopyAction(f.ctx),false);assert.equal(calls,0);assert.equal(f.started.length,0);
});

test('后端确认期间改字或换任务，较早返回不覆盖当前编辑且不启动',async()=>{
 for(const switchTask of [false,true]){const f=actionFixture(),before=structuredClone(f.d);f.d.mode='auto';f.ctx.call=async()=>{if(switchTask)f.draft.value=Object.assign(createDraft(),{sourceText:'新任务'});else f.d.rewrite='用户新写稿';return {...before,mode:'auto',finalText:before.rewrite,confirmed:true};};assert.equal(await(await import('../src/copy-confirmation-action.mjs')).confirmCopyAction(f.ctx),false);assert.equal(f.started.length,0);assert.equal(f.draft.value.rewrite,switchTask?'':'用户新写稿');}
});

test('正常确认只在成功后启动捕获任务，连续点击只提交一次',async()=>{
 const f=actionFixture(),{confirmCopyAction}=await import('../src/copy-confirmation-action.mjs');f.d.mode='background';let release,calls=0;f.ctx.call=async(action,{input})=>{calls++;await new Promise(r=>release=r);return {...f.draft.value,finalText:input.rewrite,confirmed:true};};const pending=confirmCopyAction(f.ctx);for(let i=0;i<10&&!release;i++)await new Promise(r=>setImmediate(r));assert(release);assert.equal(f.d.confirmed,false);assert.equal(await confirmCopyAction(f.ctx),false);release();assert.equal(await pending,true);assert.equal(calls,1);assert.equal(f.draft.value.confirmed,true);assert.deepEqual(f.started,[['background',f.d.id]]);
});

test('旁支编辑不被确认返回的整份草稿覆盖，也不启动后续流程',async()=>{
 const f=actionFixture(),before=structuredClone(f.d);f.d.mode='auto';f.ctx.call=async()=>{f.d.voice.speed=1.5;return {...before,mode:'auto',finalText:before.rewrite,confirmed:true};};assert.equal(await(await import('../src/copy-confirmation-action.mjs')).confirmCopyAction(f.ctx),false);assert.equal(f.draft.value.voice.speed,1.5);assert.equal(f.started.length,0);
});

test('文件权限错误保留原因并给出恢复步骤，界面清理Electron内部前缀',async t=>{
 const s=serviceFixture(t),d=s.store.draft(),{confirmationInput}=await load();d.sourceText='原稿';s.store.save();const save=s.store.save;s.store.save=()=>{throw Object.assign(Error('原始文件不可写'),{code:'EPERM'});};try{await assert.rejects(s.invoke('confirmCopy',{id:d.id,input:confirmationInput(d)}),error=>/文案确认保存失败.*重试/.test(error.message)&&error.cause.code==='EPERM');}finally{s.store.save=save;}
 const f=actionFixture();let message;f.ctx.call=async()=>{throw Error("Error invoking remote method 'studio:invoke': Error: 文案确认保存失败，当前稿件已保留。");};f.ctx.act=async(_,work)=>{try{return await work();}catch(error){message=error.message;}};assert.equal(await(await import('../src/copy-confirmation-action.mjs')).confirmCopyAction(f.ctx),false);assert.equal(message,'文案确认保存失败，当前稿件已保留。');assert.equal(f.d.confirmed,false);
});
