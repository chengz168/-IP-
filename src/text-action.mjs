import {textInput,textInputMatches} from '../server/text-input.mjs';

// 新旧工作流共用文案写入边界，已拒绝或过期的回包只留执行记录。
export async function runTextAction({draft,state,save,act,call,notify,showDialog,showLegal},kind){
 const taskId=draft.value.id;
 try{await save();}catch(error){notify('保存文案失败：'+error.message,'error');return;}
 if(draft.value.id!==taskId)return;
 const input=textInput(draft.value,kind,state.value),id=taskId;
 const result=await act(kind==='legal'?'检查文案':'生成文案',()=>call('text',{id,kind}));
 if(!result)return;
 if(result.stale||!textInputMatches(input,draft.value,kind,state.value)){
  notify('文案、模板或任务已经变化，本次结果保留在执行记录中，未覆盖当前内容');return;
 }
 if(result.quality?.status==='rejected'||(kind==='rewrite'&&result.quality?.targetDeviation>.2)){
  showDialog('本次改写未通过内容检查',(result.quality.issues||[]).join('\n')+'\n完整输出保留在任务执行记录中，当前文案未替换。');return;
 }
 if(kind==='legal')showLegal(result.text);
 else if(kind==='rewrite'){draft.value.rewrite=result.text;draft.value.finalText='';draft.value.confirmed=false;}
 else if(kind==='translate')draft.value.finalText=result.text;
 else if(kind==='title')draft.value.cover.title=result.text;
 else{draft.value.sourceText=result.text;draft.value.confirmed=false;}
 // 生成结果立即落盘，避免用户在自动保存间隔内刷新或关闭时丢稿。
 if(kind!=='legal')try{await save();}catch(error){
  notify('文案已生成，但保存失败：'+error.message+'。当前编辑已保留，请重试保存。','error');return result;
 }
 const notices=[...(result.quality?.issues||[]),...(result.quality?.warnings||[])];
 notify(notices.length?'文案已返回，请复核：'+notices.join('；'):'已收到模型文案，请核对内容后确认使用',notices.length?'warning':'success');
 return result;
}
