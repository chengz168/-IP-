const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
async function main(){
 const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3'),source=JSON.parse(fs.readFileSync(path.join(root,'first-generation/media-report.json'),'utf8'));
 const input=path.join(root,'input/superip-h3-guide');fs.mkdirSync(input,{recursive:true});
 const image=path.join(input,'reference-frame.png'),audio=path.join(input,'driver.wav');
 const data=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8')),media=new Media({data});
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',source.video,'-frames:v','1','-update','1',image]);
 fs.copyFileSync(source.audio,audio);
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 fs.writeFileSync(path.join(root,'guided-input-provenance.json'),JSON.stringify({sourceVideo:source.video,sourceVideoSha256:source.sha256,image,imageSha256:sha(image),audio,audioSha256:sha(audio),kind:'inputs-from-own-first-h3-generation',newVoiceGeneration:false},null,2));
 console.log('已从本次新生成的 H3 视频提取参考首帧和驱动音频，未使用原版成片。');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
