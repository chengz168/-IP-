const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles'),stateFile=path.resolve('evidence/validation/pip-desktop-workspace/studio.json'),original=JSON.parse(fs.readFileSync(path.join(root,'original-desktop-baseline.json'))),read=()=>JSON.parse(fs.readFileSync(stateFile));assert.deepEqual(read(),original);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  async function save(){await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.operation-status'));}
  try{
    await menu('设置');await page.getByRole('textbox',{name:'本地字体目录',exact:true}).fill('F:\\Software\\轻语IP智能体\\aigc-human\\resources\\fonts');await page.getByRole('textbox',{name:'本地注音Python',exact:true}).fill('C:\\Python314\\python.exe');await save();
    await page.locator('.settings-nav').getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'填写本机Ollama地址',exact:true}).click();await page.getByRole('spinbutton',{name:'本地上下文长度',exact:true}).fill('8192');await page.getByRole('textbox',{name:'文本模型',exact:true}).fill('qwen3.5:9b-q4_K_M');await save();
    const expected=structuredClone(original);Object.assign(expected.settings,{subtitleFontsDir:'F:\\Software\\轻语IP智能体\\aigc-human\\resources\\fonts',subtitlePythonPath:'C:\\Python314\\python.exe',mode:'own'});Object.assign(expected.settings.provider,{textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434/v1',model:'qwen3.5:9b-q4_K_M',textMaxTokens:'2048',textContextTokens:'8192'});assert.deepEqual(read(),expected);
    const changes=[];for(const key of ['subtitleFontsDir','subtitlePythonPath','mode'])if(original.settings[key]!==expected.settings[key])changes.push({field:'settings.'+key,before:original.settings[key]??null,after:expected.settings[key]});for(const key of ['textProtocol','baseUrl','model','textMaxTokens','textContextTokens'])if(original.settings.provider[key]!==expected.settings.provider[key])changes.push({field:'settings.provider.'+key,before:original.settings.provider[key]??null,after:expected.settings.provider[key]});
    await menu('新工作流');const close=page.getByRole('button',{name:'关闭提示',exact:true});if(await close.count())await close.click();await page.screenshot({path:path.join(root,'returned-original-workspace.png')});const report={checkedAt:new Date().toISOString(),originalBusinessJsonUnchangedBeforeConfiguration:true,allOriginalDraftsUnchanged:true,allOtherBusinessDataUnchanged:true,configurationChanges:changes,configuredViaActualUi:true};fs.writeFileSync(path.join(root,'current-workspace-configuration.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
