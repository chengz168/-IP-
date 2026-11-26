const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');
const {coverInput,coverSignature,frameInput,hashFile,assertCoverCurrent}=require('../server/cover-source.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cover-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=createService(root),store=service.store,d=store.draft();
 service.media.probe=async()=>({streams:[{codec_type:'video',width:1080,height:1920}],format:{duration:5}});
 const add=(name,type,extra={})=>{const file=path.join(root,name);fs.writeFileSync(file,name+'独立来源夹具');return store.addAsset(file,{type,...extra});};
 const video=add('video.mp4','video'),other=add('other.mp4','video');
 Object.assign(d,{confirmed:true,finalText:'真实文案',sourceText:'真实文案'});Object.assign(d.edit,{sourceId:video.id,resultId:video.id,subtitlesEnabled:false});
 d.cover.title='封面标题';Object.assign(d.publish,{title:'发布标题',description:'发布描述',tags:['标签']});
 const background=add('frame.png','image',{origin:'frame',frameSource:frameInput(store,video.id,0)});background.frameSha256=hashFile(background.path);
 d.cover.backgroundId=background.id;d.cover.frameTime=0;
 const cover=add('cover.png','image',{origin:'cover',coverSource:coverInput(store,d),coverSignature:coverSignature(d.cover)});cover.coverSha256=hashFile(cover.path);d.cover.assetId=cover.id;store.save();
 return {service,store,d,video,other,background,cover,add};
}
const action=(plan,key)=>plan.stages.find(stage=>stage.key===key).action;
const payload=id=>({id,base64:'data:image/png;base64,'+Buffer.alloc(150).toString('base64')});

test('自动封面只复用匹配当前视频的来源，换源和同ID文件变化都要求重新生成',async t=>{
 const f=fixture(t);assert.equal(action(await f.service.invoke('planWorkflow',{id:f.d.id}),'cover'),'reuse');
 f.d.edit.resultId=f.other.id;const changed=await f.service.invoke('planWorkflow',{id:f.d.id});assert.equal(action(changed,'frame'),'generate');assert.equal(action(changed,'cover'),'generate');
 f.d.edit.resultId=f.video.id;fs.appendFileSync(f.video.path,'同素材ID下替换内容');const replaced=await f.service.invoke('planWorkflow',{id:f.d.id});assert.equal(action(replaced,'frame'),'generate');assert.equal(action(replaced,'cover'),'generate');assert(fs.existsSync(f.cover.path));
});

test('即将重新剪辑时不能预先决定复用旧自动封面',async t=>{
 const f=fixture(t);f.d.edit.resultId='';const plan=await f.service.invoke('planWorkflow',{id:f.d.id});
 assert.equal(action(plan,'render'),'generate');assert.equal(action(plan,'frame'),'generate');assert.equal(action(plan,'cover'),'generate');
});

test('保存换源撤销自动背景和成品引用，保留旧文件及素材记录',async t=>{
 const f=fixture(t),next=structuredClone(f.d);next.edit.sourceId=f.other.id;next.publish.coverId=f.cover.id;f.store.updateDraft(next);
 const current=f.store.draft();assert.equal(current.cover.backgroundId,'');assert.equal(current.cover.assetId,'');assert.equal(current.publish.coverId,'');
 assert.equal(f.store.asset(f.cover.id).id,f.cover.id);assert(fs.existsSync(f.background.path));
});

test('同参数重新生成新视频产物时撤销旧自动封面',async t=>{
 const f=fixture(t);f.d.edit.sourceId='';f.d.edit.resultId='';f.d.video.assetId=f.video.id;
 const next=structuredClone(f.d);next.video.assetId=f.other.id;f.store.updateDraft(next);
 assert.equal(f.store.draft().cover.backgroundId,'');assert.equal(f.store.draft().cover.assetId,'');assert(fs.existsSync(f.cover.path));
});

test('手选通用背景与据此生成的封面允许换视频后保留',async t=>{
 const f=fixture(t),manual=f.add('manual.png','image',{origin:'import'});f.d.cover.backgroundId=manual.id;
 const rendered=f.add('manual-cover.png','image',{origin:'cover',coverSource:coverInput(f.store,f.d),coverSignature:coverSignature(f.d.cover)});rendered.coverSha256=hashFile(rendered.path);f.d.cover.assetId=rendered.id;
 const next=structuredClone(f.d);next.edit.sourceId=f.other.id;f.store.updateDraft(next);const current=f.store.draft();
 assert.equal(current.cover.backgroundId,manual.id);assert.equal(current.cover.assetId,rendered.id);assert.doesNotThrow(()=>assertCoverCurrent(f.store,current));
 const plan=await f.service.invoke('planWorkflow',{id:f.d.id});assert.equal(action(plan,'frame'),'skip');assert.equal(action(plan,'cover'),'reuse');
});

test('历史自动封面无来源不复用，历史导入图片仍作为显式手选封面',async t=>{
 const f=fixture(t);delete f.cover.coverSource;assert.equal(action(await f.service.invoke('planWorkflow',{id:f.d.id}),'cover'),'generate');
 const manual=f.add('chosen-cover.png','image',{origin:'import'});f.d.cover.assetId=manual.id;assert.equal(action(await f.service.invoke('planWorkflow',{id:f.d.id}),'cover'),'reuse');
});

test('保存封面记录背景和视频凭据，历史无来源帧不得补签',async t=>{
 const f=fixture(t),saved=await f.service.invoke('saveCover',payload(f.d.id));
 assert.deepEqual(saved.coverSource,coverInput(f.store,f.store.draft()));assert.equal(saved.coverSha256,hashFile(saved.path));
 delete f.background.frameSource;await assert.rejects(f.service.invoke('saveCover',payload(f.d.id)),/来源凭据/);
});

test('保存探测期间相同ID视频或背景字节变化会拒绝，不登记迟到封面',async t=>{
 for(const kind of ['video','background']){
  const f=fixture(t),before=f.store.data.assets.length,old=f.d.cover.assetId;
  f.service.media.probe=async()=>{fs.appendFileSync(f[kind].path,'探测期间内容变化');return {streams:[{codec_type:'video',width:1080,height:1920}]};};
  await assert.rejects(f.service.invoke('saveCover',payload(f.d.id)),/变化|来源/);assert.equal(f.store.data.assets.length,before);assert.equal(f.store.draft().cover.assetId,old);assert(fs.existsSync(f.cover.path));
 }
});

test('当前发布包拒绝旧视频封面且不留半成品目录，历史文件仍可单独导出',async t=>{
 const f=fixture(t);f.d.edit.resultId=f.other.id;
 const before=fs.readdirSync(f.store.outputDir());await assert.rejects(f.service.invoke('exportPackage',{id:f.d.id}),/封面|来源/);assert.deepEqual(fs.readdirSync(f.store.outputDir()),before);
 const destination=path.join(f.store.root,'历史封面.png');const exported=await require('../electron/export-asset.cjs').exportAsset({store:f.store,dialog:{showSaveDialog:async()=>({filePath:destination})}},f.cover.id);
 assert.equal(exported.canceled,false);assert.deepEqual(fs.readFileSync(destination),fs.readFileSync(f.cover.path));
});

test('封面视频在媒体探测之前拒绝旧来源，不启动编码',async t=>{
 const f=fixture(t);f.d.edit.resultId=f.other.id;let probed=0;f.service.media.probe=async()=>{probed++;throw Error('不应进入编码准备');};
 await assert.rejects(f.service.invoke('coverVideo',{id:f.d.id}),/封面|来源/);assert.equal(probed,0);assert(fs.existsSync(f.cover.path));
});

test('自动流程执行中源文件变化会阻止复用封面，不进入待发布',async t=>{
 const f=fixture(t);let changed=false;
 f.service.media.probe=async file=>{if(file===f.video.path&&!changed){changed=true;fs.appendFileSync(file,'执行中更换');}return {streams:[{codec_type:'video'}]};};
 await f.service.invoke('startWorkflow',{id:f.d.id,mode:'background'});
 for(let index=0;index<100&& !['failed','awaiting_publish'].includes(f.store.data.workflowJobs[0].status);index++)await new Promise(resolve=>setTimeout(resolve,5));
 const job=f.store.data.workflowJobs[0];assert.equal(job.status,'failed');assert.match(job.error,/封面背景|来源/);
 assert.equal(job.stages.find(stage=>stage.key==='cover').status,'failed');assert.equal(f.store.data.publishRecords.length,0);
});

test('封面解码等待期间源文件变化也不能穿过复用后的校验',async t=>{
 const f=fixture(t);f.service.media.probe=async file=>{if(file===f.cover.path)fs.appendFileSync(f.video.path,'封面探测途中换源');return {streams:[{codec_type:'video'}]};};
 await f.service.invoke('startWorkflow',{id:f.d.id,mode:'background'});
 for(let index=0;index<100&&!['failed','awaiting_publish'].includes(f.store.data.workflowJobs[0].status);index++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.store.data.workflowJobs[0].status,'failed');assert.match(f.store.data.workflowJobs[0].error,/来源|封面背景/);
});

test('发布包封面还必须匹配明确选择的发布视频，而不只匹配当前编辑视频',async t=>{
 const f=fixture(t);f.d.publish.videoId=f.other.id;
 await assert.rejects(f.service.invoke('exportPackage',{id:f.d.id}),/发布视频与自动封面来源不匹配/);
});

test('封面视频完成前换背景保留产物为失败证据，不能作为当前输出返回',async t=>{
 const f=fixture(t),manual=f.add('next-background.png','image',{origin:'import'}),output=f.add('late-video.mp4','video',{origin:'cover-video'});
 f.service.media.coverVideo=async()=>{const next=structuredClone(f.store.draft());next.cover.backgroundId=manual.id;f.store.updateDraft(next);return output;};
 await assert.rejects(f.service.invoke('coverVideo',{id:f.d.id}),/封面|文件不存在/);
 const run=f.store.data.runs[0];assert.equal(run.status,'failed');assert.equal(run.failureOutput.material.id,output.id);assert.equal(run.failureOutput.stale,true);
 assert.equal(f.store.draft().cover.videoId,'');assert.equal(f.store.asset(output.id).id,output.id);assert(fs.existsSync(f.cover.path));
});

test('当前自动封面可正常导出发布包，且保存的字节与来源一致',async t=>{
 const f=fixture(t),result=await f.service.invoke('exportPackage',{id:f.d.id});
 assert.deepEqual(fs.readFileSync(path.join(result.directory,'cover.png')),fs.readFileSync(f.cover.path));
 assert.deepEqual(fs.readFileSync(path.join(result.directory,'video.mp4')),fs.readFileSync(f.video.path));
 assert.equal(result.status,'exported');
});
