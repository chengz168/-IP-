const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sequencePlan,prepareSequence,assembleSequence,generateSequence}=require('../server/musetalk-sequence.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {readPcm}=require('../integrations/musetalk-local/production-input.cjs');
function folder(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'多镜头 实际媒体-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('累计切点覆盖非整帧音轨，0.1秒镜头与600秒边界不截尾',()=>{
 const plan=sequencePlan(32160,30,[{avatarId:'a',duration:.1},{avatarId:'b',duration:1.9}]);
 assert.equal(plan.frameCount,61);assert.deepEqual(plan.shots.map(s=>[s.startFrame,s.endFrame]),[[0,3],[3,61]]);
 assert.equal(plan.shots[0].driverSamples,16000);assert.equal(plan.shots[0].copiedSamples,1600);assert.equal(plan.shots[0].paddedDriverSamples,14400);
 assert.equal(plan.shots.at(-1).endSample,32160);
 assert.equal(sequencePlan(9600000,24,[{avatarId:'a',duration:600}]).frameCount,14400);
 assert.throws(()=>sequencePlan(9600001,24,[{avatarId:'a',duration:600}]),/1至600/);
 assert.throws(()=>sequencePlan(32000,30,[{avatarId:'a',duration:1}]),/总时长/);
 assert.throws(()=>sequencePlan(32000,30,[{avatarId:'a',duration:.001},{avatarId:'b',duration:1.999}]),/不足一帧/);
 assert.throws(()=>sequencePlan(32000,1,[{avatarId:'a',duration:2}]),/帧率/);
});
test('所有整数帧率的采样边界最多修正一个采样，不累积到最终音轨',()=>{
 for(let fps=10;fps<=60;fps++)for(const samples of [16000,16001,32160,128001,9599999]){
  const duration=samples/16000,ticks=Math.round(duration*10),count=Math.min(7,ticks),shots=Array.from({length:count},(_,i)=>({avatarId:String(i),duration:(Math.floor(ticks/count)+(i<ticks%count?1:0))/10}));
  const plan=sequencePlan(samples,fps,shots);let frame=0,sample=0;
  for(const shot of plan.shots){assert.equal(shot.startFrame,frame);assert.equal(shot.startSample,sample);assert(shot.trimmedDriverSamples<=1);assert(shot.paddedDriverSamples>=0);assert(Math.ceil(shot.driverSamples*fps/16000)>=shot.frameCount);frame=shot.endFrame;sample=shot.endSample;}
  assert.equal(frame,Math.ceil(samples*fps/16000));assert.equal(sample,samples);
 }
});
async function fixture(t){
 const root=folder(t),media=new Media({data:{settings:{}}});try{await media.check();}catch(error){t.skip('媒体工具未配置：'+error.message);return;}const {ffmpeg}=media.binaries();
 const a=path.join(root,'portrait.mp4'),b=path.join(root,'landscape.mp4'),audio=path.join(root,'driver.wav');
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','color=c=red:size=48x64:rate=30','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p',a]);
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','color=c=blue:size=64x48:rate=25','-t','1','-an','-c:v','libx264','-pix_fmt','yuv420p',b]);
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','sine=frequency=400:sample_rate=16000','-t','2.01','-c:a','pcm_s16le',audio]);
 const stamp=(id,file,type)=>{const s=fs.statSync(file);return {assetId:id,path:file,type,size:s.size,mtimeMs:s.mtimeMs};};
 const audioAsset={id:'audio',path:audio,type:'audio'},videoAsset={id:'video-a',path:a,type:'video'};
 const context={audio:audioAsset,video:videoAsset,input:{mode:'multi',audio:stamp('audio',audio,'audio'),video:stamp('video-a',a,'video'),shots:[{avatarId:'a',duration:.1},{avatarId:'b',duration:1.9}],shotAvatars:[{avatarId:'a',source:stamp('video-a',a,'video')},{avatarId:'b',source:stamp('video-b',b,'video')}]}};
 return {root,media,context,files:[a,b,audio]};
}
test('真实FFmpeg混合画幅、短镜头模型驱动与完整音轨拼接，无模型推理冒认',async t=>{
 const input=await fixture(t);if(!input)return;const {root,media,context,files}=input,before=files.map(digest),directory=path.join(root,'sequence');
 const plan=await prepareSequence({context,directory,media});assert.equal(plan.frameCount,61);assert.equal(plan.width,48);assert.equal(plan.height,64);
 assert.equal(plan.shots[0].source.conversion,'none');assert.equal(plan.shots[1].source.conversion,'fps-and-aspect-fit-black-pad-v1');
 assert.equal(readPcm(plan.shots[0].audio).samples,16000);assert.equal(readPcm(plan.shots[1].audio).samples,plan.shots[1].driverSamples);
 // 颜色视频仅检查媒体拼接协议，不能充当真实口型生成证据。
 const parts=[];
 for(const shot of plan.shots){const file=path.join(directory,'fixture-'+shot.index+'.mp4');await runProcess(media.binaries().ffmpeg,['-v','error','-n','-stream_loop','-1','-i',shot.source.normalizedPath,'-map','0:v:0','-frames:v',String(Math.ceil(shot.driverSamples*plan.fps/16000)),'-an','-c:v','libx264','-pix_fmt','yuv420p',file]);parts.push({index:shot.index,path:file,sha256:digest(file)});}
 const result=await assembleSequence({plan,parts,directory,media});assert.equal(result.frames,61);assert.equal(result.probe.streams.filter(s=>s.codec_type==='audio').length,1);assert.deepEqual(files.map(digest),before);
 const pix=path.join(directory,'shot-colors.rgb');await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',result.path,'-vf','select=eq(n\\,0)+eq(n\\,3),scale=1:1','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo',pix]);
 const rgb=fs.readFileSync(pix);assert.equal(rgb.length,6);assert(rgb[0]>rgb[2]);assert(rgb[5]>rgb[3]);
 await assert.rejects(prepareSequence({context,directory,media}),/exist|存在/i);
});
test('真实媒体准备后的工作器失败或取消均不登记素材，不启动后续镜头',async t=>{
 const input=await fixture(t);if(!input)return;const {root,media,context}=input;let registrations=0,workers=0;
 const store={outputDir:()=>root,data:{assets:[]},addAsset(){registrations++;throw Error('不应登记');},save(){}};
 for(const cancel of [false,true]){const controller=new AbortController();
  await assert.rejects(generateSequence({store,media,context,ctx:{signal:controller.signal},home:root,python:process.execPath,integration:name=>name,
   runWorker:async()=>{workers++;if(cancel)controller.abort();throw Error(cancel?'明确取消夹具':'明确失败夹具');},verifyReceipt:()=>{throw Error('不应读取成功回执');}}),/明确取消|明确失败/);
 }
 assert.equal(workers,2);assert.equal(registrations,0);assert.equal(store.data.assets.length,0);
 const failed=fs.readdirSync(root).find(name=>name.startsWith('.musetalk-multi-'));assert.equal(JSON.parse(fs.readFileSync(path.join(root,failed,'failed.json'),'utf8')).registered,false);
});
test('真实FFmpeg多镜头接受非整数旋转视频与缺帧数素材，并保留各原件hash',async t=>{
 const input=await fixture(t);if(!input)return;const {root,media,context}=input,{ffmpeg}=media.binaries(),fractional=path.join(root,'fractional.mp4'),rotated=path.join(root,'rotated.mp4'),missingFrames=path.join(root,'missing.mkv');
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','testsrc2=size=64x48:rate=30000/1001','-t','1.2','-c:v','libx264',fractional]);
 await runProcess(ffmpeg,['-v','error','-n','-display_rotation:v:0','-90','-i',fractional,'-c','copy',rotated]);
 await runProcess(ffmpeg,['-v','error','-n','-i',context.input.shotAvatars[1].source.path,'-c','copy',missingFrames]);
 context.input.shotAvatars[0].source.path=rotated;context.input.shotAvatars[1].source.path=missingFrames;const before=[rotated,missingFrames].map(digest),directory=path.join(root,'adapted-sequence');
 const plan=await prepareSequence({context,directory,media});assert.equal(plan.fps,30);assert.equal(plan.width,48);assert.equal(plan.height,64);assert.equal(plan.frameCount,61);
 for(const [index,source]of plan.sources.entries()){
  assert.equal(source.sha256,before[index]);assert.equal(digest(source.path),before[index]);assert.equal(source.videoPreparation.conversion,'integer-cfr-autorotate-even-size-v1');assert.equal(digest(source.normalizedPath),source.normalizedSha256);
 }
 for(const shot of plan.shots){const prepared=await require('../integrations/musetalk-local/production-input.cjs').prepareProductionInput({videoPath:shot.source.normalizedPath,audioPath:shot.audio,directory:path.join(shot.directory,'input'),media});assert.equal(prepared.fps,30);assert.equal(prepared.width,48);assert.equal(prepared.height,64);assert.equal(prepared.videoPreparation.conversion,'none');}
});
