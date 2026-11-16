const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const variant=process.argv[3]||'first-generation';
if(!['first-generation','guided-generation','official-prompt-guided'].includes(variant))throw Error('未知实验类型');
const guided=variant!=='first-generation';
const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3',variant);
fs.mkdirSync(root,{recursive:true});
const base='http://127.0.0.1:8188';
const file=path.join(root,'receipt.json');
const node=(class_type,inputs)=>({class_type,inputs});
const graph={
 '1':node('UNETLoader',{unet_name:'minimax_h3_fl2va_pruned_int8_convrot.safetensors',weight_dtype:'default'}),
 '2':node('CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}),
 '3':node('VAELoader',{vae_name:'minimax_h3_video_vae_int8_convrot.safetensors'}),
 '4':node('VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}),
 '5':node('LoraLoaderModelOnly',{model:['1',0],lora_name:'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',strength_model:1}),
 '6':node('MiniMaxH3ImageToVideo',{clip:['2',0],vae:['3',0],
  prompt:'A photorealistic medium close-up of one fictional Chinese woman in her thirties, sitting at a clean desk in a quiet home studio. Natural skin texture, normal facial proportions, soft daylight, stable eye contact, restrained hand gestures, locked camera, a single continuous shot. She speaks clearly in Mandarin: “先把台灯放在左边，再把电源接好。” Natural voice and precisely synchronized mouth movements. Quiet room tone, no music, no captions, no logo.',
  width:352,height:608,length:124}),
 '7':node('MiniMaxH3SigmaShift',{model:['5',0],shift_video:12,shift_audio:3}),
 '8':node('RandomNoise',{noise_seed:42}),
 '9':node('KSamplerSelect',{sampler_name:'res_multistep'}),
 '10':node('BasicScheduler',{model:['7',0],scheduler:'simple',steps:8,denoise:1}),
 '11':node('BasicGuider',{model:['7',0],conditioning:['6',0]}),
 '12':node('SamplerCustomAdvanced',{noise:['8',0],guider:['11',0],sampler:['9',0],sigmas:['10',0],latent_image:['6',1]}),
 '13':node('VAEDecode',{samples:['12',0],vae:['3',0]}),
 '14':node('VAEDecodeAudio',{samples:['12',0],vae:['4',0]}),
 '15':node('CreateVideo',{images:['13',0],audio:['14',0],fps:24,bit_depth:8}),
 '16':node('SaveVideo',{video:['15',0],filename_prefix:'superip-study/h3-new-speaker-seed42',format:'auto','format.codec':'auto'}),
};
if(guided){
 graph['6'].inputs={...graph['6'].inputs,prompt:'A photorealistic medium close-up of the same woman as the first frame. Preserve her facial identity, hairstyle, clothing and desk background. She calmly speaks the supplied Mandarin soundtrack with precisely matching lip movements. Natural skin texture, subtle breathing and small restrained hand movements, locked camera, continuous shot, no text overlays or logos.',width:608,height:1056,first_frame:['17',0]};
 graph['17']=node('LoadImage',{image:'superip-h3-guide/reference-frame.png'});
 graph['18']=node('LoadAudio',{audio:'superip-h3-guide/driver.wav'});
 graph['19']=node('MiniMaxH3AddGuide',{positive:['6',0],latent:['6',1],frame_idx:0,audio_vae:['4',0],audio:['18',0]});
 graph['11'].inputs.conditioning=['19',0];graph['8'].inputs.noise_seed=43;
 graph['16'].inputs.filename_prefix='superip-study/h3-guided-speaker-seed43';
}
if(variant==='official-prompt-guided'){
 // 本次仅改变提示词，保留失败样本的首帧、音轨、种子、分辨率和采样设置作对照。
 graph['6'].inputs.prompt='For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: [Shot 1] Live-action, a medium close-up of the same adult Chinese woman seated at the desk in <Picture 1>. Preserve her facial proportions, dark shoulder-length hair, white shirt, desk and room arrangement. The camera holds a static shot. She looks toward the camera, breathes subtly and keeps both hands resting on the desk, with small natural finger movements. The woman with the clear Mandarin voice from the supplied soundtrack (S1) says: <d>[Chinese] 先把台灯放在左边，再把电源接好。</d> Her lips and jaw follow the exact timing of the supplied speech. She settles into a relaxed closed-mouth expression when the sentence finishes. The full 5.17-second shot stays continuous. The lower part of the image shows only her shirt, hands and tabletop; the image is free of subtitles, captions and graphic overlays.\n\noverall_soundscape: Quiet indoor room ambience beneath the supplied speech, with faint breathing and subtle fabric movement.\n\nnon_diegetic_music: N/A';
 graph['16'].inputs.filename_prefix='superip-study/h3-official-prompt-guided-seed43';
}
const save=value=>fs.writeFileSync(file,JSON.stringify(value,null,2));
async function main(){
 const action=process.argv[2]||'prepare';
 if(action==='prepare'){
  fs.writeFileSync(path.join(root,'prompt-api.json'),JSON.stringify(graph,null,2));
  console.log('已准备实际本地 H3 实验图，未提交推理。');return;
 }
 if(action==='submit'){
  if(fs.existsSync(file))throw Error('实验已有提交记录，先查询现有任务，禁止盲目重复提交');
  const payload={prompt:graph,client_id:crypto.randomUUID()};
  fs.writeFileSync(path.join(root,'prompt-api.json'),JSON.stringify(payload,null,2));
  const receipt={startedAt:new Date().toISOString(),kind:variant==='first-generation'?'new-local-h3-t2va':'new-local-h3-audio-guided-video',inputReferenceVideo:null,inputReferenceAudio:guided?'first-generation/generated-audio.wav':null,
   inputReferenceImage:guided?'input/superip-h3-guide/reference-frame.png':null,
   source:'existing-local-comfy-models',size:guided?[608,1056]:[352,608],frames:124,fps:24,seed:guided?43:42,steps:8,
   ...(variant==='official-prompt-guided'?{promptSource:'own-script-using-official-h3-prompt-writing',guideCommit:'199b7d0e1fd95e7b3eafa8c15eca692534142427',comparison:'guided-generation',changedVariable:'prompt-only'}:{}),
   qualityAccepted:false,referenceParityAccepted:false,submissionState:'submitting'};save(receipt);
  try{
   const response=await fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
   const result=await response.json();Object.assign(receipt,{httpStatus:response.status,submission:result,submissionState:response.ok?'submitted':'rejected'});save(receipt);
   console.log(JSON.stringify(receipt));
  }catch(error){receipt.submissionState='unknown';receipt.error=error.message;save(receipt);throw error;}
  return;
 }
 const receipt=JSON.parse(fs.readFileSync(file,'utf8')),id=receipt.submission?.prompt_id;
 if(!id)throw Error('没有可查询的任务 ID，提交状态为 '+receipt.submissionState);
 const history=await (await fetch(base+'/history/'+id,{signal:AbortSignal.timeout(5000)})).json();
 const queue=await (await fetch(base+'/queue',{signal:AbortSignal.timeout(5000)})).json();
 const running=queue.queue_running?.some(row=>row[1]===id)||false;
 if(action==='interrupt'){
  if(!running)throw Error('当前运行的不是本次实验，未发送全局停止请求');
  const response=await fetch(base+'/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt_id:id})});
  receipt.interruptRequestedAt=new Date().toISOString();receipt.interruptHttpStatus=response.status;
 }
 receipt.checkedAt=new Date().toISOString();receipt.running=running;receipt.queued=queue.queue_pending?.some(row=>row[1]===id)||false;
 if(history[id]){receipt.history=history[id];receipt.completed=history[id].status?.completed||false;}
 save(receipt);console.log(JSON.stringify({id,running:receipt.running,queued:receipt.queued,completed:receipt.completed,status:receipt.history?.status,outputs:receipt.history?.outputs}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
