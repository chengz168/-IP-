const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Media,runProcess}=require('../server/media.cjs');
const {Store}=require('../server/store.cjs');
const {frameInput,assertFrameCurrent,hashFile}=require('../server/cover-source.cjs');
const enabled=!!process.env.FFMPEG_PATH&&!!process.env.FFPROBE_PATH;

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cover-real-frame-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),media=new Media(store),source=path.join(root,'source.mp4');
 store.data.settings.ffmpegPath=process.env.FFMPEG_PATH;store.data.settings.ffprobePath=process.env.FFPROBE_PATH;
 await runProcess(process.env.FFMPEG_PATH,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=160x96:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p',source]);
 const video=store.addAsset(source),draft=store.draft();draft.edit.sourceId=video.id;
 return {store,media,video,draft};
}

test('真实FFmpeg截帧保存源文件摘要和时间，已登记图片可解码且源字节未变',{skip:!enabled},async t=>{
 const f=await fixture(t),before=hashFile(f.video.path),input=frameInput(f.store,f.video.id,.25),image=await f.media.frame(f.video.id,.25,{});
 assert.equal(image.type,'image');assert.deepEqual(image.frameSource,input);assert.equal(image.frameSha256,hashFile(image.path));assert.equal(hashFile(f.video.path),before);
 assert.doesNotThrow(()=>assertFrameCurrent(f.store,f.draft,image.id));
 const info=await f.media.probe(image.path);assert.deepEqual(info.streams.filter(row=>row.codec_type==='video').map(row=>[row.width,row.height]),[[160,96]]);
 fs.appendFileSync(f.video.path,'同一个资产编号内容变化');assert.throws(()=>assertFrameCurrent(f.store,f.draft,image.id),/变化/);assert(fs.existsSync(image.path));
});

test('真实截帧子进程运行期间源字节变化时拒绝登记，清理临时图片保留旧源',{skip:!enabled},async t=>{
 const f=await fixture(t),before=f.store.data.assets.length;let changed=false;
 await assert.rejects(f.media.frame(f.video.id,.25,{onStderr(){if(!changed){changed=true;fs.appendFileSync(f.video.path,'截帧期间修改');}}}),/截帧期间源视频已变化/);
 assert.equal(changed,true);assert.equal(f.store.data.assets.length,before);assert.deepEqual(fs.readdirSync(f.store.outputDir()),[]);assert(fs.existsSync(f.video.path));
});
