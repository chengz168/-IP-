const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ComfyH3,buildGraph,graphSignature}=require('../server/comfy-h3.cjs'),{Media,runProcess}=require('../server/media.cjs');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/reference-video-night-20261115'),baseUrl='http://127.0.0.1:8188';
fs.mkdirSync(directory,{recursive:true});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),write=(file,data)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(data,null,2));
async function main(){
 const mode=process.argv[2];if(!['submit','status'].includes(mode))throw Error('必须显式选择submit或status');
 const h3=new ComfyH3({},{}),receiptFile=path.join(directory,'submission.json');
 if(mode==='status'){
  if(!fs.existsSync(receiptFile))throw Error('没有已保存的提交凭据');
  let receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  if(!receipt.promptId){const id=await h3.discover(receipt.remote);receipt={...receipt,promptId:id};write('submission.json',receipt);}
  const status=await h3.query(receipt.promptId,receipt.remote);write('status.json',{at:new Date().toISOString(),...status});console.log(JSON.stringify(status));return;
 }
 if(fs.existsSync(receiptFile))throw Error('已有提交凭据，只能查询原任务，禁止重交');
 const queue=await h3.json(baseUrl,'/queue');if(queue.queue_running.length||queue.queue_pending.length)throw Error('已有本机模型任务，未提交');
 const previous=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/reference-sample-20261115/inputs.json'),'utf8'));
 const settings=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/reference-sample-20261115/workspace/studio.json'),'utf8')).settings,media=new Media({data:{settings}});
 const image=path.join(directory,'first-frame.png'),reference=path.join(directory,'reference-motion-8s.mp4');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',previous.source,'-frames:v','1','-update','1',image]);
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',previous.source,'-t','8','-an','-vf','fps=24,scale=608:1056','-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',reference]);
 const clientId=crypto.randomUUID(),folder='superip/ref-night/'+clientId;
 const uploadedImage=await h3.upload(baseUrl,image,folder,{}),uploadedVideo=await h3.upload(baseUrl,reference,folder,{}),uploadedAudio=await h3.upload(baseUrl,previous.audio.path,folder,{});
 const name=input=>input.subfolder+'/'+input.name;
 const graph=buildGraph({image:name(uploadedImage),audio:name(uploadedAudio),duration:8,portrait:true,seed:42,prefix:folder});
 graph['1'].inputs.unet_name='minimax_h3_ref2va_pruned_int8_convrot.safetensors';graph['5'].inputs.lora_name='minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors';
 // 模式与权重一同变更，按官方本机模板使用4步及beta调度；不声称仅提示词单变量实验。
 graph['10'].inputs.steps=4;graph['10'].inputs.scheduler='beta';
 const prompt='subject_definitions:\n<Subject 1> (S1) is the woman in <Picture 1> and <Video 1>, with long straight black hair, transparent glasses and a sleeveless ribbed taupe high-neck top.\n<Subject 2> is the illuminated nighttime street behind her in <Video 1>.\n<Picture 1> is the first-frame composition and exact facial-appearance reference.\n<Video 1> supplies the original person, lighting, background, framing and natural head and gaze motion. Its soundtrack is excluded.\n<Audio 1> is the exact supplied Mandarin driving speech for S1.\n\n'+
 'summary: [reference generation + audio reuse] Generate an 8.00-second single continuous photorealistic talking-person shot. Preserve <Subject 1> and <Subject 2> from <Picture 1> and <Video 1>, while replacing the mouth articulation to follow <Audio 1>.\n\n'+
 'retention_analysis:\n<Subject 1> ([Shot 1]): fully_preserved - retain facial proportions, glasses geometry, hair, clothing and natural skin texture; only the speech articulation changes.\n<Subject 2> ([Shot 1]): fully_preserved - retain the nighttime street, warm storefront lighting and depth.\n<Picture 1> ([Shot 1] appearance): fully_preserved - match the starting face, outfit and composition.\n<Video 1> (motion and camera): partially_preserved - follow its restrained head movement, blinking, gaze changes and static framing, replacing only speech articulation.\n<Audio 1>: fully_copy - reuse the complete 8-second driving audio as the final soundtrack.\n\n'+
 'detailed_description: [Shot 1, 0.00-8.00 seconds] A stable portrait medium close-up matching <Picture 1>. <Subject 1> (S1) stands on the nighttime street from <Video 1>. Preserve her original head movement and natural blinks, the position of her shoulders and the shape of the glasses. Her lips and jaw follow the exact Mandarin phonemes, timing and pauses in <Audio 1>; movements remain small and realistic. Do not exaggerate the smile or change facial proportions. She speaks naturally toward the camera, with brief gaze shifts guided by <Video 1>. Maintain the street lights, skin texture, hair strands and clothing texture throughout the continuous shot. No captions, text, logos or graphic overlays.\n\n'+
 'overall_soundscape: Only the exact driving speech and pauses in <Audio 1>. Do not retain the source video audio or add voices or effects.\n\nnon_diegetic_music: N/A';
 graph['6']={class_type:'MiniMaxH3ReferenceToVideo',inputs:{clip:['2',0],vae:['3',0],audio_vae:['4',0],prompt,width:608,height:1056,length:graph['6'].inputs.length,ref_image_size:'match','ref_images.ref_image_0':['17',0],'ref_videos.ref_video_0':['21',0],'ref_audios.ref_audio_0':['18',0]}};
 graph['20']={class_type:'LoadVideo',inputs:{file:name(uploadedVideo)}};graph['21']={class_type:'GetVideoComponents',inputs:{video:['20',0]}};
 const remote={kind:'comfy-h3-v1',baseUrl,clientId,graph,graphSha256:graphSignature(graph),image:uploadedImage,audio:uploadedAudio,duration:8,seed:42,submissionState:'submitting'};
 const receipt={at:new Date().toISOString(),clientId,promptId:'',remote,reference:{file:reference,sha256:hash(reference),uploaded:uploadedVideo},source:{file:previous.source,sha256:hash(previous.source)},originalAudioReused:true,newSpeechGenerated:false,experimental:true,qualityAccepted:false,notSingleVariableComparison:true};
 write('submission.json',receipt);fs.writeFileSync(path.join(directory,'prompt.txt'),prompt);
 const promptId=await h3.submit(baseUrl,graph,clientId,{});receipt.promptId=promptId;receipt.remote.submissionState='accepted';write('submission.json',receipt);console.log(JSON.stringify({promptId,clientId,graphSha256:remote.graphSha256,experimental:true}));
}
main().catch(error=>{write('last-error.json',{at:new Date().toISOString(),error:error.stack,unknown:!!error.unknown,remoteConfirmed:!!error.remoteConfirmed});console.error(error);process.exitCode=1;});
