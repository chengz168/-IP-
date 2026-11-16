import {copyCandidate,confirmationInput,confirmationMatches} from '../server/copy-confirmation.mjs';

const pending=new WeakSet();
const core=draft=>JSON.stringify({...draft,updatedAt:undefined});

// 服务端完成原子保存后才应用确认结果；中途改字、换任务或保存失败均不启动后续流程。
export async function confirmCopyAction({draft,save,act,call,notify,startWorkflow}){
 if(pending.has(draft))return false;
 pending.add(draft);
 try{
  const id=draft.value.id,original=confirmationInput(draft.value),mode=draft.value.mode;
  if(!copyCandidate(draft.value).trim()){notify('请先输入文案');return false;}
  try{await save();}catch(error){notify('保存文案失败：'+error.message,'error');return false;}
  const current=confirmationInput(draft.value);
  // 保存可能撤销旧确认；正文、目标稿与任务必须仍是点击时的版本。
  if(current.id!==id||['sourceText','rewrite','finalText'].some(key=>current[key]!==original[key])){
   notify('确认期间文案或任务已变化，请核对当前内容后重新确认');return false;
  }
  const snapshot=core(draft.value),input=confirmationInput(draft.value);
  const result=await act('确认文案',async()=>{try{return await call('confirmCopy',{id,input});}catch(error){throw Error(String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u,''));}});
  if(!result)return false;
  if(draft.value.id===id&&core(draft.value)===snapshot)draft.value=result;
  if(result.id!==id||!confirmationMatches(confirmationInput(result),draft.value)||!draft.value.confirmed||draft.value.mode!==mode){
   notify('文案确认已保存，但当前编辑或任务已变化，未启动后续处理，请重新核对');return false;
  }
  if(['auto','background'].includes(mode))await startWorkflow(mode,id);
  else notify('已确认为最终文案','success');
  return true;
 }finally{pending.delete(draft);}
}
