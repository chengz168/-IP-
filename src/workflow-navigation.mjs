// 先完成子编辑器与主草稿保存，再切换步骤，避免卸载与回填竞争。
export async function moveWorkflowStep({target,draft,save,navigating,notify,handoff}){
 if(!Number.isInteger(target)||target<0||target>6||navigating.value||!draft.value||target===(draft.value.step||0))return false;
 const id=draft.value.id,previous=draft.value.step||0;
 navigating.value=true;
 try{
  await save();
  if(draft.value?.id!==id)return false;
  // 分镜成片必须经过当前集交接，不能只切换页面后沿用旧剪辑源。
  if(previous===3&&target===4&&['story','product'].includes(draft.value.video?.mode)){
   if(!handoff)throw Error('当前集交接入口尚未就绪，请返回视频生成后重试');
   return !!await handoff()&&draft.value?.id===id&&draft.value.step===4;
  }
  draft.value.step=target;
  await save();
  return true;
 }catch(error){if(draft.value?.id===id)draft.value.step=previous;notify(error.message,'error');return false;}
 finally{navigating.value=false;}
}
