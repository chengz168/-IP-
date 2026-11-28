const {transcript}=require('./reference-source.cjs');
const {digest}=require('./materials.cjs');
const limits={shallow:3,deep:6};
const limitation='仅学习本次公开可读作品的音轨文案，不覆盖账号全部历史作品，也未分析视频画面；语音转写可能有错字。';
const captionLimitation='仅学习作者在作品卡片公开发布的标题与配文，不是视频口播转写、字幕或画面分析，也不代表全部历史作品。';
const collectionOf=run=>run.output?.evidence?.profileCollection||run.failureOutput?.profileCollection||run.checkpoint?.profileCollection;
const history=store=>store.data.runs.filter(run=>run.type==='brain-study'&&!['running','queued','unknown'].includes(run.status));
class BrainProfile{
 constructor(service){this.service=service;}
 configuration(){return this.service.brains.video.configuration();}
 async cached(post,configuration,ctx,lock){
  const runs=history(this.service.store);
  for(const run of runs){const collected=collectionOf(run);
   if(collected?.configuration!==configuration)continue;
   const source=collected.samples?.find(s=>s.url===post.url&&s.media?.identity?.profileId===post.profileId);
   if(!source?.assetId||!source.media?.sha256)continue;
   try{lock(source.assetId);const value=await this.service.references.source.validate(source.assetId,ctx);
    if(value.sha256!==source.media.sha256)continue;
    transcript(source.media.transcription,value.duration);return {...structuredClone(source),reusedRunId:run.id};
   }catch(error){ctx.signal.throwIfAborted();}
  }return null;
 }
 async collect(id,url,mode,ctx,evidence,basis='audio',scope='sample'){
  if(!['audio','caption'].includes(basis))throw Error('账号学习内容类型无效');
  if(!['sample','all'].includes(scope))throw Error('账号采集范围无效');
  const {profileBrowser,store}=this.service;if(!profileBrowser?.collectProfile)throw Error(require('./share-link.mjs').brainCollectionUnavailable);
  const owned=new Set(),lock=assetId=>{if(!owned.has(assetId)){owned.add(assetId);this.service.references.source.lock(assetId);}},release=()=>{for(const assetId of owned)this.service.references.source.unlock(assetId);owned.clear();};
  const configuration=this.configuration(),requestedCount=limits[mode];
  const collection={configuration,scope,requestedCount:scope==='all'?0:requestedCount,attemptedCount:0,samples:[],failed:[],basis,limitation:basis==='caption'?captionLimitation:limitation,complete:false,analysisComplete:false,phase:'discovering'};evidence.profileCollection=collection;
  const checkpoint=()=>ctx.checkpoint?.({profileCollection:collection});
  try{
   ctx.progress(3,'正在后台读取账号公开作品');const profile=await profileBrowser.collectProfile(url,{signal:ctx.signal,scope,onPage:page=>{collection.profile={...page,posts:undefined};collection.discovery=page.discovery;collection.discoveredPosts=page.posts;checkpoint();ctx.progress(5,`已发现 ${page.posts.length} 条公开作品，正在核对后续页面`);}});
   collection.profile={...profile,posts:undefined};collection.discovery=profile.discovery;collection.discoveredPosts=profile.posts;
   let posts=profile.posts;
   if(scope==='all'){
    // 受限重试仍保留同账号此前已发现的作品；旧记录不会成为本次全量完成的证明。
    const previous=history(store).map(collectionOf).filter(c=>c?.scope==='all'&&c.profile?.id===profile.id&&c.configuration===configuration&&c.basis===basis);
    const merged=new Map(posts.map(post=>[post.url,post]));
    if(!profile.discovery?.complete)for(const old of previous)for(const post of old.discoveredPosts||[])if(post.profileId===profile.id&&!merged.has(post.url))merged.set(post.url,{...post,previouslyDiscovered:true});
    posts=[...merged.values()];collection.discoveredPosts=posts;collection.previousDiscoveryCount=posts.filter(p=>p.previouslyDiscovered).length;collection.requestedCount=posts.length;
    collection.limitation=(basis==='caption'?'只分析实际读取的标题与配文，不是视频口播、字幕或画面分析。':'只分析实际提取的音轨文案，未分析视频画面，语音转写可能有错字。')+'全量仅指可访问的公开作品；受限、未读到末尾或有提取失败时不能代表整账号完成。';
   }
   collection.phase='extracting';checkpoint();
   // 重试时优先复用成功样本并尝试尚未采集的作品；之前失败的排在后面，避免连续重复推理。
   const previous=history(store).map(collectionOf).filter(c=>c?.basis===basis&&c.profile?.id===profile.id&&c.configuration===configuration).slice(0,10);
   const failedBefore=new Set(previous.flatMap(c=>c.failed?.map(row=>row.url)||[]));
   const candidates=scope==='all'?posts:[...posts.filter(post=>!failedBefore.has(post.url)),...posts.filter(post=>failedBefore.has(post.url))].slice(0,requestedCount+2);
   collection.selection='公开作品顺序；重试优先成功缓存和未采集作品';collection.selectedUrls=candidates.map(post=>post.url);
   for(const [index,post] of candidates.entries()){
    // 发布文案处理没有网络等待，逐条让出事件循环，保证界面与停止请求能及时响应。
    await new Promise(resolve=>setImmediate(resolve));
    ctx.signal.throwIfAborted();if(scope!=='all'&&collection.samples.length>=requestedCount)break;
    collection.attemptedCount++;ctx.progress(8+index/candidates.length*58,`正在提取账号作品 ${collection.attemptedCount}/${candidates.length}，已取得 ${collection.samples.length} 条文案`);
    try{
     if(basis==='caption'){
      const published=String(post.caption||'').trim();if(published.length<(scope==='all'?1:20))throw Error(scope==='all'?'该作品没有公开发布文案':'公开发布文案不足20字，已跳过');
      if(scope==='all'&&post.captionTruncated)throw Error('该作品发布文案被页面截断，未作为完整文案接受');
      const reused=history(store).find(run=>{const c=collectionOf(run);return c?.basis==='caption'&&c.profile?.id===profile.id&&c.samples?.some(s=>s.url===post.url&&s.text===published);});
      collection.samples.push({title:post.title,text:published,url:post.url,kind:'profile-caption',...(reused?{reusedRunId:reused.id}:{}),publication:{profileId:profile.id,author:profile.name,observedAt:profile.observedAt,basis:'public-profile-post-list',truncated:post.captionTruncated===true,...(post.previouslyDiscovered?{previouslyDiscovered:true}:{})}});continue;
     }
     if(post.kind==='note')throw Error('图文作品没有可核验的视频音轨，可选择发布文案分析');
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
    finally{collection.successCount=collection.samples.length;checkpoint();}
   }
   ctx.signal.throwIfAborted();collection.successCount=collection.samples.length;collection.complete=scope==='all'?profile.discovery?.complete===true&&collection.successCount===posts.length&&collection.failed.length===0:collection.successCount===requestedCount;collection.completedAt=new Date().toISOString();collection.phase='analyzing';checkpoint();
   const sample=collection.samples.map(s=>s.text).join('\n\n');
   if(sample.length<80)throw Error(`已读取账号“${profile.name}”，但有效文案不足80字（成功${collection.samples.length}条，失败${collection.failed.length}条）。${collection.failed[0]?.error||'可导入本地文案或视频样本继续'}。未保存已学习档案。`);
   if(scope!=='all'&&sample.length>30000)throw Error('作品样本超过30000字，请改用浅度学习或全部公开作品的分批分析');
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
