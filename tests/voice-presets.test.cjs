const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const {catalog,presetJob,definitionHash}=require('../server/voice-presets.cjs');
const {validateJob}=require('../server/voice-design.cjs');
const {hashFile}=require('../server/local-indextts.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-presets-')),priorExitListeners=new Set(process.listeners('exit')),service=createService(root),id=service.store.draft().id;let calls=0;
 const ownExitListeners=process.listeners('exit').filter(listener=>!priorExitListeners.has(listener));
 t.after(()=>{for(const listener of ownExitListeners)process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 // 此处文件只验证资源登记与篡改防护，真实媒体生成另行验收。
 service.voiceDesign.generate=async({id,job})=>{calls++;const file=path.join(root,'candidate-'+calls+'.wav');fs.writeFileSync(file,'测试替身，不是真实音频'+calls);const asset=service.store.addAsset(file,{origin:'qwen-voice-design',voiceDesign:{job,referenceAudio:null,model:'test-double',outputSha256:hashFile(file)}},{persist:false});service.store.data.runs.unshift({id:'run-'+calls,type:'voice-design',draftId:id,status:'succeeded',output:{assetId:asset.id}});return {assetId:asset.id};};
 return {service,id,calls:()=>calls,prepare:presetId=>service.invoke('prepareVoicePreset',{id,presetId})};
}
test('八种固定预设定义可用于现有音色设计校验，男女各四种',()=>{
 assert.equal(catalog.length,8);assert.equal(new Set(catalog.map(p=>p.id)).size,8);
 for(const gender of ['女声','男声'])assert.equal(catalog.filter(p=>p.gender===gender).length,4);
 for(const p of catalog){assert.ok(p.name.length<=10);assert.deepEqual(validateJob(presetJob(p)),presetJob(p));assert.match(definitionHash(p),/^[a-f0-9]{64}$/);}
});
test('没有实际生成记录的预设不会作为已就绪音色',async t=>{const f=fixture(t);const list=await f.service.invoke('listVoicePresets');assert.equal(list.length,8);assert.ok(list.every(p=>!p.ready&&!p.voiceId&&!p.sampleId));assert.equal(f.calls(),0);});
test('新增预设保留原音色与当前选择，重复请求幂等',async t=>{
 const f=fixture(t),original={id:'original',name:'用户原声音',sampleId:'original-sample'};f.service.store.data.voices.push(original);f.service.store.draft(f.id).voice.profile=original.id;
 const first=await f.prepare('natural-male'),second=await f.prepare('natural-male');assert.equal(first.id,second.id);assert.equal(f.calls(),1);assert.equal(f.service.store.data.voices.length,2);assert.deepEqual(f.service.store.data.voices[0],original);assert.equal(f.service.store.draft(f.id).voice.profile,'original');
 assert.equal(first.provenance.savedByUser,false);assert.equal(first.provenance.qualityAccepted,false);assert.equal(first.provenance.referenceAudio,null);assert.equal(first.provenance.kind,'builtin-voice-preset');
 const ready=f.service.voicePresets.list().find(p=>p.id==='natural-male');assert.equal(ready.ready,true);assert.equal(ready.voiceId,first.id);
});
test('文件丢失或内容改变时预设失效，重建保留声音ID',async t=>{
 const f=fixture(t),first=await f.prepare('warm-female'),asset=f.service.store.asset(first.sampleId);fs.appendFileSync(asset.path,'变化');assert.equal(f.service.voicePresets.list().find(p=>p.id==='warm-female').ready,false);
 const rebuilt=await f.prepare('warm-female');assert.equal(rebuilt.id,first.id);assert.notEqual(rebuilt.sampleId,first.sampleId);assert.equal(f.service.store.data.voices.length,1);fs.rmSync(f.service.store.asset(rebuilt.sampleId).path);assert.equal(f.service.voicePresets.installed(catalog[1]),null);
});
test('非法预设及草稿请求不启动模型',async t=>{const f=fixture(t);await assert.rejects(f.prepare('unknown'),/不存在/);await assert.rejects(f.service.invoke('prepareVoicePreset',{id:'unknown',presetId:'natural-male'}));assert.equal(f.calls(),0);});
test('自动流程及形象优化期间拒绝准备预设',async t=>{
 const f=fixture(t);f.service.store.data.workflowJobs=[{id:'active',draftId:f.id,status:'running'}];await assert.rejects(f.prepare('natural-male'),/自动流程/);f.service.store.data.workflowJobs=[];f.service.store.data.runs=[{type:'avatar-optimize',status:'running'}];await assert.rejects(f.prepare('natural-male'),/形象优化/);assert.equal(f.calls(),0);
});
test('同一预设并发请求拒绝重复，失败及取消清除等待标记',async t=>{
 const f=fixture(t);let fail;f.service.voiceDesign.generate=()=>new Promise((_,reject)=>{fail=reject;});const first=f.prepare('natural-male');await assert.rejects(f.prepare('natural-male'),/正在生成/);fail(Error('用户停止'));await assert.rejects(first,/用户停止/);assert.equal(f.service.voicePresets.pending.size,0);assert.equal(f.service.store.data.voices.length,0);
});
test('伪造、不同任务及不一致的设计记录不会登记为预设',async t=>{
 for(const patch of [asset=>{asset.origin='import';},asset=>{asset.voiceDesign.referenceAudio='私人声音.wav';},asset=>{asset.voiceDesign.job={};},asset=>{asset.voiceDesign.outputSha256='fake';},(_asset,s)=>{s.store.data.runs[0].draftId='foreign';},(_asset,s)=>{s.store.data.runs[0].status='cancelled';}]){
  const f=fixture(t),generate=f.service.voiceDesign.generate;f.service.voiceDesign.generate=async input=>{const result=await generate(input);patch(f.service.store.asset(result.assetId),f.service);return result;};await assert.rejects(f.prepare('natural-male'),/一致/);assert.equal(f.service.store.data.voices.length,0);assert.equal(f.service.voicePresets.pending.size,0);
 }
});
test('保存失败回滚新增和替换的声音资源',async t=>{
 const f=fixture(t),first=await f.prepare('natural-male');fs.appendFileSync(f.service.store.asset(first.sampleId).path,'变化');const generate=f.service.voiceDesign.generate;
 f.service.voiceDesign.generate=async input=>{const result=await generate(input);f.service.store.save=()=>{throw Error('磁盘已满');};return result;};await assert.rejects(f.prepare('natural-male'),/磁盘已满/);assert.deepEqual(f.service.store.data.voices,[first]);assert.equal(f.service.voicePresets.pending.size,0);f.service.store.data.voices=[];await assert.rejects(f.prepare('warm-female'),/磁盘已满/);assert.equal(f.service.store.data.voices.length,0);assert.equal(f.service.voicePresets.pending.size,0);
});
