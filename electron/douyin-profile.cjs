// 只读取账号“作品”区域，排除喜欢、推荐和页脚热门链接。页面标题不作为口播正文。
function profileSnapshot(){
 const root=document.querySelector('[data-e2e="user-detail"]');
 const name=root?.querySelector('[data-e2e="user-info"] h1')?.textContent?.trim()||'';
 const list=root?.querySelector('[data-e2e="user-post-list"]');
 return {url:location.href,name,listPresent:!!list,loginLimited:/登录后查看更多作品/.test(root?.innerText||''),
  totalText:root?.querySelector('[data-e2e="user-tab-count"]')?.textContent||'',
  posts:[...(list?.querySelectorAll('a[href]')||[])].slice(0,100).map(a=>({url:a.href,alt:a.querySelector('img[alt]')?.getAttribute('alt')||'',title:a.querySelector('p')?.textContent?.trim()||''}))};
}
function profileId(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.douyin.com','douyin.com'].includes(u.hostname)&&/^\/user\/[\w-]+\/?$/.test(u.pathname)?u.pathname.split('/')[2]:'';}catch{return '';}}
function videoId(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.douyin.com','douyin.com'].includes(u.hostname)&&/^\/video\/\d+\/?$/.test(u.pathname)?u.pathname.split('/')[2]:'';}catch{return '';}}
function normalizeProfile(snapshot,inputUrl){
 const id=profileId(snapshot?.url),expected=profileId(inputUrl);
 if(!id||id==='self')throw Error('分享链接未打开公开账号主页，请复制账号主页链接；单条作品请在视频拆解中使用');
 if(expected&&expected!==id)throw Error('打开的账号与输入主页不一致，未采集其他账号');
 const name=String(snapshot.name||'').trim();
 if(!name||name.length>60||!snapshot.listPresent)throw Error('未读取到公开账号及作品区域，平台可能要求验证；可导入本地样本继续');
 const seen=new Set(),posts=[];
 for(const row of snapshot.posts||[]){const vid=videoId(row.url);if(!vid||seen.has(vid)||!String(row.alt||'').startsWith(name+'：'))continue;seen.add(vid);const caption=String(row.title||row.alt.slice(name.length+1)).trim();posts.push({id:vid,url:'https://www.douyin.com/video/'+vid,title:caption.slice(0,300),caption:caption.slice(0,3000),captionTruncated:caption.length>3000,profileId:id,author:name});}
 if(!posts.length)throw Error('账号公开作品区域未返回可核对归属的视频，未使用推荐内容或标题代替学习样本');
 return {id,name,url:'https://www.douyin.com/user/'+id,posts,visibleCount:posts.length,totalText:String(snapshot.totalText||'').slice(0,30),loginLimited:snapshot.loginLimited===true,observedAt:new Date().toISOString(),basis:'public-profile-post-list'};
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
module.exports={profileSnapshot,normalizeProfile,profileId,videoId,identitySnapshot,verifyIdentity};
