const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDraft}=require('../server/store.cjs'),{hash}=require('../server/subtitle-proofread.cjs');
const {trustedSubtitleReference,subtitleReferenceInput}=require('../server/subtitle-reference.mjs');
function fixture(){const d=createDraft();d.confirmed=true;d.finalText='红色便签贴在封底。';d.video.assetId='video';const data={assets:[{id:'video',avatarRequest:{audio:{assetId:'audio'}}},{id:'audio',speech:{request:{textSha256:hash(d.finalText),textLength:d.finalText.length}}}]};return {d,data};}
test('未确认稿、改写稿和没有视频配音关系的导入视频不作为可信字幕参考',()=>{
 for(const change of [(d)=>d.confirmed=false,(d)=>d.finalText='',(d,data)=>data.assets[0].avatarRequest=undefined,(d,data)=>data.assets[1].speech.request.textSha256=hash('另一稿'),(d)=>d.edit.sourceId='unrelated']){
  const {d,data}=fixture();d.rewrite=d.finalText;change(d,data);assert.equal(trustedSubtitleReference(d,data,hash),null);
 }
 const {d,data}=fixture();const ref=trustedSubtitleReference(d,data,hash);assert.equal(ref.text,d.finalText);assert.equal(ref.audioId,'audio');assert.equal(ref.sourceId,'video');
});
test('配音正文长度和摘要必须同时对应，手动驱动音频不能借用当前 voice.audioId',()=>{
 const {d,data}=fixture();data.assets[1].speech.request.textLength++;assert.equal(trustedSubtitleReference(d,data,hash),null);
 data.assets[1].speech.request.textLength--;data.assets[0].avatarRequest.audio.assetId='manual';d.voice.audioId='audio';assert.equal(trustedSubtitleReference(d,data,hash),null);
});
test('识别快照冻结正文、确认状态和实际配音凭据，封面不影响识别',async()=>{
 const {recognitionSnapshot,canApplyRecognition}=await import('../src/recognition-state.js');
 for(const change of [d=>d.finalText+='新稿',d=>d.confirmed=false,(d,data)=>data.assets[1].speech.request.textSha256=hash('新音频')]){
  const {d,data}=fixture(),snapshot=recognitionSnapshot(d,'transcribe',data);assert(canApplyRecognition(snapshot,d,data));change(d,data);assert.equal(canApplyRecognition(snapshot,d,data),false);
 }
 const {d,data}=fixture(),snapshot=recognitionSnapshot(d,'transcribe',data);d.cover.title='新标题';assert(canApplyRecognition(snapshot,d,data));assert.equal(subtitleReferenceInput(d,data).audioId,'audio');
});
test('单集已交接时读取本集正文，变更集稿使快照失效',async()=>{
 const {createStory}=require('../server/story-contract.cjs'),{recognitionSnapshot,canApplyRecognition}=await import('../src/recognition-state.js'),{d,data}=fixture();
 d.video.mode='story';d.story=createStory(d);d.story.activeEpisodeId='episode';d.story.episodes=[{id:'episode',text:'本集讲稿',resultId:'video',resultInputHash:'composition',resultNarrationAssetId:''}];
 assert.equal(trustedSubtitleReference(d,data,hash).text,'本集讲稿');const snapshot=recognitionSnapshot(d,'transcribe',data);d.story.episodes[0].text='变更集稿';assert.equal(canApplyRecognition(snapshot,d,data),false);
});
