// 给C与C1保持一致的试听响度，仅恒定增益，不改变时长和停顿。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-C-prosody-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
async function measure(ffmpeg,file){let log='';await runProcess(ffmpeg,['-hide_banner','-nostats','-i',file,'-af','loudnorm=I=-23:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{onStderr:c=>{log=(log+c).slice(-24000)}});const match=log.match(/\{\s*"input_i"[\s\S]*?\}/);assert(match,'没有返回响度数据');const d=JSON.parse(match[0]);return{integratedLufs:Number(d.input_i),truePeakDbtp:Number(d.input_tp)};}
async function main(){
 assert(!fs.existsSync(path.join(root,'delivery-report.json')),'已有本轮报告，不覆盖');
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')),generated=read('generated.json'),input=read('submission-intent.json'),inspection=read('inspection.json'),finished=read('finished.json');
 const {ffmpeg}=new Media({data}).binaries();assert.equal(digest(generated.file),generated.sha256);
 const before=await measure(ffmpeg,generated.file),gainDb=Math.min(-23-before.integratedLufs,-1.5-before.truePeakDbtp),file=path.join(root,'C1-同响度试听.wav');
 await runProcess(ffmpeg,['-v','error','-n','-i',generated.file,'-af','volume='+gainDb.toFixed(6)+'dB','-ac','1','-ar','48000','-c:a','pcm_s16le',file]);
 await runProcess(ffmpeg,['-v','error','-xerror','-i',file,'-f','null','-']);const after=await measure(ffmpeg,file),C=input.baselineC;assert(Math.abs(C.after.integratedLufs-after.integratedLufs)<.1);
 assert.equal(data.currentId,finished.restoredDraftId);assert(!data.runs.some(r=>['running','queued','unknown'].includes(r.status)));
 const report={at:new Date().toISOString(),status:'awaiting-listening-with-asr-discrepancy',userFeedback:{statement:'C是更像真人',meaning:'已有三候选相对偏好',numericScore:null},
 baseline:C,candidate:{file,sha256:digest(file),rawFile:generated.file,rawSha256:generated.sha256,runId:generated.run.id,duration:generated.asset.duration,text:input.text,newInference:true,onlyPunctuationChanged:true,before,after,gainDb,signalProcessing:'constant-gain-and-48k-mono-pcm16-only'},
 inspection,finished,knownIssue:'末尾慢慢聊被自动转写为慢慢了；未据此断言实际一定读错，正文核对未通过',newModelsDownloaded:false,newModelSubmissions:1,naturalnessImproved:false,naturalnessImprovementEstablished:false,characterMatchAccepted:false,productionDefaultsChanged:false,goalStatus:'active'};
 fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
 const note='\n## 2026-11-15 C音色断句受控候选\n\n用户相对偏好C已核验来源并记录；沿用同参考/种子42/语速1/情绪空/强度.7，仅去掉两处逗号，经实际生成按钮提交aa472d71成功，C1为6.188118秒。完整解码、满幅0、产品原生完整不静音播放通过；ASR末尾慢慢聊转为慢慢了，正文规范化核对不一致，不能断言听感改善或实际一定读错。等响试听只恒定增益和48k单声道PCM16，与C响度差小于0.1LU，未改语速音高停顿。原全部草稿/设置/声音库/发布记录与6保护SHA不变，恢复3057d521，无未结束任务。报告voice-C-prosody-20261115/delivery-report.json。此轮只增验证脚本、没再改生产，未重复全套构建打包，整体目标active。\n';
 for(const name of ['task_plan.md','findings.md','progress.md'])fs.appendFileSync(name,note);
 console.log(JSON.stringify({file,duration:generated.asset.duration,before,after,C_lufs:C.after.integratedLufs,asrTextMatches:inspection.textMatches,restoredDraftId:finished.restoredDraftId,naturalnessImprovementEstablished:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
