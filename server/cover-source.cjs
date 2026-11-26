const fs=require('node:fs'),crypto=require('node:crypto');
const hashFile=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const coverSignature=cover=>JSON.stringify({...cover,assetId:undefined,videoId:undefined});
const sourceId=draft=>draft.edit?.resultId||draft.edit?.sourceId||draft.video?.assetId||'';
function fileInput(store,id,type){
 const asset=store.asset(id);if(asset.type!==type)throw Error(type==='video'?'封面来源不是有效视频':'封面来源不是有效图片');
 return {assetId:id,sha256:hashFile(asset.path)};
}
function frameInput(store,id,time=0){return {version:1,video:fileInput(store,id,'video'),time:Math.max(0,Number(time)||0)};}
function assertFrameCurrent(store,draft,id){
 const asset=store.asset(id);if(asset.type!=='image')throw Error('封面背景不是图片');
 if(asset.origin!=='frame')return;
 const input=asset.frameSource;
 if(!input||input.version!==1)throw Error('历史视频帧缺少来源凭据，请从当前视频重新截取封面');
 if(!same(input.video,fileInput(store,sourceId(draft),'video')))throw Error('封面背景来自其他或已变化的视频，请重新截取当前视频');
 if(asset.frameSha256!==hashFile(asset.path))throw Error('封面背景文件已变化，请重新截取');
}
function coverInput(store,draft){
 const id=draft.cover?.backgroundId;
 if(!id)return {version:1,mode:'manual',background:null};
 const asset=store.asset(id);assertFrameCurrent(store,draft,id);
 const background=fileInput(store,id,'image');
 if(asset.origin==='frame'){
  if(asset.frameSource.time!==Math.max(0,Number(draft.cover.frameTime)||0))throw Error('封面取帧时间已变化，请重新截取');
  return {version:1,mode:'video-frame',background,frameSource:structuredClone(asset.frameSource)};
 }
 return {version:1,mode:'manual',background};
}
function assertCoverCurrent(store,draft,id=draft.cover?.assetId){
 const asset=store.asset(id);if(asset.type!=='image')throw Error('封面图片不能实际解码，请重新选择素材');
 if(asset.origin==='cover'){
  if(!asset.coverSource||asset.coverSource.version!==1)throw Error('历史自动封面缺少来源凭据，请重新生成封面');
  if(asset.coverSignature!==coverSignature(draft.cover))throw Error('封面设计已变化，请重新生成封面');
  if(!same(asset.coverSource,coverInput(store,draft)))throw Error('封面背景或视频来源已变化，请重新生成封面');
  if(asset.coverSha256!==hashFile(asset.path))throw Error('封面图片文件已变化，请重新生成封面');
 }else assertFrameCurrent(store,draft,id);
 return asset;
}
function coverCurrent(store,draft,id=draft.cover?.assetId){try{assertCoverCurrent(store,draft,id);return true;}catch{return false;}}
function backgroundCurrent(store,draft){try{if(!draft.cover?.backgroundId)return false;coverInput(store,draft);return true;}catch{return false;}}
function videoDerivedCover(store,draft){try{const asset=store.asset(draft.cover.assetId);return asset.origin==='frame'||asset.origin==='cover'&&asset.coverSource?.mode!=='manual';}catch{return false;}}
function assertPublicationCover(store,draft,videoId,coverId){
 const cover=assertCoverCurrent(store,draft,coverId);
 if(cover.origin==='frame'||cover.coverSource?.mode==='video-frame'){
  const video=store.asset(videoId),expected=fileInput(store,sourceId(draft),'video');
  if(videoId!==expected.assetId&&(!video.coverVideoSource||!same(video.coverVideoSource.video,expected)||video.coverVideoSource.cover?.assetId!==coverId||video.coverVideoSource.cover?.sha256!==hashFile(cover.path)))throw Error('发布视频与自动封面来源不匹配，请重新生成封面');
 }
 return cover;
}
function invalidateVideoCover(store,before,next){
 // 仅撤销自动视频帧的失配引用；手选通用图和素材历史继续保留。
 const oldSource=sourceId(before),newSource=sourceId(next);if(oldSource===newSource)return;
 try{if(store.asset(next.cover.backgroundId).origin==='frame'&&!backgroundCurrent(store,next)){next.cover.backgroundId='';next.cover.assetId='';next.cover.videoId='';}}catch{}
 if(videoDerivedCover(store,next)&&!coverCurrent(store,next)){next.cover.assetId='';next.cover.videoId='';}
}
module.exports={hashFile,coverSignature,sourceId,frameInput,fileInput,assertFrameCurrent,coverInput,assertCoverCurrent,assertPublicationCover,coverCurrent,backgroundCurrent,videoDerivedCover,invalidateVideoCover};
