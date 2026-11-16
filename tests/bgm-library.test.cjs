const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Store}=require('../server/store.cjs'),{BgmLibrary}=require('../server/bgm-library.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t,text){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bgm-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const library=path.join(root,'library');fs.mkdirSync(library);const bytes=Buffer.from('受控测试音频字节');fs.writeFileSync(path.join(library,'track.wav'),bytes);
 const store=new Store(path.join(root,'workspace')),draft=store.draft();draft.finalText='今天讲解如何保存视频和整理素材。';Object.assign(draft.edit,{bgmEnabled:true,bgmSource:'system',bgmResourceId:'',bgmId:''});
 const catalog=[{name:'知识科普',files:[{id:'music-test',name:'舒缓-测试.wav',relative:'track.wav',bytes:bytes.length,sha256:digest(bytes)}]}];
 const media={probe:async()=>({streams:[{codec_type:'audio'}],format:{duration:2}})};
 const provider={text:text||(async()=>({text:JSON.stringify({resourceId:'music-test',reason:'文案为教程，按舒缓标签选择。'}),request:{model:'test'},usage:{}}))};
 return {store,draft,library,media,provider,music:new BgmLibrary(store,media,provider,{root:library,catalog})};
}
test('真实音乐目录44项与清单散列和原版分类顺序一致',()=>{
 const catalog=require('../server/bgm-catalog.json');assert.deepEqual(catalog.map(g=>g.name),['情感','通用','新闻','营销','知识科普']);assert.equal(catalog.flatMap(g=>g.files).length,44);assert.equal(new Set(catalog.flatMap(g=>g.files).map(f=>f.sha256)).size,42);
 for(const group of catalog)for(const file of group.files){const bytes=fs.readFileSync(path.join(__dirname,'../server/assets/bgm',file.relative));assert.equal(bytes.length,file.bytes);assert.equal(digest(bytes),file.sha256);}
});
test('背景音乐旧任务、本地与系统来源切换保持已选文件，读取不写默认字段',async()=>{
 const {bgmSelection,bgmSummary}=await import('../server/bgm-model.mjs'),old={bgmEnabled:true,bgmId:'old'},before=JSON.stringify(old);
 assert.equal(bgmSelection(old).source,'upload');assert.equal(bgmSelection(old).auto,false);assert.equal(JSON.stringify(old),before);
 assert.equal(bgmSelection({...old,bgmSource:'system'}).auto,false);assert.equal(bgmSummary(old,[{id:'old',name:'音乐.wav'}]),'音乐.wav');
 assert.equal(bgmSummary({bgmEnabled:true}),'AI 自动匹配');assert.equal(bgmSummary({}),'已关闭');
});
test('预览不增素材，选曲校验并复用已导入文件，保存失败清理新副本',async t=>{
 const {store,music}=fixture(t),count=store.data.assets.length;assert.ok(music.preview('music-test').url.startsWith('data:audio/wav;base64,'));assert.equal(store.data.assets.length,count);
 const asset=await music.select('music-test');assert.equal((await music.select('music-test')).id,asset.id);assert.equal(store.data.assets.length,count+1);assert.throws(()=>music.resolve('../../track.wav'),/不存在/);
 const failed=fixture(t);failed.store.save=()=>{throw Error('磁盘只读');};await assert.rejects(failed.music.select('music-test'),/磁盘只读/);assert.equal(failed.store.data.assets.length,0);assert.deepEqual(fs.readdirSync(failed.store.assetDir),[]);
});
test('真实匹配契约保留模型请求依据、音轨散列且不改任务选择',async t=>{
 const {store,draft,music}=fixture(t),before=JSON.stringify(draft),prepared=await music.prepare(structuredClone(draft),{signal:new AbortController().signal});
 assert.equal(prepared.record.auto,true);assert.equal(prepared.record.match.request.model,'test');assert.equal(prepared.record.match.category,'知识科普');assert.ok(store.asset(prepared.draft.edit.bgmId));assert.equal(JSON.stringify(draft),before);prepared.check();
 fs.appendFileSync(store.asset(prepared.draft.edit.bgmId).path,'changed');assert.throws(prepared.check,/已变化/);
});
test('不存在的曲目、分类错配、无效理由及多余字段不随机回退',async t=>{
 for(const value of [{resourceId:'不存在',reason:'测试'},{category:'知识科普',name:'舒缓-测试.wav',reason:'测试'},{resourceId:'music-test',reason:''},{resourceId:'music-test',reason:'测试',extra:1}]){
  const {store,draft,music}=fixture(t,async()=>({text:JSON.stringify(value),request:{model:'test'}}));await assert.rejects(music.prepare(structuredClone(draft)),error=>{assert.match(error.message,/无效/);assert.equal(error.evidence.returnedText,JSON.stringify(value));assert.equal(error.evidence.request.model,'test');return true;});assert.equal(store.data.assets.length,0);
 }
});
test('模型期间输入变化或停止均不导入、不返回可绑定匹配',async t=>{
 const changed=fixture(t);changed.provider.text=async()=>{changed.draft.finalText='输入已改';return {text:'{}'};};await assert.rejects(changed.music.prepare(structuredClone(changed.draft)),/设置已变化/);assert.equal(changed.store.data.assets.length,0);
 const cancelled=fixture(t),controller=new AbortController();cancelled.provider.text=async()=>{controller.abort();return {text:'{}'};};await assert.rejects(cancelled.music.prepare(structuredClone(cancelled.draft),{signal:controller.signal}),{name:'AbortError'});assert.equal(cancelled.store.data.assets.length,0);
});
test('手动音乐不请求模型，无音轨或空文案自动模式明确失败',async t=>{
 const item=fixture(t,async()=>{throw Error('不应请求');}),asset=await item.music.select('music-test');Object.assign(item.draft.edit,{bgmId:asset.id,bgmResourceId:'music-test'});const manual=await item.music.prepare(structuredClone(item.draft));assert.equal(manual.record.auto,false);assert.equal(manual.record.match,null);
 item.media.probe=async()=>({streams:[{codec_type:'video'}],format:{duration:2}});await assert.rejects(item.music.prepare(structuredClone(item.draft)),/有效音轨/);
 const empty=fixture(t);empty.draft.finalText='';await assert.rejects(empty.music.prepare(structuredClone(empty.draft)),/确认文案/);
});
