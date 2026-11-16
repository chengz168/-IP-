const test=require('node:test'),assert=require('node:assert/strict');
const {createDraft,defaults}=require('../server/store.cjs');
function fixture(){
 const data=defaults(),d=createDraft(),messages=[];d.finalText='用于核对音频输入的正文。';d.voice.audioId='已有配音';data.drafts=[d];data.currentId=d.id;Object.assign(data.settings.provider,{baseUrl:'http://127.0.0.1:1/v1',ttsModel:'model-a',voice:'voice-a'});
 const ctx={draft:{value:d},state:{value:data},save:async()=>{},act:async(_,fn)=>fn(),call:async()=>({id:'新配音'}),notify:(...args)=>messages.push(args)};return {ctx,d,data,messages};
}
test('当前输入的有效配音才绑定音频，不改原正文',async()=>{
 const f=fixture();await (await import('../src/speech-action.mjs')).runSpeechAction(f.ctx);assert.equal(f.d.voice.audioId,'新配音');assert.equal(f.d.finalText,'用于核对音频输入的正文。');assert.match(f.messages[0][0],/请试听确认/);
});
test('配音前保存失败不发请求，旧音频保留',async()=>{
 const f=fixture();let calls=0;f.ctx.save=async()=>{throw Error('只读');};f.ctx.call=async()=>{calls++;};await (await import('../src/speech-action.mjs')).runSpeechAction(f.ctx);assert.equal(calls,0);assert.equal(f.d.voice.audioId,'已有配音');assert.match(f.messages[0][0],/保存配音文案失败/);
});
test('配音保存期间切任务不生成，生成期间切任务不污染新任务',async()=>{
 const {runSpeechAction}=await import('../src/speech-action.mjs');let f=fixture(),calls=0;f.ctx.save=async()=>{f.ctx.draft.value=createDraft();};f.ctx.call=async()=>{calls++;};await runSpeechAction(f.ctx);assert.equal(calls,0);
 f=fixture();const other=createDraft();other.voice.audioId='另一个任务的声音';f.ctx.call=async()=>{f.ctx.draft.value=other;return{id:'旧任务迟到结果'};};await runSpeechAction(f.ctx);assert.equal(other.voice.audioId,'另一个任务的声音');assert.equal(f.d.voice.audioId,'已有配音');
});
for(const change of ['正文','语速','音色','模型','服务地址'])test('生成期间修改'+change+'时迟到结果不覆盖',async()=>{
 const f=fixture();f.ctx.call=async()=>{if(change==='正文')f.d.finalText='尚未保存的新正文';if(change==='语速')f.d.voice.speed=1.5;if(change==='音色')f.data.settings.provider.voice='voice-b';if(change==='模型')f.data.settings.provider.ttsModel='model-b';if(change==='服务地址')f.data.settings.provider.baseUrl='http://127.0.0.1:2/v1';return{id:'迟到配音'};};await (await import('../src/speech-action.mjs')).runSpeechAction(f.ctx);assert.equal(f.d.voice.audioId,'已有配音');assert.match(f.messages[0][0],/未替换当前音频/);
});
test('服务端标为过期或操作停止时不重新绑定结果',async()=>{
 for(const result of [{id:'过期音频',stale:true},undefined]){const f=fixture();f.ctx.call=async()=>result;await (await import('../src/speech-action.mjs')).runSpeechAction(f.ctx);assert.equal(f.d.voice.audioId,'已有配音');}
});
test('无关文字模型变化不误判配音过期，未选用的全局音色不影响任务音色',async()=>{
 const f=fixture();f.data.settings.provider.ttsProtocol='windows';f.d.voice.systemVoice='任务音色';f.ctx.call=async()=>{f.data.settings.provider.model='无关文字模型';f.data.settings.provider.systemVoice='另一全局音色';return{id:'有效系统配音'};};await (await import('../src/speech-action.mjs')).runSpeechAction(f.ctx);assert.equal(f.d.voice.audioId,'有效系统配音');
});
test('未训练样本、缺服务、缺模型和缺音色均给出实际原因',async()=>{
 const {speechGenerationReason:reason}=await import('../server/speech-config.mjs'),f=fixture(),p=f.data.settings.provider;
 assert.equal(reason(f.d,p),'');assert.match(reason(f.d,{...p,baseUrl:''}),/服务地址/);assert.match(reason(f.d,{...p,ttsModel:''}),/语音模型/);assert.match(reason(f.d,{...p,voice:''}),/服务音色ID/);f.d.voice.profile='sample';assert.match(reason(f.d,p,[{id:'sample'}]),/尚未训练/);assert.equal(reason(f.d,{...p,voice:''},[{id:'sample',remoteId:'已训练音色'}]),'');
});
test('系统音色必须实际安装，系统配音不能冒用克隆样本',async()=>{
 const {speechGenerationReason:reason}=await import('../server/speech-config.mjs'),f=fixture(),p={ttsProtocol:'windows',systemVoice:'实际音色'};
 assert.match(reason(f.d,p),/实际安装/);assert.equal(reason(f.d,p,[],[{name:'实际音色'}]),'');f.d.voice.profile='sample';assert.match(reason(f.d,p,[{id:'sample',remoteId:'已训练音色'}],[{name:'实际音色'}]),/不能使用克隆样本/);
});
