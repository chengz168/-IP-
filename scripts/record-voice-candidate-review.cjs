// 图像已经由主代理逐张直接查看；如实记录采用和排除的证据，不把无效图当视觉通过。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve('evidence/validation/voice-design-20261115/candidate-recovery');
const target=path.join(root,'visual-review.json');assert(!fs.existsSync(target),'已有视觉结论，不覆盖');
const captures=JSON.parse(fs.readFileSync(path.join(root,'surface-captures.json'),'utf8'));assert.equal(captures.images.length,2);
const review={at:new Date().toISOString(),images:captures.images.map(image=>({...image,visualInspected:true,observations:['恢复按钮与音频区左右边界对齐','页脚按钮可见且没有与正文重叠','正文区域可滚动','上次生成试听与本次取消提示同时保留']})),
 geometryStates:8,inspectionMethod:'主代理使用view_image逐张直接查看1400×1000舒适字号和1100×760大字号渲染表面原图',
 excludedEvidence:[{file:'voice-design-layout-1400-compact.png',reason:'第一轮仅有局部有效截图，不能代替八状态完成'},
  {file:'cdp-captures/voice-design-layout-1400-compact.png',reason:'fromSurface=false捕获全白，已查看，不采用'},
  {file:'native-captures.json',reason:'系统CopyFromScreen区域受到其他窗口遮挡，未捕获目标软件，不采用'}],
 technicalErrors:['初次Playwright截图等待超时','第二次CDP落盘因已有同名图而拒绝覆盖，旧图保留','第三次fromSurface=false为空白，脚本停在后续截图等待后已停止；改几何独立验证及恢复窗口后的fromSurface=true'],
 sourceWindowWasMinimized:true,pixelParityAccepted:false,originalProductEntryParityClaimed:false};
for(const image of review.images)assert(fs.existsSync(image.file));fs.writeFileSync(target,JSON.stringify(review,null,2),{flag:'wx'});
const update='\n## 2026-11-15 自主音色上次候选恢复修正\n\n真实同任务后续取消011eee2a复现旧UI播放器消失，原音频仍在。新增voice-design-state.mjs并接入VoiceDesign，分离最新尝试和上次可用成功候选；支持恢复其正文/描述，输入变化及候选变化重置试听，关闭或编辑时停止音频。真实恢复原oral9.92秒、完整不静音播放、实际保存恢复试听候选fbe0424d、刷新声音库/候选及重新试听门槛通过；保存仍指向原成功33217dfa，qualityAccepted=false。原全部草稿含updatedAt未变。\n\n13项定向检查0失败0跳过；构建、目录包和199文件哈希核对退出0。未冒认本批全套重测或打包EXE启动。1400/1100两尺寸四字号8组几何、恢复按钮命中及页脚无遮挡通过；两张有效渲染表面原图逐张查看。首次Playwright截图超时；备用落盘因旧同名图拒绝覆盖；fromSurface=false得到白图并停止挂起验证脚本。发现源码窗口处于最小化，恢复后改fromSurface=true成功。OS区域截图被其他窗口遮挡，明确排除，不作为目标UI证据。完整错误和排除记录在candidate-recovery/visual-review.json。\n\n本批修正新增音色入口的可用性，不声称原厂有同入口或像素一致，也不声称声音更自然。待听审的音色不切为默认、不延长视频。完整goal active。\n';
for(const file of ['findings.md','progress.md','docs/自主音色候选恢复修正.md'])fs.appendFileSync(path.resolve(file),update);
console.log(JSON.stringify({review:target,validImages:2,geometryStates:8,pixelParityAccepted:false}));
