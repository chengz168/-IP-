const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../src/model-settings.mjs');

test('来源切换保留每种协议的草稿，且不修改已保存配置',async()=>{
 const {createProtocolDrafts}=await load(),saved={textProtocol:'ollama',baseUrl:'http://local/v1',model:'existing-local',ttsModel:'tts-old'};
 const draft=structuredClone(saved),sessions=createProtocolDrafts();sessions.switch(draft,'text','compatible');
 assert.equal(draft.model,'existing-local');assert.equal(draft.baseUrl,'http://local/v1');
 draft.model='custom-cloud';draft.baseUrl='https://cloud.example/v1';sessions.switch(draft,'text','ollama');
 assert.equal(draft.model,'existing-local');assert.equal(draft.baseUrl,'http://local/v1');
 sessions.switch(draft,'text','compatible');assert.equal(draft.model,'custom-cloud');assert.equal(draft.baseUrl,'https://cloud.example/v1');
 assert.deepEqual(saved,{textProtocol:'ollama',baseUrl:'http://local/v1',model:'existing-local',ttsModel:'tts-old'});
});

test('TTS切换不清理系统音色或模型，视觉不自动沿用文本模型',async()=>{
 const {createProtocolDrafts}=await load(),draft={ttsProtocol:'windows',systemVoice:'已有系统音色',ttsModel:'custom-tts',visionProtocol:'ollama',visionModel:'',model:'text-only'};
 const sessions=createProtocolDrafts();sessions.switch(draft,'tts','compatible');draft.ttsModel='new-cloud';sessions.switch(draft,'tts','windows');
 assert.equal(draft.systemVoice,'已有系统音色');assert.equal(draft.ttsModel,'custom-tts');
 sessions.switch(draft,'vision','compatible');assert.equal(draft.visionModel,'');
});

test('来源变化时结束界面等待，晚到的发现结果不进入新来源',async()=>{
 const {createDiscoveryController}=await load();let resolve;
 const controller=createDiscoveryController(()=>new Promise(r=>resolve=r));
 const pending=controller.run({protocol:'ollama'});await Promise.resolve();controller.invalidate();
 assert.deepEqual(await pending,{phase:'stale'});resolve({models:[{id:'old-source'}]});
});

test('发现超时后允许刷新，新结果保持独立',async()=>{
 const {createDiscoveryController}=await load();let resolveOld,calls=0;
 const controller=createDiscoveryController(()=>++calls===1?new Promise(r=>resolveOld=r):Promise.resolve({models:[{id:'current'}]}),{timeoutMs:10});
 assert.equal((await controller.run({})).phase,'timeout');const current=await controller.run({});resolveOld({models:[{id:'late'}]});
 assert.equal(current.phase,'result');assert.equal(current.result.models[0].id,'current');
});

test('发现错误作为错误态返回，不写模型字段',async()=>{
 const {createDiscoveryController}=await load(),payload={provider:{model:'saved'}};
 const controller=createDiscoveryController(async()=>{throw Error('服务不可达');});
 assert.deepEqual(await controller.run(payload),{phase:'error',message:'服务不可达'});assert.equal(payload.provider.model,'saved');
});

test('取消与超时只取消对应发现请求，成功结束后不再取消',async()=>{
 const {createDiscoveryController}=await load(),cancelled=[];
 const waiting=createDiscoveryController(()=>new Promise(()=>{}),{cancel:p=>cancelled.push(p.requestId),timeoutMs:10});
 const pending=waiting.run({requestId:'one'});waiting.invalidate();assert.equal((await pending).phase,'stale');assert.deepEqual(cancelled,['one']);
 assert.equal((await waiting.run({requestId:'two'})).phase,'timeout');assert.deepEqual(cancelled,['one','two']);
 const ready=createDiscoveryController(async()=>({models:[]}),{cancel:p=>cancelled.push(p.requestId)});await ready.run({requestId:'three'});ready.invalidate();assert.deepEqual(cancelled,['one','two']);
});

test('模型声明三态如实展示，不按名称猜能力，显式不支持不可选',async()=>{
 const {discoveryModels}=await load();
 const models=discoveryModels({models:[{id:'vision-amazing',capabilities:{vision:'unknown'},availability:'listed'},{id:'actual',capabilities:{vision:'supported'},capabilityEvidence:'ollama-show',availability:'listed'},{id:'text',capabilities:{vision:'unsupported'},availability:'listed'}]},'vision');
 assert.match(models[0].detail,/视觉能力未确认/);assert.match(models[1].detail,/服务声明支持视觉/);assert.equal(models[2].disabled,true);
 assert(models.every(m=>m.detail.includes('未验证生成')));
});

test('无效模型列表报错，真实重复ID只显示一次',async()=>{
 const {discoveryModels}=await load();assert.throws(()=>discoveryModels({models:null},'text'),/结构无效/);assert.throws(()=>discoveryModels({models:[{name:'no id'}]},'text'),/无效模型标识/);
 assert.equal(discoveryModels({models:[{id:'same'},{id:'same'}]},'text').length,1);
});

test('TTS和ASR独立地址随协议保留，不覆盖文本端点',async()=>{
 const {createProtocolDrafts}=await load(),sessions=createProtocolDrafts(),p={baseUrl:'http://local/v1',ttsProtocol:'compatible',ttsBaseUrl:'https://speech.example/v1',asrProtocol:'compatible',asrBaseUrl:'https://asr.example/v1'};
 sessions.switch(p,'tts','indextts-local');p.ttsBaseUrl='temporary';sessions.switch(p,'tts','compatible');assert.equal(p.ttsBaseUrl,'https://speech.example/v1');
 sessions.switch(p,'asr','local-whisper');p.asrBaseUrl='temporary';sessions.switch(p,'asr','compatible');assert.equal(p.asrBaseUrl,'https://asr.example/v1');assert.equal(p.baseUrl,'http://local/v1');
});
