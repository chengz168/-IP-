const fs = require('node:fs');
const path = require('node:path');
const {runProcess} = require('../server/media.cjs');

// 从已保存的教程解码清晰画面，采样时间明确记录，不将采样标为完整观看。
async function main() {
  const settings = JSON.parse(fs.readFileSync('data/studio.json', 'utf8')).settings;
  const inventory = JSON.parse(fs.readFileSync('evidence/tutorial/desktop-video-inventory.json', 'utf8'));
  const requested = process.argv.slice(2);
  const reports = [];
  for (const entry of inventory.filter(item => !requested.length || requested.includes(item.key))) {
    const source = path.resolve('evidence/tutorial/audio-study', entry.key + '.mp4');
    const directory = path.resolve('evidence/tutorial/offline-frames', entry.key);
    fs.mkdirSync(directory, {recursive:true});
    const probe = JSON.parse(await runProcess(settings.ffprobePath, ['-v','error','-show_format','-show_streams','-of','json',source]));
    const interval = entry.key === 'new' ? 4 : 2;
    await runProcess(settings.ffmpegPath, ['-y','-i',source,'-vf',`fps=1/${interval}`,'-start_number','0',path.join(directory,'%05d.png')]);
    const images = fs.readdirSync(directory).filter(name=>name.endsWith('.png')).sort();
    const report = {key:entry.key,name:entry.name,duration:Number(probe.format.duration),
      streams:probe.streams.map(s=>({type:s.codec_type,width:s.width,height:s.height,codec:s.codec_name})),
      interval,scope:'定时画面解码，未逐帧人工核对；帧时间为fps滤镜采样区间近似值',
      frames:images.map((file,index)=>({file:path.join(directory,file),approximateTime:(index+0.5)*interval}))};
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(report,null,2));
    reports.push(report);
    console.log(JSON.stringify({key:entry.key,duration:report.duration,frames:images.length,streams:report.streams}));
  }
  fs.writeFileSync('evidence/tutorial/offline-study-index.json',JSON.stringify(reports,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
