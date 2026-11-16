const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles'),fixture=JSON.parse(fs.readFileSync(path.join(root,'desktop-fixture.json'))),read=()=>JSON.parse(fs.readFileSync(path.join(fixture.workspace,'studio.json')));
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],report={checkedAt:new Date().toISOString(),pageErrors:[]};page.on('pageerror',error=>report.pageErrors.push(error.message));page.setDefaultTimeout(15000);
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  try{
    await menu('设置');const field=page.getByRole('textbox',{name:'本地注音Python',exact:true});await field.fill('C:\\Python314\\python.exe');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.operation-status'));assert.equal(read().settings.subtitlePythonPath,'C:\\Python314\\python.exe');
    await page.reload();await menu('设置');assert.equal(await field.inputValue(),'C:\\Python314\\python.exe');await field.scrollIntoViewIfNeeded();
    const rect=await field.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=1400);const close=page.getByRole('button',{name:'关闭提示',exact:true});if(await close.count())await close.click();await page.screenshot({path:path.join(root,'python-setting.png')});
    await menu('新工作流');await page.locator('.steps>button').nth(4).click();await page.locator('.edit-nav').getByRole('button',{name:'字幕',exact:false}).click();await page.getByRole('button',{name:'白色注音',exact:true}).click();await page.getByRole('checkbox',{name:'关键词高亮',exact:true}).uncheck();await page.getByRole('button',{name:'剪辑视频',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.operation-status'),{},{timeout:180000});
    const current=read(),draft=current.drafts.find(d=>d.id===fixture.id),result=current.assets.find(a=>a.id===draft.edit.resultId);assert.equal(result?.renderedSubtitleTemplate?.templateId,'white_pinyin');assert.equal(result.renderedSubtitleTemplate.pinyin[0][0],'rèn');report.result=result;report.assertions=['注音Python通过实际设置表单保存并在刷新后恢复','显式选择已有pypinyin环境后，桌面正式剪辑再次成功'];assert.deepEqual(report.pageErrors,[]);fs.writeFileSync(path.join(root,'python-setting-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({assertions:report.assertions,result:result.path,pageErrors:report.pageErrors}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
