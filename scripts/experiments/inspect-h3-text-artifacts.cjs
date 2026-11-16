const fs=require('node:fs'),path=require('node:path');
const {Media,runProcess}=require('../../server/media.cjs');
async function main(){
 const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3/official-prompt-guided');
 const report=JSON.parse(fs.readFileSync(path.join(root,'media-report.json'),'utf8'));
 const data=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8'));
 const media=new Media({data}),directory=path.join(root,'lower-frame-review');fs.mkdirSync(directory,{recursive:true});
 // 逐帧保留出现伪字幕的画面下部，不能把本检查外推为完整口型或声音验收。
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',report.video,'-vf','crop=608:360:0:696,scale=304:180,tile=4x8','-q:v','2',path.join(directory,'frames-%02d.jpg')]);
 const manifest={source:report.video,crop:{x:0,y:696,width:608,height:360},framesPerSheet:32,expectedFrames:124,sheets:fs.readdirSync(directory).filter(f=>/\.jpg$/.test(f)),reviewed:false,qualityAccepted:false};
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
