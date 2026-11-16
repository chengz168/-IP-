const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');

async function main(){
  const root=fs.mkdtempSync(path.resolve('evidence/validation/pip-workspace-')),service=createService(root);
  const settings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,provider:{}});
  const ffmpeg=settings.ffmpegPath;
  const make=async(name,args)=>{const file=path.join(root,name);await runProcess(ffmpeg,['-y',...args,file]);return service.store.addAsset(file,{name});};
  // 颜色标记仅用于逐帧验收；主画面使用现有真实商品视频，不能当作模型生成质量证明。
  const red=await make('画中画红色标记.png',['-f','lavfi','-i','color=c=red:s=160x100','-frames:v','1']);
  const blue=await make('画中画蓝色标记.png',['-f','lavfi','-i','color=c=blue:s=160x100','-frames:v','1']);
  const colors=['red','lime','blue','yellow','magenta','cyan'];
  const args=colors.flatMap(color=>['-f','lavfi','-i',`color=c=${color}:s=160x100:r=30:d=1`]);
  const marker=await make('画中画逐秒变色视频.mp4',[...args,'-filter_complex',colors.map((_,i)=>`[${i}:v]`).join('')+'concat=n=6:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p']);
  const source=await make('商品主视频8秒.mp4',['-i','D:/我的智能体/视频测试素材/收纳盒商品推广视频_19s.mp4','-t','8','-vf','scale=360:640','-c:v','libx264','-preset','veryfast','-c:a','aac']);
  const d=service.store.draft();d.title='逐句画中画真实媒体验收';Object.assign(d.edit,{sourceId:source.id,pipEnabled:true,pipMode:'captions',pipSize:.4,pipPosition:'top-right',subtitlesEnabled:false,captions:[{start:1,end:2,text:'红色',pipId:red.id},{start:3,end:4,text:'蓝色',pipId:blue.id},{start:4,end:5,text:'相邻重新红色',pipId:red.id},{start:6,end:7.5,text:'动态',pipId:marker.id}]});service.store.save();
  const result=await service.invoke('render',{id:d.id});
  let sampleIndex=0;
  async function sample(file,time,x=206,y=30){const output=path.join(root,'pixel-'+sampleIndex+++'.rgb');await runProcess(ffmpeg,['-y','-ss',String(time),'-i',file,'-frames:v','1','-vf',`crop=12:12:${x}:${y},scale=1:1:flags=area`,'-pix_fmt','rgb24','-f','rawvideo',output]);const data=fs.readFileSync(output);assert.equal(data.length,3,'无法抽取真实输出帧');return [...data];}
  const near=(actual,expected,label)=>assert.ok(actual.every((v,i)=>Math.abs(v-expected[i])<24),`${label}: 实际 ${actual} 期望 ${expected}`);
  const checks=[];
  for(const [time,color] of [[1,[255,0,0]],[1.9,[255,0,0]],[3,[0,0,255]],[3.9,[0,0,255]],[4,[255,0,0]],[4.9,[255,0,0]],[6,[255,0,0]],[7.2,[0,255,0]]]){const pixel=await sample(result.path,time);near(pixel,color,'按句颜色'+time);checks.push({time,pixel,expected:color});}
  const gaps=[];
  for(const time of [.5,2,2.5,5,5.5,7.5]){const pixel=await sample(result.path,time),original=await sample(source.path,time);near(pixel,original,'间隙不应出现画中画'+time);gaps.push({time,pixel,original});}
  const noAudio=await make('无音轨主视频.mp4',['-i',source.path,'-an','-c:v','copy']);
  d.edit.sourceId=noAudio.id;d.edit.captions=[{start:.5,end:1.5,text:'无音轨',pipId:blue.id}];service.store.save();
  const silentResult=await service.invoke('render',{id:d.id}),silentProbe=await service.media.probe(silentResult.path);assert.ok(!silentProbe.streams.some(s=>s.codec_type==='audio'));
  near(await sample(silentResult.path,1),[0,0,255],'无音轨画中画');
  const cutSource=await make('带可测静音的商品视频.mp4',['-i',path.resolve('evidence/validation/silence-workspace/真实素材与人工静音.mp4'),'-vf','scale=360:640','-c:v','libx264','-preset','veryfast','-c:a','copy']);
  Object.assign(d.edit,{sourceId:cutSource.id,cutSilence:true,speed:2,silenceThreshold:-42,silenceMinimum:.4,silencePadding:.08,captions:[{start:1,end:7,text:'跨剪口继续素材',pipId:marker.id}]});service.store.save();
  const cutResult=await service.invoke('render',{id:d.id}),cutProbe=await service.media.probe(cutResult.path),cutChecks=[];
  assert.equal(cutResult.renderedPip.length,2);assert.ok(cutResult.renderedPip[1].sourceOffset>3);
  for(const clip of cutResult.renderedPip){const time=clip.start+.15,offset=clip.sourceOffset+(time-clip.start)*clip.rate,expected=await sample(marker.path,offset,20,20),actual=await sample(cutResult.path,time);near(actual,expected,'跨剪口素材偏移');cutChecks.push({time,offset,actual,expected});}
  const vd=Number(cutProbe.streams.find(s=>s.codec_type==='video').duration),ad=Number(cutProbe.streams.find(s=>s.codec_type==='audio').duration);assert.ok(Math.abs(vd-ad)<.16);
  const before=service.store.data.assets.length;d.edit.captions[0].pipId='不存在的素材';service.store.save();await assert.rejects(service.invoke('render',{id:d.id}),/文件不存在/);assert.equal(service.store.data.assets.length,before);assert.equal(service.store.data.runs[0].status,'failed');
  const frame=await service.media.frame(result.id,1.4);fs.copyFileSync(frame.path,'evidence/validation/pip-actual-frame.png');
  const report={checkedAt:new Date().toISOString(),root,source:source.path,result,silentResult,cutResult,checks,gaps,cutChecks,audioDuration:ad,videoDuration:vd,failedMissingAsset:true,temporaryDirectories:fs.readdirSync(service.store.outputDir()).filter(n=>n.startsWith('.render-')),scope:'真实商品主画面、可辨识颜色素材与动态视频；逐句/间隙/相邻边界/无音轨/剪气口+倍速/素材源偏移/失败清理；颜色标记不作为视觉美观验收'};
  fs.writeFileSync('evidence/validation/pip-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:'evidence/validation/pip-report.json',root,duration:result.duration,checks:checks.length,gaps:gaps.length,cutChecks,audioDuration:ad,videoDuration:vd,failedMissingAsset:true},null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
