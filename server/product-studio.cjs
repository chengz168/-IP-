const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {hash}=require('./story-contract.cjs');
const {resolveCreativePreset,creativePresetPrompt}=require('./creative-presets.mjs');
const {detectContentProfile}=require('./content-types.mjs');
const {collectProduct,parseProductHtml,downloadProductImage}=require('./product-source.cjs');
const active=['running','queued','unknown'];
const types=['product-collect','product-script','product-video'];
const clean=(v,label,max=10000,optional=false)=>{if(typeof v!=='string'||v.length>max||!optional&&!v.trim())throw Error(label+'缺失或过长');return v.trim();};
const stamp=asset=>crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');
const signature=d=>hash(d.product||{});
const selection=p=>hash({url:p.url,sourceRunId:p.sourceRunId,selectedIndices:p.selectedIndices,assetIds:p.assetIds,...(Object.keys(p.imageRoles||{}).length?{imageRoles:p.imageRoles}:{})});
const voiceSignature=(providers,d)=>hash({provider:providers.config(),language:d.language,voice:{...d.voice,audioId:undefined}});
const compact=text=>text.replace(/\s+/g,'');
function validateShots(shots,images){
 if(!Array.isArray(shots)||shots.length<1||shots.length>12)throw Error('商品脚本需要1至12个镜头');
 return shots.map((shot,index)=>{if(!images.some(image=>image.id===shot.imageId))throw Error('第'+(index+1)+'镜头未绑定本次确认的商品图');if(!Number.isFinite(shot.duration)||shot.duration<.2||shot.duration>60)throw Error('单镜头时长需为0.2至60秒');if(shot.iconIndices!==undefined&&(!Array.isArray(shot.iconIndices)||shot.iconIndices.length>4||new Set(shot.iconIndices).size!==shot.iconIndices.length||shot.iconIndices.some(index=>!Number.isInteger(index)||images[index]?.role!=='icon')))throw Error('图标索引无效，最多引用四张本次标注为图标的素材');return {text:clean(shot.text,'第'+(index+1)+'镜头文案',500),visual:clean(shot.visual||'展示所选商品','画面说明',1500),imageId:shot.imageId,duration:shot.duration,sellingPoint:clean(shot.sellingPoint||'','卖点',160,true),evidence:clean(shot.evidence||'','卖点依据',1000,true),stage:clean(shot.stage||'','镜头阶段',100,true),action:clean(shot.action||'','主体动作',1200,true),camera:clean(shot.camera||'','运镜',500,true),...(shot.videoPrompt?{videoPrompt:clean(shot.videoPrompt,'内部生成指令',5000)}:{}),iconIndices:Array.isArray(shot.iconIndices)?shot.iconIndices.filter(Number.isInteger):[]};});
}
function form(d){
 const p=d.product;if(!p||typeof p!=='object')throw Error('请先填写商品资料');
 if(!Number.isFinite(p.duration)||p.duration<5||p.duration>180)throw Error('宣传视频目标时长需为5至180秒');
 if(!['9:16','16:9','1:1'].includes(p.aspect))throw Error('请选择有效的视频画幅');
 const details={title:clean(p.title,'商品名称',500),description:clean(p.description||'','商品详情',15000,true),brand:clean(p.brand||'','品牌',300,true),sku:clean(p.sku||'','货号',300,true),price:clean(String(p.price||''),'价格',100,true),currency:clean(p.currency||'','币种',100,true)};
 if(!Array.isArray(p.specifications||[])||(p.specifications||[]).length>100)throw Error('商品规格格式无效');
 details.specifications=(p.specifications||[]).map(row=>({name:clean(row.name,'规格名',200),value:clean(String(row.value),'规格值',1000)}));
 return {details,duration:p.duration,aspect:p.aspect,brief:clean(p.brief||'','补充要求',4000,true)};
}
class ProductStudio{
 constructor(service,{pageReader}={}){this.service=service;this.store=service.store;this.providers=service.providers;this.media=service.media;this.pageReader=pageReader;this.locks=new Set();}
 ready(id){this.store.draft(id);if(this.locks.has(id)||this.store.data.runs.some(r=>r.draftId===id&&active.includes(r.status))||require('./workflow-state.cjs').workflowActive(this.store.data,id))throw Error('当前任务正在处理或结果待确认，请等待、停止或确认原任务后再操作商品创作');}
 async locked(id,work){this.ready(id);this.locks.add(id);try{return await work();}finally{this.locks.delete(id);}}
 async run(type,id,parameters,work){const output=await this.service.runtime.run(type,id,parameters,work),record=this.store.data.runs.find(r=>r.output===output);return {...output,runId:record.id};}
 report(id,runId,type){const record=this.store.data.runs.find(r=>r.id===runId&&r.draftId===id&&r.type===type&&r.status==='succeeded');if(!record?.output||record.output.stale)throw Error('商品任务记录不存在或已失效，请重新生成');return record;}
 async collect({id,url}){url=clean(url,'商品链接',3000);return this.locked(id,()=>this.run('product-collect',id,{url},async ctx=>{
  const inputSignature=signature(this.store.draft(id));let product;
  const collectContext={signal:ctx.signal,progress:status=>ctx.progress(12,status.message)};
  try{product=await collectProduct(url,collectContext);}catch(error){ctx.signal.throwIfAborted();if(!this.pageReader)throw error;ctx.progress(25,'静态页面没有完整商品资料，正在后台读取公开详情页');try{const page=await this.pageReader.read(url,collectContext);product=parseProductHtml(page.html,page.url||url);product.fetchedAt=new Date().toISOString();product.warnings=[...(product.warnings||[]),'资料来自后台公开页面，请核对当前规格、价格和图片。'];}catch(browserError){throw Object.assign(Error('商品页面读取失败：'+browserError.message.replace(/[。；\s]+$/u,'')+'。'),{code:browserError.code||'PRODUCT_BROWSER_ERROR',evidence:browserError.evidence});}}
  return {product,sourceUrl:url,contentProfile:detectContentProfile({sourceKind:'product-page',product,title:product.title,description:product.description,brief:product.brief}),inputSignature,stale:signature(this.store.draft(id))!==inputSignature};
 }));}
 async imageAssets(id,p,ctx){
  const source=p.sourceRunId?this.report(id,p.sourceRunId,'product-collect').output:null;
  if(source&&source.sourceUrl!==p.url)throw Error('商品链接已变化，请重新采集，或清除旧来源后上传图片');
  const indices=p.selectedIndices||[],local=p.assetIds||[];
  if(!Array.isArray(indices)||!Array.isArray(local)||new Set(indices).size!==indices.length||new Set(local).size!==local.length||indices.length+local.length>20)throw Error('请选择最多20张不同商品图片');
  if(indices.length&&!source)throw Error('所选商品图片缺少采集来源，请重新采集');
  const images=[];
  for(const assetId of local){const asset=this.store.asset(assetId);if(asset.type!=='image')throw Error('商品素材只能选择图片');await this.checkImage(asset);images.push({id:asset.id,name:asset.name,sha256:stamp(asset),source:'imported'});}
  for(const index of indices){
   if(!Number.isInteger(index)||!source.product.images[index])throw Error('所选详情图片已变化，请重新选择');
   const item=source.product.images[index];ctx.signal.throwIfAborted();ctx.progress(8+images.length,'正在下载所选商品图片 '+(images.length+1));
   const cached=this.store.data.assets.find(a=>a.productSource?.sourceRunId===p.sourceRunId&&a.productSource?.url===item.url&&fs.existsSync(a.path));
   if(cached){await this.checkImage(cached);const digest=stamp(cached);if(cached.productSource.sha256!==digest)throw Error('已下载商品图发生变化，请重新采集或上传');if(!images.some(i=>i.id===cached.id))images.push({id:cached.id,name:cached.name,sha256:digest,url:item.url});continue;}
   const downloaded=await downloadProductImage(item.url,ctx),extension={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[downloaded.contentType];
   const file=path.join(this.store.outputDir(),'.product-image-'+crypto.randomUUID()+extension);
   try{fs.writeFileSync(file,downloaded.bytes);await this.checkImage({path:file,type:'image'});ctx.signal.throwIfAborted();const digest=crypto.createHash('sha256').update(downloaded.bytes).digest('hex'),asset=this.store.addAsset(file,{origin:'product-detail',name:item.name||'商品图'+(index+1),productSource:{url:item.url,sourceRunId:p.sourceRunId,sha256:digest}});images.push({id:asset.id,name:asset.name,sha256:digest,url:item.url});}finally{fs.rmSync(file,{force:true});}
  }
  if(!images.length)throw Error('请至少勾选或上传一张商品图');
  for(const image of images){const remoteIndex=source?.product.images.findIndex(item=>item.url===image.url),key=image.source==='imported'?image.id:'remote:'+remoteIndex,kind=source?.product.images[remoteIndex]?.kind;image.role=p.imageRoles?.[key]||p.imageRoles?.[image.id]||(kind==='detail'?'detail':'product');if(!['product','detail','icon'].includes(image.role))throw Error('图片用途无效');}
  if(!images.some(image=>image.role!=='icon'))throw Error('请至少选择一张商品图或详情图，图标不能替代商品主体');return images;
 }
 async checkImage(asset){const info=await this.media.probe(asset.path),video=info.streams.find(s=>s.codec_type==='video');if(!video||video.width<100||video.height<100||video.width*video.height>80000000)throw Error('商品图片无法读取，或尺寸不在100像素至8000万像素范围内');}
 async create({id}){return this.locked(id,async()=>{const d=structuredClone(this.store.draft(id)),input=form(d),inputSignature=signature(d),creativePreset=resolveCreativePreset(d,'script',{kind:'product'});return this.run('product-script',id,{input,inputSignature,creativePreset,contentProfile:creativePreset.contentProfile,sourceRunId:d.product.sourceRunId||''},async ctx=>{
  const images=await this.imageAssets(id,d.product,ctx),visual=await require('./product-vision.cjs').describeProductImages(this.service,images,ctx),system=require('./product-prompt.cjs').scriptSystem,schema={type:'object',properties:{shots:{type:'array',minItems:3,maxItems:8,items:{type:'object',properties:{text:{type:'string',maxLength:Math.max(4,Math.floor(input.duration))},sellingPoint:{type:'string'},evidence:{type:'string'},stage:{type:'string'},visual:{type:'string'},action:{type:'string'},camera:{type:'string'},videoPrompt:{type:'string'},imageIndex:{type:'integer'},iconIndices:{type:'array',items:{type:'integer'}},duration:{type:'number'}},required:['text','sellingPoint','evidence','visual','action','camera','videoPrompt','imageIndex','iconIndices','duration'],additionalProperties:false}}},required:['shots'],additionalProperties:false};
  const user=JSON.stringify({...input,narrationBudget:{minCharacters:Math.ceil(input.duration*2),maxCharacters:Math.floor(input.duration*3),maxCharactersPerShot:Math.max(4,Math.floor(input.duration)),rule:'所有镜头text合计只用这一字数预算；画面已有的信息不必在旁白重复。'},images:images.map((a,imageIndex)=>({imageIndex,name:a.name,role:a.role})),visualObservations:visual.observations.map(({pageClaims,...observation})=>observation),limitation:'只能依据明确资料和有编号的图片观察；商家宣传语不得升级为已实测事实，用户需核对台词。'});ctx.progress(30,'正在根据已核对资料生成商品分镜脚本');
  const actualSystem=system+creativePresetPrompt(creativePreset),attempts=[];
  let result,value;
  for(let attempt=0;attempt<2;attempt++){
   const correction=attempt?'\n上一份脚本没有通过以下明确检查，请逐项纠正并返回完整JSON，不新增商品事实：'+JSON.stringify(require('./product-script-quality.cjs').productScriptIssues(value.shots,input.duration))+'\n上一份待纠正脚本：'+JSON.stringify(value):'';
   result=await this.providers.text(actualSystem,user+correction,ctx,{schema,maxTokens:4096,temperature:attempt?0:.4});attempts.push({system:actualSystem,user:user+correction,response:result});ctx.signal.throwIfAborted();
   try{value=JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{const error=Error('模型未返回有效商品脚本JSON，已下载图片保留在素材库，可重试');error.evidence={attempts,creativePreset};throw error;}
   const issues=require('./product-script-quality.cjs').productScriptIssues(value.shots,input.duration);
   if(!issues.length)break;
   if(attempt===1){const error=Error('商品脚本未通过检查：'+issues.map(issue=>issue.replace(/。$/,'')).join('；')+'。旧脚本保留，请调整要求后重试。');error.evidence={attempts,issues,creativePreset,qualityAccepted:false};throw error;}
   ctx.progress(45,'脚本的字数、中文依据或动作设计未通过检查，正在限定纠正一次');
  }
  if(!Array.isArray(value.shots)||value.shots.length<3||value.shots.length>8)throw Error('商品模型未生成3至8个有效镜头');
  for(const shot of value.shots)require('./product-prompt.cjs').chineseDesign(shot,['visual','action','camera']);
  const shots=validateShots(value.shots.map(shot=>({...shot,imageId:Number.isInteger(shot.imageIndex)?images[shot.imageIndex]?.id:''})),images),total=shots.reduce((n,s)=>n+s.duration,0);for(const shot of shots)shot.duration=Math.round(shot.duration/total*input.duration*100)/100;
  if(shots.some(s=>s.duration<1))throw Error('镜头数量与目标时长不匹配，请增加目标时长');
  for(const shot of shots){if(images.find(image=>image.id===shot.imageId)?.role==='icon')throw Error('模型用图标替代了商品主体，请重新生成脚本');if(shot.iconIndices.some(index=>images[index]?.role!=='icon'))throw Error('模型引用的图标没有对应的原图标素材，请重新生成脚本');}
  return {shots,text:shots.map(s=>s.text).join('\n'),images,sourceRunId:d.product.sourceRunId||'',selectionHash:selection(d.product),inputSignature,input,visual:{status:visual.status,observations:visual.observations,warnings:visual.warnings},creativePreset,contentProfile:creativePreset.contentProfile,evidence:{system:system+creativePresetPrompt(creativePreset),user,response:result,attempts,vision:visual.responses||[]},stale:signature(this.store.draft(id))!==inputSignature||JSON.stringify(creativePreset)!==JSON.stringify(resolveCreativePreset(this.store.draft(id),'script',{kind:'product'})),qualityAccepted:false};
 });});}
 async generate({id}){return this.locked(id,async()=>{
  if(this.store.data.runs.some(r=>['voice-design','avatar-optimize','avatar-background'].includes(r.type)&&active.includes(r.status)))throw Error('已有声音或形象模型任务执行中，请先等待或停止');
  const d=structuredClone(this.store.draft(id)),p=d.product||{},script=this.report(id,p.scriptRunId,'product-script').output,input=form(d);
  // 只比较生成脚本所依据的资料，逐镜人工调整另行留存，不能用新商品套旧脚本。
  if(hash(input)!==hash(script.input)||selection(p)!==script.selectionHash)throw Error('商品资料、所选图片或视频要求已改变，请先重新生成脚本');
  const shots=validateShots(p.shots,script.images),inputSignature=signature(d),voiceInputSignature=voiceSignature(this.providers,d);
  if(typeof p.narration!=='boolean')throw Error('请选择是否生成配音');
  if(!d.confirmed||!d.finalText?.trim())throw Error('请先在第二步确认商品文案，再继续生成视频');
  if(compact(shots.map(s=>s.text).join(''))!==compact(d.finalText))throw Error('已确认文案与镜头旁白不一致，请先同步已确认文案到镜头');
  let audioInput;if(p.narration){if(!d.voice.audioId)throw Error('请先在第三步生成声音');const audio=this.store.asset(d.voice.audioId);if(audio.type!=='audio')throw Error('请先在第三步生成声音');const {speechContext,speechRequest,speechEvidence}=require('./speech-request.cjs'),expected=speechEvidence(speechRequest(d,speechContext(this.store.data)));if(!audio.speech?.request||hash(audio.speech.request)!==hash(expected))throw Error('当前配音与已确认文案或声音设置不一致，请在第三步重新生成');audioInput={id:audio.id,sha256:stamp(audio)};}
  for(const image of script.images)if(stamp(this.store.asset(image.id))!==image.sha256)throw Error('商品图片已变化，请重新生成脚本');
  return this.run('product-video',id,{scriptRunId:p.scriptRunId,shots,narration:p.narration,inputSignature,contentProfile:script.contentProfile},async ctx=>{
   const rendered=await require('./product-video.cjs').renderProductVideo(this.service,{draft:d,shots,aspect:p.aspect,narration:p.narration,audioId:audioInput?.id},ctx),current=this.store.draft(id);
   return {...rendered,scriptRunId:p.scriptRunId,inputSignature,voiceInputSignature,audioInput,contentProfile:script.contentProfile,confirmedTextHash:hash(d.finalText),stale:signature(current)!==inputSignature||voiceInputSignature!==voiceSignature(this.providers,current)||!current.confirmed||hash(current.finalText)!==hash(d.finalText)||audioInput&&(current.voice.audioId!==audioInput.id||stamp(this.store.asset(audioInput.id))!==audioInput.sha256),qualityAccepted:false};
  });
 });}
 async useScript({id,runId,shots}){this.ready(id);const record=this.report(id,runId,'product-script'),d=this.store.draft(id),input=form(d),output=record.output;if(output.creativePreset&&JSON.stringify(output.creativePreset)!==JSON.stringify(resolveCreativePreset(d,'script',{kind:'product'})))throw Error('创作预设已变化，请重新生成商品脚本');if(hash(input)!==hash(output.input)||selection(d.product)!==output.selectionHash)throw Error('商品资料或图片已变化，请重新生成脚本');shots=validateShots(shots||d.product.shots,output.images);for(const image of output.images)if(stamp(this.store.asset(image.id))!==image.sha256)throw Error('商品图已变化，请重新生成脚本');
  const {createStory,validateStory,assetInput,shotInput,uid}=require('./story-contract.cjs'),text=shots.map(s=>s.text).join('\n'),story=createStory({confirmed:true,finalText:text});story.contentProfile=structuredClone(output.contentProfile||resolveCreativePreset(d,'script',{kind:'product'}).contentProfile);story.episodeCount=1;story.episodeDuration=d.product.duration;story.aspect=d.product.aspect;story.style='保留商品原图与包装标识，商品外观和结构保持一致';story.instructions='商品详情页内容为商家资料，未证明实测效果。不得添加原图没有的配件或改变商品外观。';story.narrationMode=d.product.narration?'upstream':'none';story.episodesSourceHash=hash([text,1,story.episodeDuration]);
  const assets=new Map();for(const image of output.images){const asset={id:uid(),kind:'prop',name:image.name,description:'已确认的商品详情原图',prompt:'Preserve the exact product appearance from the supplied original product image.',images:[],selectedImageId:image.id};asset.images.push({id:image.id,inputHash:hash(assetInput(story,asset)),status:'ready',imported:true});story.assets.push(asset);assets.set(image.id,asset);}
  const episode={id:uid(),title:input.details.title,text,resultId:'',shots:shots.map(sh=>({id:uid(),text:sh.text,visual:sh.visual,action:'保持原图商品外观，仅作克制的展示运镜',camera:'缓慢平移，商品完整可见',sound:sh.text,imagePrompt:sh.visual,videoPrompt:'Preserve the exact product appearance. Subtle camera movement only. Do not invent product usage or alter packaging.',duration:sh.duration,assetIds:[assets.get(sh.imageId).id],primaryReferenceAssetId:assets.get(sh.imageId).id,images:[],videos:[],selectedImageId:sh.imageId,selectedVideoId:''}))};story.episodes.push(episode);for(const sh of episode.shots)sh.images.push({id:sh.selectedImageId,inputHash:hash(shotInput(story,sh)),status:'ready',imported:true});
  const before=structuredClone(d),index=this.store.data.drafts.findIndex(row=>row.id===id),next=structuredClone(d);next.sourceText=text;next.rewrite=text;next.finalText='';next.confirmed=false;next.step=1;next.video.mode='product';next.product.shots=shots;next.product.scriptRunId=runId;
  // 新商品脚本必须重新交接视频，旧剪辑源不能越过第四步被自动复用。
  next.video.assetId='';next.video.audioId='';next.edit.sourceId='';next.edit.resultId='';next.edit.captions=[];next.cover.assetId='';next.cover.videoId='';next.publish.videoId='';next.publish.coverId='';next.publish.recordId='';delete next.productSelection;
  try{const saved=this.store.updateDraft(next,{persist:false,preserveCurrentId:true});story.revision=(before.story?.revision||0)+1;saved.story=validateStory(story);this.store.save();return structuredClone(saved);}catch(error){this.store.data.drafts[index]=before;throw error;}
 }
 async sync({id}){this.ready(id);const d=this.store.draft(id),p=d.product||{},record=this.report(id,p.scriptRunId,'product-script');if(!d.confirmed||!d.finalText.trim())throw Error('请先在第二步确认文案');const shots=validateShots(p.shots,record.output.images),units=require('./story-text-ranges.cjs').sourceUnits(d.finalText,shots.length),count=Math.min(units.length,shots.length),next=structuredClone(d);next.product.shots=shots.slice(0,count).map((shot,index)=>({...shot,text:units.slice(Math.floor(index*units.length/count),Math.floor((index+1)*units.length/count)).map(unit=>unit.text).join('')}));return this.store.updateDraft(next,{preserveCurrentId:true});}
 async use({id,runId}){this.ready(id);const output=this.report(id,runId,'product-video').output,d=this.store.draft(id);if(signature(d)!==output.inputSignature||output.voiceInputSignature!==voiceSignature(this.providers,d)||!d.confirmed||hash(d.finalText)!==output.confirmedTextHash||output.audioInput&&(d.voice.audioId!==output.audioInput.id||stamp(this.store.asset(output.audioInput.id))!==output.audioInput.sha256))throw Error('商品资料、镜头、确认文案或配音已变化，请重新生成，未覆盖现有创作');
  const asset=this.store.asset(output.asset.id),base=this.store.asset(output.baseAsset.id);if(asset.type!=='video'||base.type!=='video'||stamp(asset)!==output.outputSha256||stamp(base)!==output.baseSha256)throw Error('商品视频文件已变化，请重新生成');if(output.audioId)this.store.asset(output.audioId);
  const before=structuredClone(d),index=this.store.data.drafts.findIndex(x=>x.id===id),next=structuredClone(d);next.step=4;next.video.mode='product';next.productSelection={runId,scriptRunId:output.scriptRunId,baseId:base.id,resultId:asset.id,selectedAt:new Date().toISOString()};
  try{const saved=this.store.updateDraft(next,{persist:false,preserveCurrentId:true});saved.video.audioId=output.audioId||'';saved.video.assetId=base.id;saved.edit={...saved.edit,sourceId:base.id,resultId:asset.id,captions:structuredClone(output.captions),subtitlesEnabled:!!output.captions.length,titleEnabled:false,cardEnabled:false,pipEnabled:false,bgmEnabled:false,sfxEnabled:false,cutSilence:false,speed:1,volume:1};saved.cover.assetId='';saved.cover.videoId='';saved.publish.videoId='';saved.publish.coverId='';saved.publish.recordId='';this.store.save();return structuredClone(saved);}catch(error){this.store.data.drafts[index]=before;throw error;}
 }
}
module.exports={ProductStudio,validateShots,form,signature,selection};
