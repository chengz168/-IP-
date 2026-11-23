import {subtitleReferenceInput} from '../server/subtitle-reference.mjs';
// 长操作只可回填原任务、原输入，期间的新编辑由用户保留。
export function recognitionSnapshot(draft,kind,data){
  const referenceInput=kind==='extract'?undefined:subtitleReferenceInput(draft,data);
  return {id:draft.id,kind,referenceInput,signature:JSON.stringify(kind==='extract'?{url:draft.sourceUrl,text:draft.sourceText}:{source:draft.edit.sourceId||draft.video.assetId,captions:draft.edit.captions,reference:referenceInput})};
}
export function canApplyRecognition(snapshot,draft,data){return snapshot.id===draft.id&&snapshot.signature===recognitionSnapshot(draft,snapshot.kind,data).signature;}
