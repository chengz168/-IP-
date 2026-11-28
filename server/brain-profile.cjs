const {transcript}=require('./reference-source.cjs');
const {digest}=require('./materials.cjs');
const limits={shallow:3,deep:6};
const limitation='仅学习本次公开可读作品的音轨文案，不覆盖账号全部历史作品，也未分析视频画面；语音转写可能有错字。';
const captionLimitation='仅学习作者在作品卡片公开发布的标题与配文，不是视频口播转写、字幕或画面分析，也不代表全部历史作品。';
class BrainProfile{
 constructor(service){this.service=service;}
 configuration(){return this.service.brains.video.configuration();}
 async cached(post,configuration,ctx,lock){
  const runs=this.service.store.data.runs.filter(r=>r.type==='brain-study'&&['succeeded','failed','cancelled'].includes(r.status));
  for(const run of runs){const collected=run.output?.evidence?.profileCollection||run.failureOutput?.profileCollection;
   if(collected?.configuration!==configuration)continue;
   const source=collected.samples?.find(s=>s.url===post.url&&s.media?.identity?.profileId===post.profileId);
   if(!source?.assetId||!source.media?.sha256)continue;
   try{lock(source.assetId);const value=await this.service.references.source.validate(source.assetId,ctx);
    if(value.sha256!==source.media.sha256)continue;
    transcript(source.media.transcription,value.duration);return {...structuredClone(source),reusedRunId:run.id};
   }catch(error){ctx.signal.throwIfAborted();}
  }return null;
 }
 async collect(id,url,mode,ctx,evidence,basis='audio'){
  if(!['audio','caption'].includes(basis))throw Error('账号学习内容类型无效');
  const {profileBrowser,store}=this.service;if(!profileBrowser?.collectProfile)throw Error(require('./share-link.mjs').brainCollectionUnavailable);
  const owned=new Set(),lock=assetId=>{if(!owned.has(assetId)){owned.add(assetId);this.service.references.source.lock(assetId);}},release=()=>{for(const assetId of owned)this.service.references.source.unlock(assetId);owned.clear();};
  const configuration=this.configuration(),requestedCount=limits[mode];
  try{
   ctx.progress(3,'正在后台读取账号公开作品');const profile=await profileBrowser.collectProfile(url,{signal:ctx.signal});
   const collection={profile:{...profile,posts:undefined},configuration,requestedCount,attemptedCount:0,samples:[],failed:[],basis,limitation:basis==='caption'?captionLimitation:limitation,complete:false};evidence.profileCollection=collection;
   // 重试时优先复用成功样本并尝试尚未采集的作品；之前失败的排在后面，避免连续重复推理。
   const previous=store.data.runs.filter(r=>r.type==='brain-study'&&(r.failureOutput?.profileCollection?.basis||'audio')===basis&&r.failureOutput?.profileCollection?.profile?.id===profile.id&&r.failureOutput.profileCollection.configuration===configuration).slice(0,10);
   const failedBefore=new Set(previous.flatMap(run=>run.failureOutput.profileCollection.failed?.map(row=>row.url)||[]));
   const candidates=[...profile.posts.filter(post=>!failedBefore.has(post.url)),...profile.posts.filter(post=>failedBefore.has(post.url))].slice(0,requestedCount+2);
   collection.selection='公开作品顺序；重试优先成功缓存和未采集作品';collection.selectedUrls=candidates.map(post=>post.url);
   for(const [index,post] of candidates.entries()){
    ctx.signal.throwIfAborted();if(collection.samples.length>=requestedCount)break;
    collection.attemptedCount++;ctx.progress(8+index/candidates.length*58,`正在提取账号作品 ${collection.attemptedCount}，已取得 ${collection.samples.length}/${requestedCount} 条文案`);
    try{
     if(basis==='caption'){
      const published=String(post.caption||'').trim();if(published.length<20)throw Error('公开发布文案不足20字，已跳过');
      collection.samples.push({title:post.title,text:published,url:post.url,kind:'profile-caption',publication:{profileId:profile.id,author:profile.name,observedAt:profile.observedAt,basis:'public-profile-post-list',truncated:post.captionTruncated===true}});continue;
     }
     let source=await this.cached(post,configuration,ctx,lock);
     if(!source){
      const stepCtx={...ctx,progress:(_value,message)=>{if(message)ctx.progress(8+index/candidates.length*58,`作品 ${index+1}：${message}`);},onReferenceAsset:lock};
      const result=await this.service.extractReferenceSource({id,sourceUrl:post.url,profileIdentity:profile.id},stepCtx),media=result?.linkSource;
      if(!media?.assetId||!media.sha256||media.identity?.profileId!==profile.id||media.identity.videoId!==post.id)throw Error('作品缺少媒体来源或作者校验证据');
      lock(media.assetId);const value=await this.service.references.source.validate(media.assetId,ctx);
      if(value.sha256!==media.sha256)throw Error('作品源文件在转写期间变化');
      const transcription=transcript(result,value.duration);
      if(transcription.text.length<20)throw Error('音轨未识别到至少20字有效文案，已跳过');
      source={title:post.title,text:transcription.text,url:post.url,kind:'profile-video',assetId:media.assetId,media:{sha256:media.sha256,duration:value.duration,identity:media.identity,transcription}};
     }
     collection.samples.push(source);
    }catch(error){ctx.signal.throwIfAborted();if(error.unknown)throw error;collection.failed.push({url:post.url,title:post.title,error:error.message});}
   }
   ctx.signal.throwIfAborted();collection.successCount=collection.samples.length;collection.complete=collection.successCount===requestedCount;collection.completedAt=new Date().toISOString();
   const sample=collection.samples.map(s=>s.text).join('\n\n');
   if(sample.length<80)throw Error(`已读取账号“${profile.name}”，但有效文案不足80字（成功${collection.samples.length}条，失败${collection.failed.length}条）。${collection.failed[0]?.error||'可导入本地文案或视频样本继续'}。未保存已学习档案。`);
   if(sample.length>30000)throw Error('作品样本超过30000字，请改用浅度学习或导入精简样本');
   return {name:profile.name,url:profile.url,sample,sources:collection.samples,collection,configuration,release};
  }catch(error){release();throw error;}
 }
 async unchanged(collected,ctx){
  if(this.configuration()!==collected.configuration)return false;
  for(const source of collected.sources){ctx.signal.throwIfAborted();if(source.kind==='profile-caption')continue;try{const asset=this.service.store.asset(source.assetId);if(await digest(asset.path,ctx.signal)!==source.media.sha256)return false;}catch{ctx.signal.throwIfAborted();return false;}}
  return true;
 }
}
module.exports={BrainProfile,limits,limitation};
