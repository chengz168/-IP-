const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/h3-autonomous'),base='http://127.0.0.1:8188';
const comfy=path.resolve('evidence/research/generation-chain-20261115/comfy-h3');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
const json=async(endpoint,options={})=>{const r=await fetch(base+endpoint,{...options,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('ComfyUI HTTP '+r.status+' '+await r.text());return r.json();};
const text='晚上出来走一走，给自己留几分钟，慢慢走，也慢慢聊。';
const prompt=`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, a fixed medium close-up of the adult woman in <Picture 1>, preserving her long dark hair, glasses, sleeveless beige knitted top and the warmly lit night street behind her. One continuous eight-second shot. She looks at the viewer with a relaxed expression, makes a small natural head movement and speaks as if talking to a friend nearby. The woman with a clear, gently warm, mid-register adult female voice (S1) says in conversational Mandarin at a comfortable unhurried pace: <d>[Chinese] ${text}</d> Her delivery has small natural pitch changes and phrase-final falls, with brief breaths between phrases, clear consonants and relaxed vowels. Her voice is present and close, without exaggerated breathiness, a shrill pitch or an announcer cadence. Her mouth follows her own spoken words. She finishes the last word before the shot ends, settles her mouth and keeps looking at the camera. No added captions or graphic overlays.

overall_soundscape: A clean close microphone recording with faint natural breathing. The background is very quiet, with no distinct traffic, crowd voices or loud street sounds.

non_diegetic_music: N/A`;

async function main(){
 const action=process.argv[2];
 if(action==='prepare'){
  assert(!fs.existsSync(root),'已有H3自主音色试验，先查询原任务，不覆盖');
  const queue=await json('/queue');assert.equal(queue.queue_running.length+queue.queue_pending.length,0,'已有任务，保留原队列');
  fs.mkdirSync(root);
  const source='F:/Software/轻语IP智能体/aigc-human/resources/assets/videos/示例2-夜间.mp4',before=digest(source);
  const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')),media=new Media({data});
  const frame=path.join(root,'character-first-frame.png');
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',source,'-map','0:v:0','-frames:v','1','-update','1',frame]);
  assert.equal(digest(source),before);
  const form=new FormData();form.append('image',new Blob([fs.readFileSync(frame)],{type:'image/png'}),'voice-design-character-'+crypto.randomUUID()+'.png');form.append('subfolder','superip-voice-design');form.append('type','input');
  const upload=await json('/upload/image',{method:'POST',body:form});
  const prior=JSON.parse(fs.readFileSync(path.join(comfy,'first-generation/prompt-api.json'),'utf8')),graph=structuredClone(prior.prompt||prior);
  assert(!Object.values(graph).some(n=>/LoadAudio|AddGuide|ReferenceToVideo/.test(n.class_type)),'不允许复用参考音轨或视频');
  graph['6'].inputs={...graph['6'].inputs,prompt,width:352,height:608,length:192,first_frame:['17',0]};
  graph['17']={class_type:'LoadImage',inputs:{image:(upload.subfolder?upload.subfolder+'/':'')+upload.name}};
  graph['8'].inputs.noise_seed=20261115;
  graph['16'].inputs.filename_prefix='superip-voice-design/autonomous-female-seed20261115';
  const info=await json('/object_info');for(const node of Object.values(graph))assert(info[node.class_type],'本地节点缺失：'+node.class_type);
  const payload={prompt:graph,client_id:crypto.randomUUID()};write('prompt-api.json',payload);
  write('prepared.json',{at:new Date().toISOString(),purpose:'现有H3联合模型自主产声短试验；低分辨率画面仅用于产声，不是最终1080p成片',
   text,prompt,promptSource:'自行编写，按h3-prompt-writing公开结构；不是原厂隐藏提示词',firstFrame:{path:frame,sha256:digest(frame),source,sourceSha256:before,upload},
   referenceAudio:null,referenceVideo:null,frames:192,fps:24,width:352,height:608,steps:8,seed:20261115,
   payloadSha256:digest(path.join(root,'prompt-api.json')),qualityAccepted:false,voiceAccepted:false,modelSubmitted:false});
  console.log(JSON.stringify({prepared:true,referenceAudio:null,frames:192,payloadSha256:digest(path.join(root,'prompt-api.json'))}));return;
 }
 const prepared=read('prepared.json');
 if(action==='submit'){
  assert(!fs.existsSync(path.join(root,'submission.json')),'已有提交记录，禁止重复提交');
  assert.equal(digest(path.join(root,'prompt-api.json')),prepared.payloadSha256);
  const queue=await json('/queue');assert.equal(queue.queue_running.length+queue.queue_pending.length,0,'已有任务，保留原队列');
  const payload=read('prompt-api.json'),receipt={at:new Date().toISOString(),state:'submitting',payloadSha256:prepared.payloadSha256,clientId:payload.client_id};
  write('submission.json',receipt);
  try{const result=await json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});Object.assign(receipt,{state:'submitted',result});}
  catch(error){Object.assign(receipt,{state:'unknown',error:error.message});throw error;}
  finally{write('submission.json',receipt);}
  console.log(JSON.stringify(receipt));return;
 }
 const submitted=read('submission.json'),id=submitted.result?.prompt_id;assert(id,'缺少可查询的任务ID；先核对未知提交状态');
 const [history,queue]=await Promise.all([json('/history/'+id),json('/queue')]);
 const current=history[id],state={at:new Date().toISOString(),promptId:id,running:queue.queue_running.some(r=>r[1]===id),queued:queue.queue_pending.some(r=>r[1]===id),
  status:current?.status||null,outputs:current?.outputs||null,taskCompleted:!!current?.status?.completed,qualityAccepted:false};
 write('status.json',state);if(current)write('history.json',current);
 console.log(JSON.stringify(state));
 if(action==='status')return;
 assert.equal(action,'collect');assert.equal(current?.status?.status_str,'success','原H3任务尚未成功，禁止重交');
 const item=current.outputs['16'].images?.[0];assert(item&&item.type==='output');
 const origin=path.resolve(comfy,'output',item.subfolder||'',item.filename),outputRoot=path.resolve(comfy,'output');assert(origin.startsWith(outputRoot+path.sep));
 const originalHash=digest(origin),video=path.join(root,'h3-autonomous-generated.mp4'),audio=path.join(root,'h3-autonomous-voice.wav');
 if(!fs.existsSync(video))fs.copyFileSync(origin,video,fs.constants.COPYFILE_EXCL);assert.equal(digest(video),originalHash);
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')),media=new Media({data});
 const probe=await media.probe(video);assert(probe.streams.some(s=>s.codec_type==='audio'));
 await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',video,'-f','null','-']);
 if(!fs.existsSync(audio))await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',video,'-map','0:a:0','-vn','-ac','1','-c:a','pcm_f32le',audio]);
 const audioProbe=await media.probe(audio);
 assert.equal(digest(prepared.firstFrame.source),prepared.firstFrame.sourceSha256);
 write('generated.json',{at:new Date().toISOString(),promptId:id,video,videoSha256:digest(video),audio,audioSha256:digest(audio),probe,audioProbe,
  expectedText:text,newSpeechGenerated:true,newVideoGenerated:true,referenceAudio:null,referenceVideo:null,firstFrameOnly:true,fullDecodeVerified:true,
  submittedThroughProductButton:false,kind:'独立H3已有资源试验',sourceCharacterUnchanged:true,listeningAccepted:false,qualityAccepted:false});
 console.log(JSON.stringify({video,audio,fullDecodeVerified:true,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
