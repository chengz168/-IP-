// 长操作只可回填原任务、原输入，期间的新编辑由用户保留。
export function recognitionSnapshot(draft,kind){
  return {id:draft.id,kind,signature:JSON.stringify(kind==='extract'?{url:draft.sourceUrl,text:draft.sourceText}:{source:draft.edit.sourceId||draft.video.assetId,captions:draft.edit.captions})};
}
export function canApplyRecognition(snapshot,draft){return snapshot.id===draft.id&&snapshot.signature===recognitionSnapshot(draft,snapshot.kind).signature;}
