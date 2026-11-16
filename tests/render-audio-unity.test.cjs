// 真实媒体回归：原速剪辑保留波形，显式变速仍改变时长。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
test('生产剪辑在原速时保留音轨，显式变速仍生效',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'render-unity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),media=new Media(store),{ffmpeg}=media.binaries(),source=path.join(root,'source.mp4');
 // 多频率、非周期包络及停顿比纯扫频更接近实际配音的变化，不能用纯音掩盖问题。
 const raw=path.join(root,'signal.pcm'),rate=44100,bytes=Buffer.alloc(rate*5*2);let random=1234567;
 for(let i=0;i<rate*5;i++){const time=i/rate;random=(Math.imul(random,1664525)+1013904223)>>>0;const noise=(random/4294967296-.5)*.03,envelope=Math.sin(time*11)**2*(time%1.13<.91?1:0);const x=envelope*(.22*Math.sin(2*Math.PI*(180*time+24*Math.sin(time*4)))+.1*Math.sin(2*Math.PI*443*time)+noise);bytes.writeInt16LE(Math.round(x*32767),i*2);}fs.writeFileSync(raw,bytes);
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','color=c=gray:s=160x240:r=30:d=5','-f','s16le','-ar',String(rate),'-ac','1','-i',raw,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-shortest',source]);
 const asset=store.addAsset(source),draft=store.draft();draft.video.assetId=asset.id;draft.edit.subtitlesEnabled=false;
 async function pcm(file,label){const target=path.join(root,label+'.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',file,'-map','0:a:0','-ac','1','-ar','16000','-f','s16le',target]);return fs.readFileSync(target);}
 const input=await pcm(source,'source'),result=await media.render(draft,{}),output=await pcm(result.path,'original-speed');
 let xx=0,yy=0,xy=0;for(let i=0;i<Math.min(input.length,output.length);i+=2){const x=input.readInt16LE(i),y=output.readInt16LE(i);xx+=x*x;yy+=y*y;xy+=x*y;}
 assert(xy/Math.sqrt(xx*yy)>.98,'原速剪辑不得引入不必要的变速波形变化');
 draft.edit.speed=1.25;const faster=await media.render(draft,{});assert(Math.abs(faster.duration-result.duration/1.25)<.15,'用户显式设置的变速应实际生效');
});
