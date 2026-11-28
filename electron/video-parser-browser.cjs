const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {setTimeout:sleep}=require('node:timers/promises');

// 解析窗口使用独立持久化会话。Cookie 只在本次解析时导出到临时文件，解析结束立即删除。
const allowedHosts=['douyin.com','iesdouyin.com','snssdk.com','byteimg.com','ibytedtos.com','bytedance.com'];
function isAllowed(url){try{const parsed=new URL(url);return parsed.protocol==='https:'&&allowedHosts.some(host=>parsed.hostname===host||parsed.hostname.endsWith('.'+host));}catch{return false;}}
function isMediaUrl(url){try{const value=new URL(url);return value.protocol==='https:'&&['douyinvod.com','douyinpic.com'].some(host=>value.hostname===host||value.hostname.endsWith('.'+host))&&/media-audio|media-video|video_mp4|\/video\//.test(url);}catch{return false;}}
// 保留当前 Chromium 版本，仅去掉桌面应用标记，避免网页误走抖音客户端专属路由。
function webUserAgent(value){return String(value).replace(/\s+[^\s/]+\/[\w.\-]+(?=\s+Chrome\/)/,'').replace(/\s+Electron\/[^\s]+/g,'');}
// currentSrc能读取尚未下载完成的流媒体，避免只等onCompleted漏掉正在播放的资源。
const mediaSnapshot=`(()=>[...Array.from(document.querySelectorAll('video')).flatMap(video=>[video.currentSrc,video.src,...Array.from(video.querySelectorAll('source')).map(source=>source.src)]),...performance.getEntriesByType('resource').map(entry=>entry.name)].filter(value=>typeof value==='string'&&value.startsWith('https://')))()`;
function netscapeCookie(cookie){
  const domain=String(cookie.domain||'');
  const includeSubdomains=domain.startsWith('.')?'TRUE':'FALSE';
  const secure=cookie.secure?'TRUE':'FALSE';
  const expires=Number.isFinite(cookie.expirationDate)?Math.floor(cookie.expirationDate):0;
  return [domain,includeSubdomains,cookie.path||'/',secure,expires,cookie.name||'',cookie.value||''].join('\t');
}
function loadPage(window,url,{signal,timeoutMs=30000}={}){
  signal?.throwIfAborted();
  // 平台页面可能持续请求资源；正文可读取时就继续采集，并为加载和取消设置真实终止边界。
  return new Promise((resolve,reject)=>{
    const contents=window.webContents;let settled=false,timer;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);contents.removeListener('dom-ready',ready);contents.removeListener('destroyed',closed);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
    const stop=error=>{finish(error);if(!window.isDestroyed())contents.stop();};
    const ready=()=>finish(),closed=()=>finish(Error('解析窗口已关闭'));
    const abort=()=>stop(Error('本地链接提取已取消'));
    contents.once('dom-ready',ready);contents.once('destroyed',closed);signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>stop(Error('分享页面加载超过允许时限，请检查网络或平台验证后重试')),timeoutMs);
    if(signal?.aborted){abort();return;}
    try{Promise.resolve(window.loadURL(url)).then(()=>finish(),error=>finish(error));}catch(error){finish(error);}
  });
}
class VideoParserBrowser{
  constructor({BrowserWindow,parent,root}){this.BrowserWindow=BrowserWindow;this.parent=parent;this.root=root;this.window=null;this.generation=0;}
  async exclusive(work){if(this.occupied)throw Error('本地解析器正在处理另一条链接，请等待完成或停止后重试');this.occupied=true;try{return await work();}finally{this.occupied=false;}}
  async collectProfile(url,{signal,timeoutMs=30000,pollMs=500,scope='sample',onPage,maxPages=300,maxPosts=10000,maxDurationMs=300000,stagnantMs=12000}={}){
    return this.exclusive(async()=>{
      if(!isAllowed(url))throw Error('本地账号采集目前支持抖音公开主页，其他平台可配置采集接口或导入样本');
      signal?.throwIfAborted();await this.open({silent:true});const win=this.window,generation=++this.generation;
      const {profileSnapshot,normalizeProfile,scrollProfile,profileDiscovery}=require('./douyin-profile.cjs');
      const check=()=>{signal?.throwIfAborted();if(win.isDestroyed()||this.window!==win||generation!==this.generation)throw Error('解析窗口已关闭');};
      const evaluate=fn=>{check();return new Promise((resolve,reject)=>{
        let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
        const abort=()=>finish(signal.reason||Error('本地账号采集已取消'));const timer=setTimeout(()=>finish(Error('账号页面读取超时，已停止本次采集')),10000);
        signal?.addEventListener('abort',abort,{once:true});
        try{Promise.resolve(win.webContents.executeJavaScript('('+fn.toString()+')()')).then(result=>finish(null,result),error=>finish(error));}catch(error){finish(error);}
      });};
      await loadPage(win,url,{signal,timeoutMs});const started=Date.now(),deadline=started+timeoutMs;let lastError,profile;
      do{
        const snapshot=await evaluate(profileSnapshot);check();
        try{profile=normalizeProfile(snapshot,url,{includeNotes:scope==='all',allowEmpty:scope==='all'});if(profile.posts.length||profile.endMarker||profile.loginLimited||profile.verificationRequired)break;profile=null;}catch(error){lastError=error;}
        await sleep(pollMs,undefined,{signal});
      }while(Date.now()<deadline);
      if(!profile)throw lastError||Error('未读取到账号公开作品');
      if(scope!=='all')return profile;
      const bounded=(value,fallback,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.trunc(value))):fallback;
      const pageLimit=bounded(maxPages,300,1,1000),postLimit=bounded(maxPosts,10000,1,20000),durationLimit=bounded(maxDurationMs,300000,1,600000),stallLimit=bounded(stagnantMs,12000,1,60000);
      const posts=new Map(),omitted=new Map();let pages=0,lastGrowth=Date.now(),firstCount=null,countChanged=false,lastEmitted=-1,capped=false,loginLimited=false;
      const publish=async(reasonCode,reason,complete=false)=>{
        check();const result=profileDiscovery({...profile,posts:[...posts.values()],omitted:[...omitted.values()]},{pages,reasonCode,reason,complete,omittedCount:omitted.size+(profile.unlinkedCount||0),countChanged});
        if(onPage)await onPage(result);check();return result;
      };
      while(true){
        check();pages++;const before=posts.size;
        for(const post of profile.posts){if(posts.size>=postLimit&&!posts.has(post.id)){capped=true;continue;}posts.set(post.id,post);omitted.delete(post.id);}
        for(const row of profile.omitted||[])if(!posts.has(row.id))omitted.set(row.id,row);
        if(posts.size>before)lastGrowth=Date.now();
        if(profile.reportedCount!==null){if(firstCount===null)firstCount=profile.reportedCount;else if(firstCount!==profile.reportedCount)countChanged=true;}
        loginLimited=profile.loginLimited;
        const hasOmissions=omitted.size>0||profile.unlinkedCount>0;
        if(profile.verificationRequired)return publish('verification_required','平台要求安全验证，已保留可读取作品，账号尚未完整解析');
        if(capped)return publish('post_limit','本次发现作品达到安全数量上限，已保存已发现部分，尚未完整');
        // 数字相等也必须没有作者归属遗漏或隐藏卡片；停滞绝不等于账号已经采完。
        const countReached=profile.reportedCount!==null&&profile.reportedCount>0&&posts.size===profile.reportedCount;
        if((countReached||profile.endMarker)&&!hasOmissions&&!loginLimited){
          if(countChanged)return publish('count_changed','采集期间账号作品数量发生变化，已保留结果，需要继续核对');
          if(profile.reportedCount!==null&&posts.size!==profile.reportedCount)return publish('count_mismatch','页面显示已到末尾，但已发现数量与账号作品数不一致，需要继续核对');
          return publish(profile.endMarker?'end_marker':'reported_count',profile.endMarker?'作品区域明确显示末尾，已发现全部公开作品':'已发现数量与账号明确显示的作品总数一致',true);
        }
        if(profile.endMarker&&loginLimited)return publish('login_required','平台提示登录后查看更多作品，已保留公开可读取部分');
        if(profile.endMarker&&hasOmissions)return publish('omitted_posts','作品区域已到末尾，但有无法核对或读取的作品，未标记完整');
        if(posts.size>=postLimit)return publish('post_limit','本次发现作品达到安全数量上限，已保存已发现部分，尚未完整');
        if(pages>=pageLimit)return publish('page_limit','本次达到安全翻页上限，已保存已发现部分，尚未完整');
        if(Date.now()-started>=durationLimit)return publish('time_limit','本次发现作品达到时间预算，已保存已发现部分，尚未完整');
        if(Date.now()-lastGrowth>=stallLimit)return publish(loginLimited?'login_required':countChanged?'count_changed':'stalled',loginLimited?'平台提示登录后查看更多作品，滚动已无新增，已保留公开可读取部分':countChanged?'采集期间账号作品数量发生变化，已保留结果，需要继续核对':'页面暂未继续返回作品，不能确认已到账号末尾，已保存已发现部分');
        if(lastEmitted!==posts.size){await publish('collecting','正在发现账号公开作品');lastEmitted=posts.size;}
        try{await evaluate(scrollProfile);}catch(error){check();return publish('page_unavailable','后续作品页无法滚动：'+error.message);}await sleep(pollMs,undefined,{signal});
        let next;
        try{next=normalizeProfile(await evaluate(profileSnapshot),profile.url,{includeNotes:true,allowEmpty:true});}
        catch(error){check();return publish('page_unavailable','后续作品页无法核对：'+error.message);}
        check();profile={...next,reportedCount:next.reportedCount??profile.reportedCount};
      }
    });
  }
  async open({silent=false}={}){
    if(this.window&&!this.window.isDestroyed()){if(!silent){this.window.show();this.window.focus();}return this.status();}
    const window=new this.BrowserWindow({width:1180,height:860,minWidth:980,minHeight:680,title:'抖音视频解析 · 浏览器会话',show:false,parent:this.parent(),webPreferences:{partition:'persist:studio-douyin-parser',contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    if(window.webContents.getUserAgent&&window.webContents.setUserAgent)window.webContents.setUserAgent(webUserAgent(window.webContents.getUserAgent()));
    const session=window.webContents.session;
    // Chromium 页面可通过 openExternal 权限直接请求系统协议，必须显式拒绝。
    session.setPermissionCheckHandler((_contents,permission)=>permission!=='openExternal');
    session.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission!=='openExternal'));
    // 解析窗口只负责读取媒体资源，禁止页面音频进入系统输出，保持静默提取。
    window.webContents.setAudioMuted(true);
    const blockUnsafeNavigation=event=>{try{if(!isAllowed(event.url))event.preventDefault();}catch{event.preventDefault();}};
    // 分享链接可能先返回 HTTPS 页面，再通过重定向或子帧尝试唤起系统协议。
    window.webContents.on('will-navigate',blockUnsafeNavigation);
    window.webContents.on('will-redirect',blockUnsafeNavigation);
    window.webContents.on('will-frame-navigate',blockUnsafeNavigation);
    window.on('closed',()=>{if(this.window===window){this.window=null;this.generation++;}});
    this.window=window;
    try{
      // 静默模式直接等待后续分享链接，避免先加载首页被重定向或拦截导致整条任务卡住。
      if(!silent){await loadPage(window,'https://www.douyin.com/',{timeoutMs:15000});window.show();window.focus();}
      return this.status();
    }
    catch(error){if(!window.isDestroyed())window.close();throw Error('抖音解析窗口打开失败：'+error.message);}
  }
  status(){return {open:!!(this.window&&!this.window.isDestroyed()),url:this.window&&!this.window.isDestroyed()?this.window.webContents.getURL():'',message:'请在解析窗口完成抖音验证或登录后重试'};}
  close(){if(this.window&&!this.window.isDestroyed())this.window.close();return true;}
  async cookieFile(){
    if(!this.window||this.window.isDestroyed())throw Error('请先打开抖音解析窗口并完成验证');
    const cookies=await this.window.webContents.session.cookies.get({});
    const usable=cookies.filter(cookie=>allowedHosts.some(host=>String(cookie.domain||'').replace(/^\./,'')===host||String(cookie.domain||'').endsWith('.'+host)));
    if(!usable.length)return '';
    const file=path.join(this.root,'.browser-session-'+crypto.randomUUID()+'.txt');
    fs.writeFileSync(file,['# Netscape HTTP Cookie File','# 此文件由本地解析临时生成，任务结束后删除',...usable.map(netscapeCookie),''].join('\n'),{mode:0o600});
    return file;
  }
  async prepare(url,{signal,mediaTimeoutMs=30000,pollMs=500,preferVideo=false,expectedProfileId=''}={}){
    if(!this.window||this.window.isDestroyed())throw Error('请先打开抖音解析窗口并完成验证');
    if(!isAllowed(url))throw Error('解析窗口只允许访问抖音及其媒体域名');
    const current=this.window,session=current.webContents.session,captured=[];
    const generation=++this.generation;
    const filter={urls:['*://*/*']},onCompleted=details=>{if(isMediaUrl(details.url))captured.push(details.url);};
    session.webRequest.onCompleted(filter,onCompleted);
    let observed=[],firstMediaAt=0,identity;
    try{await loadPage(current,url,{signal});const deadline=Date.now()+mediaTimeoutMs;
      do{signal?.throwIfAborted();if(current.isDestroyed()||this.window!==current||generation!==this.generation)throw Error('解析窗口已关闭');const snapshot=await current.webContents.executeJavaScript(mediaSnapshot);observed=(Array.isArray(snapshot)?snapshot:[]).filter(isMediaUrl);const found=[...observed,...captured];if(found.length){firstMediaAt||=Date.now();const split=found.some(url=>/media-video|media-audio/.test(url)),paired=found.some(url=>/media-video/.test(url))&&found.some(url=>/media-audio/.test(url));if(!preferVideo||!split||paired||Date.now()-firstMediaAt>=3000)break;}await sleep(pollMs,undefined,{signal});}while(Date.now()<deadline);
    }catch(error){if(signal?.aborted)throw Error('本地链接提取已取消');throw Error('抖音分享页加载失败：'+error.message);}finally{session.webRequest.onCompleted(filter,null);}
    if(!this.window||this.window!==current||generation!==this.generation||current.isDestroyed())throw Error('解析窗口已关闭，请重新打开后重试');
    if(expectedProfileId){
      const {identitySnapshot,verifyIdentity,videoId}=require('./douyin-profile.cjs');
      let snapshot,lastError;const deadline=Date.now()+5000;
      // 作者区域可能晚于播放器渲染，短暂等待真实作者信息，仍不放宽归属校验。
      do{signal?.throwIfAborted();if(current.isDestroyed()||this.window!==current||generation!==this.generation)throw Error('解析窗口已关闭');snapshot=await current.webContents.executeJavaScript('('+identitySnapshot.toString()+')()');try{identity=verifyIdentity(snapshot,expectedProfileId,url);break;}catch(error){lastError=error;}await sleep(pollMs,undefined,{signal});}while(Date.now()<deadline);
      if(!identity)throw lastError;
      // 账号学习只接受当前作品播放器的媒体，不能混入预加载的下一条推荐。
      observed=(snapshot.media||[]).filter(isMediaUrl).filter(value=>{const vid=new URL(value).searchParams.get('__vid');return !vid||vid===videoId(url);});
      captured.length=0;
      if(!observed.length)throw Error('目标账号作品尚未提供可读取的播放器媒体，未使用推荐视频');
    }
    return {url:current.webContents.getURL(),title:await current.webContents.getTitle(),mediaUrls:[...new Set([...observed,...captured])],...(identity?{identity}:{}),cookieFile:await this.cookieFile()};
  }
  async downloadMedia(url,target,{signal}={}){
    if(!this.window||this.window.isDestroyed())throw Error('解析窗口已关闭，请重新打开后重试');
    if(typeof url!=='string'||!/^https:\/\//.test(url))throw Error('浏览器未发现可下载的真实媒体地址');
    const userAgent=this.window.webContents.getUserAgent().replace(/[^\x00-\x7F]/g,'');
    const downloadSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000);
    const response=await fetch(url,{headers:{Referer:this.window.webContents.getURL()||'https://www.douyin.com/','User-Agent':userAgent},signal:downloadSignal});
    if(!response.ok||!response.body)throw Error('浏览器媒体下载失败：HTTP '+response.status);
    await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(target),{signal:downloadSignal});
    return target;
  }
  async withSession(url,work,options={}){
    return this.exclusive(async()=>{const prepared=await this.prepare(url,options);
      try{return await work(prepared);}finally{if(prepared.cookieFile)fs.rmSync(prepared.cookieFile,{force:true});}});
  }
}
module.exports={VideoParserBrowser,isAllowed,isMediaUrl,loadPage,webUserAgent};
