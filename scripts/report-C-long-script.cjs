// 汇总新稿真实生成与播放证据，程序检查不冒充人工听感验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'../evidence/validation/voice-C-long-script-20261116');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
function alive(pid){try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
// 仅用字符对齐标记需要复听的位置，不据自动转写断言模型实际读错。
function differences(expected,actual){
 const rows=Array.from({length:expected.length+1},()=>new Uint16Array(actual.length+1));
 for(let i=expected.length-1;i>=0;i--)for(let j=actual.length-1;j>=0;j--)rows[i][j]=expected[i]===actual[j]?rows[i+1][j+1]+1:Math.max(rows[i+1][j],rows[i][j+1]);
 let i=0,j=0,active=null;const output=[];
 while(i<expected.length||j<actual.length){
  if(i<expected.length&&j<actual.length&&expected[i]===actual[j]){if(active){output.push(active);active=null}i++;j++;continue}
  if(!active)active={expectedStart:i,actualStart:j,expected:'',actual:'',context:expected.slice(Math.max(0,i-8),i+14)};
  if(i<expected.length&&(j===actual.length||rows[i+1][j]>=rows[i][j+1]))active.expected+=expected[i++];else active.actual+=actual[j++];
 }
 if(active)output.push(active);return output;
}
async function main(){
 const generated=read('generated.json'),inspection=read('inspection.json'),playback=read('playback.json'),input=read('prepared.json'),launch=read('launch.json');
 assert(inspection.fullDecode&&playback.fullNativeUnmutedPlayback&&playback.refreshBinding&&playback.noNewTasksAfterReload);
 assert.equal(inspection.signal.fullScaleSamples,0);assert.equal(digest(generated.file),generated.sha256);assert.equal(generated.sha256,inspection.sha256);
 assert(!fs.existsSync(path.join(root,'delivery-report.json')),'保留已有交付回执');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+launch.port);let closeConnectionError=null;
 try{
  const pages=browser.contexts().flatMap(context=>context.pages());assert.equal(pages.length,1);
  const page=pages[0],data=await page.evaluate(()=>window.studio.invoke('state',{}));
  assert.equal(data.currentId,input.draftId);assert.equal(data.drafts.length,1);assert.equal(data.runs.length,1);assert.equal(data.runs[0].id,generated.run.id);assert.equal(data.runs[0].status,'succeeded');
  try{await page.evaluate(()=>window.studio.window('close'))}catch(error){closeConnectionError=String(error);if(!/closed|destroyed|disconnected/i.test(closeConnectionError))throw error}
 }finally{await browser.close().catch(()=>{})}
 for(let attempt=0;attempt<40&&alive(launch.pid);attempt++)await new Promise(resolve=>setTimeout(resolve,250));
 assert(!alive(launch.pid),'需核对主进程真正退出，不能只看CDP断开');
 const protectedFiles=read('baseline.json').protectedFiles.map(file=>({...file,actual:digest(file.file)}));assert(protectedFiles.every(file=>file.actual===file.sha256));
 write('closed.json',{at:new Date().toISOString(),pid:launch.pid,port:launch.port,processExited:true,closedThroughOwnWindow:true,closeConnectionError,otherWindowsClosed:false,protectedFilesUnchanged:true});
 const result={
  at:new Date().toISOString(),classification:'progress',overallGoalComplete:false,
  design:path.resolve('docs/C音色新文案连续配音验证.md'),userPreference:'C优于C2，保留C，不采用C2情绪参数',
  text:input.text,textLength:input.text.length,textOrigin:input.textOrigin,
  source:{runId:generated.run.id,assetId:generated.asset.id,origin:generated.asset.origin,actualProductTextField:true,actualProductGenerateButton:true,newSpeechInference:true,newAvatarInference:false},
  configuration:generated.run.parameters.input,
  output:{path:generated.file,sha256:generated.sha256,duration:generated.asset.duration,elapsedSeconds:generated.asset.speech.elapsedSeconds,metadata:inspection.metadata},
  audioMastering:generated.asset.speech.audioMastering,fullDecode:true,signal:inspection.signal,loudness:inspection.loudness,silences:inspection.silences,
  asr:{recognized:inspection.recognized,normalizedExpected:inspection.normalizedExpected,normalizedActual:inspection.normalizedActual,textMatches:inspection.textMatches,differences:differences(inspection.normalizedExpected,inspection.normalizedActual),interpretation:'自动转写辅助正文核对；有差异时需实际复听，不能仅凭转写判实际读错或漏句'},
  playback:{...playback,humanQualityAccepted:false},listeningSegments:read('listening-segments.json'),
  protectedFiles,protectedFilesUnchanged:true,productionDataChanged:false,productionVoiceDefaultChanged:false,sourceElectronClosed:true,closedPid:launch.pid,
  validation:{seedExitCode:0,launchExitCode:0,configureExitCode:0,submitExitCode:0,collectExitCode:0,inspectionExitCode:0,playbackAttempts:[{exitCode:1,reason:'首次检查在监听seeking后设置currentTime=0，把初始化定位纳入零跳播断言，原观察保留playback-first-observation.json'},{exitCode:0,reason:'修正为先核对0起点再开始监听，重播同一音频，无新生成'}],productionCodeChanges:0,previousFullSuite:{tests:677,rerun:false,reason:'本批只新增验证脚本和文档，没有生产代码变化'},newModelDownloads:0,newPaidCalls:0,externalUploads:0},
  acceptance:{technicalSpeechGeneration:true,normalizedAsrTextMatches:inspection.textMatches,humanNaturalness:'pending',speakerCharacterMatch:'pending',continuousLipSync:'not-tested-in-this-batch',fullProductParity:false},
  limitations:['C的新稿复用已选参考声与有效生成配置，不保证新文本下主观听感完全不变。','本次新稿与旧C短句内容不同，不是同稿盲听对照。','没有通过后期删停顿、变速、变调或混响美化交付音频。','技术播放、波形和自动转写不能证明听不出AI。','牙齿嘴周细节、C长口型视频、全教程全页面功能模板UI交互一致和真实平台成功仍未完成。']
 };
 write('delivery-report.json',result);
 console.log(JSON.stringify({runId:result.source.runId,duration:result.output.duration,textMatches:result.asr.textMatches,differences:result.asr.differences,protectedFiles:protectedFiles.length,closedPid:launch.pid,overallGoalComplete:false}));
}
main().catch(error=>{fs.appendFileSync(path.join(root,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode:'report',error:error.stack})+'\n');console.error(error);process.exitCode=1});
