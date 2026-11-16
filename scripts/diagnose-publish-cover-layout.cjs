// 只读记录失败现场与祖先滚动几何，不修改生产数据。
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/publish-cover-preview-20261116');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9359');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/dist/index.html'));
  const geometry=await page.evaluate(()=>{
   const node=document.querySelector('.cover-preview-trigger'),rect=node.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2),parents=[];
   for(let n=node;n;n=n.parentElement)parents.push({tag:n.tagName,cls:n.className,rect:n.getBoundingClientRect().toJSON(),overflow:getComputedStyle(n).overflowY,scrollTop:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight});
   return {viewport:[innerWidth,innerHeight],rootClass:document.documentElement.className,rect:rect.toJSON(),hit:hit?.outerHTML.slice(0,400),parents,footer:document.querySelector('.workflow-footer').getBoundingClientRect().toJSON()};
  });
  fs.writeFileSync(path.join(root,'layout-failure-live.json'),JSON.stringify(geometry,null,2),{flag:'wx'});
  const session=await page.context().newCDPSession(page),capture=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'layout-failure-live.png'),Buffer.from(capture.data,'base64'),{flag:'wx'});await session.detach();console.log(JSON.stringify(geometry));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
