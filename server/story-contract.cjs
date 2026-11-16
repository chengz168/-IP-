const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)??'null').digest('hex');
const uid=()=>crypto.randomUUID();
const string=(v,label,max=50000)=>{if(typeof v!=='string'||v.length>max)throw Error(label+'格式无效');return v;};
function createStory(draft={}){const sourceText=draft.confirmed?draft.finalText||'':'';return {version:1,revision:0,sourceMode:'upstream',sourceKind:'confirmed-finalText',sourceText,sourceHash:hash(sourceText),episodesSourceHash:'',narrationMode:'none',episodeCount:1,episodeDuration:30,aspect:'9:16',style:'',instructions:'',episodes:[],assets:[]};}
function candidate(item){if(!item||typeof item.id!=='string')throw Error('候选素材记录无效');return {...item};}
function validateStory(value){
 if(!value||value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('非口播创作版本无效');
 const s=structuredClone(value);string(s.sourceText,'剧本');string(s.style,'视觉风格',3000);string(s.instructions,'补充要求',5000);
 s.sourceMode=s.sourceMode||'upstream';s.narrationMode=s.narrationMode||'none';if(!['upstream','custom'].includes(s.sourceMode)||!['none','upstream'].includes(s.narrationMode))throw Error('剧本来源或旁白模式无效');
 s.sourceKind=s.sourceMode==='custom'?'custom':'confirmed-finalText';s.sourceHash=hash(s.sourceText);
 if(!Number.isSafeInteger(s.episodeCount)||s.episodeCount<1||s.episodeCount>50)throw Error('集数请输入1至50的正整数');
 if(!Number.isFinite(s.episodeDuration)||s.episodeDuration<1||s.episodeDuration>600)throw Error('每集参考时长需为1至600秒');
 if(!['9:16','16:9','1:1','4:3','3:4'].includes(s.aspect))throw Error('画幅无效');
 if(!Array.isArray(s.episodes)||s.episodes.length>50||!Array.isArray(s.assets)||s.assets.length>500)throw Error('分集或资产数量无效');
 const ids=new Set(),take=(id,label)=>{if(typeof id!=='string'||!id||id.length>120||ids.has(id))throw Error(label+'ID缺失或重复');ids.add(id);};
 for(const a of s.assets){take(a.id,'资产');if(!['character','scene','prop'].includes(a.kind))throw Error('资产类型无效');string(a.name,'资产名',300);string(a.description,'资产描述',5000);string(a.prompt,'资产提示词',5000);a.images=(a.images||[]).map(candidate);a.selectedImageId=a.selectedImageId||'';}
 for(const e of s.episodes){take(e.id,'分集');string(e.title,'分集标题',500);string(e.text,'分集原文');if(e.narrationAssetId!==undefined)string(e.narrationAssetId,'分集旁白素材ID',120);if(!Array.isArray(e.shots)||e.shots.length>100)throw Error('单集最多100个镜头');e.resultId=e.resultId||'';
  for(const shot of e.shots){take(shot.id,'镜头');for(const key of ['text','visual','action','camera','sound','imagePrompt','videoPrompt'])string(shot[key]||'',key,10000);if(!Number.isFinite(shot.duration)||shot.duration<.1||shot.duration>600)throw Error('镜头时长需为0.1至600秒');if(!Array.isArray(shot.assetIds)||new Set(shot.assetIds).size!==shot.assetIds.length||shot.assetIds.some(id=>!s.assets.some(a=>a.id===id)))throw Error('镜头引用了缺失或重复资产ID');if(shot.primaryReferenceAssetId&&!shot.assetIds.includes(shot.primaryReferenceAssetId))throw Error('主参考必须是当前镜头已绑定的资产');shot.images=(shot.images||[]).map(candidate);shot.videos=(shot.videos||[]).map(candidate);shot.selectedImageId=shot.selectedImageId||'';shot.selectedVideoId=shot.selectedVideoId||'';}
 }
 return s;
}
function assetInput(s,a){return {aspect:s.aspect,style:s.style,instructions:s.instructions,kind:a.kind,name:a.name,description:a.description,prompt:a.prompt};}
function shotInput(s,shot){return {aspect:s.aspect,style:s.style,instructions:s.instructions,text:shot.text,visual:shot.visual,action:shot.action,camera:shot.camera,sound:shot.sound,duration:shot.duration,imagePrompt:shot.imagePrompt,videoPrompt:shot.videoPrompt,primaryReferenceAssetId:shot.primaryReferenceAssetId||'',assets:shot.assetIds.map(id=>{const a=s.assets.find(a=>a.id===id);return a?{id,input:assetInput(s,a),selectedImageId:a.selectedImageId}:null;})};}
function reconcile(before,after){
 const global=hash([before.sourceText,before.episodeCount,before.episodeDuration])!==hash([after.sourceText,after.episodeCount,after.episodeDuration]);
 for(const a of after.assets){const old=before.assets.find(x=>x.id===a.id);if(old){const same=hash(assetInput(before,old))===hash(assetInput(after,a));a.images=(old.images||[]).map(c=>same?c:{...c,status:'stale'});a.selectedImageId=same?old.selectedImageId:'';}else{a.images=[];a.selectedImageId='';}}
 for(const e of after.episodes){const old=before.episodes.find(x=>x.id===e.id);if(!old){e.resultId='';for(const sh of e.shots){sh.images=[];sh.videos=[];sh.selectedImageId='';sh.selectedVideoId='';}continue;}
  const oldNarration=before.narrationMode==='upstream'?old.narrationAssetId||'':'',newNarration=after.narrationMode==='upstream'?e.narrationAssetId||'':'';
  let changed=global||e.text!==old.text||newNarration!==oldNarration||before.narrationMode!==after.narrationMode||hash(e.shots.map(x=>x.id))!==hash(old.shots.map(x=>x.id));
  for(const sh of e.shots){const os=old.shots.find(x=>x.id===sh.id),same=os&&!global&&e.text===old.text&&hash(shotInput(before,os))===hash(shotInput(after,sh));sh.images=(os?.images||[]).map(c=>same?c:{...c,status:'stale'});sh.videos=(os?.videos||[]).map(c=>same?c:{...c,status:'stale'});sh.selectedImageId=same?os.selectedImageId:'';sh.selectedVideoId=same?os.selectedVideoId:'';if(!same)changed=true;}
  e.resultId=changed?'':old.resultId;e.resultInputHash=changed?'':old.resultInputHash;e.resultNarrationAssetId=changed?'':old.resultNarrationAssetId;e.results=old.results||[];
 }
 return after;
}
module.exports={hash,uid,createStory,validateStory,assetInput,shotInput,reconcile};
