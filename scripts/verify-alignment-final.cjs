const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/alignment');
async function menu(page,name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
async function font(page,name){await menu(page,'设置');await page.locator('.settings-nav').getByRole('button',{name:'常规设置',exact:true}).click();await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name,exact:true}).click();await page.getByRole('button',{name:'关闭提示',exact:true}).click();}
function resize(width,height){const r=spawnSync('python',['scripts/resize-desktop.py','--handle',process.argv[2],'--width',String(width),'--height',String(height)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
async function main(){const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],report={checkedAt:new Date().toISOString()};try{
 resize(1100,760);await page.waitForFunction(()=>innerWidth===1100);await font(page,'大');await menu(page,'新工作流');await page.locator('.steps>button').nth(5).click();await page.waitForFunction(()=>!document.querySelector('.cover-painting'));
 const canvas=page.getByLabel('封面编辑画布',{exact:true});report.canvas=await canvas.boundingBox();assert.ok(report.canvas.width>=135&&report.canvas.height>=240);
 await page.getByRole('tab',{name:'文本图层',exact:true}).click();const layer=page.getByRole('button',{name:'选择文字图层1',exact:true});await layer.click();await page.getByLabel('位置 X',{exact:true}).waitFor();
 await page.locator('.stage-body').evaluate(e=>e.scrollTop=e.scrollHeight);await page.getByRole('button',{name:'生成封面',exact:true}).click({trial:true});await page.locator('.cover-preview>.toolbar').getByRole('button',{name:'添加文本',exact:true}).click({trial:true});
 report.actionsReachable=true;await page.screenshot({path:path.join(root,'small-large-cover-actions.png')});
 await page.locator('.stage-body').evaluate(e=>e.scrollTop=0);await page.getByRole('tab',{name:'模板',exact:true}).click();await page.locator('.cover-option-body').evaluate(e=>e.scrollTop=0);await page.waitForFunction(()=>[...document.querySelectorAll('.cover-template-select>img')].length===15);await page.screenshot({path:path.join(root,'small-large-cover-preview.png')});
}finally{try{resize(1400,1000);await font(page,'舒适');await menu(page,'新工作流');await page.locator('.steps>button').nth(1).click();}finally{await browser.close();}}
fs.writeFileSync(path.join(root,'interaction-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
main().catch(e=>{console.error(e);process.exitCode=1;});
