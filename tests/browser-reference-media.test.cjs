const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runProcess,Media}=require('../server/media.cjs'),{Store}=require('../server/store.cjs');
const {LocalLinkExtractor}=require('../server/local-link-extractor.cjs'),{extractBrowserMedia}=require('../server/browser-reference-media.cjs');
const ffmpeg=process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_PATH;
test('真实分离音画静默合流后同时保留音频视频，时长不符不调用识别且清理临时文件',{skip:![ffmpeg,ffprobe].every(x=>x&&fs.existsSync(x))},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-split-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root);Object.assign(store.data.settings,{ffmpegPath:ffmpeg,ffprobePath:ffprobe});const media=new Media(store),video=path.join(root,'video.mp4'),audio=path.join(root,'audio.m4a'),wrong=path.join(root,'wrong.m4a');
 await runProcess(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=160x288:r=12','-t','2','-an','-c:v','libx264',video]);
 for(const [duration,out]of [[2,audio],[5,wrong]])await runProcess(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440','-t',String(duration),'-c:a','aac',out]);
 let calls=0,currentAudio=audio;const parser=new LocalLinkExtractor(store,media,{transcribe:async id=>{calls++;const info=await media.probe(store.asset(id).path);assert(info.streams.some(s=>s.codec_type==='audio'));assert(info.streams.some(s=>s.codec_type==='video'));return {text:'协议夹具，非实际语音识别'};}});
 const options={browser:{downloadMedia:async(url,file)=>fs.copyFileSync(url.includes('media-audio')?currentAudio:video,file)},session:{mediaUrls:['https://video.test/media-video','https://video.test/media-audio'],title:'分离源'},parser,media,directory:store.outputDir(),shareText:'https://video.test/reference',preferVideo:true,allowSilentVideo:true,ctx:{}};
 const result=await extractBrowserMedia(options);assert.equal(calls,1);assert.equal(result.linkSource.hasAudio,true);assert.equal(result.linkSource.streamAssembly.durationVerified,true);assert.equal(fs.readdirSync(store.outputDir()).filter(n=>n.startsWith('.browser-media-')).length,0);
 currentAudio=wrong;await assert.rejects(extractBrowserMedia(options),/音画时长不一致/);assert.equal(calls,1);assert.equal(fs.readdirSync(store.outputDir()).filter(n=>n.startsWith('.browser-media-')).length,0);
});
