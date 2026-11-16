const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/subtitle-layout-refine');
process.env.SUBTITLE_CUSTOM_EVIDENCE=root;
const stateFile=path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ui=require('./ui-subtitle-custom.cjs');
async function disk(test){for(let i=0;i<100;i++){const data=read();if(test(data))return data;await pause(50);}throw new Error('等待实际落盘超时');}
async function menu(page,name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
async function capture(page,name){
  await ui.ready(page);await page.mouse.move(10,30);
  const geometry=await page.locator('.subtitle-editor').evaluate(el=>{
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {modal:box(el.closest('.modal')),pane:box(el.querySelector('.subtitle-settings-pane')),fields:box(el.querySelector('.subtitle-style-fields')),controls:[...el.querySelectorAll('.subtitle-preset-grid>button,.subtitle-font-row label,.subtitle-font-toggles>button,.subtitle-two-fields>label,.subtitle-editor-footer>button')].map(e=>({text:e.textContent.trim(),...box(e)}))};
  });
  await page.screenshot({path:path.join(root,name+'.png')});fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify(geometry,null,2));return geometry;
}
async function main(){
  fs.mkdirSync(root,{recursive:true});const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page=browser.contexts()[0].pages()[0];
  try{
    const action=process.argv[2]||'inspect';
    if(action==='prepare'){
      if(fs.existsSync(path.join(root,'baseline.json')))throw new Error('已有本批基线，不能覆盖');
      fs.writeFileSync(path.join(root,'baseline.json'),fs.readFileSync(stateFile));
      await menu(page,'任务中心');await page.getByRole('button',{name:'新建任务',exact:true}).click();
      const current=await disk(s=>s.currentId!==JSON.parse(fs.readFileSync(path.join(root,'baseline.json'))).currentId);
      fs.writeFileSync(path.join(root,'temporary-id.txt'),current.currentId);
      await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('字幕布局校正临时验收');await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.title==='字幕布局校正临时验收');
      await page.locator('.steps>button').nth(4).click();await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.step===4);
      await ui.open(page);await page.getByRole('button',{name:'重置默认',exact:true}).click();await page.getByRole('button',{name:'简约白字',exact:true}).click();await page.getByRole('button',{name:'竖版',exact:true}).click();await capture(page,'before-simple');
    }else if(action==='capture'){
      if(!await page.locator('.subtitle-editor').count())await ui.open(page);
      await page.getByRole('button',{name:'重置默认',exact:true}).click();await page.getByRole('button',{name:'竖版',exact:true}).click();
      await page.getByRole('button',{name:'简约白字',exact:true}).click();await capture(page,'after-simple');
      await page.getByRole('button',{name:'黑色背景',exact:true}).click();await capture(page,'after-black-background');
    }else if(action==='review'){
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      const resized=require('node:child_process').spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(resized.status,0);
      await require('./ui-typography.cjs').choose(page,'comfortable');await menu(page,'新工作流');await ui.open(page);await page.getByRole('button',{name:'重置默认',exact:true}).click();
      await page.getByRole('button',{name:'简约白字',exact:true}).click();await capture(page,'after-simple');await page.getByRole('button',{name:'黑色背景',exact:true}).click();await capture(page,'after-black-background');
    }else if(action==='functional'){
      const report={checkedAt:new Date().toISOString(),assertions:[],pageErrors:[]};page.on('pageerror',e=>report.pageErrors.push(e.message));
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      const typo=require('./ui-typography.cjs');await typo.choose(page,'comfortable');await typo.choose(page,'large');await menu(page,'新工作流');
      await ui.open(page);assert.equal(await page.locator('.toast').count(),0);report.assertions.push('字号成功提示在新弹窗打开时清理，不遮挡操作');
      await page.getByRole('button',{name:'重置默认',exact:true}).click();await page.getByRole('button',{name:'简约白字',exact:true}).click();await ui.ready(page);
      const before=fs.readFileSync(stateFile,'utf8');
      try{
        fs.chmodSync(stateFile,0o444);await page.getByRole('button',{name:'确认设置',exact:true}).click();await page.getByRole('alert').filter({hasText:'字幕样式保存失败'}).waitFor();assert.equal(fs.readFileSync(stateFile,'utf8'),before);
        assert.equal(await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).count(),1);assert.equal(await page.getByLabel('字幕字号',{exact:true}).inputValue(),'50');assert.equal(await page.locator('.toast.error').count(),0);
        const visible=await page.locator('.subtitle-editor-footer>button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top===button||button.contains(top);}));assert.equal(visible,true);
        await page.screenshot({path:path.join(root,'actual-write-failure-large-1100.png')});report.assertions.push('真实业务文件只读：旧数据不变，错误在弹窗内，输入保留且全部页脚按钮可操作');
      }finally{fs.chmodSync(stateFile,0o666);}
      await page.getByRole('button',{name:'确认设置',exact:true}).click();await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).waitFor({state:'hidden'});
      await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.edit.subtitleCustom?.fontSize===50);await page.reload();await ui.open(page);assert.equal(await page.getByLabel('字幕字号',{exact:true}).inputValue(),'50');await page.getByRole('button',{name:'取消',exact:true}).click();
      report.assertions.push('恢复可写后确认成功，刷新后已保存字幕参数恢复');assert.deepEqual(report.pageErrors,[]);fs.writeFileSync(path.join(root,'functional-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    }else if(action==='layouts'){
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      const report={checkedAt:new Date().toISOString(),groups:[],pageErrors:[]};page.on('pageerror',e=>report.pageErrors.push(e.message));
      for(const [width,height] of [[1400,1000],[1100,760]]){
        const resized=require('node:child_process').spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width',String(width),'--height',String(height)],{encoding:'utf8'});if(resized.status!==0)throw new Error(resized.stderr||resized.stdout);
        await page.waitForFunction(size=>innerWidth===size[0]&&innerHeight===size[1],[width,height]);
        for(const font of ['compact','standard','comfortable','large']){
          await require('./ui-typography.cjs').choose(page,font);await menu(page,'新工作流');
          const group=await ui.layout(page,width+'x'+height,font);report.groups.push(group);fs.writeFileSync(path.join(root,'layout-report.json'),JSON.stringify(report,null,2));
        }
      }
      assert.deepEqual(report.groups.flatMap(g=>g.issues),[]);assert.deepEqual(report.pageErrors,[]);assert.ok(report.groups.every(g=>g.pageErrors.length===0));console.log(JSON.stringify({groups:report.groups.length,states:report.groups.reduce((sum,g)=>sum+g.states,0),issues:report.groups.flatMap(g=>g.issues),pageErrors:report.pageErrors}));
    }else if(action==='cleanup'){
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      const baseline=JSON.parse(fs.readFileSync(path.join(root,'baseline.json'))),id=fs.readFileSync(path.join(root,'temporary-id.txt'),'utf8');
      const resized=require('node:child_process').spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(resized.status,0);
      await require('./ui-typography.cjs').choose(page,baseline.settings.fontSize);
      await menu(page,'任务中心');const row=page.locator('.draft-task-table tbody tr').filter({hasText:'字幕布局校正临时验收'});
      await row.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/确定|删除/}).last().click();await disk(s=>!s.drafts.some(d=>d.id===id));
      const original=baseline.drafts.find(d=>d.id===baseline.currentId);
      await page.locator('.draft-task-table tbody tr').filter({hasText:original.title}).getByRole('button',{name:'继续',exact:true}).click();
      await disk(s=>s.currentId===baseline.currentId);assert.deepEqual(read(),baseline);fs.writeFileSync(path.join(root,'cleanup.json'),JSON.stringify({completeBusinessJsonRestored:true,originalId:baseline.currentId},null,2));
      console.log('临时任务通过UI删除，完整业务JSON与本轮开始前一致');
    }else console.log((await page.locator('body').innerText()).slice(0,1800));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
