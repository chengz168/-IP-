const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');

// 使用真实素材核对首帧替换、正文恢复、帧时间与音轨，不以成功提示代替媒体检查。
async function main(){
  const project=path.resolve(__dirname,'..'),root=path.join(project,'evidence/validation/cover-frame-workspace');
  const settings=JSON.parse(fs.readFileSync(path.join(project,'data/studio.json'),'utf8')).settings;
  const service=createService(root);Object.assign(service.store.data.settings,{ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath});service.store.save();
  const report={checkedAt:new Date().toISOString(),scope:'真实收纳盒视频与真实JPG封面，仅验收首帧合成；不验证数字人口型或平台发布',cases:[],status:'running'};
  const reportFile=path.join(project,'evidence/validation/cover-frame-report.json');
  const persist=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  const ffmpeg=service.media.binaries().ffmpeg,ffprobe=service.media.binaries().ffprobe;
  const original=path.join(project,'evidence/reference-media/original-edit-test.mp4');
  const cover=service.store.addAsset(path.join(project,'evidence/reference-media/original-cover-layer-test.jpg'));
  async function pixels(file,label,isImage=false){
    const out=path.join(root,label+'.rgb');
    const filter=isImage?'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,scale=96:170,format=rgb24':'select=lte(n\\,2),scale=96:170,format=rgb24';
    await runProcess(ffmpeg,['-v','error','-y','-i',file,'-vf',filter,'-frames:v',isImage?'1':'3','-fps_mode','passthrough','-f','rawvideo',out]);
    return fs.readFileSync(out);
  }
  const meanError=(a,b)=>{assert.equal(a.length,b.length);let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
  async function timestamps(file){return JSON.parse(await runProcess(ffprobe,['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',file])).frames.map(f=>Number(f.best_effort_timestamp_time));}
  async function audioHash(file){return (await runProcess(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'])).trim();}
  async function check(file,label,expectedAudio){
    const source=service.store.addAsset(file),draft=service.store.draft();draft.edit.sourceId=source.id;draft.cover.assetId=cover.id;service.store.save();
    const result=await service.invoke('coverVideo',{id:draft.id}),before=await service.media.probe(source.path),after=await service.media.probe(result.path);
    const v0=before.streams.find(s=>s.codec_type==='video'),v1=after.streams.find(s=>s.codec_type==='video');
    const sourcePixels=await pixels(source.path,label+'-source'),outputPixels=await pixels(result.path,label+'-output'),coverPixels=await pixels(cover.path,label+'-cover',true),frameBytes=96*170*3;
    const entry={label,source:source.path,result:result.path,sourceDuration:Number(before.format.duration),outputDuration:Number(after.format.duration),sourceFrames:Number(v0.nb_frames),outputFrames:Number(v1.nb_frames),sourceRate:v0.avg_frame_rate,outputRate:v1.avg_frame_rate,width:v1.width,height:v1.height,audioPresent:after.streams.some(s=>s.codec_type==='audio'),coverError:meanError(outputPixels.subarray(0,frameBytes),coverPixels),sourceFirstFrameDifference:meanError(outputPixels.subarray(0,frameBytes),sourcePixels.subarray(0,frameBytes)),bodyFrameErrors:[1,2].map(i=>meanError(outputPixels.subarray(i*frameBytes,(i+1)*frameBytes),sourcePixels.subarray(i*frameBytes,(i+1)*frameBytes)))};
    report.cases.push(entry);persist();
    assert.ok(entry.coverError<5,'第0帧未正确替换为封面');assert.ok(entry.sourceFirstFrameDifference>5,'第0帧仍与原正文相同');
    assert.ok(entry.bodyFrameErrors.every(value=>value<5),'第1/2帧未恢复原正文');assert.equal(entry.sourceFrames,entry.outputFrames);assert.equal(entry.audioPresent,expectedAudio);
    assert.equal(v0.width,v1.width);assert.equal(v0.height,v1.height);assert.ok(Math.abs(entry.sourceDuration-entry.outputDuration)<.05);
    const sourceTimes=await timestamps(source.path),outputTimes=await timestamps(result.path);assert.equal(sourceTimes.length,outputTimes.length);
    entry.maxTimestampDifference=Math.max(...sourceTimes.map((value,i)=>Math.abs(value-outputTimes[i])));assert.ok(entry.maxTimestampDifference<.001);
    if(expectedAudio){entry.sourceAudioHash=await audioHash(source.path);entry.outputAudioHash=await audioHash(result.path);assert.equal(entry.sourceAudioHash,entry.outputAudioHash);}
    entry.status='passed';persist();return result;
  }
  persist();
  try{
    const result=await check(original,'real-19s-aac',true);
    const first=path.join(project,'evidence/validation/cover-frame-first.png'),second=path.join(project,'evidence/validation/cover-frame-second.png');
    await runProcess(ffmpeg,['-v','error','-y','-i',result.path,'-frames:v','1',first]);
    await runProcess(ffmpeg,['-v','error','-y','-i',result.path,'-vf','select=eq(n\\,1)','-frames:v','1',second]);
    const silent=path.join(root,'真实素材无音轨30000-1001.mp4');
    await runProcess(ffmpeg,['-v','error','-y','-i',original,'-t','1.5','-an','-vf','fps=30000/1001','-c:v','libx264','-preset','veryfast',silent]);
    await check(silent,'silent-fractional-rate',false);
    report.status='passed';persist();console.log(JSON.stringify(report,null,2));
  }catch(error){report.status='failed';report.error=error.message;persist();throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
