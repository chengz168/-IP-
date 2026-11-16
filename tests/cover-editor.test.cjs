const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,createDraft}=require('../server/store.cjs');
const {createService}=require('../server/service.cjs');
const model=()=>import('../src/cover-model.mjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-cover-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));return root;}

test('封面默认文字宽度对齐原版90%画布，启用背景显式宽度时共同折行',async()=>{
 const {textStyle}=await model(),{layoutText}=await import('../src/cover-render.mjs');
 const ctx={measureText:text=>({width:Array.from(text).length*100})};
 const implicit=layoutText(ctx,{id:'main',text:'一二三四五六七八九十',style:{}});assert.equal(implicit.width,972);assert.deepEqual(implicit.rows,['一二三四五六七八九','十']);
 const bg=layoutText(ctx,{id:'main',text:'一二三四五六七八九十',style:{background:{enabled:true,width:600}}});assert.equal(bg.width,600);assert.deepEqual(bg.rows,['一二三四五六','七八九十']);
 const disabled=layoutText(ctx,{id:'main',text:'一二三四五六七八九十',style:{background:{enabled:false,width:600}}});assert.equal(disabled.width,972);
 assert.equal(textStyle({boxWidth:850}).boxWidth,850,'已有用户显式文字宽度保留');
});
test('旧任务只读转换保留主副标题、独立层和坐标，不修改原对象',async()=>{const {coverScene}=await model(),cover=createDraft().cover;Object.assign(cover,{title:'旧主标题',subtitle:'旧副标题',fontSize:88,y:.7,layers:[{text:'独立文字',fontSize:45,color:'#123456',x:.3,y:.2}]});const before=JSON.stringify(cover),scene=coverScene(cover);assert.equal(JSON.stringify(cover),before);assert.equal(scene.layers.find(l=>l.id==='main').style.y,1344);assert.equal(scene.layers.find(l=>l.id==='legacy-0').style.x,324);assert.ok(scene.layers.some(l=>l.text==='旧副标题'));});
test('15模板多层、渐变、装饰线与文字绑定可独立编辑，不污染模板或其他场景',async()=>{const {coverTemplates,templateScene,validScene}=await model();assert.equal(coverTemplates.length,15);const before=JSON.stringify(coverTemplates),a=templateScene('v16','主标题','副标题'),b=templateScene('v16','另一个主标题','另一个副标题');a.layers[0].style.shadow.blur=45;a.layers.find(l=>l.id==='main').text='已编辑';assert.notEqual(b.layers[0].style.shadow.blur,45);assert.equal(b.layers.find(l=>l.id==='main').text,'另一个主标题');for(const t of coverTemplates)validScene(templateScene(t.id,'标题','副标题'));assert.equal(JSON.stringify(coverTemplates),before);assert.equal(templateScene('v4').shapes.length,1);assert.equal(templateScene('v12').mask.fillLinearGradientColorStops.length,6);});
test('旋转选区按局部坐标命中，不能仅凭垂直位置选中文字',async()=>{const {hitLayer,textStyle}=await model(),layout={style:textStyle({x:540,y:960,rotation:90}),left:-100,width:200,height:50};assert.equal(hitLayer({x:540,y:1040},layout),true);assert.equal(hitLayer({x:620,y:960},layout),false);assert.equal(hitLayer({x:900,y:960},layout),false);});
test('场景数值无效时拒绝导出，空画布允许导出背景',async()=>{const {validScene,templateScene}=await model(),scene=templateScene('default');scene.layers[0].style.fontSize=NaN;assert.throws(()=>validScene(scene),/字号/);scene.layers=[];assert.equal(validScene(scene),scene);});
test('修改封面图层解除旧图片与首帧视频，保留原始剪辑视频',t=>{const store=new Store(fixture(t)),d=store.draft();d.edit.resultId='edited-video';d.cover.assetId='old-cover';d.cover.videoId='old-covered-video';d.publish.videoId='old-covered-video';store.save();const next=structuredClone(d);next.cover.layers.push({text:'新图层'});store.updateDraft(next);assert.equal(store.draft().cover.assetId,'');assert.equal(store.draft().cover.videoId,'');assert.equal(store.draft().publish.videoId,'');assert.equal(store.draft().edit.resultId,'edited-video');});
test('默认封面模板只影响新任务，不改写已有任务',async t=>{const service=createService(fixture(t)),original=structuredClone(service.store.draft());await service.invoke('saveCoverDefault',{templateId:'v18'});const created=await service.invoke('newDraft');assert.equal(created.cover.template,'v18');assert.equal(created.cover.modelVersion,1);assert.deepEqual(service.store.data.drafts.find(d=>d.id===original.id),original);await assert.rejects(service.invoke('saveCoverDefault',{templateId:'missing'}),/不存在/);});
test('过期封面快照与无效图片不附着到任务，不伪造成功产物',async t=>{const service=createService(fixture(t)),d=service.store.draft();await assert.rejects(service.invoke('saveCover',{id:d.id,signature:'expired',base64:'data:image/png;base64,'}),/已变化/);await assert.rejects(service.invoke('saveCover',{id:d.id,base64:'data:image/png;base64,'+Buffer.alloc(150).toString('base64')}));assert.equal(service.store.draft().cover.assetId,'');assert.equal(service.store.data.assets.length,0);});
test('封面提交持久化失败不留下半条资产记录，恢复可写后一次提交资产和引用',async t=>{
 const service=createService(fixture(t)),store=service.store,before=fs.readFileSync(store.file,'utf8'),oldDraft=structuredClone(store.draft()),save=store.save.bind(store);
 // 此项只注入存储失败；真实图像解码另由桌面和媒体专项验收。
 service.media.probe=async()=>({streams:[{codec_type:'video',width:1080,height:1920}]});const payload={id:oldDraft.id,base64:'data:image/png;base64,'+Buffer.alloc(150).toString('base64')};
 store.save=()=>{throw new Error('验收注入：磁盘不可写');};await assert.rejects(service.invoke('saveCover',payload),/磁盘不可写/);assert.equal(fs.readFileSync(store.file,'utf8'),before);assert.deepEqual(store.draft(),oldDraft);assert.equal(store.data.assets.length,0);assert.deepEqual(fs.readdirSync(store.assetDir),[]);assert.deepEqual(fs.readdirSync(store.outputDir()),[]);
 let calls=0;store.save=()=>{calls++;save();};const asset=await service.invoke('saveCover',payload),reopened=JSON.parse(fs.readFileSync(store.file,'utf8'));assert.equal(calls,1);assert.equal(reopened.drafts[0].cover.assetId,asset.id);assert.equal(reopened.assets.length,1);assert.equal(reopened.assets[0].id,asset.id);assert.ok(fs.existsSync(asset.path));
});
