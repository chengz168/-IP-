// 前后端共用分享文字解析，只识别唯一网址，不把短链识别当作采集成功。
export function shareLink(value,kind='video'){
 const label=kind==='profile'?'账号主页':'视频';
 if(typeof value!=='string'||value.length>10000)throw Error('分享文本为空或超过10000字');
 const matches=value.match(/https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi)||[];
 const links=[...new Set(matches.map(link=>link.replace(/[,.!?;:)\]}]+$/gu,'')))];
 if(links.length!==1)throw Error(links.length?`请只保留一个${label}分享链接`:`没有识别到HTTP或HTTPS${label}链接${kind==='profile'?'，请粘贴账号主页的完整分享文字或网址，抖音号不能代替链接':''}`);
 let url;try{url=new URL(links[0]);}catch{throw Error(`${label}分享链接无效`);}
 if(!url.hostname||url.username||url.password)throw Error(`${label}分享链接不能包含账号或密码`);
 url.hash='';return url.href;
}

export function profileShareLink(value){
 const href=shareLink(value,'profile'),url=new URL(href);
 const douyin=['douyin.com','iesdouyin.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host));
 if(douyin&&(/^\/(?:share\/)?(?:video|note)\//u.test(url.pathname)||url.searchParams.has('modal_id')))
  throw Error('这是单条抖音作品链接，请在“提取文案”或“视频拆解”中使用；学习账号请粘贴账号主页分享链接');
 return href;
}

export const brainCollectionUnavailable='已识别账号分享链接，但主页采集服务尚未配置。请在“设置 → 模型设置”填写“账号主页文案采集接口”，或导入本地文案/视频样本；单条视频提取服务不能代替账号主页采集。';
