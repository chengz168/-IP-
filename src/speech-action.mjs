import {capabilityBaseUrl} from '../server/provider-endpoints.mjs';
// 前端包含尚未保存的输入；服务端另有有效请求快照，双端共同阻止迟到结果覆盖。
export function speechActionSignature(draft,data){
 const p=data.settings.provider,v=draft.voice,profile=data.voices.find(item=>item.id===v.profile),windows=p.ttsProtocol==='windows';
 if(p.ttsProtocol==='indextts-local')return JSON.stringify({id:draft.id,text:draft.finalText,language:draft.language,voice:{...v,audioId:undefined},protocol:p.ttsProtocol,home:p.indexttsHome||'',sampleId:profile?.sampleId||''});
 return JSON.stringify({id:draft.id,text:draft.finalText,voice:{...v,audioId:undefined},protocol:p.ttsProtocol||'compatible',model:windows?'':v.model==='classic'?(p.ttsClassicModel||p.ttsModel||'').trim():(p.ttsFastModel||p.ttsModel||'').trim(),effectiveVoice:windows?v.systemVoice||p.systemVoice||'':profile?.remoteId||p.voice||'',baseUrl:windows?'':capabilityBaseUrl(p,'tts')});
}

export async function runSpeechAction({draft,state,save,act,call,notify}){
 const id=draft.value.id;
 try{await save();}catch(error){notify('保存配音文案失败：'+error.message,'error');return;}
 if(draft.value.id!==id)return;
 const signature=speechActionSignature(draft.value,state.value),result=await act('生成声音',()=>call('speech',{id}));
 if(!result)return;
 if(result.stale||draft.value.id!==id||signature!==speechActionSignature(draft.value,state.value)){
  notify('配音输入或任务已变化，新产物保留在素材库，未替换当前音频');return;
 }
 draft.value.voice.audioId=result.id;
 notify('音频已生成并通过媒体格式校验，请试听确认','success');
 return result;
}
