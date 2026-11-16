const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {defaults,createDraft}=require('./store.cjs');

async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function childFile(root,relative){
  if(typeof relative!=='string'||path.isAbsolute(relative))throw new Error('备份文件路径无效');
  const file=path.resolve(root,relative),boundary=path.resolve(root)+path.sep;
  if(!file.startsWith(boundary)||!fs.realpathSync(file).startsWith(fs.realpathSync(root)+path.sep))throw new Error('备份文件超出所选目录');
  if(!fs.statSync(file).isFile())throw new Error('备份包含无效文件');
  return file;
}
function validateData(data){
  const base=defaults();
  if(data?.version!==1)throw new Error('备份数据版本不支持');
  for(const key of ['drafts','assets','voices','avatars','brains','accounts','runs','publishRecords','categories','prompts'])if(!Array.isArray(data[key]))throw new Error('备份缺少有效的'+key+'记录');
  for(const key of ['drafts','assets','voices','avatars','brains','accounts','runs','prompts']){
    const ids=data[key].map(item=>item?.id);
    if(ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(id))||new Set(ids).size!==ids.length)throw new Error('备份中的记录ID无效或重复');
  }
  if(!data.drafts.length||!data.drafts.some(d=>d.id===data.currentId)||!data.prompts.length)throw new Error('备份缺少当前任务或提示词');
  for(const d of data.drafts){for(const k of ['sourceText','finalText','rewrite'])if(typeof d[k]!=='string')throw new Error('备份中的文案格式无效');for(const k of ['voice','video','edit','cover','publish'])if(!d[k]||typeof d[k]!=='object'||Array.isArray(d[k]))throw new Error('备份中的任务参数无效');if(!Array.isArray(d.edit.captions))throw new Error('备份中的字幕格式无效');}
  return {...base,...data};
}
class Backups{
  constructor(store,runtime){this.store=store;this.runtime=runtime;this.busy=false;}
  assertIdle(){if(this.runtime.controllers.size||this.store.data.runs.some(r=>r.type==='publish'&&['running','queued'].includes(r.status)))throw new Error('任务正在执行，请停止或等待完成后再备份或恢复');}
  async snapshot(prefix='backup'){
    const parent=path.join(this.store.root,'backups');fs.mkdirSync(parent,{recursive:true});
    const id=prefix+'-'+Date.now()+'-'+crypto.randomUUID().slice(0,8),temp=path.join(parent,'.'+id),target=path.join(parent,id);
    fs.mkdirSync(path.join(temp,'assets'),{recursive:true});
    try{
      const data=this.store.state(),files=[];
      for(const asset of data.assets){const source=this.store.asset(asset.id);const relative='assets/'+asset.id+path.extname(source.path);const dest=path.join(temp,relative);await fs.promises.copyFile(source.path,dest);files.push({id:asset.id,file:relative,size:fs.statSync(dest).size,sha256:await digest(dest)});}
      const stateFile=path.join(temp,'studio.json');fs.writeFileSync(stateFile,JSON.stringify(data,null,2));
      const manifest={format:'super-ip-studio-backup',version:1,createdAt:new Date().toISOString(),stateSha256:await digest(stateFile),files};
      fs.writeFileSync(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2));fs.renameSync(temp,target);
      return {directory:target,assets:files.length,note:'包含任务、素材和记录；不含API Key、软件程序及素材库以外的历史发布包。恢复时保留当前模型连接、密钥和媒体工具路径。'};
    }catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error;}
  }
  async backup(){if(this.busy)throw new Error('备份或恢复正在进行');this.assertIdle();this.busy=true;try{return await this.snapshot();}finally{this.busy=false;}}
  async restore(directory){
    if(this.busy)throw new Error('备份或恢复正在进行');this.assertIdle();
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('请选择备份文件夹的绝对路径');
    this.busy=true;const copied=[];let before;
    try{
      const manifest=JSON.parse(fs.readFileSync(childFile(directory,'manifest.json'),'utf8'));
      if(manifest.format!=='super-ip-studio-backup'||manifest.version!==1||!Array.isArray(manifest.files))throw new Error('不是受支持的任务与素材备份');
      const stateFile=childFile(directory,'studio.json');if(await digest(stateFile)!==manifest.stateSha256)throw new Error('备份业务数据校验失败，当前数据未更改');
      const data=validateData(JSON.parse(fs.readFileSync(stateFile,'utf8')));
      if(manifest.files.length!==data.assets.length)throw new Error('备份素材清单不完整');
      const media=new Map();
      for(const item of manifest.files){if(media.has(item.id))throw new Error('备份素材ID重复');const source=childFile(directory,item.file);if(fs.statSync(source).size!==item.size||await digest(source)!==item.sha256)throw new Error('备份素材校验失败：'+item.file);media.set(item.id,{source,item});}
      if(data.assets.some(a=>!media.has(a.id)))throw new Error('备份缺少素材文件');
      this.assertIdle();const safety=await this.snapshot('before-restore');
      for(const asset of data.assets){const {source}=media.get(asset.id);const dest=path.join(this.store.assetDir,crypto.randomUUID()+path.extname(source));await fs.promises.copyFile(source,dest);copied.push(dest);asset.path=dest;}
      // 保留本机连接设置，避免恢复其他服务地址后误用现有密钥。
      data.settings={...defaults().settings,...data.settings,provider:structuredClone(this.store.data.settings.provider),outputDir:this.store.data.settings.outputDir,ffmpegPath:this.store.data.settings.ffmpegPath,ffprobePath:this.store.data.settings.ffprobePath};
      for(const d of data.drafts){const base=createDraft();for(const k of ['voice','video','edit','cover','publish'])d[k]={...base[k],...d[k]};d.publish.recordId='';}
      for(const record of data.publishRecords){record.originalDirectory=record.directory;record.directory='';record.note='由备份恢复的历史导出记录，需重新导出发布包。';}
      before=this.store.data;this.store.data=data;this.store.recover();this.store.save();
      return {drafts:data.drafts.length,assets:data.assets.length,safetyDirectory:safety.directory,note:'恢复完成；旧素材文件与恢复前备份已保留，历史发布包需重新导出。'};
    }catch(error){if(before)this.store.data=before;for(const file of copied)fs.rmSync(file,{force:true});throw error;}finally{this.busy=false;}
  }
}
module.exports={Backups,digest,validateData};
