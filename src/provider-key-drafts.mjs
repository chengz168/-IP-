export const keyCapabilities=['text','vision','tts','asr','image','video','avatar','clone','extract','brain'];
export function createKeyDrafts(){return Object.fromEntries(keyCapabilities.map(scope=>[scope,{action:'keep',value:'',error:''}]));}
export function keyChanges(drafts,{validate=false,only}={}){
 const changes={};
 for(const scope of only?[only]:keyCapabilities){
  const draft=drafts[scope];if(validate)draft.error='';
  if(draft.action==='clear')changes[scope]='';
  if(draft.action==='set'){
   if(!draft.value.trim()){
    if(validate){draft.error='请输入独立密钥，或选择清除并沿用全局。';throw Error('独立密钥尚未填写，请检查对应能力。');}
   }else changes[scope]=draft.value.trim();
  }
 }
 return changes;
}
