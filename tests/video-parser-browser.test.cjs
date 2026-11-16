const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {VideoParserBrowser,loadPage}=require('../electron/video-parser-browser.cjs');

function windowFixture(){
 const contents=new EventEmitter();contents.stops=0;contents.stop=()=>contents.stops++;
 return {webContents:contents,isDestroyed:()=>false,loadURL:()=>new Promise(()=>{})};
}

test('分享页持续加载时DOM就绪即可采集，不等待所有资源',async()=>{
 const win=windowFixture(),pending=loadPage(win,'https://www.douyin.com/',{timeoutMs:1000});
 win.webContents.emit('dom-ready');await pending;
 assert.equal(win.webContents.stops,0);assert.equal(win.webContents.listenerCount('dom-ready'),0);assert.equal(win.webContents.listenerCount('destroyed'),0);
});

test('未就绪的页面超时会停止加载并解除观察',async()=>{
 const win=windowFixture();await assert.rejects(loadPage(win,'https://www.douyin.com/',{timeoutMs:20}),/超过允许时限/);
 assert.equal(win.webContents.stops,1);assert.equal(win.webContents.listenerCount('dom-ready'),0);
});

test('停止解析立即打断加载，之后迟到的页面结果不会复活任务',async()=>{
 const win=windowFixture(),controller=new AbortController(),pending=loadPage(win,'https://www.douyin.com/',{signal:controller.signal,timeoutMs:1000});
 controller.abort();await assert.rejects(pending,/已取消/);win.webContents.emit('dom-ready');
 assert.equal(win.webContents.stops,1);assert.equal(win.webContents.listenerCount('destroyed'),0);
});

test('已取消、窗口关闭和导航失败均拒绝，保留实际错误',async()=>{
 const cancelled=new AbortController();cancelled.abort();assert.throws(()=>loadPage(windowFixture(),'https://www.douyin.com/',{signal:cancelled.signal}));
 const closed=windowFixture(),pending=loadPage(closed,'https://www.douyin.com/');closed.webContents.emit('destroyed');await assert.rejects(pending,/窗口已关闭/);
 const failed=windowFixture();failed.loadURL=()=>Promise.reject(Error('实际网络失败'));await assert.rejects(loadPage(failed,'https://www.douyin.com/'),/实际网络失败/);
});

test('后台创建即静音且跳过首页，重复打开复用窗口，关闭后重开仍静音',async()=>{
 const windows=[];
 class Window extends EventEmitter{
  constructor(){super();this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler(){},setAudioMuted:value=>{this.muted=value;},getURL:()=>'',session:{setPermissionCheckHandler:handler=>{this.permissionCheck=handler;},setPermissionRequestHandler:handler=>{this.permissionRequest=handler;}}});this.loads=0;windows.push(this);}
  setMenu(){}isDestroyed(){return !!this.closed;}show(){this.shown=true;}focus(){}loadURL(){this.loads++;return Promise.resolve();}close(){this.closed=true;this.emit('closed');}
 }
 const parser=new VideoParserBrowser({BrowserWindow:Window,parent:()=>null,root:__dirname});
 await parser.open({silent:true});assert.equal(windows[0].muted,true);assert.equal(windows[0].loads,0);assert(!windows[0].shown);
 assert.equal(windows[0].permissionCheck(null,'openExternal','https://www.douyin.com/',{}),false);
 assert.equal(windows[0].permissionCheck(null,'media','https://www.douyin.com/',{}),true);
 let permissionResult;windows[0].permissionRequest(null,'openExternal',value=>{permissionResult=value;},{});assert.equal(permissionResult,false);
 let redirectBlocked=false;windows[0].webContents.emit('will-redirect',{url:'bytedance://open/test',preventDefault(){redirectBlocked=true;}});assert.equal(redirectBlocked,true);
  let frameBlocked=false;windows[0].webContents.emit('will-frame-navigate',{url:'bytedance://open/frame',preventDefault(){frameBlocked=true;}});assert.equal(frameBlocked,true);
 await parser.open({silent:true});assert.equal(windows.length,1);parser.close();await parser.open({silent:true});assert.equal(windows.length,2);assert.equal(windows[1].muted,true);parser.close();
});
