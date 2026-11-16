const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDraft,defaults}=require('../server/store.cjs');
function fixture(){
 const data=defaults(),d=createDraft(),messages=[];d.video.assetId='prior';d.video.avatarId='shape';d.video.audioId='audio';data.settings.provider.avatarUrl='http://127.0.0.1:1/avatar';data.assets=[{id:'audio',path:'input.wav',type:'audio'},{id:'video',path:'shape.mp4',type:'video'}];data.avatars=[{id:'shape',assetId:'video'}];let saves=0;
 const ctx={draft:{value:d},state:{value:data},save:async()=>{saves++;},act:async(_,fn)=>fn(),call:async()=>({id:'new'}),notify:(...args)=>messages.push(args)};return {ctx,d,data,messages,get saves(){return saves;}};
}
test('新旧共用动作先保存、生成后立即保存，反馈要求检查口型而不认质量通过',async()=>{
 const f=fixture();await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(f.d.video.assetId,'new');assert.equal(f.saves,2);assert.match(f.messages[0][0],/检查口型和音画同步/);
});
test('保存失败或保存期间切任务不发生成请求',async()=>{
 for(const kind of ['fail','switch']){const f=fixture();let calls=0;f.ctx.save=async()=>{if(kind==='fail')throw Error('只读');f.ctx.draft.value=createDraft();};f.ctx.call=async()=>{calls++;};await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(calls,0);assert.equal(f.d.video.assetId,'prior');}
});
for(const kind of ['模型','驱动音频','形象资源','服务','任务','多镜头'])test('视频返回时'+kind+'编辑不被旧结果覆盖',async()=>{
 const f=fixture();f.ctx.call=async()=>{if(kind==='模型')f.d.video.model='v1';if(kind==='驱动音频')f.d.video.audioId='another';if(kind==='形象资源')f.data.avatars[0].assetId='another';if(kind==='服务')f.data.settings.provider.avatarUrl='http://127.0.0.1:2/avatar';if(kind==='任务')f.ctx.draft.value=createDraft();if(kind==='多镜头'){f.d.video.mode='multi';f.d.video.shots=[{avatarId:'shape',duration:3}];}return {id:'late'};};await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(f.d.video.assetId,'prior');assert.match(f.messages[0][0],/未替换当前视频/);
});
test('排队等待保存期间再次改输入不提交，服务端过期和停止也不绑定',async()=>{
 let f=fixture(),calls=0;f.ctx.act=async(_,fn)=>{f.d.video.model='v1';return fn();};f.ctx.call=async()=>{calls++;};await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(calls,0);
 for(const output of [undefined,{id:'stale',stale:true}]){f=fixture();f.ctx.call=async()=>output;await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(f.d.video.assetId,'prior');}
});
test('视频明确选用音频时无关声音与文字模型变化不误判过期',async()=>{
 const f=fixture();f.ctx.call=async()=>{f.d.voice.audioId='unused';f.data.settings.provider.model='unused';f.data.avatars[0].name='重命名';return{id:'valid'};};await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(f.d.video.assetId,'valid');
});
test('结果保存失败保留当前编辑并说明视频在素材库，不提示保存成功',async()=>{
 const f=fixture();let saves=0;f.ctx.save=async()=>{if(++saves===2)throw Error('只读');};await (await import('../src/avatar-action.mjs')).runAvatarAction(f.ctx);assert.equal(f.d.video.assetId,'new');assert.match(f.messages[0][0],/保存当前任务失败/);assert.equal(f.messages[0][1],'error');
});
test('未保存输入导致拒绝时立即保存编辑，保存失败明确报错',async()=>{
 const {runAvatarAction}=await import('../src/avatar-action.mjs');let f=fixture();f.ctx.call=async()=>{f.d.video.model='v1';return{id:'late'};};await runAvatarAction(f.ctx);assert.equal(f.saves,2);assert.match(f.messages[0][0],/未替换当前视频/);
 f=fixture();let saves=0;f.ctx.save=async()=>{if(++saves===2)throw Error('只读');};f.ctx.call=async()=>{f.d.video.model='v1';return{id:'late'};};await runAvatarAction(f.ctx);assert.equal(f.d.video.model,'v1');assert.equal(f.d.video.assetId,'prior');assert.match(f.messages[0][0],/保存当前编辑失败/);assert.equal(f.messages[0][1],'error');
});
