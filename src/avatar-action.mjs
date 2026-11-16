// 服务端核对已保存的文件和输入；这里额外保护尚未保存的界面编辑。
export function avatarActionSignature(draft,data){
 const video=draft.video,avatar=data.avatars.find(a=>a.id===video.avatarId),shots=video.mode==='multi'?video.shots:[];
 const source=id=>{const asset=data.assets.find(a=>a.id===id);return asset?{id:asset.id,path:asset.path,type:asset.type}:null;};
 const muse=data.settings.provider.avatarProtocol==='musetalk-local';
 return JSON.stringify({id:draft.id,avatarUrl:muse?'':(data.settings.provider.avatarUrl||'').trim(),protocol:data.settings.provider.avatarProtocol||'compatible',...(muse?{musetalkHome:(data.settings.provider.musetalkHome||'').trim()}:{}),mode:video.mode,model:muse?'MuseTalk-1.5':video.model,avatarId:video.avatarId,audio:source(video.audioId||draft.voice.audioId),video:source(avatar?.assetId),shots,shotAvatars:shots.map(shot=>({avatarId:shot.avatarId,source:source(data.avatars.find(a=>a.id===shot.avatarId)?.assetId)}))});
}
export async function runAvatarAction({draft,state,save,act,call,notify}){
 const id=draft.value.id;
 try{await save();}catch(error){notify('保存视频配置失败：'+error.message,'error');return;}
 if(draft.value.id!==id)return;
 const signature=avatarActionSignature(draft.value,state.value);
 const result=await act('生成数字人视频',()=>{
  if(id!==draft.value.id||signature!==avatarActionSignature(draft.value,state.value)){
   notify('视频输入或任务已变化，本次未提交，请核对后重新生成');return;
  }
  return call('avatar',{id});
 });
 if(!result)return;
 if(result.stale||draft.value.id!==id||signature!==avatarActionSignature(draft.value,state.value)){
  // 先落盘当前编辑，使服务端按已修改输入清除可能在回包时绑定的旧产物。
  if(draft.value.id===id){
   try{await save();}catch(error){notify('视频输入已变化，保存当前编辑失败：'+error.message,'error');return;}
  }
  notify('视频输入或任务已变化，新产物保留在素材库，未替换当前视频');return;
 }
 draft.value.video.assetId=result.id;
 try{await save();}catch(error){notify('视频已保留在素材库，保存当前任务失败：'+error.message,'error');return;}
 notify('视频已生成并通过媒体格式校验，请检查口型和音画同步','success');
 return result;
}
