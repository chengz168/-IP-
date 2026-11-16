const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {runProcess}=require('../server/media.cjs');
const root=path.resolve('evidence/validation/pip-semantic'),report=JSON.parse(fs.readFileSync(path.join(root,'functional-report.json'),'utf8')),state=JSON.parse(fs.readFileSync(path.join(root,'desktop-workspace/studio.json'),'utf8')),ffmpeg=state.settings.ffmpegPath,ffprobe=state.settings.ffprobePath;
(async()=>{
 report.output=state.assets.find(a=>a.id===report.output.id);for(const key of Object.keys(report.assets))report.assets[key]=state.assets.find(a=>a.id===report.assets[key].id);

 const result=await runProcess(ffprobe,['-v','error','-show_format','-show_streams','-of','json',report.output.path]),info=JSON.parse(typeof result==='string'?result:result.stdout);const stream=info.streams.find(s=>s.codec_type==='video');assert(stream);assert(info.streams.some(s=>s.codec_type==='audio'));assert(Math.abs(Number(info.format.duration)-report.assets.source.duration)<.25);
 const samples=[{name:'desktop',time:1,asset:report.assets.desktop},{name:'gap',time:3.5},{name:'bed',time:4.5,asset:report.assets.bed},{name:'unrelated',time:7.5},{name:'manual',time:10.5,asset:report.assets.desktop},{name:'omitted',time:13.5}];
 for(const item of samples){
  const file=path.join(root,'frame-'+item.name+'.png');await runProcess(ffmpeg,['-v','error','-y','-ss',String(item.time),'-i',report.output.path,'-frames:v','1',file]);
  const width=Math.round(stream.width*.35/2)*2,height=Math.ceil(width/2)*2,x=stream.width-width-20,y=stream.height-height-20;
  const raw=path.join(root,'crop-'+item.name+'.rgb'),expected=path.join(root,'expected-'+item.name+'.rgb');await runProcess(ffmpeg,['-v','error','-y','-ss',String(item.time),'-i',report.output.path,'-frames:v','1','-vf',`crop=${width}:${height}:${x}:${y},scale=32:32:flags=area`,'-pix_fmt','rgb24','-f','rawvideo',raw]);
  await runProcess(ffmpeg,['-v','error','-y',...(item.asset?[]:['-ss',String(item.time)]),'-i',item.asset?.path||report.assets.source.path,'-frames:v','1','-vf',item.asset?`scale=${width}:${height},scale=32:32:flags=area`:`crop=${width}:${height}:${x}:${y},scale=32:32:flags=area`,'-pix_fmt','rgb24','-f','rawvideo',expected]);
  const a=fs.readFileSync(raw),b=fs.readFileSync(expected);assert.equal(a.length,b.length);const mae=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;assert(mae<10,item.name+'画面内容差异过大 '+mae);item.meanAbsolutePixelError=mae;item.frame=file;item.overlay=!!item.asset;item.crop={x,y,width,height};console.log(JSON.stringify({sample:item.name,mae}));
 }
 const media={checkedAt:new Date().toISOString(),path:report.output.path,duration:Number(info.format.duration),width:stream.width,height:stream.height,videoCodec:stream.codec_name,audioCodec:info.streams.find(s=>s.codec_type==='audio').codec_name,samples,accepted:true,scope:'真实源素材/输出抽帧与局部像素比对，不代表与原厂算法同源效果一致'};fs.writeFileSync(path.join(root,'media-report.json'),JSON.stringify(media,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
