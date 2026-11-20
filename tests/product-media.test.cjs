const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
const {renderProductVideo}=require('../server/product-video.cjs');
test('混合JPEG和WebP商品图在真实字幕渲染后仍保留完整时长与统一色域',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'product-media-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),media=new Media(store),binary=media.binaries();
 try{await runProcess(binary.ffmpeg,['-version']);await runProcess(binary.ffprobe,['-version']);}catch(error){if(error.code==='ENOENT'){t.skip('当前测试环境未配置FFmpeg/FFprobe');return;}throw error;}
 const shots=[];
 for(const [extension,color]of [['jpg','pink'],['webp','yellow']]){
  const file=path.join(root,'product.'+extension);await runProcess(binary.ffmpeg,['-y','-f','lavfi','-i','color=c='+color+':s=200x300','-frames:v','1','-update','1',file]);shots.push({text:'商品原图展示',imageId:store.addAsset(file).id,visual:'完整展示商品原图',duration:1});
 }
 const d=store.draft();d.finalText=shots.map(s=>s.text).join('');d.confirmed=true;let speechCalls=0;
 const output=await renderProductVideo({store,media,providers:{speech:()=>speechCalls++}},{draft:d,shots,aspect:'9:16',narration:false},{signal:new AbortController().signal,progress:()=>{}});
 assert.equal(speechCalls,0);assert.equal(output.audioId,'');assert.equal(output.captions.length,2);
 const info=await media.probe(store.asset(output.asset.id).path),video=info.streams.find(s=>s.codec_type==='video');
 assert.equal(video.width,1080);assert.equal(video.height,1920);assert.equal(video.color_range,'tv');assert.equal(video.color_space,'bt709');assert.ok(Math.abs(Number(info.format.duration)-2)<.12);assert.equal(Number(video.nb_frames),50);
 await runProcess(binary.ffmpeg,['-v','error','-i',store.asset(output.asset.id).path,'-f','null','-']);
});
