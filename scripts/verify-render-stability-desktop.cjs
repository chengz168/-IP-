const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/render-stability-20261115');
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9348'),page=browser.contexts()[0].pages()[0],errors=[];
 page.on('pageerror',error=>errors.push(error.message));const state=()=>page.evaluate(()=>window.studio.invoke('state'));
 try{
  await page.locator('.shared-edit-preview').waitFor();
  const initial=await state(),avatarCount=initial.runs.filter(run=>run.type==='avatar').length,renderIds=new Set(initial.runs.filter(run=>run.type==='render').map(run=>run.id));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'desktop-runtime.json'),'utf8')).electron,'40.10.6');
  const renders=[];
  for(let iteration=0;iteration<3;iteration++){
   assert(!(await state()).runs.some(run=>['running','queued','unknown'].includes(run.status)));
   await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
   let run;const deadline=Date.now()+90000;
   while(Date.now()<deadline){run=(await state()).runs.find(run=>run.type==='render'&&!renderIds.has(run.id));if(run&&!['queued','running'].includes(run.status))break;await page.waitForTimeout(200);}
   assert.equal(run?.status,'succeeded',run?.error||'没有完成真实剪辑');renderIds.add(run.id);renders.push({iteration:iteration+1,id:run.id,outputId:run.output.id});
   fs.writeFileSync(path.join(directory,'desktop-render-progress.json'),JSON.stringify({renders},null,2));
  }
  const video=page.getByLabel('剪辑成片视频',{exact:true});await video.waitFor();
  await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.readyState>=2);
  await video.evaluate(node=>{node.currentTime=0;node.muted=false;});await video.focus();await video.press('Space');
  await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.currentTime>.3);
  await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.ended,null,{timeout:20000});
  const playback=await video.evaluate(node=>({duration:node.duration,time:node.currentTime,ended:node.ended,error:node.error?.message||''}));assert.equal(playback.error,'');
  const before=await state(),assetId=before.drafts.find(item=>item.id===before.currentId).edit.resultId;
  await page.reload();await page.locator('.shared-edit-preview').waitFor();await video.waitFor();const after=await state();
  assert.equal(after.drafts.find(item=>item.id===after.currentId).edit.resultId,assetId);assert.equal(after.runs.length,before.runs.length);assert.equal(after.runs.filter(run=>run.type==='avatar').length,avatarCount);
  await video.evaluate(node=>{node.pause();node.currentTime=.7;});
  await page.waitForFunction(()=>{const node=document.querySelector('video[aria-label="剪辑成片视频"]');return node&&!node.seeking&&node.readyState>=3&&Math.abs(node.currentTime-.7)<.02;});
  await page.screenshot({path:path.join(directory,'desktop-final.png')});assert.deepEqual(errors,[]);
  const report={at:new Date().toISOString(),electron:'40.10.6',passed:true,submittedThroughProductButton:true,renders,playback,refreshBinding:true,additionalModelSubmissions:0,pageErrors:errors,sourceAssetReused:true,qualityAccepted:false};
  fs.writeFileSync(path.join(directory,'desktop-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
}
main().catch(error=>{fs.writeFileSync(path.join(directory,'desktop-failure.json'),JSON.stringify({at:new Date().toISOString(),error:error.stack},null,2));console.error(error);process.exitCode=1;});
