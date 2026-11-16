import {recognitionSnapshot,canApplyRecognition} from './recognition-state.js';

// 新旧工作流共用提取回填与即时保存，期间的新输入不会被迟到回包覆盖。
export async function runExtractAction({draft,save,act,call,notify},asset){
 const taskId=draft.value.id;
 try{await save();}catch(error){notify('保存提取输入失败：'+error.message,'error');return;}
 if(draft.value.id!==taskId)return;
 const snapshot=recognitionSnapshot(draft.value,'extract');
 const result=await act('提取文案',()=>asset?.type==='text'?call('assetText',{id:asset.id}).then(text=>({text})):call('extract',{id:taskId,assetId:asset?.id}));
 if(!result)return;
 if(result.stale||!canApplyRecognition(snapshot,draft.value)){
  notify(asset?.type==='text'?'原文或任务已变化，未覆盖当前内容':'原文或任务已变化，本次识别结果保留在执行记录中，未覆盖当前内容');return;
 }
 if(typeof result.text!=='string'||!result.text.trim()){notify('提取结果没有有效正文，请检查来源或执行记录','error');return;}
 draft.value.sourceText=result.text;
 try{await save();}catch(error){notify('文案已提取，但保存失败：'+error.message+'。当前文字已保留，请重试保存。','error');return result;}
 notify('文案提取完成并已保存，请核对识别文字','success');return result;
}
