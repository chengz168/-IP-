const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)??'null').digest('hex');
const uid=()=>crypto.randomUUID();
const string=(v,label,max=50000)=>{if(typeof v!=='string'||v.length>max)throw Error(label+'格式无效');return v;};
function createStory(draft={}){const sourceText=draft.confirmed?draft.finalText||'':'';return {version:1,revision:0,sourceMode:'upstream',sourceKind:'confirmed-finalText',sourceText,sourceHash:hash(sourceText),episodesSourceHash:'',narrationMode:'none',originalAudioVolume:null,episodeCount:1,episodeDuration:30,aspect:'9:16',style:'',instructions:'',episodes:[],assets:[]};}
// 缺字段的旧稿保持旧合成输入；null 表示新稿按旁白模式自动选择原声音量。
function storyAudioMix(story){
 if(story.productIntroduction||story.originalAudioVolume===undefined)return undefined;
 const volume=story.originalAudioVolume;
 if(volume!==null&&(!Number.isFinite(volume)||volume<0||volume>1))throw Error('镜头原声音量请输入0至100%');
 return {version:1,originalAudioVolume:volume===null?(story.narrationMode==='upstream'?.2:1):volume,limiter:.95};
}
function candidate(item){if(!item||typeof item.id!=='string')throw Error('候选素材记录无效');return {...item};}
// 图标权限来自服务端冻结的商品来源，不采信可编辑资产上的角色标签。
function frozenProductIcons(productIntroduction){
 const images=productIntroduction?.images;if(images===undefined)return new Map();if(!Array.isArray(images))throw Error('商品冻结素材清单无效，请重新准备产品介绍分镜');
 const ids=new Set(),icons=new Map();for(const image of images){if(!image||typeof image.id!=='string'||!image.id||ids.has(image.id))throw Error('商品冻结素材ID缺失或重复，请重新准备产品介绍分镜');ids.add(image.id);if(image.role==='icon'){if(typeof image.sha256!=='string'||!(/^[a-f0-9]{64}$/i).test(image.sha256))throw Error('商品冻结图标校验凭据无效，请重新准备产品介绍分镜');icons.set(image.id,image.sha256.toLowerCase());}}return icons;
}
function validateStory(value){
 if(!value||value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('非口播创作版本无效');
 const s=structuredClone(value);string(s.sourceText,'剧本');string(s.style,'视觉风格',3000);string(s.instructions,'补充要求',5000);
 s.sourceMode=s.sourceMode||'upstream';s.narrationMode=s.narrationMode||'none';if(!['upstream','custom'].includes(s.sourceMode)||!['none','upstream'].includes(s.narrationMode))throw Error('剧本来源或旁白模式无效');
 if(s.originalAudioVolume!==undefined&&s.originalAudioVolume!==null&&(!Number.isFinite(s.originalAudioVolume)||s.originalAudioVolume<0||s.originalAudioVolume>1))throw Error('镜头原声音量请输入0至100%');
 s.sourceKind=s.sourceMode==='custom'?'custom':'confirmed-finalText';s.sourceHash=hash(s.sourceText);
 if(!Number.isSafeInteger(s.episodeCount)||s.episodeCount<1||s.episodeCount>50)throw Error('集数请输入1至50的正整数');
 if(!Number.isFinite(s.episodeDuration)||s.episodeDuration<1||s.episodeDuration>600)throw Error('每集参考时长需为1至600秒');
 if(!['9:16','16:9','1:1','4:3','3:4'].includes(s.aspect))throw Error('画幅无效');
 if(!Array.isArray(s.episodes)||s.episodes.length>50||!Array.isArray(s.assets)||s.assets.length>500)throw Error('分集或资产数量无效');
 const ids=new Set(),take=(id,label)=>{if(typeof id!=='string'||!id||id.length>120||ids.has(id))throw Error(label+'ID缺失或重复');ids.add(id);};
 for(const a of s.assets){take(a.id,'资产');if(!['character','scene','prop'].includes(a.kind))throw Error('资产类型无效');string(a.name,'资产名',300);string(a.description,'资产描述',5000);string(a.prompt,'资产提示词',5000);a.images=(a.images||[]).map(candidate);a.selectedImageId=a.selectedImageId||'';}
 for(const e of s.episodes){take(e.id,'分集');string(e.title,'分集标题',500);string(e.text,'分集原文');if(e.narrationAssetId!==undefined)string(e.narrationAssetId,'分集旁白素材ID',120);if(!Array.isArray(e.shots)||e.shots.length>100)throw Error('单集最多100个镜头');e.resultId=e.resultId||'';
  for(const shot of e.shots){take(shot.id,'镜头');validateVideoControls(shot);for(const key of ['text','visual','action','camera','sound','imagePrompt','videoPrompt'])string(shot[key]||'',key,10000);if(!Number.isFinite(shot.duration)||shot.duration<.1||shot.duration>600)throw Error('镜头时长需为0.1至600秒');if(!Array.isArray(shot.assetIds)||new Set(shot.assetIds).size!==shot.assetIds.length||shot.assetIds.some(id=>!s.assets.some(a=>a.id===id)))throw Error('镜头引用了缺失或重复资产ID');if(shot.primaryReferenceAssetId&&!shot.assetIds.includes(shot.primaryReferenceAssetId))throw Error('主参考必须是当前镜头已绑定的资产');shot.images=(shot.images||[]).map(candidate);shot.videos=(shot.videos||[]).map(candidate);shot.selectedImageId=shot.selectedImageId||'';shot.selectedVideoId=shot.selectedVideoId||'';}
 }
 if(s.productIntroduction){
  const trustedIcons=frozenProductIcons(s.productIntroduction);
  for(const e of s.episodes)for(const shot of e.shots){
   for(const key of ['sellingPoint','evidence','stage'])string(shot[key]||'',key,key==='evidence'?1000:key==='sellingPoint'?160:500);
   if(!Array.isArray(shot.iconIds)||shot.iconIds.length>4||new Set(shot.iconIds).size!==shot.iconIds.length||shot.iconIds.some(id=>!trustedIcons.has(id)||!s.assets.some(a=>a.role==='icon'&&a.selectedImageId===id&&shot.assetIds.includes(a.id))))throw Error('商品镜头图标必须引用冻结来源清单中当前绑定的原图标素材，每镜最多四个');
  }
 }
 return s;
}
function assetInput(s,a){return {...(s.referenceFacts?{referenceFacts:s.referenceFacts}:{}),aspect:s.aspect,style:s.style,instructions:s.instructions,kind:a.kind,name:a.name,description:a.description,prompt:a.prompt};}
function shotInput(s,shot){return {...(s.referenceFacts?{referenceFacts:s.referenceFacts}:{}),aspect:s.aspect,style:s.style,instructions:s.instructions,text:shot.text,visual:shot.visual,action:shot.action,camera:shot.camera,sound:shot.sound,duration:shot.duration,imagePrompt:shot.imagePrompt,videoPrompt:shot.videoPrompt,primaryReferenceAssetId:shot.primaryReferenceAssetId||'',...(s.productIntroduction?{product:{sellingPoint:shot.sellingPoint||'',evidence:shot.evidence||'',iconIds:shot.iconIds||[],audioId:s.productIntroduction.audioId,productHash:s.productIntroduction.productHash}}:{}),assets:shot.assetIds.map(id=>{const a=s.assets.find(a=>a.id===id);return a?{id,input:assetInput(s,a),selectedImageId:a.selectedImageId}:null;})};}
// 尾帧和种子仅控制动态视频，保持无参数旧镜头的输入结构兼容。
function videoInput(s,shot){return {shot:shotInput(s,shot),...(shot.referenceMode==='assets'?{referenceMode:'assets'}:{imageId:shot.selectedImageId}),...(shot.lastFrameId?{lastFrameId:shot.lastFrameId}:{}),...(shot.videoSeed!==undefined&&shot.videoSeed!==null?{videoSeed:shot.videoSeed}:{})};}
function validateVideoControls(shot){if(shot.referenceMode!==undefined&&!['first-frame','assets'].includes(shot.referenceMode))throw Error('请选择有效的视频参考方式');if(shot.referenceMode==='assets'&&shot.lastFrameId)throw Error('资产参考生成不支持尾帧，请清除尾帧或选择首帧图生视频');if(shot.lastFrameId!==undefined)string(shot.lastFrameId,'尾帧素材ID',120);if(shot.videoSeed!==undefined&&shot.videoSeed!==null&&(!Number.isSafeInteger(shot.videoSeed)||shot.videoSeed<0||shot.videoSeed>4294967295))throw Error('固定种子请输入0至4294967295的整数，留空则随机');}
function reconcile(before,after){
 const global=hash([before.sourceText,before.episodeCount,before.episodeDuration])!==hash([after.sourceText,after.episodeCount,after.episodeDuration]);
 for(const a of after.assets){const old=before.assets.find(x=>x.id===a.id);if(old){const same=hash(assetInput(before,old))===hash(assetInput(after,a));a.images=(old.images||[]).map(c=>same?c:{...c,status:'stale'});a.selectedImageId=same?old.selectedImageId:'';}else{a.images=[];a.selectedImageId='';}}
 for(const e of after.episodes){const old=before.episodes.find(x=>x.id===e.id);if(!old){e.resultId='';for(const sh of e.shots){sh.images=[];sh.videos=[];sh.selectedImageId='';sh.selectedVideoId='';}continue;}
  const oldNarration=before.narrationMode==='upstream'?old.narrationAssetId||'':'',newNarration=after.narrationMode==='upstream'?e.narrationAssetId||'':'';
  let changed=global||e.text!==old.text||newNarration!==oldNarration||before.narrationMode!==after.narrationMode||hash(storyAudioMix(before))!==hash(storyAudioMix(after))||hash(e.shots.map(x=>x.id))!==hash(old.shots.map(x=>x.id));
  for(const sh of e.shots){const os=old.shots.find(x=>x.id===sh.id),same=os&&!global&&e.text===old.text&&hash(shotInput(before,os))===hash(shotInput(after,sh));sh.images=(os?.images||[]).map(c=>same?c:{...c,status:'stale'});const sameVideo=same&&hash(videoInput(before,os))===hash(videoInput(after,sh));sh.videos=(os?.videos||[]).map(c=>sameVideo?c:{...c,status:'stale'});sh.selectedImageId=same?os.selectedImageId:'';sh.selectedVideoId=sameVideo?os.selectedVideoId:'';if(!sameVideo)changed=true;}
  e.resultId=changed?'':old.resultId;e.resultInputHash=changed?'':old.resultInputHash;e.resultNarrationAssetId=changed?'':old.resultNarrationAssetId;e.results=old.results||[];
 }
 return after;
}
module.exports={hash,uid,createStory,validateStory,assetInput,shotInput,videoInput,validateVideoControls,reconcile,frozenProductIcons,storyAudioMix};
