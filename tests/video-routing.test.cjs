const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const {createDraft}=require('../server/store.cjs');
const {detectVideoRoute,effectiveVideoRoute,applyVideoRoute}=require('../server/video-routing.cjs');

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-routing-')),prior=new Set(process.listeners('exit')),service=createService(root),listener=process.listeners('exit').find(fn=>!prior.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});return {service,draft:service.store.draft()};}

test('商品介绍里的镜头和演示指令进入保留旁白的分镜模式，不误判成商品详情宣传或剧情',async t=>{
 const text='今天看看这家工厂的板材。镜头移到侧边看厚度，接着给边缘特写。展示过程里把表面的残渣清理干净。';
 const route=detectVideoRoute({finalText:text,confirmed:true});assert.equal(route.mode,'story');assert.equal(route.kind,'demonstration');assert.equal(route.confidence,'medium');
 const {service,draft}=fixture(t),input=structuredClone(draft);input.sourceText=text;await service.invoke('saveDraft',input);const saved=await service.invoke('confirmCopy',{id:draft.id,input:require('../server/copy-confirmation.mjs').confirmationInput(service.store.draft(draft.id))});assert.equal(saved.video.mode,'story');assert.equal(saved.story.narrationMode,'upstream');assert.equal(saved.story.sourceMode,'upstream');
});

test('角色对白与场景标记进入剧情分镜，日常单人解释不因说故事二字误判',()=>{
 const drama=detectVideoRoute({finalText:'场景一：厨房，早晨\n小林：你怎么还没出发？\n阿杰：我在找钥匙。\n场景二：门口，连续\n小林：在桌上，快走吧。'});assert.equal(drama.mode,'story');assert.equal(drama.kind,'drama');assert.equal(drama.confidence,'high');
 const lecture=detectVideoRoute({finalText:'今天给大家讲一个创业故事，重点是如何核对每一步。'});assert.equal(lecture.mode,'single');
});

test('镜头词语不会只看题材字样；简短普通稿低置信度并解释需要人工核对',()=>{
 assert.equal(detectVideoRoute({finalText:'这个故事很有意思，今天分享给大家。'}).mode,'single');
 const route=detectVideoRoute({finalText:'今天聊聊我的生活。'});assert.equal(route.confidence,'low');assert.match(route.reason,/手动调整/);
});

test('直接编辑已确认最终文案时重新自动路由，确认选用新候选同样生效',async t=>{
 const {service,draft}=fixture(t);Object.assign(draft,{finalText:'今天介绍板材。镜头移到侧边。再给边缘特写。',confirmed:true});draft.video.routing={policy:'auto'};draft.video.mode='single';service.store.save();
 let next=structuredClone(draft);next.finalText='场景一：车间\n小周：板材到了吗？\n老王：到了。\n场景二：仓库\n小周：我们现在就测量。';assert.equal((await service.invoke('saveDraft',next)).video.mode,'story');
 next=structuredClone(service.store.draft(draft.id));next.sourceText='今天我们聊聊如何挑选板材。';next.rewrite='';await service.invoke('saveDraft',next);
 const {confirmationInput}=require('../server/copy-confirmation.mjs');const saved=await service.invoke('confirmCopy',{id:draft.id,input:confirmationInput(service.store.draft(draft.id))});assert.equal(saved.video.mode,'single');assert.equal(saved.video.routing.policy,'auto');
});

test('明确手动模式覆盖识别并继续保留用户已选多镜头，恢复自动才同步推荐模式',t=>{
 const draft=Object.assign(createDraft(),{finalText:'场景一：夜班\n小李：机器启动了吗？\n小王：开始了。\n场景二：清晨\n小李：交接完成。',confirmed:true});draft.video.mode='multi';draft.video.routing={policy:'manual',mode:'multi'};applyVideoRoute(draft);assert.equal(effectiveVideoRoute(draft).mode,'multi');assert.equal(effectiveVideoRoute(draft).recommendedMode,'story');
 draft.video.routing.policy='auto';applyVideoRoute(draft);assert.equal(draft.video.mode,'story');
});

test('历史草稿保留原手动模式和成片；自动剧情即使伪造single也不能绕过服务直接生成口型',async t=>{
 const {service,draft}=fixture(t);draft.finalText='场景一：车间\n小林：开始了吗？\n老赵：开始了。\n场景二：门口\n小林：走吧。';draft.confirmed=true;draft.video.mode='single';draft.video.assetId='保留的历史视频';draft.video.routing={policy:'manual',mode:'single'};service.store.save();const saved=await service.invoke('saveDraft',structuredClone(draft));assert.equal(saved.video.mode,'single');assert.equal(saved.video.assetId,'保留的历史视频');saved.video.routing.policy='auto';assert.throws(()=>require('../server/avatar-request.cjs').avatarContext(service.store,saved),/不能直接走人物口型生成/);
});

test('新草稿初始等待最终稿，缺失和损坏路由记录不信任客户端提供的伪造模式',async t=>{
 const draft=createDraft();assert.equal(draft.video.routing.policy,'auto');assert.equal(draft.video.routing.confidence,'low');
 const {service,draft:stored}=fixture(t);stored.finalText='场景一：家里\n小美：准备好了吗？\n爸爸：好了。\n场景二：车站\n小美：我们出发吧。';stored.confirmed=true;stored.video.routing={policy:'auto'};stored.video.mode='single';const forged=structuredClone(stored);forged.video.mode='unknown';await assert.rejects(service.invoke('saveDraft',forged),/视频制作方式选择无效/);
});

test('不同格式的自然叙事、纯画面及明确多形象稿各走对应流程，商品参数表不是角色对白',()=>{
 assert.equal(detectVideoRoute({finalText:'小林推开门，发现桌上有一封信。突然窗外响起敲门声，他拿起信走出房间。与此同时，小王赶到了楼下。'}).mode,'story');
 assert.equal(detectVideoRoute({finalText:'纯画面，不需要口播。清晨水珠滑过叶片，阳光缓缓照进窗台。'}).kind,'visual');
 assert.equal(detectVideoRoute({finalText:'采用多镜头口播，切换不同形象分别解释三个问题。'}).mode,'multi');
 assert.equal(detectVideoRoute({finalText:'品牌：本厂\n材质：钢板\n厚度：10毫米\n价格：请咨询\n优点：方便清洁'}).mode,'single');
});

test('只提到产品或手动商品写作预设不能伪造商品资料，真实关联镜头商品图才能自动推荐商品链路',()=>{
 const d={finalText:'今天介绍一款产品。',creativePreset:{mode:'manual',presetId:'product'}};assert.equal(detectVideoRoute(d).mode,'single');
 d.product={title:'扒炉',scriptRunId:'已选商品脚本',shots:[{text:'产品介绍',imageId:'用户确认商品图'}]};assert.equal(detectVideoRoute(d).mode,'product');
});

test('自动切换制作链路撤销旧口型剪辑源及发布派生绑定，素材文件保留',async t=>{
 const {service,draft}=fixture(t),file=path.join(service.store.root,'prior.mp4');fs.writeFileSync(file,'文件保留契约，非真实视频');const asset=service.store.addAsset(file);
 draft.finalText='旧讲解正文';draft.confirmed=true;Object.assign(draft.video,{assetId:asset.id});Object.assign(draft.edit,{sourceId:asset.id,resultId:'旧剪辑'});Object.assign(draft.cover,{assetId:'旧封面',videoId:'旧带封面视频'});Object.assign(draft.publish,{videoId:'旧带封面视频',coverId:'旧封面',recordId:'旧发布记录'});service.store.save();
 const next=structuredClone(draft);next.finalText='镜头移到侧边看板面。再给边缘特写。';const saved=await service.invoke('saveDraft',next);assert.equal(saved.video.mode,'story');assert.equal(saved.video.assetId,'');assert.equal(saved.edit.sourceId,'');assert.equal(saved.edit.resultId,'');assert.equal(saved.cover.assetId,'');assert.equal(saved.publish.videoId,'');assert.equal(saved.publish.recordId,'');assert(fs.existsSync(asset.path));
});

test('自动流程不为剧情创建人物口型阶段；保存路由说明和切页不让原任务过期',async t=>{
 const {service,draft}=fixture(t);draft.finalText='场景一：客厅\n小林：要走了吗？\n老赵：准备好了。\n场景二：车站';draft.confirmed=true;service.store.save();
 const plan=await service.invoke('planWorkflow',{id:draft.id});assert(plan.issues.some(issue=>issue.includes('分镜')));assert(!plan.stages.some(stage=>stage.key==='avatar'&&stage.action==='generate'));
 let calls=0;service.providers.avatar=async()=>{calls++;};await assert.rejects(service.invoke('avatar',{id:draft.id}),/不能直接走人物口型/);assert.equal(calls,0);assert.equal(service.store.data.runs.length,0);
 const {workflowInput}=require('../server/workflow-state.cjs'),before=workflowInput(draft),next=structuredClone(draft);next.video.routing.reason='说明文字变化';next.video.routing.sourceHash='新说明指纹';next.step=3;assert.equal(workflowInput(next),before);
});

test('首次读取老草稿只迁移手动策略，原有镜头、音频、成片与下游均保持',t=>{
 const {Store}=require('../server/store.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'routing-migrate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let store=new Store(root);const d=store.draft();delete d.video.routing;d.video.mode='multi';d.video.shots=[{avatarId:'原形象',duration:12}];d.voice.audioId='原音频';d.video.assetId='原视频';d.edit.sourceId='原视频';d.edit.resultId='原成片';store.save();store=new Store(root);const migrated=store.draft();assert.equal(migrated.video.routing.policy,'manual');assert.equal(migrated.video.mode,'multi');assert.deepEqual(migrated.video.shots,d.video.shots);assert.equal(migrated.voice.audioId,'原音频');assert.equal(migrated.edit.resultId,'原成片');assert.equal(migrated.video.assetId,'原视频');
});

test('路由切换写盘失败回滚模式和下游，活动工作流不能修改路由策略',async t=>{
 const {service,draft}=fixture(t);draft.finalText='镜头移到板材侧边，再给边缘特写。';draft.confirmed=true;draft.video.routing={policy:'manual',mode:'single'};draft.video.assetId='旧视频';service.store.save();const next=structuredClone(draft);next.video.routing.policy='auto';const original=structuredClone(service.store.data),save=service.store.save;service.store.save=()=>{throw Error('受控磁盘错误');};try{await assert.rejects(service.invoke('saveDraft',next),/受控磁盘错误/);}finally{service.store.save=save;}assert.deepEqual(service.store.data,original);service.store.data.workflowJobs=[{id:'活动工作流',draftId:draft.id,status:'running'}];await assert.rejects(service.invoke('saveDraft',next),/先停止/);
});

test('新版确认动作自动进入分镜工作台而不启动口型；保留手动调整后的普通口播路径',async()=>{
 const {confirmCopyAction}=await import('../src/copy-confirmation-action.mjs');
 for(const mode of ['manual','auto','background']){const original=Object.assign(createDraft(),{mode,sourceText:'场景一：房间\n小林：出发吗？\n小王：走吧。'}),draft={value:original},messages=[];let started=0;
 const result=await confirmCopyAction({draft,save:async()=>{},act:async(_,work)=>work(),call:async()=>({...draft.value,finalText:original.sourceText,confirmed:true,video:{...original.video,mode:'story'}}),notify:message=>messages.push(message),startWorkflow:async()=>{started++;}});
 assert.equal(result,true);assert.equal(draft.value.step,3);assert.equal(started,0);assert(messages.some(message=>message.includes('分镜创作')));}
});
