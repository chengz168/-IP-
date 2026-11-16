const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const asar=require('@electron/asar');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const archive=path.resolve('release/win-unpacked/resources/app.asar');
const files=[];
function walk(root){for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(entry.name==='__pycache__'||/\.py[co]$/.test(entry.name))continue;const file=path.join(root,entry.name);if(entry.isDirectory())walk(file);else files.push(file);}}
for(const dir of ['server','electron','dist','integrations/indextts-local','integrations/local-link-extractor','integrations/musetalk-local','integrations/qwen-voice-design'])walk(dir);
// 注音词典在正式生成时才加载，源码一致之外也核对其真实运行入口。
files.push(path.normalize('node_modules/pinyin/lib/cjs/pinyin.js'));
const checked=files.map(file=>{const sourceHash=hash(fs.readFileSync(file));const packagedHash=hash(asar.extractFile(archive,file));return {file,sha256:sourceHash,matches:sourceHash===packagedHash};});
// Python 按真实磁盘路径启动；仅进入归档但未解包不能视为运行资源齐备。
const pythonRuntimeFiles=['integrations/local-link-extractor/worker.py','server/local-indextts.py','integrations/indextts-local/model-manifest.json','integrations/indextts-local/scripts/tts.py','integrations/indextts-local/scripts/common.py','integrations/indextts-local/scripts/worker.py','integrations/indextts-local/scripts/audio_headroom.py','integrations/indextts-local/scripts/download_models.py','integrations/indextts-local/scripts/download_plan.py',...['worker.py','check.py','model_backend.py','face_selection.py','stream_encoder.py','model-manifest.json'].map(name=>'integrations/musetalk-local/'+name)];
const localRuntime={pythonResources:pythonRuntimeFiles.map(file=>({file,unpacked:asar.statFile(archive,path.normalize(file)).unpacked===true})),modelWeightsBundled:false,inferenceVerifiedByPackage:false};
for(const file of ['integrations/qwen-voice-design/worker.py','integrations/qwen-voice-design/manifest.json'])localRuntime.pythonResources.push({file,unpacked:asar.statFile(archive,path.normalize(file)).unpacked===true});
const dependencyBytes=asar.extractFile(archive,path.join('node_modules','pinyin','package.json')),dependency=JSON.parse(dependencyBytes.toString()),dependencySourceBytes=fs.readFileSync('node_modules/pinyin/package.json'),dependencySource=JSON.parse(dependencySourceBytes.toString()),appPackage=JSON.parse(asar.extractFile(archive,'package.json').toString());
// electron-builder实测去掉bugs/scripts/keywords，运行声明和许可证仍须完全相同。
const buildRemovedFields=['bugs','scripts','keywords'],normalizedSource={...dependencySource};for(const key of buildRemovedFields)delete normalizedSource[key];
const normalize=value=>JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])));
const metadataVerified=normalize(normalizedSource)===normalize(dependency),pinyinRuntimeVerified=dependency.version==='4.0.0'&&appPackage.dependencies.pinyin==='4.0.0'&&metadataVerified&&checked.filter(item=>item.file.startsWith('node_modules')).every(item=>item.matches);
const report={checkedAt:new Date().toISOString(),archive,files:checked,sourceMatchesPackage:checked.every(item=>item.matches)&&pinyinRuntimeVerified,pinyinRuntime:{version:dependency.version,appDependency:appPackage.dependencies.pinyin,entry:'node_modules/pinyin/lib/cjs/pinyin.js',hashVerified:pinyinRuntimeVerified,metadata:{sourceSha256:hash(dependencySourceBytes),packagedSha256:hash(dependencyBytes),rawBytesEqual:dependencySourceBytes.equals(dependencyBytes),buildRemovedFields,remainingFieldsEqual:metadataVerified}},startupVerified:false,startupLimitation:'此前启动打包EXE被自动审批拒绝；未更换路径或启动方式绕过。源码Electron已单独实际运行验证。'};
report.localRuntime=localRuntime;
const expectedElectron=require('../package.json').devDependencies.electron,installedElectron=require('electron/package.json').version;
const runtimeVersion=require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::Write((Get-Item -LiteralPath './release/win-unpacked/超级IP智能体.exe').VersionInfo.ProductVersion)"],{encoding:'utf8',windowsHide:true}).trim();
report.electronRuntime={expected:expectedElectron,installed:installedElectron,packaged:runtimeVersion,matches:expectedElectron===installedElectron&&runtimeVersion.split('+')[0]===installedElectron,verifiedBy:'只读PE版本资源，未启动EXE'};
report.sourceMatchesPackage=report.sourceMatchesPackage&&localRuntime.pythonResources.every(file=>file.unpacked)&&report.electronRuntime.matches;
fs.writeFileSync('evidence/validation/package-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({file:'evidence/validation/package-report.json',checkedFiles:checked.length,sourceMatchesPackage:report.sourceMatchesPackage,startupVerified:false},null,2));
if(!report.sourceMatchesPackage)process.exitCode=1;
