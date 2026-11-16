const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-generation'),label=process.argv[2],read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
async function main(){
 if(!['normal','happy','fast'].includes(label))throw Error('请指定normal、happy或fast');
 const submission=read('submit-'+label+'.json'),b=await chromium.connectOverCDP('http://127.0.0.1:9342'),p=b.contexts()[0].pages()[0],report={at:new Date().toISOString(),label,audioAudited:false,qualityAccepted:false};
 try{
  const state=await p.evaluate(()=>window.studio.invoke('state')),run=state.runs.find(item=>item.id===submission.run?.id),draft=state.drafts.find(item=>item.id===submission.draftId);
  assert.equal(run?.status,'succeeded');assert.equal(draft.voice.audioId,run.output.id);
  const player=p.locator('.audio-result audio[controls]');await player.waitFor();await p.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.readyState>=2);
  await player.focus();await player.press('Space');
  await p.waitForFunction(()=>{const a=document.querySelector('.audio-result audio[controls]');return a.currentTime>.2&&!a.paused;});
  report.playing=await player.evaluate(a=>({time:a.currentTime,duration:a.duration,src:a.currentSrc}));
  await p.screenshot({path:path.join(directory,label+'-playing.png')});
  await p.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.ended,{},{timeout:60000});
  report.ended=await player.evaluate(a=>({ended:a.ended,time:a.currentTime,duration:a.duration,error:a.error?.message||''}));
  await p.reload();await p.locator('.voice-config').waitFor();const refreshed=await p.evaluate(()=>window.studio.invoke('state'));
  assert.equal(refreshed.drafts.find(item=>item.id===draft.id).voice.audioId,run.output.id);report.bindingAfterReload=true;report.fullNativePlaybackToEnded=true;report.runId=run.id;report.assetId=run.output.id;
 }catch(error){report.error=error.stack;throw error;}
 finally{fs.writeFileSync(path.join(directory,label+'-playback.json'),JSON.stringify(report,null,2));await b.close();}
 console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
