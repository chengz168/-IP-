const {app,BrowserWindow,ipcMain,dialog,protocol,safeStorage,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {assetResponse}=require('../server/asset-response.cjs');
const {createService}=require('../server/service.cjs');
const {VideoParserBrowser}=require('./video-parser-browser.cjs');
const {ProductBrowser}=require('./product-browser.cjs');
// 波形需要从页面读取已登记媒体，显式声明自定义协议的跨源读取能力。
protocol.registerSchemesAsPrivileged([{scheme:'media',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let win,service;
const platformWindows=new Map();
app.setName('超级IP智能体');
const gotLock=app.requestSingleInstanceLock();
if(!gotLock)app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
if(gotLock)app.whenReady().then(()=>{const root=process.argv.find(a=>a.startsWith('--studio-data-dir='))?.slice(18)||process.env.STUDIO_DATA_DIR||(app.isPackaged?path.join(app.getPath('userData'),'studio'):path.join(__dirname,'..','data'));fs.mkdirSync(root,{recursive:true});const secrets=require('../server/provider-keys.cjs').encryptedSecrets(root,safeStorage);const videoParserBrowser=new VideoParserBrowser({BrowserWindow,parent:()=>win,root});service=createService(root,secrets,{builtinAvatars:true,accountBrowser:new (require('./account-browser.cjs').AccountBrowser)({BrowserWindow,parent:()=>win}),videoParserBrowser,productBrowser:new ProductBrowser({BrowserWindow}),manageLocalEnvironment:true});service.localEnvironment.start().catch(error=>console.error('本地环境检查失败：'+error.message));service.renderCover=require('./cover-worker.cjs').coverRenderer(service);service.media.renderTitle=require('./cover-worker.cjs').coverRenderer(service,'renderTitle');service.media.renderNamecard=require('./cover-worker.cjs').coverRenderer(service,'renderNamecard');protocol.handle('media',request=>{try{const u=new URL(request.url);if(u.hostname!=='asset')return new Response('文件不存在',{status:404});const asset=service.store.asset(decodeURIComponent(u.pathname.slice(1)));return assetResponse(asset,request);}catch{return new Response('文件不存在',{status:404});}});win=new BrowserWindow({width:1400,height:1000,minWidth:1100,minHeight:760,frame:false,backgroundColor:'#1b1d29',title:'超级IP智能体',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.setMenu(null);win.once('ready-to-show',()=>win.show());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://')&&!url.startsWith('http://127.0.0.1:5173'))event.preventDefault();});if(process.env.STUDIO_DEV_URL)win.loadURL(process.env.STUDIO_DEV_URL);else win.loadFile(path.join(__dirname,'..','dist','index.html'));
  ipcMain.handle('studio:invoke',async(event,action,payload)=>{if(event.sender!==win.webContents)throw new Error('窗口来源无效');return service.invoke(action,payload);});
  ipcMain.handle('studio:pickFiles',async(event,kind,options={})=>{if(event.sender!==win.webContents)throw new Error('窗口来源无效');const extensions={video:['mp4','mov','mkv','webm','avi'],music:['mp3','wav','m4a','aac','flac'],audio:['mp3','wav','m4a','aac','flac','ogg','mp4','mov','mkv','webm','avi'],image:['png','jpg','jpeg','webp'],visual:['mp4','mov','mkv','avi','webm','png','jpg','jpeg','webp'],text:['txt','srt','vtt','json'],all:['mp4','mov','mkv','webm','avi','mp3','wav','m4a','flac','png','jpg','jpeg','webp','txt','srt']}[kind]||[];const result=await dialog.showOpenDialog(win,{properties:options.multiple===false?['openFile']:['openFile','multiSelections'],filters:[{name:'支持的文件',extensions}]});if(result.canceled)return [];if(options.maxSize){if(!Number.isFinite(options.maxSize)||options.maxSize<=0)throw new Error('文件大小限制无效');for(const file of result.filePaths){const stat=fs.statSync(file);if(!stat.isFile()||stat.size<=0||stat.size>options.maxSize)throw new Error('所选文件须大于0且不超过'+Math.round(options.maxSize/1024/1024)+'MB');}}const files=[];for(const file of result.filePaths)files.push(await service.importPath(file));return files.map(({path:file,...asset})=>asset);});
  ipcMain.handle('studio:dropVoice',require('./voice-drop.cjs').createVoiceDropImporter({window:()=>win,service}));
  ipcMain.handle('studio:revealAsset',async(event,id)=>{if(event.sender!==win.webContents)throw new Error('窗口来源无效');const asset=service.store.asset(id);shell.showItemInFolder(asset.path);return true;});
  ipcMain.handle('studio:directory',async()=>{const result=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});return result.canceled?'':result.filePaths[0];});
  ipcMain.handle('studio:exportAsset',async(event,id,options)=>{if(event.sender!==win.webContents)throw new Error('窗口来源无效');return require('./export-asset.cjs').exportAsset({store:service.store,dialog,win},id,options);});
  ipcMain.handle('studio:output',async()=>{const result=await shell.openPath(service.store.outputDir());if(result)throw new Error(result);return true;});
  ipcMain.handle('studio:open-platform-home',async(event,platform)=>{
    if(event.sender!==win.webContents)throw new Error('窗口来源无效');
    const urls={douyin:'https://www.douyin.com/',kuaishou:'https://www.kuaishou.com/',xiaohongshu:'https://www.xiaohongshu.com/explore'};
    const key=String(platform||''),url=urls[key];
    if(!url)throw new Error('不支持的平台入口');
    let page=platformWindows.get(key);
    if(!page||page.isDestroyed()){
      page=new BrowserWindow({width:1180,height:860,minWidth:980,minHeight:680,title:'平台入口 · '+key,show:true,parent:win,webPreferences:{partition:'persist:studio-platform-'+key,contextIsolation:true,nodeIntegration:false,sandbox:true}});
      platformWindows.set(key,page);
      const pageSession=page.webContents.session;
      pageSession.setPermissionCheckHandler((_contents,permission)=>permission!=='openExternal');
      pageSession.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission!=='openExternal'));
      page.webContents.setWindowOpenHandler(({url:target})=>{
        try{const parsed=new URL(target);if(parsed.protocol==='https:'){page.loadURL(target);}}catch{}
        return {action:'deny'};
      });
      const blockNonHttps=navigationEvent=>{
        const target=navigationEvent?.url;
        try{const parsed=new URL(target);if(parsed.protocol!=='https:'){navigationEvent.preventDefault();return;}}
        catch{navigationEvent.preventDefault();}
      };
      page.webContents.on('will-navigate',blockNonHttps);
      page.webContents.on('will-redirect',blockNonHttps);
      page.webContents.on('will-frame-navigate',blockNonHttps);
      page.on('closed',()=>{if(platformWindows.get(key)===page)platformWindows.delete(key);});
    }else if(page.isMinimized())page.restore();
    page.show();
    page.focus();
    await page.loadURL(url);
    return {opened:true,embedded:true,url};
  });
  ipcMain.on('studio:window',(event,action)=>{if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();});
}).catch(error=>{dialog.showErrorBox('工作台启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());

// 退出只结束环境检查等待，共用服务留给其他窗口和下次任务复用。
app.on('before-quit',()=>service?.localEnvironment?.close());
