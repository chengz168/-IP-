const node=(class_type,inputs)=>({class_type,inputs});
const WAN_DEFAULTS=Object.freeze({storyWanModel:'wan2.2_ti2v_5B_fp16.safetensors',storyWanClip:'umt5_xxl_fp8_e4m3fn_scaled.safetensors',storyWanVae:'wan2.2_vae.safetensors'});
const ARCHITECTURE='wan22-ti2v-5b';
const REQUIRED_NODES=['UNETLoader','CLIPLoader','VAELoader','LoadImage','Wan22ImageToVideoLatent','CLIPTextEncode','ModelSamplingSD3','KSampler','VAEDecode','CreateVideo','SaveVideo'];

function wanCanvas(aspect='9:16'){
 // 保留官方原生推理尺寸，收集时补边到精确画幅，不能拉伸或裁掉商品。
 if(aspect==='9:16')return {width:704,height:1280,outputWidth:720,outputHeight:1280};
 if(aspect==='16:9')return {width:1280,height:704,outputWidth:1280,outputHeight:720};
 throw Error('当前Wan2.2仅支持9:16或16:9，请调整画幅；未提交任务');
}
function wanFrameLength(input){
 const duration=input?.duration,product=Boolean(input?.productIntroduction);
 if(!Number.isFinite(duration)||duration>15||(product?duration<=0:duration<4))throw Error(product?'Wan2.2产品介绍单镜头须大于0且不超过15秒':'Wan2.2单镜头支持4至15秒，请调整镜头时长');
 // 本机节点按四帧压缩时间维；121是模板示例，不是模型长度上限。
 return 4*Math.ceil((Math.ceil(Math.max(4,duration)*24)-1)/4)+1;
}
function requiresSpeech(text,soundField=false){
 // 自动路由不是镜头出声要求；用户的预设补充指令由调用方单独检查。
 const source=text.split(/\n?本地中文创作预设（/)[0];
 const cleaned=source.split(/([，,。！？;；\n])/).map(part=>{
  const post=/(?:后期|第三步|合成时|另行|另外|单独|已完成|post[ -]?production|separately|already recorded)/i.test(part);
  const voice=/配音|旁白|口播|画外音|narration|voice[ -]?over/i.test(part);
  // 后期配音与现场原声是不同契约，不能因同句含后期说明而放过明确现场对白。
  return post&&voice&&!/原声|现场|当场|同步(?:出声|发声|对白)|native (?:speech|audio)|on[ -]?screen (?:speech|dialogue)/i.test(part)?'':part;
 }).join('')
  // 只消除紧邻的否定人声短语；其后的正向对白仍须由能力检查拦截。
  .replace(/(?:无|没有|不要|不需要|不生成|不添加|不加入|不产生|不包含|不含|无需|不|禁止|避免)(?:任何|额外|新的)?(?:(?:人物|角色|现场)(?:的)?)?(?:对白|对话|旁白|画外音|人声|台词|口播|配音|说话|歌声|演唱)(?:[、和及或与]*(?:对白|对话|旁白|画外音|人声|台词|口播|配音|说话|歌声|演唱))*/g,'')
  .replace(/\b(?:no|without|do not (?:add|generate|include)|avoid|never (?:add|generate|include))\s+(?:any\s+|additional\s+)?(?:(?:character|on[ -]?screen)\s+)?(?:speech|spoken dialogue|dialogue|dialog|voice[ -]?over|narration|speaking|singing|vocals)(?:\s*(?:,|or|and)\s*(?:speech|spoken dialogue|dialogue|dialog|voice[ -]?over|narration|speaking|singing|vocals))*/gi,'')
  .replace(/\b(?:post[ -]?production|separately added)\s+(?:narration|voice[ -]?over|speech)\b/gi,'');
 // 声音字段中的正向人声描述可作依据，其它字段只识别明确的发声或对白指令。
 if(soundField&&/对白|对话|旁白|画外音|人声|台词|口播|配音|朗读|演唱|歌声|说话|\b(?:speech|spoken|dialogue|dialog|voice[ -]?over|narration|speaking|singing|vocals)\b/i.test(cleaned))return true;
 return /(?:对白|台词)[：:“"「『]|(?:说|说道)[：:“"「『]|(?:要求|需要|保留|生成|加入|添加|播放|听到|使用|说出|朗读|演唱|唱出|开口)[^，,。！？;；\n]{0,12}(?:对白|台词|人声|画外音|旁白|口播|配音|歌声)|(?:现场|当场|原声|同步)(?:对白|说话|发声|口播)|\b(?:generate|include|add|preserve|use|require|hear)\s+(?:a\s+|the\s+|any\s+)?(?:speech|spoken dialogue|dialogue|voice[ -]?over|narration|vocals)\b|\b(?:chef|man|woman|person|character|he|she|singer)\s+(?:speaks?|says?|sings?)\b/i.test(cleaned);
}
function validateWanInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Wan2.2镜头输入无效');
 wanCanvas(input.aspect);wanFrameLength(input);
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>32000)throw Error('请填写有效的Wan2.2视频提示词，长度不得超过32000字符');
 if(input.referenceMode!==undefined&&input.referenceMode!=='first-frame')throw Error('Wan2.2当前仅支持单首帧，不支持资产参考生成；未提交任务');
 if(input.references!==undefined&&(!Array.isArray(input.references)||input.references.length))throw Error('Wan2.2当前不支持多图资产参考；未提交任务');
 if(input.lastFrame||input.lastFrameId)throw Error('Wan2.2当前不支持尾帧，不能忽略尾帧后生成；未提交任务');
 if(!input.image||typeof input.image.assetId!=='string'||!input.image.assetId.trim())throw Error('Wan2.2需要已确认的单张镜头首帧');
 for(const seed of [input.seed,input.videoSeed])if(seed!==undefined&&seed!==null&&(!Number.isSafeInteger(seed)||seed<0||seed>4294967295))throw Error('Wan2.2固定种子请输入0至4294967295的整数');
 const texts=[input.prompt],sounds=[];
 for(const key of ['storyInstructions','instruction','style','sound']){
  if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>(key==='instruction'?16000:key==='storyInstructions'?5000:32000)))throw Error('Wan2.2镜头要求字段格式无效或过长');
  if(input[key])(key==='sound'?sounds:texts).push(input[key]);
 }
 for(const design of [input.approvedStoryDesign,input.approvedProductDesign])if(design){
  if(typeof design!=='object'||Array.isArray(design))throw Error('Wan2.2已确认镜头方案格式无效');
  for(const key of ['visual','action','camera','sound','supplementaryPrompt','storyInstructions','instruction'])if(design[key]!==undefined){if(typeof design[key]!=='string')throw Error('Wan2.2已确认镜头方案字段无效');(key==='sound'?sounds:texts).push(design[key]);}
 }
 if(typeof input.creativePreset?.instruction==='string')texts.push(input.creativePreset.instruction);
 if(texts.some(text=>requiresSpeech(text))||sounds.some(text=>requiresSpeech(text,true)))throw Error('Wan2.2当前配方只生成无音轨画面，不支持显式对白、人声或演唱；请改用支持声音的模型，或明确改为后期配音后再提交');
 return {architecture:ARCHITECTURE,referenceMode:'first-frame',supportsAudio:false,frameLength:wanFrameLength(input),...wanCanvas(input.aspect)};
}
function resolveWeights(config={}){return {architecture:ARCHITECTURE,model:config.storyWanModel??WAN_DEFAULTS.storyWanModel,clip:config.storyWanClip??WAN_DEFAULTS.storyWanClip,vae:config.storyWanVae??WAN_DEFAULTS.storyWanVae};}
function invalidWeights(weights){return [['model','storyWanModel'],['clip','storyWanClip'],['vae','storyWanVae']].filter(([key,field])=>weights[key]!==WAN_DEFAULTS[field]).map(([key,field])=>field+'='+String(weights[key]));}
function wanGraph({input,image,weights=resolveWeights(),seed=42,prefix='superip-story',prompt}={}){
 validateWanInput(input);
 if(!weights||typeof weights!=='object'||Array.isArray(weights)||invalidWeights(weights).length||weights.architecture!==undefined&&weights.architecture!==ARCHITECTURE)throw Error('当前Wan2.2图仅支持已核对的TI2V 5B官方三权重，不能直接替换其它模型');
 if(typeof image!=='string'||!image.trim())throw Error('Wan2.2缺少已上传的首帧图片');
 if(!Number.isSafeInteger(seed)||seed<0||seed>4294967295)throw Error('Wan2.2固定种子请输入0至4294967295的整数');
 const text=prompt===undefined?input.prompt:prompt;if(typeof text!=='string'||!text.trim()||text.length>32000)throw Error('Wan2.2编译后的提示词无效或过长');
 // 编译结果也检查能力，不能用翻译阶段新增的对白绕过提交门禁。
 if(requiresSpeech(text))throw Error('Wan2.2编译后的指令包含人声要求，当前无音轨配方无法执行；未提交任务');
 const {width,height}=wanCanvas(input.aspect);
 return {
  '1':node('UNETLoader',{unet_name:weights.model,weight_dtype:'default'}),
  '2':node('CLIPLoader',{clip_name:weights.clip,type:'wan',device:'default'}),
  '3':node('VAELoader',{vae_name:weights.vae}),
  '4':node('CLIPTextEncode',{text,clip:['2',0]}),
  // 不把静态商品误列为负面，运动幅度以用户已确认的动作要求为准。
  '5':node('CLIPTextEncode',{text:'watermark, subtitles, low quality, blurry, distorted geometry, duplicate objects, flicker, sudden scene cuts',clip:['2',0]}),
  '6':node('LoadImage',{image}),
  '7':node('Wan22ImageToVideoLatent',{vae:['3',0],width,height,length:wanFrameLength(input),batch_size:1,start_image:['6',0]}),
  '8':node('ModelSamplingSD3',{model:['1',0],shift:8}),
  '9':node('KSampler',{seed,steps:20,cfg:5,sampler_name:'uni_pc',scheduler:'simple',denoise:1,model:['8',0],positive:['4',0],negative:['5',0],latent_image:['7',0]}),
  '13':node('VAEDecode',{samples:['9',0],vae:['3',0]}),
  '15':node('CreateVideo',{images:['13',0],fps:24,bit_depth:8}),
  '16':node('SaveVideo',{video:['15',0],filename_prefix:prefix,format:'auto','format.codec':'auto'})
 };
}
function modelNames(info,name,field){
 const inputs=info?.[name]?.input;let specification=inputs?.required?.[field]??inputs?.optional?.[field];
 // V3动态组合把codec嵌在选中format分支内，不能当扁平字符串枚举误报。
 if(!specification&&field.includes('.')){
  const [parent,...children]=field.split('.');specification=inputs?.required?.[parent]??inputs?.optional?.[parent];
  for(const child of children){const branch=specification?.[1]?.options?.find(option=>option?.key==='auto');specification=branch?.inputs?.required?.[child]??branch?.inputs?.optional?.[child];}
 }
 const value=specification?.[0],options=Array.isArray(value)?value:specification?.[1]?.options;
 return Array.isArray(options)?options.map(option=>typeof option==='string'?option:option?.key).filter(option=>typeof option==='string'):[];
}
function inspectWanModels(info={},config={}){
 const weights=resolveWeights(config),missingNodes=REQUIRED_NODES.filter(name=>!info?.[name]),requiredWeights=[['UNETLoader','unet_name',weights.model],['CLIPLoader','clip_name',weights.clip],['VAELoader','vae_name',weights.vae]];
 const missingModels=requiredWeights.filter(([loader,field,name])=>!modelNames(info,loader,field).includes(name)).map(row=>row[2]),invalidOptions=invalidWeights(weights);
 for(const [loader,field,value]of [['UNETLoader','weight_dtype','default'],['CLIPLoader','type','wan'],['CLIPLoader','device','default'],['KSampler','sampler_name','uni_pc'],['KSampler','scheduler','simple'],['SaveVideo','format','auto'],['SaveVideo','format.codec','auto']])if(!modelNames(info,loader,field).includes(value))invalidOptions.push(loader+'.'+field+'='+value);
 if(!info?.Wan22ImageToVideoLatent?.input?.optional?.start_image&&!info?.Wan22ImageToVideoLatent?.input?.required?.start_image)invalidOptions.push('Wan22ImageToVideoLatent.start_image');
 return {architecture:ARCHITECTURE,selected:weights.model,weights,models:modelNames(info,'UNETLoader','unet_name').filter(name=>name===WAN_DEFAULTS.storyWanModel),available:{unets:modelNames(info,'UNETLoader','unet_name'),textEncoders:modelNames(info,'CLIPLoader','clip_name'),vaes:modelNames(info,'VAELoader','vae_name')},ready:!missingNodes.length&&!missingModels.length&&!invalidOptions.length,missingNodes,missingModels,invalidOptions,referenceMode:'first-frame',maxReferences:1,supportsReferences:true,supportsLastFrame:false,supportsSeed:true,supportsAudio:false,generationVerified:false};
}
module.exports={WAN_DEFAULTS,wanCanvas,wanFrameLength,wanGraph,inspectWanModels,validateWanInput};
