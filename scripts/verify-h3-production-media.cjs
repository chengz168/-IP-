const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
const directory=path.resolve('evidence/validation/h3-production-chain');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 只检查产品实际绑定的产物，不另行生成剪辑结果或替换素材。
async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(directory,'workspace/studio.json'),'utf8')),draft=data.drafts[0],media=new Media({data}),reports={};
 for(const [kind,id]of Object.entries({edited:draft.edit.resultId,cover:draft.cover.assetId,coverVideo:draft.cover.videoId})){
  if(!id)continue;const asset=data.assets.find(item=>item.id===id);assert(asset);
  const probe=await media.probe(asset.path);await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
  const report={assetId:id,file:asset.path,sha256:sha(asset.path),bytes:fs.statSync(asset.path).size,probe,fullDecodeVerified:true};
  if(kind==='edited'){
   assert.equal(asset.renderedTitle.design.templateId,'title_blue_wendao_stroke');assert.equal(asset.renderedSubtitleTemplate.templateId,'simple_blue_white');assert.equal(asset.renderedSubtitleTemplate.keywords,false);assert.equal(asset.backgroundMusic.volume,.08);
   report.title=asset.renderedTitle;report.subtitle=asset.renderedSubtitleTemplate;report.backgroundMusic=asset.backgroundMusic;
   report.frames=[];
   const times=[.5,2,4,10,16,...draft.edit.captions.map(row=>Number(((row.start+row.end)/2).toFixed(3)))];
   for(const time of [...new Set(times)]){const file=path.join(directory,'edited-frame-'+time+'.jpg');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-ss',String(time),'-i',asset.path,'-frames:v','1','-update','1',file]);report.frames.push({time,file});}
   report.captions=draft.edit.captions;
  }
  if(kind==='cover'){const stream=probe.streams.find(item=>item.codec_type==='video');assert.equal(stream.width,1080);assert.equal(stream.height,1920);}
  reports[kind]=report;
 }
 const output={at:new Date().toISOString(),draftId:draft.id,reports,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(directory,'media-verification.json'),JSON.stringify(output,null,2));
 console.log(JSON.stringify({draftId:draft.id,outputs:Object.fromEntries(Object.entries(reports).map(([kind,r])=>[kind,{file:r.file,fullDecodeVerified:r.fullDecodeVerified,duration:r.probe.format.duration}]))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
