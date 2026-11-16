const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const {speechContext,speechRequest,speechCurrent,speechEvidence}=require('../server/speech-request.cjs');

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'speech-input-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const service=createService(root),d=service.store.draft();d.finalText='保留正文和旧音频。';d.voice.audioId='prior';Object.assign(service.store.data.settings.provider,{ttsProtocol:'compatible',baseUrl:'http://127.0.0.1:1/v1',ttsModel:'original-model',voice:'original-voice'});service.store.save();return {service,d};}

test('全局配音模型或音色中途变更，迟到结果仅留历史，不挂当前任务',async t=>{
 for(const change of [{ttsModel:'changed-model'},{voice:'changed-voice'},{baseUrl:'http://127.0.0.1:2/v1'},{ttsProtocol:'windows'}]){
  const {service,d}=fixture(t);let finish,context;service.providers.speech=async(_,__,captured)=>{context=captured;return new Promise(r=>finish=r);};const pending=service.handlers.speech({id:d.id});await service.invoke('saveSettings',{outputDir:'',provider:change});assert.equal(context.provider.ttsModel,'original-model');finish({id:'late-output'});assert.equal((await pending).stale,true);assert.equal(service.store.draft(d.id).voice.audioId,'prior');assert.equal(service.store.data.runs[0].output.stale,true);assert.equal(service.store.data.runs[0].parameters.input.model,'original-model');
 }
});

test('音色资源ID更新会使结果过期，固定任务音色不受无关全局音色变更影响',async t=>{
 const {service,d}=fixture(t);service.store.data.voices.push({id:'profile',remoteId:'voice-v1'});d.voice.profile='profile';let finish;service.providers.speech=async()=>new Promise(r=>finish=r);let pending=service.handlers.speech({id:d.id});service.store.data.voices[0].remoteId='voice-v2';finish({id:'old-profile'});assert.equal((await pending).stale,true);assert.equal(service.store.draft(d.id).voice.audioId,'prior');pending=service.handlers.speech({id:d.id});service.store.data.settings.provider.voice='unrelated-global';finish({id:'new-profile'});assert.equal((await pending).stale,undefined);assert.equal(service.store.draft(d.id).voice.audioId,'new-profile');
});

test('无关文字模型设置和其他未用的语音路由变化不错误丢弃有效结果',async t=>{
 const {service,d}=fixture(t);let finish;service.providers.speech=async()=>new Promise(r=>finish=r);const pending=service.handlers.speech({id:d.id});await service.invoke('saveSettings',{outputDir:'',provider:{model:'new-text-model',ttsClassicModel:'unused-classic'}});finish({id:'valid'});assert.equal((await pending).stale,undefined);assert.equal(service.store.draft(d.id).voice.audioId,'valid');
});

test('试听配置变化会标过期，并且不会替换正式配音',async t=>{
 const {service,d}=fixture(t);let finish;service.providers.speech=async()=>new Promise(r=>finish=r);const pending=service.handlers.testSpeech({id:d.id,text:'试听正文',speed:1,profile:'',model:'fast'});await service.invoke('saveSettings',{outputDir:'',provider:{voice:'changed'}});finish({id:'preview-old'});assert.equal((await pending).stale,true);assert.equal(d.voice.audioId,'prior');assert.equal(service.store.data.runs[0].parameters.input.text,'试听正文');
});

test('系统音色请求只比较实际输入，产物证据保留正文哈希且不泄露密钥',async t=>{
 const {service,d}=fixture(t);Object.assign(service.store.data.settings.provider,{ttsProtocol:'windows',systemVoice:'global',apiKey:'sensitive'});d.voice.systemVoice='task-voice';const context=speechContext(service.store.data),request=speechRequest(d,context),evidence=speechEvidence(request);service.store.data.settings.provider.systemVoice='changed-global';service.store.data.settings.provider.ttsModel='unused-model';assert.equal(speechCurrent(request,d,service.store.data),true);d.voice.systemVoice='changed-task';assert.equal(speechCurrent(request,d,service.store.data),false);assert.equal(context.provider.systemVoice,'global');assert.equal(evidence.textLength,d.finalText.length);assert.equal(evidence.textSha256.length,64);assert.equal(evidence.text,undefined);assert(!JSON.stringify(evidence).includes('sensitive'));
});

test('兼容服务使用冻结的真实模型、音色与正文，并把输入哈希写入素材',async t=>{
 const {service,d}=fixture(t),context=speechContext(service.store.data);service.store.data.settings.provider.ttsModel='changed';service.store.data.settings.provider.voice='changed';let body;service.providers.request=async(_,options)=>{body=JSON.parse(options.body);return {arrayBuffer:async()=>Buffer.from('协议测试夹具，不是真实音频')};};service.media.probe=async()=>({streams:[{codec_type:'audio'}],format:{duration:2}});const asset=await service.providers.speech(d,{},context);assert.equal(body.model,'original-model');assert.equal(body.voice,'original-voice');assert.equal(body.input,d.finalText);assert.equal(asset.speech.request.model,body.model);assert.equal(asset.speech.request.voice,body.voice);assert.equal(asset.speech.request.textLength,body.input.length);
});
