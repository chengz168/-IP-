// 沿用账号窗口的沙箱会话，通过浏览器原生输入完成上传，不导出登录凭证。
const crypto=require('node:crypto');
const {platform}=require('../server/account-connections.cjs');

// 此函数在平台页面执行，只读取发布控件与本次成功提示，不访问账号凭证。
function pageOperation(action,value){
 const visible=node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
 const all=selector=>[...document.querySelectorAll(selector)];
 const text=node=>(node.innerText||node.textContent||'').trim();
 const norm=v=>String(v||'').replace(/\r\n/g,'\n').replace(/\u200b/g,'').trim();
 const exact=(selector,words)=>all(selector).filter(n=>visible(n)&&words.includes(text(n)));
 const one=(nodes,label)=>{const unique=[...new Set(nodes)];if(unique.length!==1)throw Error(label+'未找到唯一控件，请在平台窗口检查页面');return unique[0];};
 const title=()=>one(all('input[placeholder*="填写作品标题"]'),'作品标题');
 const description=()=>one(all('div.zone-container[contenteditable="true"]'),'作品描述');
 const modal=()=>one(all('div.dy-creator-content-modal').filter(visible),'封面设置');
 const successWords=mode=>mode==='draft'?['保存草稿成功','草稿保存成功','已保存草稿','已存为草稿']:['发布成功','作品发布成功'];
 const success=node=>{const wanted=successWords(value?.mode),matches=[];const regions=[];if(node.nodeType===3)node=node.parentElement;if(!node?.querySelectorAll)return null;
  const selector='.semi-toast-content,.semi-toast-content-text,[role="status"],[role="alert"],.ant-message-notice-content';
  if(node.matches?.(selector))regions.push(node);regions.push(...node.querySelectorAll(selector));const ancestor=node.closest?.(selector);if(ancestor)regions.push(ancestor);
  for(const n of regions)if(visible(n)){const actual=text(n);for(const word of wanted)if(actual===word||actual.startsWith(word+'，')||actual.startsWith(word+'！')||actual.startsWith(word+'!'))matches.push(actual);}
  return matches[0]||null;
 };
 if(action==='inspect')return{url:location.href,loginVisible:exact('button,span,div',['手机号登录','扫码登录','二维码失效']).length>0,challengeVisible:all('input[placeholder*="验证码"],input[placeholder*="短信"]').some(visible),uploadError:all('div.progress-div').some(n=>visible(n)&&text(n).includes('上传失败')),uploadReady:all('[class^="long-card"]').some(n=>visible(n)&&text(n).includes('重新上传')),hasEditor:all('input[placeholder*="填写作品标题"]').length===1,ack:value?.id&&globalThis.__studioPublishObservation?.id===value.id?globalThis.__studioPublishObservation.result:null,freshDocumentAck:value?.newDocument?success(document.body):null};
 if(action==='file'){
  let nodes;
  if(value.kind==='video')nodes=all('input[type="file"].upload-btn-input,input[type="file"][class*="upload-btn-input"],div[class^="container"] input[type="file"][accept*="video"]');
  else{const m=modal();nodes=[...m.querySelectorAll('.semi-upload')].filter(n=>n.querySelector('.semi-upload-drag-area-main-text')).flatMap(n=>[...n.querySelectorAll('input.semi-upload-hidden-input[type="file"]')]);}
  const node=one(nodes,value.kind==='video'?'视频文件':'封面文件');node.setAttribute('data-studio-publish-file',value.id);return 'input[data-studio-publish-file="'+value.id+'"]';
 }
 if(action==='focus'){
  const node=value.kind==='title'?title():description();node.scrollIntoView({block:'center'});node.focus();
  if(value.kind==='title')node.select();else{const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}return true;
 }
 if(action==='values')return{title:title().value,description:norm(description().innerText)};
 if(action==='selectedFile'){const node=document.querySelector('input[data-studio-publish-file="'+value.id+'"]');return node?.files?.length===1?{name:node.files[0].name,size:node.files[0].size}:null;}
 if(action==='point'){
  let node;
  if(value.kind==='cover'){const buttons=exact('button',['编辑封面','选择封面','设置封面']),nodes=buttons.length?buttons:exact('span,div',['编辑封面','选择封面','设置封面']).filter(n=>!n.children.length);if(!nodes.length)return null;node=one(nodes,'封面入口');}
  if(value.kind==='coverHover'){const candidates=all('[class*="cover-"]').filter(n=>visible(n)&&n.querySelector('img')),outer=candidates.filter(n=>!candidates.some(p=>p!==n&&p.contains(n)));node=one(outer,'封面区域');}
  if(value.kind==='portrait'){const m=modal(),buttons=[...m.querySelectorAll('button')].filter(n=>visible(n)&&text(n)==='设置竖封面'),tabs=buttons.length?buttons:[...m.querySelectorAll('span,div')].filter(n=>visible(n)&&text(n)==='设置竖封面'&&!n.children.length);if(!tabs.length)return null;node=one(tabs,'竖封面页签');}
  if(value.kind==='finish')node=one([...modal().querySelectorAll('button')].filter(n=>visible(n)&&text(n)==='完成'),'封面完成');
  if(value.kind==='submit')node=one(exact('button',value.mode==='draft'?['保存草稿','存草稿']:['发布']),'发布提交');
  if(!node)throw Error('发布操作无效');if(node.disabled||node.getAttribute('aria-disabled')==='true'||/semi-button-disabled/.test(node.className))return null;
  node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!(hit===node||node.contains(hit)))return null;return{x:r.x+r.width/2,y:r.y+r.height/2};
 }
 if(action==='coverState'){const dialogs=all('div.dy-creator-content-modal').filter(visible);return{open:dialogs.length>0,images:dialogs.flatMap(d=>[...d.querySelectorAll('img')]).filter(n=>visible(n)&&n.naturalWidth>0).map(n=>n.currentSrc||n.src)};}
 if(action==='observe'){
  globalThis.__studioPublishObservation?.observer.disconnect();
  if(success(document.body))throw Error('平台仍有上一条成功提示，请等待提示消失后重试');
  const state={id:value.id,result:null,observer:null};state.observer=new MutationObserver(records=>{for(const record of records){const nodes=record.type==='characterData'?[record.target]:[...record.addedNodes];for(const node of nodes){const found=success(node);if(found)state.result={text:found,url:location.href,observedAt:new Date().toISOString()};}}});
  state.observer.observe(document.body,{subtree:true,childList:true,characterData:true});globalThis.__studioPublishObservation=state;return true;
 }
 if(action==='cleanup'){if(globalThis.__studioPublishObservation?.id===value.id){globalThis.__studioPublishObservation.observer.disconnect();delete globalThis.__studioPublishObservation;}return true;}
 throw Error('未知发布页面操作');
}
class DouyinPublisher{
 constructor(window,options={}){this.window=window;this.timeoutMs=options.timeoutMs??180000;this.stepTimeoutMs=options.stepTimeoutMs??20000;this.pollMs=options.pollMs??350;}
 guard(){if(this.signal?.aborted)throw Error('已请求停止发布');if(this.window.isDestroyed())throw Error('平台窗口已关闭');const u=new URL(this.window.webContents.getURL());if(u.protocol!=='https:'||u.hostname!=='creator.douyin.com')throw Error('平台页面来源已变化，请重新登录并检查');}
 async bounded(operation,ms=this.stepTimeoutMs){
  if(this.signal?.aborted)throw Error('已请求停止发布');const w=this.window;
  return new Promise((resolve,reject)=>{let timer,done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);w.removeListener('closed',closed);this.signal?.removeEventListener('abort',aborted);error?reject(error):resolve(value);};const closed=()=>finish(Error('平台窗口已关闭')),aborted=()=>finish(Error('已请求停止发布'));
   w.once('closed',closed);this.signal?.addEventListener('abort',aborted,{once:true});timer=setTimeout(()=>finish(Error('平台页面响应超时')),ms);if(w.isDestroyed()){closed();return;}if(this.signal?.aborted){aborted();return;}Promise.resolve().then(operation).then(v=>finish(null,v),e=>finish(e));
  });
 }
 async command(method,params={}){this.guard();return this.bounded(()=>this.window.webContents.debugger.sendCommand(method,params));}
 async page(action,value={}){this.guard();try{return await this.bounded(()=>this.window.webContents.executeJavaScript('('+pageOperation.toString()+')('+JSON.stringify(action)+','+JSON.stringify(value)+')'));}catch(error){throw Error('发布页面操作失败（'+action+'）：'+error.message);}}
 async wait(check,ms=this.stepTimeoutMs){const end=Date.now()+ms;while(true){this.guard();const value=await check();if(value)return value;if(Date.now()>=end)throw Error('平台处理超时，请在账号窗口核对本次结果');await this.bounded(()=>new Promise(r=>setTimeout(r,this.pollMs)),this.pollMs+1000);}}
 async inspect(value={}){const s=await this.page('inspect',value);if(s.loginVisible||s.challengeVisible)throw Error('平台需要登录或身份验证，请在账号窗口手动完成后核对本次任务');if(s.uploadError)throw Error('平台提示视频上传失败');return s;}
 async click(kind,mode){const point=await this.wait(()=>this.page('point',{kind,mode}));await this.command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await this.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await this.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
 async file(kind,file,beforeSend){const id=crypto.randomUUID(),selector=await this.page('file',{kind,id}),{root}=await this.command('DOM.getDocument'),{nodeId}=await this.command('DOM.querySelector',{nodeId:root.nodeId,selector});if(!nodeId)throw Error('文件控件已变化，未上传文件');if(beforeSend)await beforeSend();await this.command('DOM.setFileInputFiles',{nodeId,files:[file]});const selected=await this.page('selectedFile',{id}),path=require('node:path'),fs=require('node:fs');if(selected?.name!==path.basename(file)||selected?.size!==fs.statSync(file).size)throw Error('平台文件控件未确认选中指定文件');}
 async run(payload,context){
  this.signal=context.signal;const wc=this.window.webContents,debuggerApi=wc.debugger;let attached=false;const id=crypto.randomUUID();
  try{
   if(debuggerApi.isAttached())throw Error('平台窗口正在被其他调试操作占用，请稍后再试');debuggerApi.attach('1.3');attached=true;
   await this.bounded(()=>this.window.loadURL(platform.creatorUrl));this.guard();await this.inspect();context.progress('正在上传视频');
   await this.file('video',payload.videoPath,context.beforeUpload);
   await this.wait(async()=>{const s=await this.inspect();return s.hasEditor&&s.uploadReady;},this.timeoutMs);
   context.progress('正在填写标题和描述');await this.page('focus',{kind:'title'});await this.command('Input.insertText',{text:payload.title});await this.page('focus',{kind:'description'});await this.command('Input.insertText',{text:payload.description});
   const values=await this.page('values');if(values.title!==payload.title||values.description!==payload.description.trim())throw Error('平台标题或描述与确认清单不一致，已停止提交');
   if(payload.coverPath){context.progress('正在设置封面');if(!await this.page('point',{kind:'cover'})){const area=await this.page('point',{kind:'coverHover'});await this.command('Input.dispatchMouseEvent',{type:'mouseMoved',...area});}await this.click('cover');await this.wait(()=>this.page('coverState').then(s=>s.open));const portrait=await this.page('point',{kind:'portrait'});if(portrait)await this.click('portrait');const before=await this.page('coverState');await this.file('cover',payload.coverPath);await this.wait(()=>this.page('coverState').then(s=>s.images.some(src=>!before.images.includes(src))));await this.click('finish');await this.wait(()=>this.page('coverState').then(s=>!s.open));}
   await this.inspect();await this.wait(()=>this.page('point',{kind:'submit',mode:payload.mode}));
   await this.page('observe',{id,mode:payload.mode});const beforeUrl=wc.getURL();
   // 必须先持久记录提交边界，再点击一次；此后失败或取消都不能断言平台未提交。
   await context.beforeCommit();await this.click('submit',payload.mode);context.progress(payload.mode==='draft'?'等待平台确认草稿保存':'等待平台确认发布');
   const evidence=await this.wait(async()=>{const s=await this.inspect({id,mode:payload.mode,newDocument:wc.getURL()!==beforeUrl});return s.ack||(s.freshDocumentAck?{text:s.freshDocumentAck,url:s.url,observedAt:new Date().toISOString()}:null);});
   return{status:payload.mode==='draft'?'draft_saved':'published',evidence:{...evidence,mode:payload.mode,kind:'fresh-platform-success-message'}};
  }finally{if(attached){try{if(!this.window.isDestroyed())await this.page('cleanup',{id});}catch{}try{if(debuggerApi.isAttached())debuggerApi.detach();}catch{}}}
 }
}
module.exports={DouyinPublisher,pageOperation};
