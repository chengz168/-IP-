const crypto=require('node:crypto');
class PromptLibrary{
 constructor(store){this.store=store;}
 async catalog(){return (await import('./prompt-catalog.mjs')).promptCatalog(this.store.data);}
 commit(change){const before=structuredClone({prompts:this.store.data.prompts,settings:this.store.data.settings});try{const result=change();this.store.save();return result;}catch(error){this.store.data.prompts=before.prompts;this.store.data.settings=before.settings;if(['EACCES','EPERM','EBUSY'].includes(error.code))throw Error('提示词保存失败，数据文件不可写或被占用。请检查文件权限后重试，输入内容已保留。',{cause:error});throw error;}}
 async save(item){
  const value=structuredClone(item),existing=(await this.catalog()).find(p=>p.id===value.id);
  if(existing?.builtin)throw Error('内置提示词请复制后编辑，原始版本保留');
  if(!['copy','title'].includes(value.type||'copy'))throw Error('提示词用途无效');value.type=value.type||'copy';
  if(typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>80)throw Error('提示词名称需为1至80字');
  if(typeof value.content!=='string'||!value.content.trim()||value.content.length>(value.type==='title'?500:2000))throw Error('提示词内容为空或超过长度限制');
  if(value.description!==undefined&&(typeof value.description!=='string'||value.description.length>500))throw Error('描述需在500字以内');
  if(value.model!==undefined&&(typeof value.model!=='string'||value.model.length>128))throw Error('模型名称格式无效');
  value.name=value.name.trim();value.id=value.id||crypto.randomUUID();value.createdAt=existing?.createdAt||new Date().toISOString();value.model=(value.model||'').trim();delete value.builtin;delete value.source;
  if(value.purposes!==undefined&&(!Array.isArray(value.purposes)||value.purposes.length!==1||value.purposes[0]!=='rewrite'))throw Error('提示词适用范围无效');
  if(existing&&existing.type!==value.type&&this.store.data.drafts.some(d=>d.template===value.id))throw Error('正在使用的提示词不能改变用途');
  return this.commit(()=>{const i=this.store.data.prompts.findIndex(p=>p.id===value.id);if(i<0)this.store.data.prompts.push(value);else this.store.data.prompts[i]=value;if(value.active)this.activateInMemory(value);return value;});
 }
 activateInMemory(value){this.store.data.settings.promptDefaults={...this.store.data.settings.promptDefaults,[value.type]:value.id};for(const item of this.store.data.prompts)if((item.type||'copy')===value.type)item.active=item.id===value.id;}
 async activate(id){const value=(await this.catalog()).find(p=>p.id===id);if(!value)throw Error('提示词不存在');return this.commit(()=>{this.activateInMemory(value);return {id,type:value.type};});}
 async remove(id){const value=(await this.catalog()).find(p=>p.id===id);if(!value||value.builtin||id==='default')throw Error('此提示词不能删除');if(this.store.data.drafts.some(d=>d.template===id))throw Error('提示词正被创作任务引用，请先解除引用');return this.commit(()=>{this.store.data.prompts=this.store.data.prompts.filter(p=>p.id!==id);if(this.store.data.settings.promptDefaults?.[value.type]===id)delete this.store.data.settings.promptDefaults[value.type];return true;});}
}
module.exports={PromptLibrary};
