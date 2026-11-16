const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-h3-chain'),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 const target=path.resolve('evidence/validation/cover-editor/indextts-h3-generated-20261115-verified.mp4');assert(!fs.existsSync(target),'禁止覆盖已有导出');
 const launch=JSON.parse(fs.readFileSync(path.join(directory,'relaunch.json'),'utf8')),browser=await chromium.connectOverCDP('http://127.0.0.1:9343'),page=browser.contexts()[0].pages()[0];
 try{
  const state=await page.evaluate(()=>window.studio.invoke('state')),draft=state.drafts.find(draft=>draft.id===state.currentId),data=JSON.parse(fs.readFileSync(path.join(directory,'workspace/studio.json'),'utf8')),asset=data.assets.find(asset=>asset.id===draft.video.assetId);assert(asset?.path);
  await page.locator('.video-result').getByRole('button',{name:'导出',exact:true}).click();
  const saved=spawnSync('python',['scripts/native-cover-dialog.py','--pid',String(launch.pid),'--path',target,'--title','导出视频'],{encoding:'utf8',timeout:15000});assert.equal(saved.status,0,saved.stderr);
  fs.writeFileSync(path.join(directory,'export-native-action.json'),JSON.stringify({at:new Date().toISOString(),file:target,clicked:true,nativeDialog:JSON.parse(saved.stdout)},null,2));
  assert.equal(hash(target),hash(asset.path));const report={at:new Date().toISOString(),file:target,sha256:hash(target),bytes:fs.statSync(target).size,assetId:asset.id,matchesProductAsset:true,realVideoExportButton:true,realNativeSaveDialog:true};fs.writeFileSync(path.join(directory,'export.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
