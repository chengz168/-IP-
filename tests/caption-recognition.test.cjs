const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createService}=require('../server/service.cjs');

test('模板断句使用真实词边界，标点结束且不等分时间、不修改识别凭据',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const words=[{start:.2,end:.7,word:'台灯'},{start:.7,end:1.1,word:'放在'},{start:1.1,end:1.8,word:'左边，'},{start:2,end:2.9,word:'开始阅读。'}];
 const result={segments:[{start:0,end:3,text:'台灯放在左边，开始阅读。',words}]},before=JSON.stringify(result);
 assert.deepEqual(recognitionRows(result,3,{maxChars:6}),[{start:.2,end:1.1,text:'台灯放在'},{start:1.1,end:1.8,text:'左边，'},{start:2,end:2.9,text:'开始阅读。'}]);assert.equal(JSON.stringify(result),before);
});

test('没有词级时间的旧识别保持整句，英文完整词与补充平面字符不拆假时间',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 assert.deepEqual(recognitionRows({segments:[{start:0,end:8,text:'只有整句时间，不均分。'}]},8,{maxChars:6}),[{start:0,end:8,text:'只有整句时间，不均分。'}]);
 const result={segments:[{start:0,end:2,text:'extraordinary 😀。',words:[{start:0,end:1.2,word:'extraordinary'},{start:1.4,end:2,word:' 😀。'}]}]};
 assert.deepEqual(recognitionRows(result,2,{maxChars:3}),[{start:0,end:1.2,text:'extraordinary'},{start:1.4,end:2,text:'😀。'}]);
});

test('同句极短单字尾回收前词，保留六字上限及真实边界，不更改原始识别',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const words=[{start:0,end:.18,word:'路'},{start:.18,end:.34,word:'邊'},{start:.34,end:.48,word:'的'},{start:.48,end:.66,word:'燈'},{start:.66,end:.82,word:'亮'},{start:.82,end:1.06,word:'了,'}];
 const result={segments:[{start:0,end:1.06,text:'路邊的燈亮了,',words}]},before=JSON.stringify(result);
 assert.deepEqual(recognitionRows(result,1.06,{maxChars:6}),[{start:0,end:.66,text:'路邊的燈'},{start:.66,end:1.06,text:'亮了,'}]);assert.equal(JSON.stringify(result),before);
});

test('单字强调句、明显停顿及完整英文词不被短尾重组',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 for(const [words,text,expected]of [
  [[{start:0,end:.8,word:'已经完成。'},{start:.8,end:1,word:'好！'}],'已经完成。好！',['已经完成。','好！']],
  [[{start:0,end:.8,word:'灯光都亮起'},{start:1.4,end:1.6,word:'了。'}],'灯光都亮起了。',['灯光都亮起','了。']],
  [[{start:0,end:.8,word:'welcome '},{start:.8,end:1,word:'I'}],'welcome I',['welcome','I']]
 ]){const rows=recognitionRows({segments:[{start:0,end:2,text,words}]},2,{maxChars:6});assert.deepEqual(rows.map(r=>r.text),expected);}
});

test('词级缺字、重叠、逆序、超范围与空时间轴拒绝，缺省参数仍校验词凭据',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 for(const words of [[],[{start:0,end:1,word:'漏字'}],[{start:NaN,end:1,word:'文字'}],[{start:1,end:.5,word:'文字'}],[{start:-.1,end:1,word:'文字'}],[{start:0,end:3,word:'文字'}],[{start:0,end:1.1,word:'文'},{start:1,end:2,word:'字'}]]){
  const result={segments:[{start:0,end:2,text:'文字',words}]};assert.throws(()=>recognitionRows(result,2,{maxChars:6}),/词级/);assert.throws(()=>recognitionRows(result,2),/词级/);
 }
});

test('词级零时长字符合并到有时间的相邻条，不生成零时长字幕或丢字',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const result={segments:[{start:0,end:2,text:'开始。完',words:[{start:0,end:0,word:'开'},{start:0,end:1,word:'始。'},{start:2,end:2,word:'完'}]}]};
 assert.deepEqual(recognitionRows(result,2.1,{maxChars:3}),[{start:0,end:2,text:'开始。完'}]);
});

test('识别字形与已确认文案拼音完全对应时校正繁简字形并保留时间轴',async()=>{
 const {alignRowsToReference}=await import('../src/caption-script.mjs');
 const rows=[{start:0,end:.8,text:'晚上出來走'},{start:.8,end:1.12,text:'一走'}];
 assert.deepEqual(alignRowsToReference(rows,'晚上出来走一走，'),[
  {start:0,end:.8,text:'晚上出来走'},
  {start:.8,end:1.12,text:'一走，'}
 ]);
 assert.deepEqual(alignRowsToReference([{start:0,end:1,text:'晚上出錯'}],'晚上出来走一走'),[{start:0,end:1,text:'晚上出錯'}]);
});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asr-input-')),listeners=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(x=>!listeners.has(x));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});const file=path.join(root,'source.mp4');fs.writeFileSync(file,'识别接口夹具，不是真视频');const a=s.store.addAsset(file);s.store.draft().edit.sourceId=a.id;return {s,a,id:s.store.draft().id};}
test('兼容字幕识别只有非空、有限、有序且不越源时长的字幕才可进入编辑器',async()=>{
 const {recognitionRows}=await import('../src/caption-recognition.mjs'),valid={segments:[{start:.1,end:1,text:' 有效识别。 '},{start:1.2,end:2,text:'第二句。'}]};assert.equal(recognitionRows(valid,2)[0].text,'有效识别。');
 for(const result of [{},{text:'没有时间轴'},{segments:[]},{segments:[{start:0,end:1,text:' '}]},{segments:[{start:'0',end:1,text:'错误类型'}]},{segments:[{start:NaN,end:1,text:'无效开始'}]},{segments:[{start:0,end:Infinity,text:'无限结束'}]},{segments:[{start:-1,end:1,text:'负数'}]},{segments:[{start:0,end:3,text:'越界'}]},{segments:[{start:0,end:1.5,text:'第一句'},{start:1,end:2,text:'重叠'}]}])assert.throws(()=>recognitionRows(result,2));
 assert.equal(recognitionRows({segments:[{start:0,end:2.05,text:'尾帧误差。'}]},2)[0].end,2);assert.equal(recognitionRows(valid,NaN).length,2);assert.throws(()=>recognitionRows({segments:[{start:2.01,end:2.05,text:'开始已越界'}]},2));
});
test('识别运行中更改有效模型或源文件则标过期，原字幕保留',async t=>{for(const change of [(s,a)=>s.store.data.settings.provider.asrModel='changed',(s,a)=>fs.appendFileSync(a.path,'文件变化'),(s,a)=>fs.renameSync(a.path,a.path+'.moved')]){const {s,a,id}=fixture(t);s.store.draft().edit.captions=[{start:0,end:1,text:'用户字幕'}];let finish;s.providers.transcribe=async()=>new Promise(r=>finish=r);const pending=s.invoke('transcribe',{id,assetId:a.id});change(s,a);finish({text:'旧配置识别',segments:[{start:0,end:1,text:'旧配置识别'}]});assert.equal((await pending).stale,true);assert.equal(s.store.draft().edit.captions[0].text,'用户字幕');assert(s.store.data.runs[0].parameters.input.source);}});
test('本机识别只比较实际配置，无关文字或未使用云端字段不误判',async t=>{const {s,a,id}=fixture(t);Object.assign(s.store.data.settings.provider,{asrProtocol:'local-whisper',asrPythonPath:'python',asrModelPath:'local-model',asrLanguage:'zh'});let finish;s.providers.transcribe=async()=>new Promise(r=>finish=r);let pending=s.invoke('transcribe',{id,assetId:a.id});Object.assign(s.store.data.settings.provider,{model:'unrelated',asrModel:'unused-cloud',baseUrl:'http://unused'});finish({text:'有效',segments:[{start:0,end:1,text:'有效'}]});assert.equal((await pending).stale,undefined);pending=s.invoke('transcribe',{id,assetId:a.id});s.store.data.settings.provider.asrLanguage='en';finish({text:'旧语言',segments:[{start:0,end:1,text:'旧语言'}]});assert.equal((await pending).stale,true);});
test('识别去重与停止后不返回成功，下一次可以继续识别',async t=>{const {s,a,id}=fixture(t);let finish;s.providers.transcribe=async()=>new Promise(r=>finish=r);const pending=s.invoke('transcribe',{id,assetId:a.id});await assert.rejects(s.invoke('transcribe',{id,assetId:a.id}),/正在识别/);const run=s.store.data.runs[0];s.runtime.cancel(run.id);finish({text:'已取消结果',segments:[{start:0,end:1,text:'已取消结果'}]});await assert.rejects(pending,/取消/);assert.equal(run.status,'cancelled');s.providers.transcribe=async()=>({text:'重试结果',segments:[{start:0,end:1,text:'重试结果'}]});assert.equal((await s.invoke('transcribe',{id,assetId:a.id})).text,'重试结果');});
test('识别中改稿使结果过期，原始 ASR 和冻结参考稿仍保留到执行记录',async t=>{
 const {s,a,id}=fixture(t),d=s.store.draft(id),{hash}=require('../server/subtitle-proofread.cjs');d.confirmed=true;d.finalText='路边的灯亮了。';d.edit.captions=[{start:0,end:1,text:'用户原有字幕'}];
 const audio={id:'audio-evidence',speech:{request:{textSha256:hash(d.finalText),textLength:d.finalText.length}}};s.store.data.assets.push(audio);a.avatarRequest={audio:{assetId:audio.id}};
 let finish;s.providers.transcribe=async()=>new Promise(r=>finish=r);const pending=s.invoke('transcribe',{id,assetId:a.id});d.finalText='现在换了正文。';finish({text:'路邊的燈亮了。',segments:[{start:0,end:1,text:'路邊的燈亮了。'}]});
 const result=await pending;assert.equal(result.stale,true);assert.equal(result.reference.text,'路边的灯亮了。');assert.equal(s.store.data.runs[0].output.segments[0].text,'路邊的燈亮了。');assert.equal(s.store.data.runs[0].parameters.reference.text,'路边的灯亮了。');assert.equal(d.edit.captions[0].text,'用户原有字幕');
});
test('显式识别其他素材时不借用当前视频讲稿，结果注明实际视频源',async t=>{
 const {s,a,id}=fixture(t),d=s.store.draft(id),{hash}=require('../server/subtitle-proofread.cjs');d.confirmed=true;d.finalText='当前视频正文';a.avatarRequest={audio:{assetId:'audio-evidence'}};s.store.data.assets.push({id:'audio-evidence',speech:{request:{textSha256:hash(d.finalText),textLength:d.finalText.length}}});
 const file=path.join(s.store.root,'other.mp4');fs.writeFileSync(file,'另一视频的契约夹具');const other=s.store.addAsset(file);s.providers.transcribe=async()=>({text:'其他识别',segments:[{start:0,end:1,text:'其他识别'}]});
 const result=await s.invoke('transcribe',{id,assetId:other.id});assert.equal(result.reference,null);assert.equal(result.sourceAssetId,other.id);
});
