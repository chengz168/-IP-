// 只经真实产品页面提交链接任务，保留失败与已有任务，观察不重复生成。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'evidence/validation/douyin-product-flow-20261116');
const workspace=path.join(root,'workspaces/local-studio'),mode=process.argv[2]||'inspect';
fs.mkdirSync(dir,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2),{flag:'wx'});
const share='7.12 复制打开抖音，看看【蜗牛景气研的作品】社保重仓系列，商业航天产业链8家核心企业梳理！ https://v.douyin.com/c5Ynfkbz5i8/ 09/03 X@M.jC :6pm lpQ:/';
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9375');
 try{
  const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);await page.locator('.steps>button').first().waitFor();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const state=()=>page.evaluate(()=>window.studio.invoke('state',{}));
  if(mode==='inspect'){console.log(JSON.stringify({buttons:await page.getByRole('button').allTextContents(),state:(await state()).currentId}));return}
  if(mode==='extract'){
   assert(!fs.existsSync(path.join(dir,'extract-intent.json')),'已有提交意图，请观察原任务');
   const before=await state();assert(!before.runs.some(run=>['running','queued'].includes(run.status)));
   write('baseline.json',{at:new Date().toISOString(),workspace,currentId:before.currentId,drafts:before.drafts,runIds:before.runs.map(run=>run.id)});
   await page.getByRole('button',{name:'开始新任务',exact:true}).click();
   await page.getByRole('textbox',{name:'视频链接',exact:true}).fill(share);
   const draftId=(await state()).currentId;assert.notEqual(draftId,before.currentId);
   write('extract-intent.json',{at:new Date().toISOString(),draftId,share,actualProductInput:true,actualProductButton:true});
   await page.getByRole('button',{name:'提取文案',exact:true}).last().click();
   await page.waitForFunction(async id=>(await window.studio.invoke('state',{})).runs.some(run=>run.draftId===id&&run.type==='extract'),draftId);
   const after=await state(),run=after.runs.find(run=>run.draftId===draftId&&run.type==='extract');
   write('extract-submitted.json',{at:new Date().toISOString(),draftId,runId:run.id,run,pageErrors:errors});
   await page.screenshot({path:path.join(dir,'product-extract-submitted.png')});
   console.log(JSON.stringify({draftId,runId:run.id,status:run.status,error:run.error}));return;
  }
  if(mode==='status'){
   const submitted=JSON.parse(fs.readFileSync(path.join(dir,'extract-submitted.json'),'utf8'));
   const data=await state(),run=data.runs.find(run=>run.id===submitted.runId),draft=data.drafts.find(draft=>draft.id===submitted.draftId);
   console.log(JSON.stringify({run,draft:{id:draft.id,sourceUrl:draft.sourceUrl,sourceText:draft.sourceText}}));
   if(!['running','queued'].includes(run.status)&&!fs.existsSync(path.join(dir,'extract-result.json'))){write('extract-result.json',{at:new Date().toISOString(),run,draft,pageErrors:errors});await page.screenshot({path:path.join(dir,'product-extract-result.png')});}
   return;
  }
  throw Error('未知动作');
 }finally{await browser.close()}
}
main().catch(error=>{fs.appendFileSync(path.join(dir,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode,error:error.stack})+'\n');console.error(error);process.exitCode=1});
