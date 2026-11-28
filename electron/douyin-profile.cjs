// 只读取账号“作品”区域，排除喜欢、推荐和页脚热门链接。页面标题不作为口播正文。
function profileSnapshot(){
 const root=document.querySelector('[data-e2e="user-detail"]');
 const name=root?.querySelector('[data-e2e="user-info"] h1')?.textContent?.trim()||'';
 const list=root?.querySelector('[data-e2e="user-post-list"]');
 const visible=node=>!!node&&node.getClientRects().length>0;
 let totalText='',totalConfirmed=false;
 // 只认“作品”页签的计数，不把粉丝、喜欢或缩写数量当作精确作品数。
 for(const count of root?.querySelectorAll('[data-e2e="user-tab-count"]')||[]){
  for(let node=count.parentElement,depth=0;node&&depth<3;node=node.parentElement,depth++){
   const text=(node.textContent||'').replace(/\s+/g,'');
   if(/^作品[\d,.万亿wWkK]+$/.test(text)){totalText=count.textContent?.trim()||'';totalConfirmed=true;break;}
   if(text.length>40)break;
  }
  if(totalConfirmed)break;
 }
 const endPattern=/^(?:没有更多了|暂时没有更多了|没有更多作品了?|暂无更多作品|已显示全部作品|暂时没有作品|暂无作品|还没有作品)[。！!]?$/;
 let endMarker='';
 // 结束提示必须位于作品列表末尾并独立显示，作品配文中的同一句话不能充当结束证据。
 const candidates=[...(list?.querySelectorAll('div,span,p')||[])];
 for(let next=list?.nextElementSibling,depth=0;next&&depth<3;next=next.nextElementSibling,depth++){candidates.push(next,...next.querySelectorAll('div,span,p'));}
 for(const node of candidates){if(!visible(node)||node.closest('li,a')||node.querySelector('a[href]'))continue;const text=(node.innerText||'').trim();if(endPattern.test(text)){endMarker=text;break;}}
 const dialogs=[...document.querySelectorAll('[role="dialog"], [id*="captcha"], [class*="captcha"]')].filter(visible);
 const verificationRequired=dialogs.some(node=>/请完成验证|拖动滑块|安全验证|验证码/.test(node.innerText||''));
 const items=[...(list?.querySelectorAll('[data-e2e="scroll-list"] > li')||[])];
 const loginCard=items.some(node=>!node.querySelector('a[href]')&&/看更多\s*最新作品\s*登录/.test(node.innerText||''));
 return {url:location.href,name,listPresent:!!list,loginLimited:loginCard||/登录后查看更多作品|登录后查看全部作品/.test(root?.innerText||''),verificationRequired,
  totalText,totalConfirmed,endMarker,unlinkedCount:items.filter(node=>!node.querySelector('a[href]')&&node.querySelector('img')).length,
  posts:[...(list?.querySelectorAll('a[href]')||[])].map(a=>({url:a.href,alt:a.querySelector('img[alt]')?.getAttribute('alt')||'',title:a.querySelector('p')?.textContent?.trim()||''}))};
}
function profileId(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.douyin.com','douyin.com'].includes(u.hostname)&&/^\/user\/[\w-]+\/?$/.test(u.pathname)?u.pathname.split('/')[2]:'';}catch{return '';}}
function videoId(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.douyin.com','douyin.com'].includes(u.hostname)&&/^\/video\/\d+\/?$/.test(u.pathname)?u.pathname.split('/')[2]:'';}catch{return '';}}
function postIdentity(value){try{const u=new URL(value),match=/^\/(video|note)\/(\d+)\/?$/.exec(u.pathname);return u.protocol==='https:'&&['www.douyin.com','douyin.com'].includes(u.hostname)&&match?{id:match[2],kind:match[1],url:'https://www.douyin.com/'+match[1]+'/'+match[2]}:null;}catch{return null;}}
function exactPostCount(value){const text=String(value||'').trim();if(!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text))return null;const count=Number(text.replace(/,/g,''));return Number.isSafeInteger(count)?count:null;}
function normalizeProfile(snapshot,inputUrl,{includeNotes=false,allowEmpty=false}={}){
 const id=profileId(snapshot?.url),expected=profileId(inputUrl);
 if(!id||id==='self')throw Error('分享链接未打开公开账号主页，请复制账号主页链接；单条作品请在视频拆解中使用');
 if(expected&&expected!==id)throw Error('打开的账号与输入主页不一致，未采集其他账号');
 const name=String(snapshot.name||'').trim();
 if(!name||name.length>60||!snapshot.listPresent)throw Error('未读取到公开账号及作品区域，平台可能要求验证；可导入本地样本继续');
 const seen=new Set(),posts=[],omitted=[];
 for(const row of snapshot.posts||[]){
  const post=postIdentity(row.url);if(!post){if(String(row.alt||'').startsWith(name+'：'))omitted.push({id:'unsupported:'+String(row.url),url:String(row.url),reason:'暂不支持的作品地址，未静默忽略'});continue;}if(seen.has(post.id))continue;
  if(!String(row.alt||'').startsWith(name+'：')){omitted.push({id:post.id,url:post.url,reason:'作品封面未能核对到目标账号'});continue;}
  if(post.kind==='note'&&!includeNotes){omitted.push({id:post.id,url:post.url,reason:'图文作品不在本次视频采样范围'});continue;}
  seen.add(post.id);const caption=String(row.title||row.alt.slice(name.length+1)).trim();posts.push({...post,title:caption.slice(0,300),caption:caption.slice(0,3000),captionTruncated:caption.length>3000,profileId:id,author:name});
 }
 if(!posts.length&&!allowEmpty)throw Error('账号公开作品区域未返回可核对归属的视频，未使用推荐内容或标题代替学习样本');
 return {id,name,url:'https://www.douyin.com/user/'+id,posts,visibleCount:posts.length,totalText:String(snapshot.totalText||'').slice(0,30),reportedCount:snapshot.totalConfirmed===true?exactPostCount(snapshot.totalText):null,loginLimited:snapshot.loginLimited===true,verificationRequired:snapshot.verificationRequired===true,endMarker:String(snapshot.endMarker||'').slice(0,40),omitted,unlinkedCount:Math.max(0,Number(snapshot.unlinkedCount)||0),observedAt:new Date().toISOString(),basis:'public-profile-post-list'};
}
function scrollProfile(){
 const list=document.querySelector('[data-e2e="user-detail"] [data-e2e="user-post-list"]');
 if(!list)return {moved:false,atBottom:false};
 let container=list;
 while(container&&!(container.scrollHeight>container.clientHeight+2&&/auto|scroll/.test(getComputedStyle(container).overflowY)))container=container.parentElement;
 container||=document.scrollingElement;const before=container.scrollTop;
 container.scrollTop=Math.min(container.scrollHeight,container.scrollTop+Math.max(400,container.clientHeight*.85));
 return {moved:container.scrollTop>before+1,atBottom:container.scrollTop+container.clientHeight>=container.scrollHeight-3};
}
function profileDiscovery(profile,{pages=1,reasonCode='collecting',reason='正在发现公开作品',complete=false,omittedCount=0,countChanged=false}={}){
 return {...profile,visibleCount:profile.posts.length,discovery:{complete,reasonCode,reason,discoveredCount:profile.posts.length,reportedCount:profile.reportedCount??null,pages,omittedCount,unlinkedCount:profile.unlinkedCount||0,countChanged,observedAt:new Date().toISOString()}};
}
function identitySnapshot(){
 const author=document.querySelector('[data-e2e="related-video"] [data-e2e="user-info"]');
 return {url:location.href,authors:[...(author?.querySelectorAll('a[href*="/user/"]')||[])].map(a=>a.href),media:[...document.querySelectorAll('[data-e2e="video-detail"] video')].flatMap(v=>[v.currentSrc,v.src]).filter(Boolean)};
}
function verifyIdentity(snapshot,expectedProfileId,expectedVideoUrl){
 if(videoId(snapshot.url)!==videoId(expectedVideoUrl)||!videoId(snapshot.url))throw Error('作品页面已切换，未接受其他视频媒体');
 const ids=[...new Set((snapshot.authors||[]).map(profileId).filter(Boolean))];
 if(ids.length!==1||ids[0]!==expectedProfileId)throw Error('作品详情未能核对到目标账号作者，未作为学习样本');
 return {profileId:ids[0],videoId:videoId(snapshot.url),basis:'profile-post-list-and-video-author'};
}
module.exports={profileSnapshot,normalizeProfile,profileId,videoId,postIdentity,exactPostCount,scrollProfile,profileDiscovery,identitySnapshot,verifyIdentity};
