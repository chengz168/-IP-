const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');

async function main(){
  const project=path.join(__dirname,'..');const root=path.join(project,'evidence','validation','media-workspace');
  const service=createService(root);const ffmpeg='F:\\Software\\轻语IP智能体\\aigc-human\\resources\\ffmpeg\\bin\\ffmpeg.exe';
  service.store.data.settings.ffmpegPath=ffmpeg;service.store.data.settings.ffprobePath=path.join(path.dirname(ffmpeg),'ffprobe.exe');service.store.save();
  const sample=path.join(root,'sample.mp4'),bgm=path.join(root,'测试正弦音.wav'),sfx=path.join(root,'测试提示音.wav');
  await runProcess(ffmpeg,['-y','-i','D:\\我的智能体\\视频测试素材\\收纳盒商品推广视频_19s.mp4','-t','4','-c:v','libx264','-preset','veryfast','-c:a','aac',sample]);
  await runProcess(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=220:duration=1','-af','volume=0.12',bgm]);
  await runProcess(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=880:duration=0.3','-af','volume=0.12',sfx]);
  const source=await service.importPath(sample),music=await service.importPath(bgm),effect=await service.importPath(sfx);
  const d=structuredClone(service.store.draft());d.title='本地多轨渲染专项验证';
  Object.assign(d.edit,{sourceId:source.id,speed:1.25,volume:.8,titleEnabled:true,title:'本地多轨验证 100%',cardEnabled:true,cardName:'本地测试',cardDescription:'真实字幕 · BGM · 音效 · 画中画',subtitlesEnabled:true,captions:[{start:0,end:2,text:'字幕验证：多轨合成'},{start:2,end:4,text:'速度设置为1.25倍'}],bgmEnabled:true,bgmId:music.id,bgmVolume:.2,sfxEnabled:true,sfxId:effect.id,pipEnabled:true,pipId:source.id,pipSize:.25});
  service.store.updateDraft(d);const asset=await service.invoke('render',{id:d.id});const info=await service.media.probe(asset.path);
  assert.ok(info.streams.some(s=>s.codec_type==='video'));assert.ok(info.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(info.format.duration)-3.2)<.2);
  const frame=await service.invoke('frame',{id:d.id,assetId:asset.id,time:1});fs.copyFileSync(frame.path,path.join(project,'evidence','validation','multitrack-frame.png'));
  const tempDirs=fs.readdirSync(service.store.outputDir()).filter(n=>n.startsWith('.render-'));assert.equal(tempDirs.length,0);
  const report={checkedAt:new Date().toISOString(),source:'19秒收纳盒真实视频的4秒片段',syntheticAudio:'本地生成正弦测试音，仅用于验证混音，不是配音或音乐产物',result:asset.path,duration:Number(info.format.duration),streams:info.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,sampleRate:s.sample_rate})),features:['标题100%字样','两条SRT字幕','1.25倍速','.8人声音量','个人名片','背景音循环','.3秒音效','右下画中画'],temporaryDirectories:tempDirs,status:service.store.data.runs.find(r=>r.type==='render').status};
  fs.writeFileSync(path.join(project,'evidence','validation','media-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
