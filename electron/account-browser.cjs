// 平台页面独立沙箱运行，不注入工作台preload，不读取或导出平台凭证。
const {platform}=require('../server/account-connections.cjs');
// 页面关闭后Electron的执行承诺未必结束，必须由窗口生命周期和超时主动收束。
function whileWindowOpen(window,operation,timeoutMs){
 return new Promise((resolve,reject)=>{
  let timer,finished=false;
  const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);window.removeListener('closed',closed);error?reject(error):resolve(value);};
  const closed=()=>finish(Error('登录窗口已关闭，请重新打开后检查'));
  window.once('closed',closed);timer=setTimeout(()=>finish(Error('平台页面响应超时，请等待页面加载后重试')),timeoutMs);timer.unref?.();
  if(window.isDestroyed()){closed();return;}
  Promise.resolve().then(operation).then(value=>finish(null,value),error=>finish(error));
 });
}
class AccountBrowser{
 constructor({BrowserWindow,parent}){this.BrowserWindow=BrowserWindow;this.parent=parent;this.windows=new Map();}
 async open({id,partition,url,title,onClose}){
  const existing=this.windows.get(id);if(existing&&!existing.isDestroyed()){existing.studioOnClose=onClose;existing.show();existing.focus();return;}
  const window=new this.BrowserWindow({width:1100,height:820,minWidth:900,minHeight:640,title:'抖音平台登录 · '+title,show:false,parent:this.parent(),webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const session=window.webContents.session;
  // 平台登录页只能在受控 HTTPS 页面内运行，不允许页面请求系统协议。
  session.setPermissionCheckHandler((_contents,permission)=>permission!=='openExternal');
  session.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission!=='openExternal'));
  const blockUnsafeNavigation=event=>{try{const u=new URL(event.url);if(u.protocol!=='https:'||!['douyin.com','snssdk.com','bytedance.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))event.preventDefault();}catch{event.preventDefault();}};
  window.webContents.on('will-navigate',blockUnsafeNavigation);
  window.webContents.on('will-redirect',blockUnsafeNavigation);
  window.webContents.on('will-frame-navigate',blockUnsafeNavigation);
  this.windows.set(id,window);window.studioOnClose=onClose;window.on('closed',()=>{if(this.windows.get(id)===window)this.windows.delete(id);window.studioOnClose();});
  try{await whileWindowOpen(window,()=>window.loadURL(url),20000);if(window.isDestroyed())throw Error('登录窗口已关闭');window.show();}catch(error){if(!window.isDestroyed())window.show();throw Error('平台页面加载失败：'+error.message);}
 }
 async inspect(id){
  const window=this.windows.get(id);if(!window||window.isDestroyed())throw Error('请先打开此账号的登录窗口');
  const url=window.webContents.getURL();if(!url.startsWith(platform.loginUrl))return {url,loginVisible:false,creatorControlVisible:false};
  return whileWindowOpen(window,()=>window.webContents.executeJavaScript(`(()=>{
   const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.visibility!=='hidden'&&style.display!=='none'&&rect.width>0&&rect.height>0};
   const elements=[...document.querySelectorAll('a,button,span,div')].filter(visible);
   const has=texts=>elements.some(node=>node.children.length===0&&texts.includes((node.innerText||'').trim()));
   return {url:location.href,loginVisible:has(['手机号登录','扫码登录','二维码失效']),creatorControlVisible:has(['发布视频','发布作品','作品管理'])};
  })()`),12000);
 }
 close(id){const window=this.windows.get(id);if(window&&!window.isDestroyed())window.close();}
 async publish(id,payload,context){const window=this.windows.get(id);if(!window||window.isDestroyed())throw Error('请先打开此账号的登录窗口');return new (require('./douyin-publisher.cjs').DouyinPublisher)(window).run(payload,context);}
}
module.exports={AccountBrowser};
