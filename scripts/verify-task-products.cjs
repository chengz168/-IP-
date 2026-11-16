const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {runProcess}=require('../server/media.cjs');

async function main(){
  const root=path.resolve('evidence/validation/pip-desktop-workspace');
  const state=JSON.parse(fs.readFileSync(path.join(root,'studio.json'),'utf8'));
  const ui=JSON.parse(fs.readFileSync('evidence/validation/task-center/report.json','utf8'));
  const product=ui.assertions.find(item=>item.renderAssetId);
  assert(ui.passed&&product);
  const video=state.assets.find(item=>item.id===product.renderAssetId),cover=state.assets.find(item=>item.id===product.coverAssetId);
  const source=state.assets.find(item=>item.id===product.result.stages[3].artifact.id);
  const probe=async file=>JSON.parse(await runProcess(state.settings.ffprobePath,['-v','error','-show_streams','-show_format','-of','json',file]));
  const [input,output,image]=await Promise.all([probe(source.path),probe(video.path),probe(cover.path)]);
  const inputVideo=input.streams.find(stream=>stream.codec_type==='video'),outputVideo=output.streams.find(stream=>stream.codec_type==='video');
  assert(outputVideo);assert.equal(outputVideo.width,inputVideo.width);assert.equal(outputVideo.height,inputVideo.height);
  assert(Math.abs(Number(output.format.duration)-Number(input.format.duration))<0.1);
  assert.equal(image.streams[0].width,1080);assert.equal(image.streams[0].height,1920);
  const exported=JSON.parse(fs.readFileSync(path.join(product.publishDirectory,'发布信息.json'),'utf8'));
  assert.equal(exported.status,'exported');
  assert.equal(fs.readFileSync(path.join(product.publishDirectory,'video.mp4')).compare(fs.readFileSync(video.path)),0);
  assert.equal(fs.readFileSync(path.join(product.publishDirectory,'cover.png')).compare(fs.readFileSync(cover.path)),0);
  const frame=path.resolve('evidence/validation/task-center/rendered-frame.png');
  await runProcess(state.settings.ffmpegPath,['-y','-ss','0.7','-i',video.path,'-frames:v','1',frame]);
  const report={checkedAt:new Date().toISOString(),source:source.path,video:video.path,cover:cover.path,publishDirectory:product.publishDirectory,duration:Number(output.format.duration),width:outputVideo.width,height:outputVideo.height,videoCodec:outputVideo.codec_name,sourceAudio:input.streams.some(stream=>stream.codec_type==='audio'),outputAudio:output.streams.some(stream=>stream.codec_type==='audio'),coverSize:[image.streams[0].width,image.streams[0].height],exportedFilesMatch:true,publishStatus:exported.status,taskProgress:product.result.progress,frame,scope:'真实桌面生成的媒体格式、时长、封面尺寸和导出文件一致；内容质量另行人工核对'};
  fs.writeFileSync('evidence/validation/task-center/products-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
