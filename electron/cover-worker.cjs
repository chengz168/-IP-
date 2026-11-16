const {BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
// 仅允许隐藏绘制窗口读取字体与背景。窗口退出或取消时移除监听并销毁。
function coverRenderer(service,method='renderCover'){return async(cover,ctx={})=>{
 const nativeTitle=method==='renderTitle'&&cover.design?.mode==='custom';
 const worker=new BrowserWindow({show:false,width:nativeTitle?cover.width:1080,height:nativeTitle?cover.height:1920,useContentSize:true,transparent:nativeTitle,backgroundColor:nativeTitle?'#00000000':'#FFFFFF',webPreferences:{preload:path.join(__dirname,'cover-worker-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:nativeTitle}}),channel='studio:cover-read';
 const read=async(event,action,payload)=>{if(event.sender!==worker.webContents)return;try{if(!['listSubtitleFonts','coverFontData','imageData'].includes(action))throw new Error('后台封面动作不允许');event.reply(channel+':reply',payload.requestId,null,await service.handlers[action](payload.data));}catch(error){event.reply(channel+':reply',payload.requestId,error.message);}};
 const abort=()=>{if(!worker.isDestroyed())worker.destroy();};ipcMain.on(channel,read);ctx.signal?.addEventListener('abort',abort,{once:true});
 let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;abort();},45000);
 try{if(ctx.signal?.aborted)throw new Error('后台绘制已停止');await worker.loadFile(path.join(__dirname,'..','dist','cover-worker.html'));
  // Windows会把隐藏原生窗口限在显示器工作区，绘制视口与截图必须独立于该限制。
  if(nativeTitle){worker.webContents.debugger.attach('1.3');await worker.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:cover.width,height:cover.height,deviceScaleFactor:1,mobile:false,screenWidth:cover.width,screenHeight:cover.height});}
  const result=await worker.webContents.executeJavaScript('window.'+method+'('+JSON.stringify(cover)+')');
  if(nativeTitle&&result?.capture){const image=await worker.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width:cover.width,height:cover.height,scale:1}}),png=Buffer.from(image.data,'base64'),width=png.length>=24?png.readUInt32BE(16):0,height=png.length>=24?png.readUInt32BE(20):0;
   if(width!==cover.width||height!==cover.height)throw new Error(`标题捕获尺寸错误：实际${width}×${height}，需要${cover.width}×${cover.height}`);
   return {data:'data:image/png;base64,'+png.toString('base64'),bounds:{...result.bounds,capture:{width,height,...result.viewport,offscreen:true,method:'Page.captureScreenshot'}}};}return result;}
 catch(error){if(ctx.signal?.aborted)throw new Error('后台绘制已停止');if(timedOut)throw new Error('后台绘制超过45秒，请检查字体或背景后重试');throw error;}
 finally{clearTimeout(timeout);ctx.signal?.removeEventListener('abort',abort);ipcMain.removeListener(channel,read);abort();}
};}
module.exports={coverRenderer};
