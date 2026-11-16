const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles'),browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],handle=process.argv[2];page.setDefaultTimeout(15000);
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  try{
    const resized=spawnSync('python',['scripts/resize-desktop.py','--handle',handle,'--width','1100','--height','760'],{encoding:'utf8'});assert.equal(resized.status,0);await menu('设置');await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:'大',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.fontSize==='large');await menu('新工作流');await page.locator('.steps>button').nth(4).click();await page.locator('.edit-nav').getByRole('button',{name:'字幕',exact:false}).click();await page.getByRole('button',{name:'3D 翻转',exact:true}).click();
    const summary=page.locator('.edit-nav>button.active small');assert.equal(await summary.innerText(),'3D 翻转 · 关键词高亮');const geometry=await summary.evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,lineHeight:parseFloat(getComputedStyle(e).lineHeight),whiteSpace:getComputedStyle(e).whiteSpace}));assert.ok(geometry.scrollWidth<=geometry.width+1);assert.ok(geometry.height>geometry.lineHeight);const close=page.getByRole('button',{name:'关闭提示',exact:true});if(await close.count())await close.click();await page.screenshot({path:path.join(root,'1100-large-long-summary.png')});fs.writeFileSync(path.join(root,'long-summary-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),width:1100,height:760,font:'large',summary:'3D 翻转 · 关键词高亮',geometry,issues:[]},null,2));console.log(JSON.stringify(geometry));
    const restored=spawnSync('python',['scripts/resize-desktop.py','--handle',handle,'--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(restored.status,0);await menu('设置');await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:'舒适',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.fontSize==='comfortable');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
