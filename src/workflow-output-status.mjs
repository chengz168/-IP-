const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])])):value;
const signature=value=>JSON.stringify(ordered(value));
const source=draft=>draft.edit.sourceId||draft.video.assetId||'';
const names={2:'当前音频',3:'当前视频',4:'剪辑结果',5:'标题封面'};
const readyStatuses=new Set(['原文案 已填写','最终文案 已确认','改写文案 已填写','当前音频 已跳过','当前音频 已就绪','当前视频 已就绪','剪辑结果 已生成','标题封面 已生成','平台 草稿已保存','平台 已发布','发布包 已导出']);
// 只为明确完成或跳过的状态显示就绪样式，配置变化等提示不能借用完成颜色。
export function isWorkflowStatusReady(status){return readyStatuses.has(status);}
function input(draft,step){
 if(step===2)return {finalText:draft.finalText,voice:draft.voice};
 if(step===3&&draft.edit.sourceId)return {sourceId:draft.edit.sourceId};
 if(step===3)return {finalText:draft.finalText,voice:draft.voice,video:draft.video,story:draft.story};
 if(step===4)return {finalText:draft.finalText,voice:draft.voice,video:draft.video,story:draft.story,edit:draft.edit};
 return {...draft.cover,assetId:undefined,videoId:undefined};
}

// 只使用当前引用对应的后端文件检查；未保存的新配置不能借用旧产物的就绪状态。
export function workflowOutputStatus(state,draft,step){
 const name=names[step],id=step===2?draft.voice.audioId:step===3?source(draft):step===4?draft.edit.resultId:draft.cover.assetId;
 const summary=state.taskSummaries?.find(task=>task.id===draft.id),stage=summary?.stages[step],saved=state.drafts?.find(task=>task.id===draft.id);
 if(!id)return step===2&&stage?.status==='skipped'?name+' 已跳过':name+' 未生成';
 const savedId=saved&&(step===2?saved.voice.audioId:step===3?source(saved):step===4?saved.edit.resultId:saved.cover.assetId);
 if(!saved||!stage||savedId!==id)return name+' 待检查';
 if(signature(input(draft,step))!==signature(input(saved,step)))return name+' 配置已变化';
 if(!stage.available)return name+' 不可用';
 return name+(step<4?' 已就绪':' 已生成');
}
