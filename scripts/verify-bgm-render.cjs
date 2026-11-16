const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {Media,runProcess}=require('../server/media.cjs');
const root=path.resolve('evidence/validation/edit-audio-panels');
async function main(){
 const state=JSON.parse(fs.readFileSync(path.join(root,'desktop-workspace/studio.json'))),draft=state.drafts.find(d=>d.id===state.currentId),asset=state.assets.find(a=>a.id===draft.edit.resultId);assert.ok(asset?.backgroundMusic?.auto);
 const media=new Media({data:state}),probe=await media.probe(asset.path),source=state.assets.find(a=>a.id===draft.edit.sourceId),sourceProbe=await media.probe(source.path);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-Number(sourceProbe.format.duration))<.15);
 const {ffmpeg}=media.binaries(),decode=spawnSync(ffmpeg,['-v','error','-i',asset.path,'-f','null','-'],{encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(root,'real-render-decode.log'),decode.stderr);assert.equal(decode.status,0,decode.stderr);
 const chunks=[];
 for(const position of [0,60,150,205]){
  const clip=path.join(root,'mix-'+position+'.wav');await runProcess(ffmpeg,['-y','-ss',String(position),'-i',asset.path,'-t','2','-vn','-ac','1','-ar','16000',clip]);
  const pcm=spawnSync(ffmpeg,['-v','error','-i',clip,'-f','s16le','pipe:1'],{windowsHide:true,maxBuffer:1000000});assert.equal(pcm.status,0);let squares=0,peak=0,clipped=0;for(let i=0;i<pcm.stdout.length;i+=2){const x=pcm.stdout.readInt16LE(i);squares+=x*x;peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>=32767)clipped++;}const samples=pcm.stdout.length/2,rms=Math.sqrt(squares/samples);assert.ok(rms>1);chunks.push({position,duration:2,clip,rmsDb:20*Math.log10(rms/32768),peakDb:20*Math.log10(peak/32768),clippedSamples:clipped,samples});
 }
 const report={checkedAt:new Date().toISOString(),assetId:asset.id,path:asset.path,sourceDuration:Number(sourceProbe.format.duration),duration:Number(probe.format.duration),decodeExitCode:decode.status,streams:probe.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,sampleRate:s.sample_rate})),chunks,qualityAccepted:false,note:'完整解码及四段音频能量验证不能代替整片听觉质量和原厂同输入比较'};fs.writeFileSync(path.join(root,'real-render-media.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
