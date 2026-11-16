const fs=require('node:fs');
const path=require('node:path');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
async function main(){
  const root=path.resolve('evidence/validation/silence-workspace'),service=createService(root);
  const settings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;await service.invoke('saveSettings',{...settings,outputDir:''});
  const audio=JSON.parse(fs.readFileSync('evidence/validation/local-speech-report.json','utf8')).result;
  const raw=path.join(root,'真实素材与人工静音.mp4');
  // 画面取真实商品视频，声音取真实系统朗读；1/2/1秒静音仅用于可测的剪口验收。
  await runProcess(settings.ffmpegPath,['-y','-i','D:/我的智能体/视频测试素材/收纳盒商品推广视频_19s.mp4','-i',audio,'-f','lavfi','-i','anullsrc=r=22050:cl=mono','-filter_complex','[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,asplit=2[s1][s2];[2:a]asplit=3[z1][z2][z3];[z1]atrim=duration=1,asetpts=PTS-STARTPTS[a1];[z2]atrim=duration=2,asetpts=PTS-STARTPTS[a2];[z3]atrim=duration=1,asetpts=PTS-STARTPTS[a3];[a1][s1][a2][s2][a3]concat=n=5:v=0:a=1[a]','-map','0:v','-map','[a]','-t','8','-c:v','libx264','-preset','veryfast','-c:a','aac','-movflags','+faststart',raw]);
  const source=service.store.addAsset(raw),user=JSON.parse(fs.readFileSync('data/studio.json','utf8'));
  const image=user.assets.find(a=>a.type==='image');if(!image)throw new Error('缺少实际封面图片用于图片画中画验收');const pip=service.store.addAsset(image.path);
  const draft=service.store.draft();draft.title='剪气口真实素材验收';Object.assign(draft.edit,{sourceId:source.id,cutSilence:true,silenceThreshold:-42,silenceMinimum:.4,silencePadding:.08,subtitlesEnabled:true,subtitleStyle:'yellow',subtitleFontSize:54,subtitleMaxChars:12,subtitlePosition:'bottom',captions:[{start:1,end:3,text:'第一段真实声音文字'},{start:3.5,end:4.5,text:'静音内字幕应消失'},{start:5,end:7,text:'第二段真实声音文字'}],pipEnabled:true,pipId:pip.id,pipSize:.25,pipPosition:'top-right'});service.store.save();
  const analysis=await service.invoke('analyzeSilence',{id:draft.id});
  if(analysis.removedDuration<3)throw new Error('未裁掉已插入的主要静音');
  const result=await service.invoke('render',{id:draft.id}),probe=await service.media.probe(result.path),streams=probe.streams;
  if(result.renderedCaptions.some(r=>r.text.includes('静音内')))throw new Error('静音内字幕没有移除');
  const vd=Number(streams.find(s=>s.codec_type==='video').duration),ad=Number(streams.find(s=>s.codec_type==='audio').duration);if(Math.abs(vd-ad)>.15)throw new Error('音视频时长差超限');
  const frame=await service.media.frame(result.id,.5);fs.copyFileSync(frame.path,'evidence/validation/silence-frame.png');
  const original=service.store.addAsset('D:/我的智能体/视频测试素材/收纳盒商品推广视频_19s.mp4');const originalAnalysis=await service.media.analyzeSilence(original.id,draft.edit,{});
  const report={checkedAt:new Date().toISOString(),source:raw,sourceDescription:'真实商品画面+系统朗读，人工插入1/2/1秒静音作为验收输入',analysis,result,videoDuration:vd,audioDuration:ad,originalAnalysis,scope:'实际裁音轨与画面、字幕重映射、黄色字幕换行、图片画中画；不涉及数字人口型',temporaryDirectories:fs.readdirSync(service.store.outputDir()).filter(n=>n.startsWith('.render-'))};
  fs.writeFileSync('evidence/validation/silence-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({file:'evidence/validation/silence-report.json',duration:result.duration,removedDuration:analysis.removedDuration,videoDuration:vd,audioDuration:ad,keptSegments:analysis.keep.length,renderedCaptions:result.renderedCaptions,originalRemoved:originalAnalysis.removedDuration},null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
