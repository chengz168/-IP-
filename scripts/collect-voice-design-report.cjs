// 只汇总已存在且已核验的真实结果，技术完成与听感接受分开。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const kinds=['clear','warm','lively'];
const candidates=kinds.map(kind=>{
 const generated=read('qwen-'+kind+'-generated.json'),inspection=read('qwen-'+kind+'-inspection.json'),playback=read('qwen-'+kind+'-playback.json'),saved=read('qwen-'+kind+'-saved.json');
 assert.equal(generated.run.status,'succeeded');assert.equal(digest(generated.file),generated.sha256);assert(inspection.fullDecodeVerified&&playback.fullNativePlaybackToEnded&&saved.actualSaveButton&&saved.refreshLibraryPreserved);
 return {kind,runId:generated.run.id,file:generated.file,sha256:generated.sha256,duration:Number(inspection.probe.format.duration),signal:inspection.signal,
  referenceAudio:null,newSpeechGenerated:true,actualProductGenerationButton:true,fullPlaybackVerified:true,asrTextMatchesInput:inspection.asrTextMatchesInput,recognizedText:inspection.recognizedSimplified,
  voiceId:saved.resource.id,name:saved.resource.name,naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
});
const prepared=read('prepared.json'),protectedFiles=prepared.protectedFiles.map(item=>({...item,unchanged:digest(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
const checkFiles=['node-tests','python-tests','supplemental-media','build','package','package-verification'];const checks=checkFiles.map(name=>{const record=read('code-validation/'+name+'.json');assert.equal(record.exitCode,0);return record;});
const first=fs.readFileSync(path.join(root,'code-validation/node-tests.log'),'utf8'),supplement=fs.readFileSync(path.join(root,'code-validation/supplemental-media.log'),'utf8');
const skippedNames=[...first.matchAll(/^﹣ (.*?) \([0-9.]+ms\).*$/gm)].map(match=>match[1]);assert.equal(skippedNames.length,4);for(const name of skippedNames)assert(supplement.includes('✔ '+name+' ('),name);
const layouts=read('voice-design-layouts.json');assert.equal(layouts.states.length,8);assert.deepEqual(layouts.pageErrors,[]);
const packageReport=JSON.parse(fs.readFileSync('evidence/validation/package-report.json','utf8'));assert(packageReport.sourceMatchesPackage);
const report={at:new Date().toISOString(),scope:'文字描述生成自主音色、真实产品试听保存与已有短视频链收尾',status:'technical-complete-awaiting-listening',
 models:JSON.parse(fs.readFileSync('D:/AI-Runtimes/super-ip/qwen3-tts-voice-design/model-download-receipt.json','utf8')),
 dependencies:{file:'D:/AI-Runtimes/super-ip/qwen3-tts-voice-design/dependency-receipt.json',sha256:digest('D:/AI-Runtimes/super-ip/qwen3-tts-voice-design/dependency-receipt.json')},
 environment:read('environment-ready/result.json'),actualSettingsCheck:read('ui-environment-ready.json'),candidates,
 priorSelfGeneratedVoiceVideo:{...read('video-playback.json'),file:read('video-inspection.json').video,frames:269,width:1080,height:1920,duration:8.966667,bodyAndBackgroundReused:true,qualityAccepted:false},
 checks,initialNode:{passed:612,skipped:4},supplementalMedia:{passed:17,skipped:0,originalSkippedNamesCovered:skippedNames},pythonChecks:9,
 layoutStates:layouts.states.length,packagedSourceFiles:packageReport.files.length,packagedExeStartupVerified:false,protectedFiles,
 originalHiddenPromptsKnown:false,voiceQualityAccepted:false,characterMatchAccepted:false,full208SecondVideoCompleted:false,completeReplica:false,goalStatus:'active'};
const target=path.join(root,'delivery-report.json');assert(!fs.existsSync(target),'已有收据，不能覆盖');fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify({file:target,candidates:candidates.length,qualityAccepted:false,completeReplica:false}));
