const crypto=require('node:crypto');
const sourceId=d=>d.edit.sourceId||d.video.assetId||'';
const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function archiveRows(before,next,reason='source-change'){
 if(!before.edit.captions?.length)return;
 const previous=structuredClone(before.artifacts?.captionHistory||[]),rows=structuredClone(before.edit.captions),rowsHash=hash(rows),source=sourceId(before);
 // 保留完整行数据，逐句画中画和辅助文本只属于原视频，不能跟着换源。
 if(!previous.some(item=>item.sourceId===source&&item.rowsHash===rowsHash))previous.unshift({id:crypto.randomUUID(),sourceId:source,rows,rowsHash,reason,archivedAt:new Date().toISOString(),proofread:structuredClone(before.edit.subtitleProofread||null)});
 next.artifacts??={};next.artifacts.captionHistory=previous;
}
function archiveOnSourceChange(before,next){
 if(sourceId(before)===sourceId(next)||!before.edit.captions?.length)return;
 archiveRows(before,next);next.edit.captions=[];delete next.edit.subtitleProofread;
}
const restoreSignature=d=>JSON.stringify({id:d.id,sourceId:sourceId(d),captions:d.edit.captions,history:d.artifacts?.captionHistory||[]});
module.exports={sourceId,archiveRows,archiveOnSourceChange,restoreSignature};
