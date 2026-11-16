// 先保存旧稿，再切视频，避免防抖保存期间旧字幕短暂挂在新源上。
export async function changeCaptionSource({draft,save},assetId,kind='edit'){
 const current=draft.value,id=current.id,previous=current.edit.sourceId||current.video.assetId||'';
 await save();
 if(draft.value.id!==id||(draft.value.edit.sourceId||draft.value.video.assetId||'')!==previous)throw Error('任务或视频已变化，请重新选择视频');
 if(kind==='video')draft.value.video.assetId=assetId;else draft.value.edit.sourceId=assetId;
 const next=draft.value.edit.sourceId||draft.value.video.assetId||'';
 if(previous!==next){draft.value.edit.captions=[];delete draft.value.edit.subtitleProofread;}
 await save();
}
