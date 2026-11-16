const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const ui=require('./ui-subtitle-custom.cjs');
const typography=require('./ui-typography.cjs');
const root=path.resolve('evidence/validation/subtitle-font-menu');
const stateFile=path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function disk(predicate){for(let index=0;index<100;index++){const state=read();if(predicate(state))return state;await sleep(50);}throw new Error('等待字体参数落盘超时');}
async function snapshot(page,name){await page.mouse.move(10,30);await page.screenshot({path:path.join(root,name+'.png')});}
async function main(){
  fs.mkdirSync(root,{recursive:true});
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0];
  const report={checkedAt:new Date().toISOString(),assertions:[],layouts:[],pageErrors:[]};page.on('pageerror',error=>report.pageErrors.push(error.message));
  const combo=()=>page.getByRole('combobox',{name:'字幕字体',exact:true});
  try{
    const action=process.argv[2]||'functional';
    if(action==='prepare'){
      assert.ok(!fs.existsSync(path.join(root,'baseline.json')),'已有本批基线，不能覆盖');
      fs.writeFileSync(path.join(root,'baseline.json'),fs.readFileSync(stateFile));await page.reload();
      await ui.menu(page,'任务中心');await page.getByRole('button',{name:'新建任务',exact:true}).click();
      const original=JSON.parse(fs.readFileSync(path.join(root,'baseline.json')));
      const state=await disk(s=>s.currentId!==original.currentId);fs.writeFileSync(path.join(root,'temporary-id.txt'),state.currentId);
      await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('字体菜单独立验收');await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.title==='字体菜单独立验收');
      await page.locator('.steps>button').nth(4).click();await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.step===4);await ui.open(page);await snapshot(page,'menu-before-open');
    }else if(action==='functional'){
      const resizedStart=spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(resizedStart.status,0);
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      await typography.choose(page,JSON.parse(fs.readFileSync(path.join(root,'baseline.json'))).settings.fontSize);await ui.menu(page,'新工作流');await page.reload();
      if(!await page.locator('.subtitle-editor').count())await ui.open(page);
      if(await page.getByRole('listbox').count())await combo().press('Escape');
      await combo().click();await page.getByRole('listbox',{name:'字幕字体选项'}).waitFor();await snapshot(page,'menu-initial');
      const catalog=await page.evaluate(()=>window.studio.invoke('listSubtitleFonts',{}));assert.ok(catalog.length>4);
      const first=catalog.filter(f=>f.source==='local').sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'))[0];
      if(first){await combo().press('Home');const actual=await page.getByRole('listbox').locator('[data-active="true"]').innerText();assert.equal(actual,first.label);report.assertions.push('已配置目录中的字体优先显示');}
      await combo().press('Escape');assert.equal(await page.getByRole('listbox').count(),0);assert.equal(await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).count(),1);
      report.assertions.push('真实系统目录字体列表，Escape只关列表且保留编辑器');
      const before=fs.readFileSync(stateFile,'utf8');
      await combo().press('ArrowDown');await combo().press('End');const endText=await page.getByRole('listbox').locator('[data-active="true"]').innerText();await combo().press('Enter');await ui.ready(page);assert.equal(await combo().innerText(),endText);assert.equal(fs.readFileSync(stateFile,'utf8'),before);
      await combo().click();await combo().press('Home');await combo().press('ArrowDown');await combo().press('PageDown');await combo().press('PageUp');await combo().press(' ');await ui.ready(page);
      await combo().click();await combo().press('s');const active=await page.getByRole('listbox').locator('[data-active="true"]').innerText();assert.ok(catalog.some(f=>f.label===active&&(f.label.toLowerCase().startsWith('s')||f.family.toLowerCase().startsWith('s'))));await combo().press('Escape');
      await combo().click();await combo().press('Tab');assert.equal(await page.getByRole('listbox').count(),0);assert.equal(await page.getByLabel('字幕字号滑块',{exact:true}).evaluate(el=>el===document.activeElement),true);
      report.assertions.push('上下键/Home/End/翻页/输入前缀/Enter/空格和Tab实际操作，选择暂存不写业务文件');
      await combo().click();await page.getByText('预览效果',{exact:true}).click();assert.equal(await page.getByRole('listbox').count(),0);await ui.ready(page);
      const chosen=catalog.find(f=>f.family==='FZCuHeiSongS-B-GB')||catalog.find(f=>f.family==='Microsoft YaHei');assert.ok(chosen);
      await combo().click();await page.getByRole('option',{name:chosen.label,exact:true}).first().click();await ui.ready(page);
      assert.equal((await combo().innerText()).trim(),chosen.label);await snapshot(page,'font-chosen');
      await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(fs.readFileSync(stateFile,'utf8'),before);await ui.open(page);assert.equal((await combo().innerText()).trim(),chosen.label);
      await page.getByRole('button',{name:'确认设置',exact:true}).click();await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).waitFor({state:'hidden'});
      const saved=await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.edit.subtitleCustom?.fontId===chosen.id);assert.equal(saved.drafts.find(d=>d.id===saved.currentId).edit.subtitleCustom.fontFamily,chosen.family);
      await page.reload();await ui.open(page);assert.equal((await combo().innerText()).trim(),chosen.label);await snapshot(page,'saved-font-reloaded');
      report.chosenFont=chosen;report.localDirectoryConfigured=!!read().settings.subtitleFontsDir;
      report.assertions.push('外部点击收起、所选系统目录字体实际预览、取消不写盘且重开保留、确认保存fontId/fontFamily与刷新恢复');
      await combo().click();await combo().press('Home');await page.waitForFunction(()=>document.querySelector('[role=listbox]')?.scrollTop<=4);const rect=await page.getByRole('listbox').boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.wheel(0,450);await page.waitForFunction(()=>document.querySelector('[role=listbox]')?.scrollTop>4);assert.equal(await page.getByRole('listbox').count(),1);await combo().press('Escape');
      await combo().click();const resized=spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width','1390','--height','1000'],{encoding:'utf8'});assert.equal(resized.status,0);await page.getByRole('listbox').waitFor({state:'hidden'});const restore=spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(restore.status,0);
      report.assertions.push('菜单实际滚轮保持展开，窗口尺寸变化后菜单收起');
      assert.deepEqual(report.pageErrors,[]);fs.writeFileSync(path.join(root,'functional-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    }else if(action==='layouts'){
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      for(const [width,height]of [[1400,1000],[1100,760]]){
        const resized=spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width',String(width),'--height',String(height)],{encoding:'utf8'});assert.equal(resized.status,0);
        await page.waitForFunction(size=>innerWidth===size[0]&&innerHeight===size[1],[width,height]);
        for(const font of ['compact','standard','comfortable','large']){
          await typography.choose(page,font);await ui.menu(page,'新工作流');await ui.open(page);await combo().click();
          const geometry=await page.locator('.subtitle-font-picker').evaluate(el=>{
            const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
            const trigger=box(el.querySelector('[role=combobox]')),list=box(el.querySelector('[role=listbox]')),footer=box(el.closest('.modal').querySelector('.subtitle-editor-footer')),issues=[];
            const size=box(el.closest('.subtitle-font-row').querySelector('.subtitle-range-value'));if(Math.abs(trigger.y-size.y)>1||Math.abs(trigger.height-size.height)>1)issues.push('字体与字号控件未等高对齐');
            if(Math.abs(trigger.x-list.x)>1||Math.abs(trigger.width-list.width)>1)issues.push('列表与触发框左边或宽度不同');
            if(list.x<0||list.right>innerWidth||list.y<0||list.bottom>innerHeight)issues.push('菜单超出窗口');
            if(list.bottom>footer.y&&list.y<footer.bottom)issues.push('菜单覆盖固定页脚');
            const selected=el.querySelector('[role=option][aria-selected=true]');if(selected){const r=box(selected);if(r.bottom>list.bottom+1||r.y<list.y-1)issues.push('选中字体未滚入视野');}
            for(const button of el.closest('.modal').querySelectorAll('.subtitle-editor-footer button')){const r=box(button),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!button.contains(top))issues.push('页脚按钮被遮挡');}
            return {trigger,list,footer,issues};
          });
          await snapshot(page,`${width}-${font}-menu`);report.layouts.push({width,height,font,...geometry});assert.deepEqual(geometry.issues,[]);
          await combo().press('End');await combo().press('Home');await combo().press('Escape');await page.getByRole('button',{name:'取消',exact:true}).click();
        }
      }
      assert.deepEqual(report.pageErrors,[]);fs.writeFileSync(path.join(root,'layout-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    }else if(action==='cleanup'){
      if(await page.locator('.subtitle-editor').count())await page.getByRole('button',{name:'取消',exact:true}).click();
      const original=JSON.parse(fs.readFileSync(path.join(root,'baseline.json'))),id=fs.readFileSync(path.join(root,'temporary-id.txt'),'utf8');
      const resized=spawnSync('python',['scripts/resize-desktop.py','--handle','2230340','--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(resized.status,0);await typography.choose(page,original.settings.fontSize);
      await ui.menu(page,'任务中心');await page.locator('.draft-task-table tbody tr').filter({hasText:'字体菜单独立验收'}).getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/确定|删除/}).last().click();await disk(s=>!s.drafts.some(d=>d.id===id));
      await page.locator('.draft-task-table tbody tr').filter({hasText:original.drafts.find(d=>d.id===original.currentId).title}).getByRole('button',{name:'继续',exact:true}).click();await disk(s=>s.currentId===original.currentId);assert.deepEqual(read(),original);
      fs.writeFileSync(path.join(root,'cleanup.json'),JSON.stringify({completeBusinessJsonRestored:true,temporaryTaskRemoved:true},null,2));console.log('UI清理完成，完整业务JSON与本批开始前一致');
    }
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
