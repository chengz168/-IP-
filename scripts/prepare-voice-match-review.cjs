const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-match-review-20261115');
async function main(){
 fs.mkdirSync(root,{recursive:true});assert(!fs.existsSync(path.join(root,'prepared.json')),'已有声音对照输入，不覆盖');
 const previous=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const speech=previous.runs.find(r=>r.type==='speech'&&r.status==='succeeded'),media=new Media({data:previous}),{ffmpeg}=media.binaries();assert(speech?.output?.path);
 const original='F:/Software/轻语IP智能体/aigc-human/outputs/videos/cloud_1794663289391.mp4';
 const sourceProbe=await media.probe(original);assert(sourceProbe.streams.some(s=>s.codec_type==='audio'));
 const files=[{name:'人物参考成片-前12秒.wav',source:original,start:0,duration:12,role:'参考原声片段；仅提取及检查，未据此执行声音克隆'},
  {name:'已拒绝配音-前12秒.wav',source:speech.output.path,start:0,duration:12,role:'用户拒绝的本轮配音，保留供对照'}],records=[];
 for(const file of files){const output=path.join(root,file.name),before=digest(file.source);await runProcess(ffmpeg,['-v','error','-n','-ss',String(file.start),'-i',file.source,'-t',String(file.duration),'-map','0:a:0','-ac','1','-ar','24000','-c:a','pcm_s16le',output]);assert.equal(digest(file.source),before);const probe=await media.probe(output);await runProcess(ffmpeg,['-v','error','-xerror','-i',output,'-f','null','-']);records.push({...file,sourceSha256:before,path:output,sha256:digest(output),probe});}
 const report={at:new Date().toISOString(),files:records,rejectedSpeechRunId:speech.id,rejectedVoiceReferenceId:speech.output.speech.referenceId,
  originalVoiceCloneAuthorized:false,originalVoiceClonePerformed:false,newSpeechGenerated:false,userVoiceAccepted:false,
  testText:'晚上出来走一走，刚好路边的灯都亮了。忙了一天，先给自己留几分钟，慢慢走，也慢慢聊。',
  plan:['先确认可用音色与人物是否匹配','同一句短稿比较参考片段与实际新配音，不用原音频冒充生成','无额外夸张情绪，保留标点停顿；不采用变调或混响掩盖问题','确认音色后再生成整段并驱动口型，不能给旧视频换音轨冒充口型重做']};
 fs.writeFileSync(path.join(root,'prepared.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:root,originalVoiceClonePerformed:false,newSpeechGenerated:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
