// 先完成子编辑器与主草稿保存，再切换步骤，避免卸载与回填竞争。
export async function moveWorkflowStep({target,draft,save,navigating,notify}){
 if(!Number.isInteger(target)||target<0||target>6||navigating.value||!draft.value||target===(draft.value.step||0))return false;
 const id=draft.value.id,previous=draft.value.step||0;
 navigating.value=true;
 try{
  await save();
  if(draft.value?.id!==id)return false;
  draft.value.step=target;
  await save();
  return true;
 }catch(error){if(draft.value?.id===id)draft.value.step=previous;notify(error.message,'error');return false;}
 finally{navigating.value=false;}
}
