const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs'),{ComfyH3}=require('../server/comfy-h3.cjs');
const enabled=!!process.env.FFMPEG_PATH&&!!process.env.FFPROBE_PATH;
test('真实FFmpeg封装H3短片保留覆盖原音轨的完整帧，短视频源不得补帧冒充',{skip:!enabled},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'h3-mux-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const settings={ffmpegPath:process.env.FFMPEG_PATH,ffprobePath:process.env.FFPROBE_PATH},store={data:{settings},outputDir:()=>root,save(){},addAsset(file,metadata){const target=path.join(root,'asset-'+crypto.randomUUID()+'.mp4');fs.copyFileSync(file,target);return {id:crypto.randomUUID(),path:target,...metadata};}},media=new Media(store);
 const generated=path.join(root,'generated.mp4'),short=path.join(root,'short.mp4'),audio=path.join(root,'driver.wav');
 await runProcess(settings.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=gray:s=160x240:r=24','-frames:v','192','-c:v','libx264','-preset','fast',generated]);
 await runProcess(settings.ffmpegPath,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=32000','-t','7.941224','-c:a','pcm_s16le',audio]);
 await runProcess(settings.ffmpegPath,['-v','error','-y','-i',generated,'-t','0.5','-c:v','copy',short]);
 const server=http.createServer((req,res)=>res.end(fs.readFileSync(req.url.includes('driver')?audio:req.url.includes('short')?short:generated)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const remote={baseUrl:'http://127.0.0.1:'+server.address().port,duration:7.941224,seed:42,image:{sha256:'仅验证封装的图像指纹夹具'},audio:{name:'driver.wav',type:'input',sha256:crypto.createHash('sha256').update(fs.readFileSync(audio)).digest('hex')}};
 const h3=new ComfyH3(store,media),asset=await h3.collect({jobId:'fixture',video:{filename:'generated.mp4',type:'output'}},remote,{},{}),probe=await media.probe(asset.path),picture=probe.streams.find(stream=>stream.codec_type==='video'),sound=probe.streams.find(stream=>stream.codec_type==='audio');
 assert.equal(Number(picture.nb_frames),191);assert(Number(picture.duration)>=Number(sound.duration));assert(Number(sound.duration)>=7.94);assert.equal(asset.h3.frameCount,191);
 await runProcess(settings.ffmpegPath,['-v','error','-i',asset.path,'-f','null','-']);
 await assert.rejects(h3.collect({jobId:'short',video:{filename:'short.mp4',type:'output'}},remote,{},{}),/计划帧|时长不符合/);
});
