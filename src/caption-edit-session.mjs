const clone=value=>JSON.parse(JSON.stringify(value));
const sourceOf=draft=>draft.edit.sourceId||draft.video.assetId||'';
export const captionEditSignature=draft=>JSON.stringify([draft.id,sourceOf(draft),draft.edit.captions]);

// 临时字幕不进入父任务的自动保存；取消重开复用，外部内容变化才重建。
export function openCaptionSession(previous,draft){
 const signature=captionEditSignature(draft);
 return previous?.signature===signature?previous:{signature,rows:clone(draft.edit.captions)};
}

export async function saveCaptionSession({session,draft,save}){
 if(session.signature!==captionEditSignature(draft.value))throw Error('任务、视频或已保存字幕已变化，请重新打开字幕编辑');
 const task=draft.value.id,source=sourceOf(draft.value),previous=clone(draft.value.edit.captions),rows=clone(session.rows);
 draft.value.edit.captions=rows;
 try{await save();}
 catch(error){
  // 写盘失败时恢复父任务，避免500ms自动保存偷偷提交失败的临时编辑。
  if(draft.value.id===task&&sourceOf(draft.value)===source&&JSON.stringify(draft.value.edit.captions)===JSON.stringify(rows))draft.value.edit.captions=previous;
  throw error;
 }
 if(draft.value.id!==task||sourceOf(draft.value)!==source)throw Error('任务或视频已变化，字幕已保存在原任务，请重新打开当前任务');
 session.signature=captionEditSignature(draft.value);
}
