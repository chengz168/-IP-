const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
// 验证工具复用调用方提供的Playwright，避免把本机缓存路径固化到仓库。
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const folder=path.resolve('evidence/validation/product-promo-20261120');
const target='https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3854345420239143257&origin_type=604';
const mode=process.argv[2]||'collect';
async function main(){const browser=await chromium.connectOverCDP('http://127.0.0.1:9375');try{const page=browser.contexts()[0].pages().find(p=>p.url().includes('/dist/index.html')),errors=[];page.on('pageerror',error=>errors.push(error.message));
 if(mode==='collect'){
  await page.getByRole('button',{name:'开始新任务',exact:true}).click();await page.getByRole('button',{name:'商品宣传',exact:true}).click();await page.getByRole('textbox',{name:'商品详情页链接'}).fill(target);await page.getByRole('button',{name:'读取商品详情',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.product-facts input')?.value.includes('逗猫棒'),null,{timeout:70000});await page.screenshot({path:path.join(folder,'product-collected-ui.png'),fullPage:true});
  const state=await page.evaluate(()=>window.studio.invoke('state')),draft=state.drafts.find(d=>d.id===state.currentId),run=state.runs.find(r=>r.draftId===draft.id&&r.type==='product-collect');assert.equal(run.status,'succeeded');assert.equal(run.output.product.images.length,14);assert.equal(run.output.product.price,'');
  fs.writeFileSync(path.join(folder,'ui-product-task.json'),JSON.stringify({draftId:draft.id,sourceRunId:run.id,target},null,2));console.log(JSON.stringify({draftId:draft.id,product:run.output.product.title,images:run.output.product.images.length,errors}));
 }else if(mode==='script'){
  await page.getByRole('button',{name:'生成宣传脚本',exact:true}).click();console.log('已从桌面商品宣传页面提交真实图片识别和脚本任务');
 }else if(mode==='status'){
  const state=await page.evaluate(()=>window.studio.invoke('state')),draft=state.drafts.find(d=>d.id===state.currentId);console.log(JSON.stringify({draftId:draft.id,step:draft.step,voice:draft.voice,product:draft.product,runs:state.runs.filter(r=>r.draftId===draft.id).map(r=>({id:r.id,type:r.type,status:r.status,progress:r.progress,log:r.logs?.at(-1)?.message,error:r.error,output:r.type==='product-script'?{text:r.output?.text,visual:r.output?.visual}:r.type==='product-video'?{asset:r.output?.asset,duration:r.output?.duration,stale:r.output?.stale}:undefined})),uiError:await page.locator('.product-error').allTextContents(),errors},null,2));
 }else if(mode==='render'){
  await page.getByRole('button',{name:'生成商品宣传视频',exact:true}).click();console.log('已从第四步商品宣传页面提交视频合成任务，复用第三步已有音频');
 }else if(mode==='use'){
  await page.getByRole('button',{name:'使用此视频，进入网感剪辑',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.page-title')?.textContent.includes('网感剪辑'));await page.screenshot({path:path.join(folder,'product-handoff-ui.png'),fullPage:true});console.log('已通过页面选用成片并进入网感剪辑');
 }else throw Error('不支持的验证阶段');
 }finally{await browser.close();}}
main().catch(error=>{console.error(error);process.exitCode=1;});
