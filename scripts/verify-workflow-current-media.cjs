const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
// 绑定桌面交互实际生成的产物，不因后续布局巡检失效引用而改换样本。
async function main(){
 const root=path.resolve('evidence/validation/workflow-current'),functional=JSON.parse(fs.readFileSync(path.join(root,'functional-report.json'))),fixture=JSON.parse(fs.readFileSync(path.join(root,'fixture.json'))),state=JSON.parse(fs.readFileSync(path.join(fixture.workspace,'studio.json'))),initial=JSON.parse(fs.readFileSync(path.join(root,'initial-job.json'))),baseline=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json')));
 assert.deepEqual(state.workflowJobs.find(j=>j.id===fixture.jobId),initial);assert.deepEqual(state.publishRecords,baseline.publishRecords);
 const media=new Media({data:{settings:state.settings}}),video=functional.speedVideo,cover=functional.cover;
 assert.deepEqual(state.assets.find(a=>a.id===video.id),video);assert.deepEqual(state.assets.find(a=>a.id===cover.id),cover);
 const [vp,cp]=await Promise.all([media.probe(video.path),media.probe(cover.path)]),vs=vp.streams.find(s=>s.codec_type==='video'),audio=vp.streams.find(s=>s.codec_type==='audio'),cs=cp.streams.find(s=>s.codec_type==='video');
 assert.equal(Number(vp.format.duration),6.4);assert.equal(vs.width,360);assert.equal(vs.height,640);assert.ok(audio);assert.equal(cs.width,1080);assert.equal(cs.height,1920);
 const frames=[];for(const time of [.8,3.4]){const file=path.join(root,`verified-${time}s.png`);await runProcess(media.binaries().ffmpeg,['-v','error','-y','-ss',String(time),'-i',video.path,'-frames:v','1',file]);assert.ok(fs.statSync(file).size>0);frames.push({time,file});}
 const report={checkedAt:new Date().toISOString(),historyUnchanged:true,publishRecordsUnchanged:true,newPublishRecordCount:0,video:{...video,width:vs.width,height:vs.height,duration:Number(vp.format.duration),codec:vs.codec_name,audioCodec:audio.codec_name},cover:{path:cover.path,width:cs.width,height:cs.height},frames,contentAccepted:false,contentLimitations:['源视频含已烧录字幕，新字幕叠加且偏小','识别文字中便签误为变迁，未将状态恢复当作内容质量验收']};
 fs.writeFileSync(path.join(root,'media-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
