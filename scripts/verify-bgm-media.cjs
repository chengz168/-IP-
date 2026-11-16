const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {Store,createDraft}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs'),{BgmLibrary}=require('../server/bgm-library.cjs');
const root=path.resolve('evidence/validation/edit-audio-panels/media-boundaries');
async function main(){
 fs.mkdirSync(root,{recursive:true});
 const config=JSON.parse(fs.readFileSync('evidence/validation/edit-audio-panels/original-baseline.json')).settings;
 const store=new Store(path.join(root,'workspace'));Object.assign(store.data.settings,{ffmpegPath:config.ffmpegPath,ffprobePath:config.ffprobePath});
 const media=new Media(store);media.music=new BgmLibrary(store,media,{text:async()=>{throw Error('手动音乐不应调用模型');}});
 const tone=path.join(root,'tone.wav'),silent=path.join(root,'silent.mp4'),voiced=path.join(root,'voiced.mp4');
 // 受控短音、纯色画面用于验证循环与时间轴，不作为业务内容质量样本。
 await runProcess(config.ffmpegPath,['-y','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=0.37',tone]);
 await runProcess(config.ffmpegPath,['-y','-f','lavfi','-i','color=c=navy:s=192x320:r=25:d=4','-an','-c:v','libx264','-pix_fmt','yuv420p',silent]);
 await runProcess(config.ffmpegPath,['-y','-f','lavfi','-i','color=c=teal:s=192x320:r=25:d=4','-f','lavfi','-i','sine=frequency=330:sample_rate=48000:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',voiced]);
 const music=store.addAsset(tone),records=[];
 for(const [name,file,speed] of [['no-source-audio',silent,1],['speed-2',voiced,2]]){
  const source=store.addAsset(file),draft=createDraft();Object.assign(draft.edit,{sourceId:source.id,subtitlesEnabled:false,bgmEnabled:true,bgmSource:'upload',bgmId:music.id,bgmVolume:.3,speed});store.data.drafts.push(draft);store.save();
  const out=await media.render(structuredClone(draft),{signal:new AbortController().signal}),probe=await media.probe(out.path),duration=Number(probe.format.duration);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(duration-4/speed)<.13);assert.equal(out.backgroundMusic.auto,false);
  const decode=spawnSync(config.ffmpegPath,['-v','error','-i',out.path,'-f','null','-'],{encoding:'utf8',windowsHide:true});assert.equal(decode.status,0,decode.stderr);
  const tail=spawnSync(config.ffmpegPath,['-ss',String(duration-.4),'-i',out.path,'-t','0.25','-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8',windowsHide:true}),mean=/mean_volume: ([\d.-]+) dB/.exec(tail.stderr);assert.equal(tail.status,0,tail.stderr);assert.ok(mean&&Number(mean[1])>-60,'片尾必须仍有循环音乐');
  records.push({name,speed,sourceDuration:4,musicDuration:.37,output:out.path,duration,audio:true,tailMeanDb:Number(mean[1]),decodeExitCode:decode.status,backgroundMusic:out.backgroundMusic});
 }
 const report={checkedAt:new Date().toISOString(),fixtureKind:'controlled-color-and-sine',qualityAccepted:false,modelRequests:0,records};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
