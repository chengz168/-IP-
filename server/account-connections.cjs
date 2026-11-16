// 登录状态只来自独立平台窗口的实际观察，账号元数据不能伪造连接状态。
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const platform={name:'抖音',key:'douyin',loginUrl:'https://creator.douyin.com/',creatorUrl:'https://creator.douyin.com/creator-micro/content/upload'};
function sessionKey(root,id){const absolute=path.resolve(root);return 'persist:studio-account-'+crypto.createHash('sha256').update((process.platform==='win32'?absolute.toLowerCase():absolute)+'\0'+id).digest('hex');}
function fileIdentity(file){const stat=fs.statSync(file);if(!stat.isFile()||stat.size<=0)throw Error('发布素材文件为空或无效');return JSON.stringify([stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino]);}
function accountIdentity(account){return JSON.stringify([account.id,account.name,account.platform,account.displayName]);}
function connectionVerdict(observed){
 let url;try{url=new URL(observed.url);}catch{return {status:'needs_check',message:'平台页面尚未就绪'};}
 if(url.protocol!=='https:'||url.hostname!=='creator.douyin.com')return {status:'needs_check',message:'尚未进入抖音创作者页面'};
 if(observed.loginVisible)return {status:'needs_login',message:'请在平台窗口完成登录'};
 if(url.pathname.startsWith('/creator-micro/')&&observed.creatorControlVisible===true)return {status:'connected',message:'已确认抖音创作者页面可用'};
 return {status:'needs_check',message:'尚未取得登录完成依据，请等待页面加载后检查'};
}
class AccountConnections{
 constructor(store,browser,media){this.store=store;this.browser=browser;this.media=media;this.observations=new Map();this.generations=new Map();this.pending=new Set();}
 account(id){const account=this.store.data.accounts.find(a=>a.id===id);if(!account)throw Error('账号不存在');return account;}
 publicState(){return this.store.data.accounts.map(({id,name,platform,displayName,createdAt})=>({id,name,platform,displayName,createdAt,connection:this.observations.get(id)||{status:'unconnected',message:platform==='抖音'?'请登录并检查平台连接':'该平台连接尚未接入'}}));}
 save(item){
  if(typeof item?.name!=='string'||!item.name.trim())throw Error('请填写账号名称');
  if(!['抖音','快手','小红书','视频号','哔哩哔哩'].includes(item.platform))throw Error('平台类型无效');
  const old=this.store.data.accounts.find(a=>a.id===item.id);if(item.id&&!old)throw Error('账号不存在');
  const value={id:old?.id||crypto.randomUUID(),name:item.name.trim().slice(0,30),platform:item.platform,displayName:String(item.displayName||'').trim().slice(0,30),createdAt:old?.createdAt||new Date().toISOString()};
  const before=this.store.data.accounts;this.store.data.accounts=old?before.map(a=>a.id===old.id?value:a):[...before,value];
  try{this.store.save();}catch(error){this.store.data.accounts=before;throw error;}
  if(old&&old.platform!==value.platform)this.close(value.id);return value;
 }
 async open(id){
  const account=this.account(id);if(account.platform!==platform.name)throw Error('当前仅接入抖音本地登录，所选平台尚未接入');
  if(!this.browser)throw Error('请在桌面工作台打开平台登录窗口');
  if(this.pending.has(id))throw Error('此账号连接正在检查，请稍候');
  this.pending.add(id);
  const generation=(this.generations.get(id)||0)+1;this.generations.set(id,generation);
  this.observations.set(id,{status:'waiting_login',message:'请在平台窗口登录，再点击检查连接'});
  try{await this.browser.open({id,partition:sessionKey(this.store.root,id),url:platform.loginUrl,title:account.displayName||account.name,onClose:()=>{if(this.generations.get(id)===generation){this.generations.set(id,generation+1);this.observations.set(id,{status:'needs_check',message:'平台窗口已关闭，请重新检查连接'});}}});}
  catch(error){if(this.generations.get(id)===generation)this.observations.set(id,{status:'failed',message:'平台窗口打开失败，请重试'});throw error;}
  finally{this.pending.delete(id);}
  return this.publicState().find(a=>a.id===id);
 }
 async check(id){
  const account=this.account(id);if(account.platform!==platform.name)throw Error('所选平台连接尚未接入');if(!this.browser)throw Error('请在桌面工作台检查平台连接');if(this.pending.has(id))throw Error('此账号连接正在检查，请稍候');
  this.pending.add(id);const generation=this.generations.get(id)||0;
  try{const observed=await this.browser.inspect(id);if(!this.store.data.accounts.some(a=>a.id===id&&a.platform===account.platform)||(this.generations.get(id)||0)!==generation)throw Error('账号或登录窗口已变化，请重新检查');
   const verdict={...connectionVerdict(observed),observedAt:new Date().toISOString()};this.observations.set(id,verdict);return {...account,connection:verdict};
  }catch(error){if((this.generations.get(id)||0)===generation)this.observations.set(id,{status:'needs_check',message:'未取得平台连接依据，请打开登录窗口后检查'});throw error;}
  finally{this.pending.delete(id);}
 }
 close(id){this.generations.set(id,(this.generations.get(id)||0)+1);this.browser?.close(id);this.observations.delete(id);return true;}
 async prepare(id){
  const draft=structuredClone(this.store.draft(id)),signature=JSON.stringify(draft.publish),video=this.store.asset(draft.publish.videoId||draft.edit.resultId||draft.video.assetId),coverId=draft.publish.coverId||draft.cover.assetId;
  if(video.type!=='video')throw Error('请选择有效发布视频');if(!draft.publish.title?.trim())throw Error('请填写发布标题');if(!['draft','direct'].includes(draft.publish.mode))throw Error('发布方式无效');
  const ids=draft.publish.accountIds;if(!Array.isArray(ids)||!ids.length)throw Error('请先选择发布账号');if(new Set(ids).size!==ids.length)throw Error('发布账号重复');
  const accounts=[],identities=new Map();for(const accountId of ids){const checked=await this.check(accountId);if(checked.connection.status!=='connected')throw Error(checked.name+'：'+checked.connection.message);identities.set(accountId,{identity:accountIdentity(checked),generation:this.generations.get(accountId)||0});accounts.push({id:checked.id,name:checked.name,platform:checked.platform,checkedAt:checked.connection.observedAt});}
  const cover=coverId?this.store.asset(coverId):null;if(cover&&cover.type!=='image')throw Error('请选择有效发布封面');
  if(!this.media)throw Error('媒体检查服务不可用');const videoIdentity=fileIdentity(video.path),coverIdentity=cover?fileIdentity(cover.path):null;const probe=await this.media.probe(video.path);if(!probe.streams?.some(s=>s.codec_type==='video')||!Number.isFinite(Number(probe.format?.duration))||!(Number(probe.format?.duration)>0))throw Error('所选视频未包含有效视频流或时长');
  if(cover){const picture=await this.media.probe(cover.path);if(!picture.streams?.some(s=>s.codec_type==='video'))throw Error('封面无法解码');}
  const current=this.store.draft(id);if(JSON.stringify(current.publish)!==signature||(current.publish.videoId||current.edit.resultId||current.video.assetId)!==video.id||(current.publish.coverId||current.cover.assetId)!==coverId)throw Error('发布内容已变化，请重新检查');
  if(fileIdentity(video.path)!==videoIdentity||(cover&&fileIdentity(cover.path)!==coverIdentity))throw Error('发布素材文件已变化，请重新检查');
  for(const [accountId,before]of identities){if(!this.store.data.accounts.some(a=>a.id===accountId&&accountIdentity(a)===before.identity)||(this.generations.get(accountId)||0)!==before.generation||this.observations.get(accountId)?.status!=='connected')throw Error('账号连接已变化，请重新检查');}
  return {draftId:id,title:draft.publish.title,description:draft.publish.description,tags:draft.publish.tags,mode:draft.publish.mode,video:{id:video.id,name:video.name,size:video.size,duration:Number(probe.format.duration)},cover:cover?{id:cover.id,name:cover.name}:null,accounts,uploadEnabled:false,uploaded:false,message:'发布前检查通过；当前尚未启用上传，本次没有上传或发布内容。'};
 }
}
module.exports={AccountConnections,sessionKey,connectionVerdict,platform};
