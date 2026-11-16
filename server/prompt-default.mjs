export const referenceCopyId='reference-copy-v840';
const bootstrapCopy={id:'default',name:'默认文案写作提示词',type:'copy',content:'根据用户提供的原文与要求改写文案。保留事实，不虚构数据，输出可直接用于口播的正文。',active:true};
export function isBootstrapCopy(item){
 // 编辑过的简版也属于用户选择，不能因ID相同就替换。
 return item.id===bootstrapCopy.id&&item.name===bootstrapCopy.name&&(item.type||'copy')==='copy'&&item.content===bootstrapCopy.content&&Object.keys(item).every(key=>key in bootstrapCopy);
}
export function selectDefaultCopyId(data){
 const choices=(data.prompts||[]).filter(item=>(item.type||'copy')==='copy'&&(!item.purposes||item.purposes.includes('rewrite'))&&item.content?.trim()&&item.id!==referenceCopyId),explicit=data.settings?.promptDefaults?.copy;
 if(explicit===referenceCopyId||choices.some(item=>item.id===explicit))return explicit;
 const custom=choices.find(item=>item.active&&!isBootstrapCopy(item));
 return custom?.id||referenceCopyId;
}
