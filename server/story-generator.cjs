const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const {runProcess}=require('./media.cjs');
const {validateVideoControls}=require('./story-contract.cjs');
const {ComfyH3,localBase,graphSignature}=require('./comfy-h3.cjs');
const node=(class_type,inputs)=>({class_type,inputs});
const DEFAULT_CHECKPOINT='sd_xl_base_1.0.safetensors';
const DEFAULT_H3='minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const DEFAULT_REFERENCE_H3='minimax_h3_ref2va_pruned_int8_convrot.safetensors';
const REFERENCE_H3_LORA='minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors';
const Z_IMAGE_DEFAULTS={storyImageZUnet:'z_image_turbo_bf16.safetensors',storyImageZClip:'qwen_3_4b.safetensors',storyImageZVae:'ae.safetensors'};
const PROMPT_COMPILER_VERSION=7;
function imageArchitecture(config={}){const value=config.storyImageArchitecture||'sdxl';if(!['sdxl','z-image-turbo'].includes(value))throw Error('图片架构尚未接入，请选择SDXL或Z-Image Turbo');return value;}
function imageWeights(config={}){const architecture=imageArchitecture(config);return architecture==='sdxl'?{architecture,model:config.storyImageModel||DEFAULT_CHECKPOINT}:{architecture,model:config.storyImageZUnet||Z_IMAGE_DEFAULTS.storyImageZUnet,clip:config.storyImageZClip||Z_IMAGE_DEFAULTS.storyImageZClip,vae:config.storyImageZVae||Z_IMAGE_DEFAULTS.storyImageZVae};}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function canvas(aspect='9:16',video=false){const values=video?{'9:16':[576,1024],'16:9':[1024,576],'1:1':[768,768],'4:3':[1024,768],'3:4':[768,1024]}:{'9:16':[768,1344],'16:9':[1344,768],'1:1':[1024,1024],'4:3':[1024,768],'3:4':[768,1024]};if(!values[aspect])throw Error('画幅仅支持9:16、16:9、1:1、4:3、3:4');return values[aspect];}
function imageReferenceSettings(config={}){
 const fit=config.storyImageReferenceFit??'contain',rawDenoise=config.storyImageDenoise??0.68,denoise=typeof rawDenoise==='number'?rawDenoise:NaN,language=config.storyImagePromptLanguage??'original';
 if(!['contain','cover','blur'].includes(fit)||!Number.isFinite(denoise)||denoise<0.1||denoise>1||!['original','english'].includes(language))throw Error('SDXL参考图设置无效，请检查画幅、重绘强度与指令语言');
 return {fit,denoise,language};
}
function referenceImageFilter(sourceWidth,sourceHeight,width,height,fit='contain'){
 if(![sourceWidth,sourceHeight,width,height].every(Number.isFinite)||Math.min(sourceWidth,sourceHeight,width,height)<=0)throw Error('参考图片或目标画幅尺寸无效');
 if(!['contain','cover','blur'].includes(fit))throw Error('参考图片画幅策略无效');
 if(fit==='cover')return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(in_w-out_w)/2:(in_h-out_h)/2,setsar=1`;
 if(fit==='blur')return `split[background][foreground];[background]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=32[blurred];[foreground]scale=${width}:${height}:force_original_aspect_ratio=decrease[fitted];[blurred][fitted]overlay=(W-w)/2:(H-h)/2,setsar=1`;
 return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}
function validPrompt(input){if(typeof input?.prompt!=='string'||!input.prompt.trim())throw Error('请填写画面或视频提示词');if(input.storyInstructions!==undefined&&(typeof input.storyInstructions!=='string'||input.storyInstructions.length>5000))throw Error('全局补充要求格式无效或过长');if(input.prompt.length>32000||String(input.instruction||'').length>16000)throw Error('生成要求过长，请缩短后重试');canvas(input.aspect);return [input.prompt.trim(),require('./product-prompt.cjs').productMotionTiming(input),input.style?`Visual style: ${input.style}`:'',input.storyInstructions?`Global story requirements: ${input.storyInstructions}`:'',input.instruction?`Additional requirements: ${input.instruction}`:''].filter(Boolean).join('\n');}
function validDuration(value){if(!Number.isFinite(value)||value<4||value>15)throw Error('当前非口播H3单镜头支持4至15秒，请调整镜头时长');return value;}
function videoDuration(input){if(!input?.productIntroduction)return {planned:validDuration(input.duration),generated:input.duration};const duration=input.duration;if(!Number.isFinite(duration)||duration<=0||duration>15)throw Error('产品介绍单镜头须大于0且不超过15秒，请拆分较长镜头');return {planned:duration,generated:Math.max(4,duration)};}
function imageGraph({prompt,checkpoint=DEFAULT_CHECKPOINT,image,aspect='9:16',seed=42,prefix='superip-story',denoise=0.68}){const [width,height]=canvas(aspect);if(!Number.isFinite(denoise)||denoise<0.1||denoise>1)throw Error('SDXL重绘强度需为0.1至1');const graph={
 '1':node('CheckpointLoaderSimple',{ckpt_name:checkpoint}),
 '2':node('CLIPTextEncode',{text:prompt,clip:['1',1]}),
 '3':node('CLIPTextEncode',{text:'watermark, logo, subtitles, distorted anatomy, duplicate subject, low quality, collage, split screen, tiled layout, grid, multiple panels, frame border',clip:['1',1]}),
 '4':node('EmptyLatentImage',{width,height,batch_size:1}),
 '5':node('KSampler',{seed,steps:24,cfg:7,sampler_name:'dpmpp_2m',scheduler:'karras',denoise:image?denoise:1,model:['1',0],positive:['2',0],negative:['3',0],latent_image:image?['8',0]:['4',0]}),
 '6':node('VAEDecode',{samples:['5',0],vae:['1',2]}),
 '7':node('SaveImage',{images:['6',0],filename_prefix:prefix})};
 if(image){graph['9']=node('LoadImage',{image});graph['8']=node('VAEEncode',{pixels:['9',0],vae:['1',2]});}return graph;
}
function zImageGraph({prompt,model=Z_IMAGE_DEFAULTS.storyImageZUnet,clip=Z_IMAGE_DEFAULTS.storyImageZClip,vae=Z_IMAGE_DEFAULTS.storyImageZVae,aspect='9:16',seed=42,prefix='superip-story',image}){
 if(image)throw Error('当前Z-Image本地工作流仅支持纯文生图，不支持参考图，不能忽略参考后提交');
 const [width,height]=canvas(aspect);return {
  '1':node('UNETLoader',{unet_name:model,weight_dtype:'default'}),
  '2':node('CLIPLoader',{clip_name:clip,type:'lumina2',device:'default'}),
  '3':node('VAELoader',{vae_name:vae}),
  '4':node('CLIPTextEncode',{text:prompt,clip:['2',0]}),
  '5':node('CLIPTextEncode',{text:'',clip:['2',0]}),
  '6':node('EmptySD3LatentImage',{width,height,batch_size:1}),
  '8':node('ModelSamplingAuraFlow',{model:['1',0],shift:3,sampling:'flow'}),
  '9':node('KSampler',{seed,steps:8,cfg:1,sampler_name:'res_multistep',scheduler:'simple',denoise:1,model:['8',0],positive:['4',0],negative:['5',0],latent_image:['6',0]}),
  '10':node('VAEDecode',{samples:['9',0],vae:['3',0]}),
  '7':node('SaveImage',{images:['10',0],filename_prefix:prefix})
 };
}
function inspectImageModels(info,config={}){
 const weights=imageWeights(config),z=weights.architecture==='z-image-turbo';
 const referenceSettings=z?null:imageReferenceSettings(config);
 const requiredNodes=z?['UNETLoader','CLIPLoader','VAELoader','ModelSamplingAuraFlow','CLIPTextEncode','EmptySD3LatentImage','KSampler','VAEDecode','SaveImage']:['CheckpointLoaderSimple','KSampler','CLIPTextEncode','EmptyLatentImage','VAEDecode','VAEEncode','LoadImage','SaveImage'];
 const models=modelNames(info,z?'UNETLoader':'CheckpointLoaderSimple',z?'unet_name':'ckpt_name');
 const requiredWeights=z?[['UNETLoader','unet_name',weights.model],['CLIPLoader','clip_name',weights.clip],['VAELoader','vae_name',weights.vae]]:[['CheckpointLoaderSimple','ckpt_name',weights.model]];
 const missingNodes=requiredNodes.filter(name=>!info[name]),missingModels=requiredWeights.filter(([loader,field,name])=>!modelNames(info,loader,field).includes(name)).map(row=>row[2]);
 const invalidOptions=[];if(z){for(const [loader,field,value]of [['CLIPLoader','type','lumina2'],['KSampler','sampler_name','res_multistep'],['KSampler','scheduler','simple']])if(!modelNames(info,loader,field).includes(value))invalidOptions.push(loader+'.'+field+'='+value);}
 return {architecture:weights.architecture,selected:weights.model,weights,models,available:{checkpoints:modelNames(info,'CheckpointLoaderSimple','ckpt_name'),unets:modelNames(info,'UNETLoader','unet_name'),textEncoders:modelNames(info,'CLIPLoader','clip_name'),vaes:modelNames(info,'VAELoader','vae_name')},ready:!missingNodes.length&&!missingModels.length&&!invalidOptions.length,missingNodes,missingModels,invalidOptions,referenceMode:z?'text-only':'single-primary-img2img',supportsReferences:!z,...(referenceSettings?{referenceSettings}:{}),generationVerified:false};
}
function h3FrameLength(input){return Math.ceil((Math.ceil(videoDuration(input).generated*24)-5)/17)*17+5;}
function h3Prompt(input){const description=validPrompt(input),duration=input.lastFrame?(h3FrameLength(input)-1)/24:videoDuration(input).generated,product=input.productIntroduction?' Preserve the exact visible product shape, material, colors, markings and quantity from the reference. Animate only the explicitly requested action; do not invent product capabilities, performance tests or new accessories. Do not add written labels, logos, icons, captions, speech or voiceover; original icons and confirmed text will be composited separately.':'';const alignment=input.lastFrame?`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.`:'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';return `${alignment}\n\nintegrated_multimodal_description: [Shot 1] Begin with the subject appearance, placement, lighting and composition shown in <Picture 1>. Develop one continuous shot over ${duration.toFixed(2)} seconds, ending at ${duration.toFixed(2)} seconds. Follow the following specific scene, action and camera requirements without adding unrelated characters or inventing dialogue.${input.lastFrame?' Move continuously toward the exact subject shape, placement and composition in <Picture 2>, reaching it at the final frame. Keep separate objects separate throughout the entire motion; do not morph their geometry or invent parts.':''}${product}\n${description}\n\noverall_soundscape: Follow the physical action and environmental sound requirements specified above. If no sound is specified, use low natural ambience consistent with the depicted environment, without spoken dialogue.\n\nnon_diegetic_music: N/A`;}
function videoGraph({input,image,lastImage,model=DEFAULT_H3,seed=42,prefix='superip-story'}){const [width,height]=canvas(input.aspect,true),length=h3FrameLength(input);if(Boolean(input.lastFrame)!==Boolean(lastImage))throw Error('首尾帧模式缺少对应尾帧输入');return {
 '1':node('UNETLoader',{unet_name:model,weight_dtype:'default'}),
 '2':node('CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}),
 '3':node('VAELoader',{vae_name:'minimax_h3_video_vae_int8_convrot.safetensors'}),
 '4':node('VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}),
 '5':node('LoraLoaderModelOnly',{model:['1',0],lora_name:'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',strength_model:1}),
 '6':node('MiniMaxH3ImageToVideo',{clip:['2',0],vae:['3',0],first_frame:['17',0],...(lastImage?{last_frame:['18',0]}:{}),prompt:h3Prompt(input),width,height,length}),
 '7':node('MiniMaxH3SigmaShift',{model:['5',0],shift_video:12,shift_audio:3}),
 '8':node('RandomNoise',{noise_seed:seed}),'9':node('KSamplerSelect',{sampler_name:'res_multistep'}),
 '10':node('BasicScheduler',{model:['7',0],scheduler:'simple',steps:8,denoise:1}),
 '11':node('BasicGuider',{model:['7',0],conditioning:['6',0]}),
 '12':node('SamplerCustomAdvanced',{noise:['8',0],guider:['11',0],sampler:['9',0],sigmas:['10',0],latent_image:['6',1]}),
 '13':node('VAEDecode',{samples:['12',0],vae:['3',0]}),'14':node('VAEDecodeAudio',{samples:['12',0],vae:['4',0]}),
 '15':node('CreateVideo',{images:['13',0],audio:['14',0],fps:24,bit_depth:8}),
 '16':node('SaveVideo',{video:['15',0],filename_prefix:prefix,format:'auto','format.codec':'auto'}),'17':node('LoadImage',{image}),...(lastImage?{'18':node('LoadImage',{image:lastImage})}:{})};}
function referenceVideoPrompt(input,references){
 const description=validPrompt(input),duration=videoDuration(input).generated;
 // Subject 指向绑定的内容单元而非整张照片；保真只作用于该角色，不推断图片已经过人物检测。
 const roles={
  character:{definition:'designated character appearance',scope:'Preserve only the designated character\'s identity and explicitly assigned appearance, clothing and features; other people in the source image are not part of this character binding.'},
  scene:{definition:'environment',scope:'Preserve the assigned environment\'s spatial layout, structures, materials, lighting and colors; people, photographers and their reflections in the source image are not environment assets.'},
  prop:{definition:'designated object appearance',scope:'Preserve only the designated object\'s geometry, components, materials, colors and confirmed markings; surrounding people, hands, photographers and their reflections are not part of the object binding.'},
  product:{definition:'designated product appearance',scope:'Preserve only the designated product\'s geometry, components, materials, colors and confirmed product markings; surrounding people, hands, photographers and their reflections are not part of the product binding.'},
  style:{definition:'visual style',scope:'Reference only the assigned visual style, palette, lighting treatment and texture; do not inherit depicted identities, objects, people or writing merely as style.'}
 };
 const roleOf=ref=>roles[ref.kind]||{definition:'designated asset content',scope:'Preserve only the named asset and its explicitly supplied description; unspecified visible content in the source image is not an additional asset binding.'};
 const subjects=references.map((ref,index)=>`<Subject ${index+1}> is the ${roleOf(ref).definition} from <Picture ${index+1}>. Asset identity: ${ref.name||ref.storyAssetId||ref.assetId||index+1}. ${roleOf(ref).scope} ${ref.description||ref.prompt||''}`),labels=references.map((_,index)=>`<Subject ${index+1}>`).join(', ');
 // 官方 fully_preserved 以已定义角色为界；风格仅作弱参考，不要求复现源图中的全部对象。
 const retention=references.map((ref,index)=>`<Subject ${index+1}> (appears in [Shot 1]): ${ref.kind==='style'?'weak_reference':'fully_preserved'} - ${roleOf(ref).scope} Apply this relationship only to the defined role throughout the requested action. This is the desired fidelity, subject to output review.`).join('\n');
 // 商品旁白由后期配音统一合成；普通剧情遵循显式声音要求，不能统一禁掉对白。
 const soundscape=input.productIntroduction?'Use only the natural physical sounds requested above; no speech or voiceover. The approved narration is added separately during composition.':'Follow the explicit speech, silence and physical sound requirements specified above. Preserve any explicitly required dialogue or voiceover in its original language and at the requested time; do not invent additional spoken content. Explicit silence or sound-only requirements take precedence over the fallback. If neither speech, silence nor specific sound requirements are provided, use only low natural ambience without dialogue or voiceover.';
 // 参考模式沿用官方六段结构；资产标签始终对应实际上传顺序，原始创作要求不擅自改写。
 return `subject_definitions:\n${subjects.join('\n')}\n\nsummary: [reference generation] Generate a new continuous scene lasting ${duration.toFixed(2)} seconds using ${labels}. Reference images are visual assets, not fixed first or last frames.\n\nretention_analysis:\n${retention}\n\ndetailed_description: Follow the requested visual style, environment and lighting. [Shot 1] At the opening, establish ${labels} in the requested composition. Keep their assigned roles and distinct identities throughout the action. Develop the specified action and camera movement continuously, completing the important action within ${duration.toFixed(2)} seconds. Use all assigned references without making a collage. Do not automatically inherit unbound people, photographers, human reflections, application interfaces, overlays or subtitles merely because they appear in a reference image. Include a person or visible text when explicitly bound to the corresponding role or explicitly required by the saved scene requirements; preserve explicitly bound characters. Do not invent dialogue, product capabilities, labels, logos, subtitles or extra accessories. Specific scene and motion requirements:\n${description}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: N/A`;
}
function referenceVideoGraph({input,images,references=input.references||[],model=DEFAULT_REFERENCE_H3,seed=42,prefix='superip-story'}){
 if(input.lastFrame)throw Error('资产参考模式不支持尾帧，请切换首尾帧模式；未提交任务');
 if(!Array.isArray(images)||images.length<1||images.length>9||images.some(image=>typeof image!=='string'||!image.trim()))throw Error('H3资产参考模式需要1至9张有效参考图片');
 if(references.length!==images.length)throw Error('参考图片与资产绑定数量不一致，未提交任务');
 if(model!==DEFAULT_REFERENCE_H3)throw Error('资产参考模式仅支持MiniMax H3 REF2VA，不能替换为其他UNET');
 const [width,height]=canvas(input.aspect,true),graph=videoGraph({input:{...input,lastFrame:undefined},image:images[0],seed,prefix});
 graph['1'].inputs.unet_name=model;
 graph['5'].inputs.lora_name=REFERENCE_H3_LORA;
 graph['6']=node('MiniMaxH3ReferenceToVideo',{clip:['2',0],vae:['3',0],audio_vae:['4',0],prompt:referenceVideoPrompt(input,references),width,height,length:h3FrameLength(input),ref_image_size:'match',...Object.fromEntries(images.map((_,index)=>['ref_images.ref_image_'+index,[String(17+index),0]]))});
 graph['10'].inputs.steps=4;
 for(const [index,image]of images.entries())graph[String(17+index)]=node('LoadImage',{image});
 return graph;
}
function inspectReferenceVideoModels(info,config={}){
 const selected=config.storyReferenceVideoModel||DEFAULT_REFERENCE_H3,required=['MiniMaxH3ReferenceToVideo','MiniMaxH3SigmaShift','VAEDecodeAudio','CreateVideo','SaveVideo','UNETLoader','CLIPLoader','VAELoader','LoraLoaderModelOnly','BasicScheduler','BasicGuider','SamplerCustomAdvanced','RandomNoise','KSamplerSelect','VAEDecode','LoadImage'];
 const requiredModels=[['UNETLoader','unet_name',selected],['CLIPLoader','clip_name','qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],['VAELoader','vae_name','minimax_h3_video_vae_int8_convrot.safetensors'],['VAELoader','vae_name','minimax_h3_audio_vae_fp32.safetensors'],['LoraLoaderModelOnly','lora_name',REFERENCE_H3_LORA]];
 const missingNodes=required.filter(name=>!info[name]),missingModels=requiredModels.filter(([loader,field,name])=>!modelNames(info,loader,field).includes(name)).map(row=>row[2]),invalidOptions=[];
 if(selected!==DEFAULT_REFERENCE_H3)invalidOptions.push('storyReferenceVideoModel='+selected);
 for(const [loader,field,value]of [['CLIPLoader','type','minimax'],['KSamplerSelect','sampler_name','res_multistep'],['BasicScheduler','scheduler','simple']])if(!modelNames(info,loader,field).includes(value))invalidOptions.push(loader+'.'+field+'='+value);
 const referenceInput=info.MiniMaxH3ReferenceToVideo?.input?.optional?.ref_images?.[1]?.template;
 if(referenceInput?.prefix!=='ref_image_'||!(Number(referenceInput?.max)>=9))invalidOptions.push('MiniMaxH3ReferenceToVideo.ref_images');
 for(const field of ['vae','audio_vae'])if(!info.MiniMaxH3ReferenceToVideo?.input?.optional?.[field])invalidOptions.push('MiniMaxH3ReferenceToVideo.'+field);
 if(!modelNames(info,'MiniMaxH3ReferenceToVideo','ref_image_size').includes('match'))invalidOptions.push('MiniMaxH3ReferenceToVideo.ref_image_size=match');
 return {selected,models:modelNames(info,'UNETLoader','unet_name').filter(name=>name===DEFAULT_REFERENCE_H3),ready:!missingNodes.length&&!missingModels.length&&!invalidOptions.length,missingNodes,missingModels,invalidOptions,referenceMode:'assets',maxReferences:9,supportsLastFrame:false,supportsSeed:true,generationVerified:false};
}
function absoluteUrl(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('模型服务及产物地址需为不含密码的HTTP或HTTPS地址');return url.toString().replace(/\/$/,'');}
function modelNames(info,name,field){const specification=info?.[name]?.input?.required?.[field],value=specification?.[0];return Array.isArray(value)?value:Array.isArray(specification?.[1]?.options)?specification[1].options:[];}
function unknown(error){error.unknown=true;return error;}
function submissionFailure(error){const status=Number(error.httpStatus||error.message.match(/模型服务返回HTTP (\d{3})/)?.[1]);if(status>=400&&status<500&&status!==408){error.remoteConfirmed=true;return error;}return unknown(error);}
function compatibleSize(aspect){canvas(aspect);return aspect==='1:1'?'1024x1024':['9:16','3:4'].includes(aspect)?'1024x1536':'1536x1024';}

class StoryGenerator{
 constructor(store,media,providers){this.store=store;this.media=media;this.providers=providers;this.comfy=new ComfyH3(store,media);}
 config(){return this.store.data.settings.provider||{};}
 async check(ctx={},draft={}){
  const config={...this.config(),...draft},report={};
  for(const [kind,protocolKey,baseKey]of [['image','storyImageProtocol','storyImageBaseUrl'],['video','storyVideoProtocol','storyVideoBaseUrl']]){
   const protocol=config[protocolKey]||(kind==='image'?'comfy':'comfy-h3');report[kind]={protocol};
   try{
    if(protocol==='comfy'||protocol==='comfy-h3'||protocol==='comfy-wan22'){
     const base=localBase(config[baseKey]||'http://127.0.0.1:8188'),info=await this.comfy.json(base,'/object_info',{},ctx);
     if(kind==='image'){report.image={protocol,connected:true,...inspectImageModels(info,config)};continue;}
     if(protocol==='comfy-wan22'){report.video={protocol,connected:true,...require('./story-wan.cjs').inspectWanModels(info,config)};continue;}
     const available=modelNames(info,'UNETLoader','unet_name').filter(name=>name===DEFAULT_H3),selected=config.storyVideoModel||DEFAULT_H3;
     const required=['MiniMaxH3ImageToVideo','MiniMaxH3SigmaShift','VAEDecodeAudio','CreateVideo','SaveVideo','UNETLoader','CLIPLoader','VAELoader','LoraLoaderModelOnly','BasicScheduler','BasicGuider','SamplerCustomAdvanced','RandomNoise','KSamplerSelect','VAEDecode','LoadImage'];
     const missingNodes=required.filter(name=>!info[name]);
     const requiredModels=[['CLIPLoader','clip_name','qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],['VAELoader','vae_name','minimax_h3_video_vae_int8_convrot.safetensors'],['VAELoader','vae_name','minimax_h3_audio_vae_fp32.safetensors'],['LoraLoaderModelOnly','lora_name','minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']];
     const missingModels=requiredModels.filter(([loader,field,name])=>!modelNames(info,loader,field).includes(name)).map(row=>row[2]);
     report.video={protocol,connected:true,models:available,selected,ready:available.includes(selected)&&!missingNodes.length&&!missingModels.length,missingNodes,missingModels,referenceMode:info.MiniMaxH3ImageToVideo?.input?.optional?.last_frame?'first-last-frame':'first-frame',supportsLastFrame:!!info.MiniMaxH3ImageToVideo?.input?.optional?.last_frame,supportsSeed:true,generationVerified:false,reference:inspectReferenceVideoModels(info,config)};
    }else report[kind]={protocol,connected:false,ready:false,configured:!!config[baseKey],message:'已配置云端协议时需实际生成验证，检查不会提交付费任务'};
   }catch(error){report[kind]={...report[kind],connected:false,ready:false,error:error.message};}
  }
  return report;
 }
 refs(input){if(input.references!==undefined&&!Array.isArray(input.references))throw Error('参考资产列表无效');return (input.references||[]).map(ref=>{const asset=this.store.asset(ref.assetId);if(asset.type!=='image')throw Error('参考资产必须为已确认图片');return {...ref,path:asset.path,sha256:hash(asset.path)};});}
 async probe(file,ctx={}){ctx.signal?.throwIfAborted();const data=JSON.parse(await runProcess(this.media.binaries().ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{signal:ctx.signal}));if(!data.streams?.length)throw Error('模型返回的文件没有有效媒体流');return data;}
 async verify(file,kind,input,ctx={}){const data=await this.probe(file,ctx),stream=data.streams.find(row=>row.codec_type==='video');if(!stream||!Number.isInteger(stream.width)||!Number.isInteger(stream.height)||stream.width<16||stream.height<16||stream.width*stream.height>33554432)throw Error('模型返回的画面尺寸无效或过大');const [w,h]=canvas(input.aspect,kind==='video');if(Math.abs(stream.width/stream.height-w/h)>.04)throw Error('模型返回的画幅与当前镜头不一致');if(kind==='video'){const duration=Number(data.format?.duration);if(!Number.isFinite(duration)||duration<=0||Number(stream.nb_frames)<=1||Math.abs(duration-input.duration)>.15)throw Error('模型视频时长或帧数与镜头计划不符');await runProcess(this.media.binaries().ffmpeg,['-v','error','-xerror','-i',file,'-map','0:v:0','-map','0:a?','-f','null','-'],{signal:ctx.signal});return {duration,width:stream.width,height:stream.height,frameRate:stream.avg_frame_rate,hasAudio:data.streams.some(row=>row.codec_type==='audio')};}await runProcess(this.media.binaries().ffmpeg,['-v','error','-xerror','-i',file,'-frames:v','1','-f','null','-'],{signal:ctx.signal});return {width:stream.width,height:stream.height};}
 assertRegisteredSources(input,details){
  // 媒体ID不代表文件内容不变；生成和解码校验之间都要核对实际参考及旁白字节。
  if(Array.isArray(details.references))for(const reference of details.references){
   if(!reference.assetId||!reference.sha256||hash(this.store.asset(reference.assetId).path)!==reference.sha256)throw Error((input.productIntroduction?'商品参考图片':'参考图片')+'在生成期间已变化，未登记结果');
  }
  if(details.narrationAssetId&&(!details.narrationSha256||hash(this.store.asset(details.narrationAssetId).path)!==details.narrationSha256))throw Error('合成期间旁白音频已变化，未登记结果');
  if(Array.isArray(details.shots))for(const shot of details.shots)if(!shot.assetId||!shot.sha256||hash(this.store.asset(shot.assetId).path)!==shot.sha256)throw Error('合成期间镜头视频已变化，未登记结果');
 }
 async register(file,kind,input,details,ctx={}){this.assertRegisteredSources(input,details);const verified=await this.verify(file,kind,input,ctx);ctx.signal?.throwIfAborted();this.assertRegisteredSources(input,details);let asset;try{asset=this.store.addAsset(file,{origin:'story-'+kind,...verified,storyGeneration:{...details,...(input.creativePreset?{creativePreset:input.creativePreset}:{}),...(input.promptCompilerVersion!==undefined?{promptCompilerVersion:input.promptCompilerVersion}:{}),...(input.storyInstructions!==undefined?{storyInstructions:input.storyInstructions}:{}),inputHash:input.inputHash,revision:input.revision,prompt:input.prompt,instruction:input.instruction||'',target:input.target||{episodeId:input.episodeId,shotId:input.shotId},qualityAccepted:false,outputSha256:hash(file)}},{persist:false});this.store.save();return asset;}catch(error){
  // 登记或保存素材失败后停止批量，避免在无法保存结果时继续调用模型。
  error.stopBatch=true;if(asset){this.store.data.assets=this.store.data.assets.filter(row=>row.id!==asset.id);fs.rmSync(asset.path,{force:true});}throw error;}}
 async preparePrimary(ref,directory,aspect,ctx={},fit='contain'){
  const [width,height]=canvas(aspect),output=path.join(directory,'primary-reference.png'),source=await this.probe(ref.path,ctx),stream=source.streams.find(row=>row.width&&row.height);
  if(!stream)throw Error('主参考图片没有有效的宽高信息');
  await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',ref.path,'-vf',referenceImageFilter(stream.width,stream.height,width,height,fit),'-frames:v','1','-update','1',output],{signal:ctx.signal});
  if(hash(ref.path)!==ref.sha256)throw Error('主参考图片在准备期间已变化，请重新生成');return output;
 }
 async image(input,ctx={}){
  // 仅新编译的任务记录当前版本；恢复旧任务沿用冻结输入，不能补签新规则已执行。
  input={...input,promptCompilerVersion:PROMPT_COMPILER_VERSION};
  const checkedPrompt=validPrompt(input),assetPrompt=require('./asset-image-prompt.cjs').assetImagePrompt(input);
  const prompt=assetPrompt||(checkedPrompt+require('./creative-presets.mjs').creativePresetPrompt(input.creativePreset)),refs=this.refs(input),config=this.config(),protocol=config.storyImageProtocol||'comfy';
  const weights=protocol==='comfy'?imageWeights(config):null;
  if(input.imageEditRegion!==undefined){require('./story-image-edit.cjs').editRegion(input.imageEditRegion);if(protocol!=='comfy'||weights?.architecture!=='sdxl')throw Error('框选局部重绘仅支持本地SDXL，请切换图片设置；未提交任务');if(!refs.length)throw Error('局部重绘需要一张已确认主参考图片');}
  if(weights?.architecture==='z-image-turbo'&&(refs.length||input.primaryReferenceAssetId))throw Error('当前Z-Image本地工作流仅支持纯文生图，不支持参考图。请切回SDXL或显式建立无参考的独立构图资产，不能忽略已绑定参考。');
  if(refs.length>12)throw Error('单次最多使用12张参考资产图片');if(input.primaryReferenceAssetId&&!refs.length)throw Error('当前没有可用主参考图片，请先选用资产图片');ctx.signal?.throwIfAborted();
  let primary;if(protocol==='comfy'&&refs.length){
   if(input.primaryReferenceAssetId){primary=refs.find(ref=>ref.storyAssetId===input.primaryReferenceAssetId||ref.assetId===input.primaryReferenceAssetId);if(!primary)throw Error('主参考资产不在当前镜头绑定图片中，请重新选择');}
   else if(refs.length===1)primary=refs[0];else throw Error('本地SDXL仅支持单张主参考，请先指定主参考资产；其他绑定只参与文本要求，不能作为多图一致性控制');
  }
  const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.story-image-'));
  try{
   if(protocol==='comfy'){
    const base=localBase(config.storyImageBaseUrl||'http://127.0.0.1:8188'),model=weights.model,tag=crypto.randomUUID();let uploaded;
    // 所有本地图片架构都在上传和提交之前只读预检，服务未开不能留下提交中凭据。
    const info=await this.comfy.json(base,'/object_info',{},ctx),checked=inspectImageModels(info,config);
    if(!checked.ready)throw Object.assign(Error((weights.architecture==='z-image-turbo'?'Z-Image':'SDXL')+'本地工作流不可用（'+base+'）：'+[...checked.missingNodes,...checked.missingModels,...checked.invalidOptions].join('、')),{stopBatch:true,environmentFailure:true});
    if(input.imageEditRegion){const missing=['VAEEncodeForInpaint','LoadImageMask','ImageScale','ImageCompositeMasked'].filter(name=>!info[name]);if(missing.length)throw Object.assign(Error('本地局部重绘缺少节点：'+missing.join('、')),{stopBatch:true,environmentFailure:true});}
    const referenceMode=primary?'single-primary-img2img':'text-only';
    const referenceSettings=weights.architecture==='sdxl'?imageReferenceSettings(config):null;
    const descriptions=refs.map(ref=>`${ref.kind||'asset'} ${ref.name||ref.storyAssetId}: ${ref.description||ref.prompt||ref.name||''}`).join('; ');
    let fullPrompt=prompt+(primary?`\nSingle continuous scene, one composition, no collage, no montage, no borders. The uploaded single visual reference is ${primary.name||primary.storyAssetId}. Preserve its visible subject appearance. Bound content descriptions: ${descriptions}.`:'');
    if(input.imageEditRegion)fullPrompt=`局部重绘目标：${input.instruction||input.prompt}\n仅生成选区内的静态画面，不重建整台产品，不在选区内再次画一台完整设备。选区外由原图保留。以下是原镜头与参考图的上下文，不是要在选区内复制全部内容：\n${fullPrompt}`;
    if(referenceSettings?.language==='english'){
     const compiled=await require('./sdxl-prompt.cjs').compileImagePrompt(this.providers,fullPrompt,ctx);
     input={...input,imagePromptCompilation:compiled};fullPrompt=compiled.prompt;
    }
    let imageEditing,editingUploads;
    if(primary){
     const prepared=await this.preparePrimary(primary,directory,input.aspect,ctx,referenceSettings.fit);uploaded=await this.comfy.upload(base,prepared,'superip-story/'+tag,ctx);
     if(input.imageEditRegion){
      const helper=require('./story-image-edit.cjs');
      const source=await this.probe(primary.path,ctx),stream=source.streams.find(row=>row.width&&row.height),[width,height]=canvas(input.aspect);
      imageEditing=helper.editGeometry(input.imageEditRegion,stream.width,stream.height,width,height,referenceSettings.fit);
      const files=await helper.prepareEdit(this.media,prepared,directory,imageEditing,ctx);editingUploads={original:uploaded.subfolder+'/'+uploaded.name,geometry:imageEditing};
      for(const [key,file]of Object.entries(files)){ctx.signal?.throwIfAborted();const upload=await this.comfy.upload(base,file,'superip-story/'+tag,ctx);editingUploads[key]=upload.subfolder+'/'+upload.name;}
     }
    }
    ctx.signal?.throwIfAborted();for(const ref of refs)if(hash(ref.path)!==ref.sha256)throw Error('参考图片在准备期间已变化，未提交任务');
    let graph=weights.architecture==='z-image-turbo'?zImageGraph({prompt:fullPrompt,...weights,aspect:input.aspect,seed:crypto.randomInt(0,4294967296),prefix:'superip-story/'+tag}):imageGraph({prompt:fullPrompt,checkpoint:model,image:uploaded?uploaded.subfolder+'/'+uploaded.name:undefined,aspect:input.aspect,denoise:referenceSettings.denoise,seed:crypto.randomInt(0,4294967296),prefix:'superip-story/'+tag});
    if(editingUploads)graph=require('./story-image-edit.cjs').editGraph(graph,editingUploads);
    return await this.executeComfy({kind:'story-comfy-image-v1',baseUrl:base,clientId:tag,graph,graphSha256:graphSignature(graph),input,model,architecture:weights.architecture,weights,referenceSettings,...(imageEditing?{imageEditing}:{}),referenceMode,references:refs.map(({path,...ref})=>ref),usedReferenceAssetIds:primary?[primary.assetId]:[],usedStoryAssetIds:primary?[primary.storyAssetId].filter(Boolean):[],unusedVisualReferenceAssetIds:refs.filter(ref=>ref!==primary).map(ref=>ref.assetId),referenceLimitation:primary?'仅主参考图片参与图生图；其他绑定以文本描述参与，不提供多图或身份一致性保证':'',outputNode:'7',mediaKind:'image',submissionState:'submitting'},ctx);
   }
   if(protocol!=='compatible')throw Error('未知非口播图片协议');return await this.cloudImage(input,prompt,refs,directory,ctx);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 async cloudImage(input,prompt,refs,directory,ctx){const config=this.config(),base=absoluteUrl(config.storyImageBaseUrl||''),model=config.storyImageModel;if(!model)throw Error('请配置云端图片模型');let options,route;if(refs.length){const form=new FormData();form.set('model',model);form.set('prompt',prompt+'\nReference images in order: '+refs.map(ref=>`${ref.kind||'asset'} ${ref.name||ref.storyAssetId}`).join('; '));for(const ref of refs)form.append('image[]',new Blob([fs.readFileSync(ref.path)],{type:/\.jpe?g$/i.test(ref.path)?'image/jpeg':/\.webp$/i.test(ref.path)?'image/webp':'image/png'}),path.basename(ref.path));form.set('n','1');form.set('size',compatibleSize(input.aspect));options={method:'POST',headers:await this.providers.headers('image'),body:form};route='/images/edits';}else{options={method:'POST',headers:{...await this.providers.headers('image'),'Content-Type':'application/json'},body:JSON.stringify({model,prompt,n:1,size:compatibleSize(input.aspect)})};route='/images/generations';}const clientId=crypto.randomUUID(),remote={kind:'story-compatible-image-v1',baseUrl:base,clientId,submissionState:'submitting',input,model,references:refs.map(({path,...ref})=>ref)};ctx.remote?.('',remote);let response;try{response=await (await this.providers.request(base+route,options,ctx)).json();}catch(error){throw submissionFailure(error);}const image=response.data?.[0],output=path.join(directory,'result.png');if(typeof image?.b64_json==='string')fs.writeFileSync(output,Buffer.from(image.b64_json,'base64'));else if(typeof image?.url==='string'){await this.download(image.url,output,base,ctx,'image');}else throw unknown(Error('云端图片服务未返回可读取的图片，提交可能已执行，不能自动重交'));ctx.remote?.(response.id||clientId,{...remote,submissionState:'completed'});return await this.fitImageAndRegister(output,input,{protocol:'compatible',model,requestId:response.id||clientId,referenceMode:refs.length?'cloud-image-edit':'text-only',references:remote.references,usedReferenceAssetIds:refs.map(ref=>ref.assetId),usedStoryAssetIds:refs.map(ref=>ref.storyAssetId).filter(Boolean),unusedVisualReferenceAssetIds:[]},directory,ctx);}
 async fitImageAndRegister(file,input,details,directory,ctx){const [width,height]=canvas(input.aspect),output=path.join(directory,'validated.png');await this.probe(file,ctx);await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',file,'-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-frames:v','1','-update','1',output],{signal:ctx.signal});return this.register(output,'image',input,{...details,fitPolicy:'aspect-fit-black-pad'},ctx);}
 async video(input,ctx={}){
  input={...input,promptCompilerVersion:PROMPT_COMPILER_VERSION};
  validPrompt(input);videoDuration(input);validateVideoControls({videoSeed:input.seed});
  if((this.config().storyVideoProtocol||'comfy-h3')==='comfy-wan22')return this.wanVideo(input,ctx);
  if(input.referenceMode==='assets')return this.referenceVideo(input,ctx);
  const asset=this.store.asset(input.image?.assetId);if(asset.type!=='image')throw Error('请先选用当前镜头已确认的图片');
  const config=this.config(),protocol=config.storyVideoProtocol||'comfy-h3';ctx.signal?.throwIfAborted();
  if(protocol==='bridge'){if(input.lastFrame||input.seed!==undefined)throw Error('当前云端视频桥未声明支持尾帧或固定种子，请清除这两项或切换本地H3；未提交任务');return this.cloudVideo(input,asset,ctx);}
  if(protocol!=='comfy-h3')throw Error('未知非口播视频协议');
  const last=input.lastFrame?this.store.asset(input.lastFrame.assetId):null;if(last&&last.type!=='image')throw Error('尾帧必须是图片素材');
  const base=localBase(config.storyVideoBaseUrl||'http://127.0.0.1:8188'),directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.story-video-input-')),tag=crypto.randomUUID(),model=config.storyVideoModel||DEFAULT_H3;
  try{
   if(model!==DEFAULT_H3)throw Error('当前本地非口播视频图仅支持MiniMax H3 FL2VA，其他UNET不能作为该模型替换');
   if(last){const info=await this.comfy.json(base,'/object_info',{},ctx);if(!info.MiniMaxH3ImageToVideo?.input?.optional?.last_frame)throw Error('当前本地H3节点不支持尾帧，请更新节点或清除尾帧；未提交任务');}
   const refs=[{assetId:asset.id,path:asset.path,sha256:hash(asset.path),role:'first-frame'},...(last?[{assetId:last.id,path:last.path,sha256:hash(last.path),role:'last-frame'}]:[])],uploaded=[];
   for(const [i,ref]of refs.entries()){
    if(input.keyframeSha256&&input.keyframeSha256[i===0?'first':'last']!==ref.sha256)throw Error('首尾帧与提交前冻结内容不一致，未提交任务');
    const [width,height]=canvas(input.aspect,true),image=path.join(directory,i?'last-frame.png':'first-frame.png');
    await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',ref.path,'-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-frames:v','1','-update','1',image],{signal:ctx.signal});
    if(hash(ref.path)!==ref.sha256)throw Error('首尾帧图片在准备期间已变化，请重新生成');
    const result=await this.comfy.upload(base,image,'superip-story/'+tag,ctx);uploaded.push(result.subfolder+'/'+result.name);
   }
   for(const ref of refs)if(hash(ref.path)!==ref.sha256)throw Error('首尾帧图片在上传期间已变化，未提交任务');
   const seed=input.seed??crypto.randomInt(0,4294967296),graph=videoGraph({input,image:uploaded[0],lastImage:uploaded[1],model,seed,prefix:'superip-story/'+tag});
   return await this.executeComfy({kind:'story-comfy-video-v1',baseUrl:base,clientId:tag,graph,graphSha256:graphSignature(graph),input,model,referenceMode:last?'first-last-frame':'first-frame',references:refs.map(({path,...ref})=>ref),outputNode:'16',mediaKind:'video',submissionState:'submitting'},ctx);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 async referenceVideo(input,ctx={}){
  const config=this.config(),protocol=config.storyVideoProtocol||'comfy-h3';
  if(protocol!=='comfy-h3')throw Error('资产参考视频仅支持本地H3 REF2VA，请切换本地协议；未提交任务');
  if(input.lastFrame)throw Error('资产参考模式不支持尾帧，请切换首尾帧模式；未提交任务');
  if(input.image?.assetId)throw Error('资产参考模式不能同时指定固定首帧，请使用参考资产绑定；未提交任务');
  if(!Array.isArray(input.references)||input.references.length<1||input.references.length>9)throw Error('H3资产参考模式需要1至9张已确认参考图片');
  const ids=input.references.map(ref=>ref?.assetId);
  if(ids.some(id=>typeof id!=='string'||!id.trim())||new Set(ids).size!==ids.length)throw Error('参考图片ID无效或重复，请检查资产绑定；未提交任务');
  const refs=this.refs(input);
  for(const [index,ref]of refs.entries())if(input.references[index].sha256&&input.references[index].sha256!==ref.sha256)throw Error('参考图片与提交前冻结内容不一致，未提交任务');
  ctx.signal?.throwIfAborted();
  const base=localBase(config.storyVideoBaseUrl||'http://127.0.0.1:8188'),info=await this.comfy.json(base,'/object_info',{},ctx),checked=inspectReferenceVideoModels(info,config);
  if(!checked.ready)throw Object.assign(Error('H3资产参考工作流不可用（'+base+'）：'+[...checked.missingNodes,...checked.missingModels,...checked.invalidOptions].join('、')),{stopBatch:true,environmentFailure:true});
  const tag=crypto.randomUUID(),uploaded=[];
  for(const ref of refs){
   ctx.signal?.throwIfAborted();const data=await this.probe(ref.path,ctx),stream=data.streams.find(row=>row.codec_type==='video');
   if(!stream||!Number.isInteger(stream.width)||!Number.isInteger(stream.height)||stream.width<16||stream.height<16||stream.width*stream.height>33554432)throw Error('参考图片尺寸无效或过大，未提交任务');
   if(hash(ref.path)!==ref.sha256)throw Error('参考图片在检查期间已变化，未提交任务');
   const result=await this.comfy.upload(base,ref.path,'superip-story/'+tag,ctx);uploaded.push(result.subfolder+'/'+result.name);
  }
  for(const ref of refs)if(hash(ref.path)!==ref.sha256)throw Error('参考图片在上传期间已变化，未提交任务');
  ctx.signal?.throwIfAborted();const model=checked.selected,graph=referenceVideoGraph({input,images:uploaded,references:refs,model,seed:input.seed??crypto.randomInt(0,4294967296),prefix:'superip-story/'+tag});
  return this.executeComfy({kind:'story-comfy-video-v1',baseUrl:base,clientId:tag,graph,graphSha256:graphSignature(graph),input,model,referenceMode:'assets',references:refs.map(({path,...ref})=>ref),usedReferenceAssetIds:refs.map(ref=>ref.assetId),usedStoryAssetIds:refs.map(ref=>ref.storyAssetId).filter(Boolean),unusedVisualReferenceAssetIds:[],referenceLimitation:'多图资产参与H3参考生成；不固定首尾帧，仍需人工检查主体及商品一致性',outputNode:'16',mediaKind:'video',submissionState:'submitting'},ctx);
 }
 async wanVideo(input,ctx={}){
  const {WAN_DEFAULTS,validateWanInput,wanCanvas,wanFrameLength,wanGraph,inspectWanModels}=require('./story-wan.cjs');
  validateWanInput(input);ctx.signal?.throwIfAborted();
  const config=this.config(),weights={architecture:'wan22-ti2v-5b',model:config.storyWanModel||WAN_DEFAULTS.storyWanModel,clip:config.storyWanClip||WAN_DEFAULTS.storyWanClip,vae:config.storyWanVae||WAN_DEFAULTS.storyWanVae};
  if(input.wanRecipe&&graphSignature(input.wanRecipe)!==graphSignature(weights))throw Error('Wan模型配方在指令准备期间已变化，未提交生成');
  const asset=this.store.asset(input.image?.assetId);if(asset.type!=='image')throw Error('请先选用当前镜头已确认的首帧图片');
  const reference={assetId:asset.id,role:'first-frame',sha256:hash(asset.path)};
  if(input.firstFrameSha256&&reference.sha256!==input.firstFrameSha256)throw Error('Wan首帧在指令准备期间已变化，未提交生成');
  const base=localBase(config.storyVideoBaseUrl||'http://127.0.0.1:8188'),checked=inspectWanModels(await this.comfy.json(base,'/object_info',{},ctx),config);
  if(!checked.ready)throw Error('Wan工作流不可用：'+[...checked.missingNodes,...checked.missingModels,...checked.invalidOptions].join('、'));
  const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.story-wan-input-')),tag=crypto.randomUUID(),size=wanCanvas(input.aspect);
  try{
   const file=path.join(directory,'first-frame.png');
   // 先等比补边到原生尺寸，避免节点内部居中裁掉商品；不拉伸原图。
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf',`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-frames:v','1','-update','1',file],{signal:ctx.signal});
   if(hash(asset.path)!==reference.sha256)throw Error('Wan首帧在准备期间已变化，未提交生成');
   const uploaded=await this.comfy.upload(base,file,'superip-story/'+tag,ctx);
   if(hash(asset.path)!==reference.sha256)throw Error('Wan首帧在上传期间已变化，未提交生成');
   const seed=input.seed??crypto.randomInt(0,4294967296),graph=wanGraph({input,image:uploaded.subfolder+'/'+uploaded.name,weights,seed,prefix:'superip-story/'+tag,prompt:validPrompt(input)});
   return await this.executeComfy({kind:'story-comfy-video-v1',engine:'wan22-ti2v-5b',videoProtocol:'comfy-wan22',baseUrl:base,clientId:tag,graph,graphSha256:graphSignature(graph),input,model:weights.model,architecture:weights.architecture,weights,recipeVersion:1,frameLength:wanFrameLength(input),nativeSize:size,referenceMode:'first-frame',references:[reference],usedReferenceAssetIds:[asset.id],usedStoryAssetIds:[],unusedVisualReferenceAssetIds:[],referenceLimitation:'Wan单首帧静音图生视频；不支持尾帧或多资产参考，商品结构与动态效果须人工验收',outputNode:'16',mediaKind:'video',submissionState:'submitting'},ctx);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 async executeComfy(remote,ctx={},existingId=''){const {baseUrl:base,graph,clientId}=remote;let promptId=existingId,observer;ctx.signal?.throwIfAborted();try{observer=await this.comfy.observe(remote,ctx);if(!promptId){ctx.signal?.throwIfAborted();if(remote.referenceMode==='assets'||remote.engine==='wan22-ti2v-5b')this.assertRegisteredSources(remote.input,{references:remote.references});ctx.remote?.('',remote);promptId=await this.comfy.submit(base,graph,clientId,ctx);}remote={...remote,submissionState:'accepted',statusUrl:base+'/history/'+promptId};ctx.remote?.(promptId,remote);observer.bind(promptId);return await this.waitComfy(promptId,remote,ctx,observer);}catch(error){if(ctx.signal?.aborted&&promptId){try{await this.comfy.json(base,'/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[promptId]})});await this.comfy.json(base,'/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt_id:promptId})});}catch{}error.unknown=true;}else if(promptId&&!error.remoteConfirmed)error.unknown=true;throw error;}finally{observer?.close();}}
 async waitComfy(promptId,remote,ctx,observer){const deadline=Date.now()+45*60*1000;while(Date.now()<deadline){ctx.signal?.throwIfAborted();observer?.check();const history=await this.comfy.json(remote.baseUrl,'/history/'+encodeURIComponent(promptId),{},ctx),item=history[promptId];if(item?.status?.status_str==='error'){const error=Error('本地模型已确认生成失败：'+JSON.stringify(item.status.messages||[]).slice(-1500));error.remoteConfirmed=true;throw error;}if(item?.status?.status_str==='success'){const result=item.outputs?.[remote.outputNode];const candidates=[...(result?.images||[]),...(result?.videos||[])],file=candidates.find(row=>row.type==='output'&&(remote.mediaKind==='image'?/\.(png|jpe?g|webp)$/i.test(row.filename):/\.(mp4|webm|mov)$/i.test(row.filename)));if(!file)throw unknown(Error('本地模型完成但没有对应媒体输出，保留原任务供查询'));observer?.collecting();return this.collectComfy(file,promptId,remote,ctx);}await sleep(1000,undefined,{signal:ctx.signal});}throw unknown(Error('本地模型仍未返回最终结果，请查询原任务，不能重新提交'));}
 async collectComfy(result,promptId,remote,ctx={}){let localProcessing=false;const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.story-result-'));try{const extension=remote.mediaKind==='image'?'.png':'.mp4',file=path.join(directory,'original'+extension),query=new URLSearchParams({filename:result.filename,subfolder:result.subfolder||'',type:result.type}),response=await this.comfy.request(remote.baseUrl,'/view?'+query,{},ctx);if(!response.ok)throw Error('模型产物下载失败：HTTP '+response.status);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));localProcessing=true;const details={protocol:remote.mediaKind==='image'?'comfy':remote.videoProtocol||'comfy-h3',...(remote.engine?{engine:remote.engine,recipeVersion:remote.recipeVersion,frameLength:remote.frameLength,nativeSize:remote.nativeSize,silentVideo:true}:{} ),model:remote.model,architecture:remote.architecture,weights:remote.weights,promptId,clientId:remote.clientId,graphSha256:remote.graphSha256,seed:remote.graph?.['8']?.inputs?.noise_seed??remote.graph?.['5']?.inputs?.seed??remote.graph?.['9']?.inputs?.seed,referenceMode:remote.referenceMode,references:remote.references,usedReferenceAssetIds:remote.usedReferenceAssetIds||[],usedStoryAssetIds:remote.usedStoryAssetIds||[],unusedVisualReferenceAssetIds:remote.unusedVisualReferenceAssetIds||[],referenceLimitation:remote.referenceLimitation||'',sourceOutputSha256:hash(file),...(remote.mediaKind==='image'&&remote.referenceSettings?{imageReferenceSettings:remote.referenceSettings}:{}),...(remote.input.imagePromptCompilation?{imagePromptCompilation:remote.input.imagePromptCompilation}:{}),...(remote.imageEditing?{imageEditing:remote.imageEditing}:{}),...(remote.input.productIntroduction?{productIntroduction:remote.input.productIntroduction,generationDuration:videoDuration(remote.input).generated,plannedDuration:remote.input.duration}:{})};if(remote.mediaKind==='image')return await this.fitImageAndRegister(file,remote.input,details,directory,ctx);const data=await this.probe(file,ctx),stream=data.streams.find(row=>row.codec_type==='video');if(!stream||Number(data.format?.duration)+.06<remote.input.duration)throw Error('模型视频不足计划时长，未补静帧或循环冒充');const output=path.join(directory,'planned.mp4'),wan=remote.engine==='wan22-ti2v-5b',size=remote.nativeSize;if(wan&&(!size||![size.outputWidth,size.outputHeight].every(Number.isSafeInteger)))throw Error('Wan原任务缺少冻结的输出尺寸，未登记视频');await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',file,'-map','0:v:0','-map','0:a?','-t',String(remote.input.duration),'-vf',remote.referenceMode==='first-last-frame'?`setpts=${remote.input.duration}/${Number(data.format.duration)}*(PTS-STARTPTS),fps=24,setsar=1`:wan?`scale=${size.outputWidth}:${size.outputHeight}:force_original_aspect_ratio=decrease,pad=${size.outputWidth}:${size.outputHeight}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1`:'fps=24,setsar=1',...(remote.referenceMode==='first-last-frame'&&data.streams.some(row=>row.codec_type==='audio')?['-af',`atempo=${Number(data.format.duration)/remote.input.duration}`]:[]),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output],{signal:ctx.signal});return await this.register(output,'video',remote.input,{...details,frameGridPolicy:wan?'Wan-4k+1-generated-surplus-trimmed-to-planned-duration':remote.referenceMode==='first-last-frame'?'H3-full-keyframe-timeline-retimed-to-planned-duration':'H3-17k+5-generated-surplus-trimmed-to-planned-duration',sourceDuration:Number(data.format.duration)},ctx);}catch(error){if(localProcessing){error.remoteConfirmed=true;error.localProcessing=true;delete error.unknown;}throw error;}finally{fs.rmSync(directory,{recursive:true,force:true});}}
 async download(url,file,base,ctx={},capability='image'){const target=absoluteUrl(url),headers=new URL(target).origin===new URL(base).origin?await this.providers.headers(capability):{};const response=await this.providers.request(target,{headers},ctx);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));}
 async cloudVideo(input,image,ctx={}){const config=this.config(),base=absoluteUrl(config.storyVideoBaseUrl||''),clientId=crypto.randomUUID(),remote={kind:'story-video-bridge-v1',baseUrl:base,clientId,input,model:config.storyVideoModel||'',referenceMode:'first-frame',references:[{assetId:image.id,sha256:hash(image.path)}],submissionState:'submitting'};ctx.remote?.('',remote);const form=new FormData();form.set('model',remote.model);form.set('clientId',clientId);form.set('prompt',validPrompt(input));form.set('duration',String(videoDuration(input).generated));form.set('aspect',input.aspect||'9:16');form.set('image',new Blob([fs.readFileSync(image.path)]),image.name||path.basename(image.path));let result;try{result=await (await this.providers.request(base,{method:'POST',headers:await this.providers.headers('video'),body:form},ctx)).json();}catch(error){throw submissionFailure(error);}const id=result.jobId||'',next={...remote,statusUrl:result.statusUrl||'',submissionState:'accepted'};ctx.remote?.(id||clientId,next);return this.waitBridge(result,id,next,ctx);}
 async waitBridge(initial,id,remote,ctx={}){let result=initial,localProcessing=false;const deadline=Date.now()+45*60*1000;try{while(['queued','running'].includes(result.status)){if(!id||!remote.statusUrl)throw Error('视频桥未返回任务ID或查询地址，请保留提交凭据');if(Date.now()>deadline)throw Error('视频桥尚未完成，请查询原任务');await sleep(1500,undefined,{signal:ctx.signal});const headers=new URL(absoluteUrl(remote.statusUrl)).origin===new URL(remote.baseUrl).origin?await this.providers.headers('video'):{};result=await (await this.providers.request(remote.statusUrl,{headers},ctx)).json();if(result.jobId!==undefined&&result.jobId!==id)throw Error('视频桥返回的任务ID与原提交不一致');}if(['failed','cancelled'].includes(result.status)){const error=Error(result.error||'视频桥确认任务失败或取消');error.remoteConfirmed=true;throw error;}if(result.status!==undefined&&result.status!=='succeeded')throw Error('视频桥返回未知状态，不能重新提交');if(typeof result.videoUrl!=='string')throw Error('视频桥没有返回实际视频地址');const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.story-cloud-video-'));try{const file=path.join(directory,'video.mp4');await this.download(result.videoUrl,file,remote.baseUrl,ctx,'video');localProcessing=true;if(remote.input.productIntroduction){const data=await this.probe(file,ctx);if(Number(data.format?.duration)+.06<remote.input.duration)throw Error('产品镜头模型视频不足计划时长，不能补静帧或循环');const planned=path.join(directory,'planned.mp4');await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',file,'-map','0:v:0','-map','0:a?','-t',String(remote.input.duration),'-vf','fps=24,setsar=1','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',planned],{signal:ctx.signal});return await this.register(planned,'video',remote.input,{protocol:'bridge',model:remote.model,jobId:id||remote.clientId,referenceMode:remote.referenceMode,references:remote.references,productIntroduction:remote.input.productIntroduction,generationDuration:videoDuration(remote.input).generated,sourceDuration:Number(data.format.duration),frameGridPolicy:'generated-surplus-trimmed-to-planned-duration'},ctx);}return await this.register(file,'video',remote.input,{protocol:'bridge',model:remote.model,jobId:id||remote.clientId,referenceMode:remote.referenceMode,references:remote.references},ctx);}finally{fs.rmSync(directory,{recursive:true,force:true});}}catch(error){if(localProcessing){error.remoteConfirmed=true;error.localProcessing=true;delete error.unknown;}else if(!error.remoteConfirmed)error.unknown=true;throw error;}}
 async recover(run,ctx={}){const remote=run.remote;if(!remote?.kind?.startsWith('story-'))throw Error('不是可查询的非口播生成任务');if(remote.kind.startsWith('story-comfy-')){const id=run.remoteId||await this.comfy.discover(remote,ctx);return this.executeComfy(remote,ctx,id);}if(remote.kind==='story-video-bridge-v1'){if(!run.remoteId||!remote.statusUrl)throw unknown(Error('视频桥没有提供原任务查询地址，需要服务商查回，不能直接重交'));return this.waitBridge({status:'running'},run.remoteId,remote,ctx);}throw unknown(Error('当前兼容图片协议没有标准任务查询接口；请联系服务端按clientId查回，不会自动重交'));}
 async confirmLost(run,ctx={}){
  const remote=run.remote;
  if(!remote?.kind||!['story-comfy-image-v1','story-comfy-video-v1'].includes(remote.kind))throw Error('仅支持确认本地 ComfyUI 图片或视频任务丢失');
  await this.comfy.assertMissing(run.remoteId,remote,ctx);
  return {status:'lost',message:'原任务在当前 ComfyUI 队列与历史中不存在，未找到可取回输出；已允许重新生成。'};
 }
 async compose(input,ctx={}){
  canvas(input.aspect,true);if(!Array.isArray(input.shots)||!input.shots.length)throw Error('当前集没有可合成镜头');
  const ids=new Set(),parts=[];
  for(const shot of input.shots){
   if(!shot.shotId||ids.has(shot.shotId)||!Number.isFinite(shot.duration)||shot.duration<=0)throw Error('镜头编号重复或计划时长无效');
   ids.add(shot.shotId);const asset=this.store.asset(shot.assetId);if(asset.type!=='video')throw Error('每个镜头都必须选用实际生成的视频');
   const sha256=hash(asset.path);if(shot.sha256&&shot.sha256!==sha256)throw Error('镜头视频与当前集冻结内容不一致，请重新合成');
   const data=await this.probe(asset.path,ctx),duration=Number(data.format?.duration);
   if(!data.streams.some(row=>row.codec_type==='video')||!Number.isFinite(duration)||Math.abs(duration-shot.duration)>.15)throw Error('镜头视频与计划时长不匹配，请重新生成后合成');
   if(hash(asset.path)!==sha256)throw Error('检查期间镜头视频已变化，未开始合成');
   parts.push({...shot,path:asset.path,sha256,duration,hasAudio:data.streams.some(row=>row.codec_type==='audio')});
  }
  const total=parts.reduce((sum,row)=>sum+row.duration,0);let narration;const narrationId=input.narrationAssetId||input.narration?.assetId;
  if(narrationId){narration={...this.store.asset(narrationId)};narration.sha256=hash(narration.path);if(input.narration?.sha256&&input.narration.sha256!==narration.sha256)throw Error('旁白音频与当前集冻结内容不一致，请重新合成');const info=await this.probe(narration.path,ctx);if(!info.streams.some(row=>row.codec_type==='audio')||Math.abs(Number(info.format?.duration)-total)>.15)throw Error('上一步配音时长与当前集镜头总时长不匹配；请为本集准备对应配音，不能自动切分或裁剪');if(hash(narration.path)!==narration.sha256)throw Error('检查期间旁白音频已变化，未开始合成');}
 const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.story-compose-'));try{if(input.productIntroduction){const product=await require('./product-intro-compose.cjs').composeProductIntroduction(this,input,parts,narration,directory,ctx,hash);return await this.register(product.file,'video',{...input,prompt:'按商品介绍台词顺序合成真实动态镜头及原素材图标',duration:product.total},product.details,ctx);}const audioMix=input.audioMix;if(audioMix&&(audioMix.version!==1||!Number.isFinite(audioMix.originalAudioVolume)||audioMix.originalAudioVolume<0||audioMix.originalAudioVolume>1||audioMix.limiter!==.95))throw Error('镜头混音参数无效');const [width,height]=canvas(input.aspect,true),args=['-v','error','-y'],filters=[],streams=[];parts.forEach(part=>args.push('-i',part.path));if(narration)args.push('-i',narration.path);parts.forEach((part,i)=>{filters.push(`[${i}:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,format=yuv420p[v${i}]`);if(part.hasAudio)filters.push(`[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${audioMix?`,volume=${audioMix.originalAudioVolume}`:''}[a${i}]`);else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${part.duration},asetpts=PTS-STARTPTS[a${i}]`);streams.push(`[v${i}][a${i}]`);});filters.push(`${streams.join('')}concat=n=${parts.length}:v=1:a=1[outv][originala]`);if(narration)filters.push(`[${parts.length}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[narration];[originala][narration]amix=inputs=2:duration=longest:normalize=0${audioMix?',alimiter=limit=0.95:level=disabled:latency=1':''}[outa]`);if(!narration&&audioMix)filters.push('[originala]alimiter=limit=0.95:level=disabled:latency=1[limiteda]');const output=path.join(directory,'episode.mp4');args.push('-filter_complex',filters.join(';'),'-map','[outv]','-map',narration?'[outa]':audioMix?'[limiteda]':'[originala]','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output);await runProcess(this.media.binaries().ffmpeg,args,{signal:ctx.signal});for(const part of parts)if(hash(part.path)!==part.sha256)throw Error('合成期间镜头视频已变化，未登记结果');const verifyInput={...input,prompt:'按当前集镜头顺序合成',duration:total};return await this.register(output,'video',verifyInput,{protocol:'local-ffmpeg-concat',model:'FFmpeg',shots:parts.map(({path,...part})=>part),narrationAssetId:narrationId||'',narrationSha256:narration?.sha256||'',...(audioMix?{audioMix}:{}),audioPolicy:audioMix?(narration?'scale-original-and-mix-matched-narration-with-limiter':'scale-original-with-limiter'):(narration?'preserve-original-and-mix-matched-narration':'preserve-original-with-silence-for-missing'),qualityAccepted:false},ctx);}finally{fs.rmSync(directory,{recursive:true,force:true});}}
}
module.exports={validPrompt,StoryGenerator,imageGraph,zImageGraph,inspectImageModels,imageArchitecture,imageWeights,imageReferenceSettings,Z_IMAGE_DEFAULTS,videoGraph,referenceVideoGraph,referenceVideoPrompt,inspectReferenceVideoModels,h3Prompt,canvas,referenceImageFilter,validDuration,videoDuration,modelNames,DEFAULT_CHECKPOINT,DEFAULT_H3,DEFAULT_REFERENCE_H3,REFERENCE_H3_LORA,PROMPT_COMPILER_VERSION};
