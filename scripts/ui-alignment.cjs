const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const audit=require('./audit-layout.cjs'),root=path.resolve('evidence/validation/alignment');
const labels={compact:'紧凑',standard:'标准',comfortable:'舒适',large:'大'};
async function menu(page,label){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name:label,exact:true}).click();}
async function font(page,id){await menu(page,'设置');await page.locator('.settings-nav').getByRole('button',{name:'常规设置',exact:true}).click();await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:labels[id],exact:true}).click();await page.waitForFunction(id=>document.documentElement.dataset.fontSize===id,id);await page.waitForFunction(()=>!document.querySelector('.operation-status'));}
async function main(){fs.mkdirSync(root,{recursive:true});const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');const page=browser.contexts()[0].pages()[0],initial=await page.evaluate(()=>window.studio.invoke('state')),report={checkedAt:new Date().toISOString(),layouts:[],scope:'两窗口四字号逐页边界、对齐、步骤行中心、状态条间距和截图；不代表逐像素一致'};
try{
 report.initialFontSize=initial.settings.fontSize;report.initialStep=initial.drafts.find(d=>d.id===initial.currentId).step;
 if(process.argv[3]==='resume'){const prior=JSON.parse(fs.readFileSync(path.join(root,'layout-report.json')));report.layouts=prior.layouts;report.initialFontSize=prior.initialFontSize||'comfortable';report.initialStep=prior.initialStep??1;}
 await page.reload();await page.locator('.steps>button').first().waitFor();
 for(const [width,height] of [[1400,1000],[1100,760]]){
  const resized=spawnSync('python',['scripts/resize-desktop.py','--handle',process.argv[2],'--width',String(width),'--height',String(height)],{encoding:'utf8'});assert.equal(resized.status,0,resized.stderr);
  await page.waitForFunction(w=>innerWidth===w,width);
  for(const id of Object.keys(labels)){
   const label=`${process.argv[4]||'alignment'}-${id}-${width}x${height}`;if(report.layouts.some(r=>r.label===label))continue;await font(page,id);const result=await audit(page,label);report.layouts.push(result);fs.writeFileSync(path.join(root,'layout-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(result));
  }
 }
 assert.deepEqual(report.layouts.flatMap(r=>r.issues),[]);assert.deepEqual(report.layouts.flatMap(r=>r.pageErrors),[]);
}catch(error){report.error=error.stack;fs.writeFileSync(path.join(root,'layout-failure.json'),JSON.stringify(report,null,2));throw error;
}finally{
 try{const resized=spawnSync('python',['scripts/resize-desktop.py','--handle',process.argv[2],'--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(resized.status,0,resized.stderr);await font(page,report.initialFontSize);await menu(page,'新工作流');await page.locator('.steps>button').nth(report.initialStep).click();}finally{await browser.close();}
}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
