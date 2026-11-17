const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Store}=require('../server/store.cjs'),{Media}=require('../server/media.cjs'),{processAvatarAppearance,runAppearanceProcess}=require('../server/avatar-appearance.cjs');
const bin='F:\\Software\\轻语IP智能体\\aigc-human\\resources\\ffmpeg\\bin',ffmpeg=process.env.FFMPEG_PATH||path.join(bin,'ffmpeg.exe'),ffprobe=process.env.FFPROBE_PATH||path.join(bin,'ffprobe.exe'),python=process.env.PORTRAIT_PYTHON||'C:\\Python314\\python.exe';
const realTest=(name,fn)=>test(name,{skip:![ffmpeg,ffprobe,python].every(file=>fs.existsSync(file))?'本机真实媒体工具或Python未配置':false},fn);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function command(file,args){const result=spawnSync(file,args,{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}
function fixture(t,{rotatedVfr=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-appearance-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const source=path.join(directory,'source.mp4'),base=path.join(directory,'base.mp4');
 command(ffmpeg,['-v','error','-n','-f','lavfi','-i','testsrc2=size=96x128:rate=8:duration=1','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=1',...(rotatedVfr?['-vf',"select='not(eq(n,3))'",'-fps_mode','vfr']:[]),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',rotatedVfr?base:source]);
 if(rotatedVfr)command(ffmpeg,['-v','error','-n','-display_rotation:v:0','-90','-i',base,'-map','0','-c','copy',source]);
 const store=new Store(path.join(directory,'store'));store.data.settings.ffmpegPath=ffmpeg;store.data.settings.ffprobePath=ffprobe;store.data.settings.provider.portraitPython=python;
 const asset=store.addAsset(source),avatar={id:crypto.randomUUID(),name:'测试人物',assetId:asset.id,posterId:'old-poster',templateId:'old-template',source:'reference-builtin'};store.data.avatars.push(avatar);store.draft().video.avatarId=avatar.id;store.save();
 return {directory,source:asset,avatar,store,media:new Media(store),before:structuredClone(store.data),disk:fs.readFileSync(store.file),hash:digest(asset.path)};
}
const input=avatar=>({avatarId:avatar.id,look:'natural',background:'original'});

test('参数和本地环境缺失明确拒绝，不触发下载',async()=>{
 const {appearanceOptions,appearanceRuntime,appearanceVideoPlan}=await import('../server/avatar-appearance-config.mjs');
 assert.throws(()=>appearanceOptions({}),/请选择/);assert.throws(()=>appearanceOptions({avatarId:'a',look:'fake'}),/无效/);assert.throws(()=>appearanceOptions({avatarId:'a',look:'original',background:'original'}),/至少/);
 assert.throws(()=>appearanceRuntime({},appearanceOptions({avatarId:'a'})),/Python/);assert.throws(()=>appearanceRuntime({portraitPython:process.execPath},appearanceOptions({avatarId:'a',background:'business-studio'})),/模型缺失/);
 assert.throws(()=>appearanceVideoPlan({streams:[]}),/无效/);
});

realTest('真实自然画质处理生成独立视频和封面，保留原件、原形象、草稿与音轨',async t=>{
 const worker=path.join(__dirname,'..','integrations','portrait-matting','worker.py'),sampling=JSON.parse(command(python,['-c',"import json,runpy,sys; f=runpy.run_path(sys.argv[1])['matting_sampling']; print(json.dumps([f(1080,1920),f(320,240)]))",worker]));assert.deepEqual(sampling[0],{mattingSamplingPolicy:'detail-960-v1',downsampleRatio:.5,mattingInternalTargetSize:{width:540,height:960}});assert.equal(sampling[1].downsampleRatio,1);assert.deepEqual(sampling[1].mattingInternalTargetSize,{width:320,height:240});
 const f=fixture(t),result=await processAvatarAppearance(f.store,f.media,input(f.avatar));
 assert.notEqual(result.avatar.id,f.avatar.id);assert.notEqual(result.asset.id,f.source.id);assert.notEqual(result.avatar.posterId,'old-poster');assert.equal(result.avatar.templateId,undefined);assert.equal(result.avatar.source,'avatar-appearance');
 assert.equal(result.avatar.name,'测试人物·自然画面·'+result.avatar.id.slice(0,6));assert.equal(result.avatar.appearance.parameters.mattingSamplingPolicy,null);assert.equal(result.avatar.appearance.parameters.mattingInternalTargetSize,null);assert.equal(result.avatar.appearance.parameters.downsampleRatio,null);
 assert.equal(result.avatar.appearance.qualityAccepted,false);assert.equal(result.avatar.appearance.fullDecodeVerified,true);assert.equal(result.avatar.appearance.frames,8);assert.equal(result.avatar.appearance.audioPolicy,'copy-original-streams');
 assert.deepEqual(f.store.data.avatars.find(a=>a.id===f.avatar.id),f.avatar);assert.deepEqual(f.store.data.drafts,f.before.drafts);assert.equal(f.store.data.currentId,f.before.currentId);assert.equal(digest(f.source.path),f.hash);
 const out=JSON.parse(command(ffprobe,['-v','error','-show_streams','-of','json',result.asset.path]));assert.equal(out.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
 const audioHash=file=>command(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-']).trim();assert.equal(audioHash(result.asset.path),audioHash(f.source.path));
 const poster=f.store.asset(result.avatar.posterId);assert.equal(poster.type,'image');assert(fs.statSync(poster.path).size>0);assert.equal(fs.readdirSync(f.store.outputDir()).some(x=>x.startsWith('.avatar-appearance-')),false);
});

realTest('真实旋转加VFR原片由临时副本自动适配，不要求用户转存',async t=>{
 const f=fixture(t,{rotatedVfr:true}),sourceInfo=JSON.parse(command(ffprobe,['-v','error','-show_streams','-of','json',f.source.path]));assert.equal(sourceInfo.streams.find(s=>s.codec_type==='video').side_data_list.find(s=>s.rotation!==undefined).rotation,-90);const result=await processAvatarAppearance(f.store,f.media,input(f.avatar));
 assert.equal(result.avatar.appearance.width,128);assert.equal(result.avatar.appearance.height,96);assert.equal(result.avatar.appearance.videoPreparation.conversion,'integer-cfr-autorotate-even-size-v1');assert(result.avatar.appearance.videoPreparation.reasons.length>0);assert.equal(digest(f.source.path),f.hash);
 const info=JSON.parse(command(ffprobe,['-v','error','-show_streams','-of','json',result.asset.path])),video=info.streams.find(s=>s.codec_type==='video');assert.equal(Number(video.side_data_list?.find(x=>x.rotation!==undefined)?.rotation||video.tags?.rotate||0),0);assert.equal(video.avg_frame_rate,video.r_frame_rate);
});

realTest('保存失败回滚本次视频、封面和形象，不改原数据文件',async t=>{
 const f=fixture(t),files=fs.readdirSync(f.store.assetDir).sort();f.store.save=()=>{throw Object.assign(Error('测试磁盘空间不足'),{code:'ENOSPC'});};
 await assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar)),/磁盘空间不足/);assert.deepEqual(f.store.data,f.before);assert.deepEqual(fs.readFileSync(f.store.file),f.disk);assert.deepEqual(fs.readdirSync(f.store.assetDir).sort(),files);assert.equal(digest(f.source.path),f.hash);assert.deepEqual(fs.readdirSync(f.store.outputDir()),[]);
});

for(const stage of ['candidate.mp4','poster.png'])realTest('隔离复制'+stage+'写半文件后ENOSPC仅清理本次目标',async t=>{
 const f=fixture(t),copy=fs.copyFileSync,files=fs.readdirSync(f.store.assetDir).sort();let injected=false,partialTarget;
 fs.copyFileSync=function(source,target,...args){if(path.basename(source)===stage&&path.dirname(target)===f.store.assetDir){injected=true;partialTarget=target;fs.writeFileSync(target,Buffer.from('本次复制故障的半文件'));throw Object.assign(Error('测试复制ENOSPC'),{code:'ENOSPC'});}return copy.call(this,source,target,...args);};
 try{await assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar)),/复制ENOSPC/);}finally{fs.copyFileSync=copy;}
 assert.equal(injected,true);assert.equal(fs.existsSync(partialTarget),false);assert.deepEqual(f.store.data,f.before);assert.deepEqual(fs.readFileSync(f.store.file),f.disk);assert.deepEqual(fs.readdirSync(f.store.assetDir).sort(),files);assert.equal(digest(f.source.path),f.hash);assert.deepEqual(fs.readdirSync(f.store.outputDir()),[]);
});

for(const cancelled of [false,true])realTest((cancelled?'取消后':'保存成功后')+'临时目录EACCES不改变原任务结论且有清理告警',async t=>{
 const f=fixture(t),remove=fs.rmSync,controller=new AbortController();let injected=false,error,result;
 fs.rmSync=function(target,options){if(path.dirname(String(target))===f.store.outputDir()&&path.basename(String(target)).startsWith('.avatar-appearance-')&&options?.recursive){injected=true;throw Object.assign(Error('测试目录被Windows占用'),{code:'EACCES'});}return remove.call(this,target,options);};
 try{result=await processAvatarAppearance(f.store,f.media,input(f.avatar),{signal:controller.signal,...(cancelled?{local:()=>controller.abort()}:{} )});}catch(value){error=value;}finally{fs.rmSync=remove;}
 assert.equal(injected,true);const log=fs.readFileSync(path.join(f.store.root,'avatar-appearance-cleanup-warnings.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(log.length,1);assert.equal(log[0].code,'EACCES');assert(log[0].path.includes('.avatar-appearance-'));
 if(cancelled){assert.match(error.message,/已取消/);assert.equal(error.cleanupWarnings[0].code,'EACCES');assert.deepEqual(f.store.data,f.before);assert.deepEqual(fs.readFileSync(f.store.file),f.disk);assert.equal(f.store.data.assets.length,1);}
 else{assert.equal(error,undefined);assert(result.avatar.id);assert.equal(f.store.data.avatars.length,2);assert.equal(JSON.parse(fs.readFileSync(f.store.file)).avatars.find(item=>item.id===result.avatar.id).appearance.cleanupWarnings[0].code,'EACCES');assert(fs.existsSync(result.asset.path));}
 assert.equal(digest(f.source.path),f.hash);
});

realTest('处理期间源形象变化拒绝登记，原视频仍保持不变',async t=>{
 const f=fixture(t);await assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar),{progress:value=>{if(value===92)f.avatar.name='处理中外部编辑';}}),/原形象.*变化/);assert.equal(f.store.data.avatars.length,1);assert.equal(f.store.data.assets.length,1);assert.equal(digest(f.source.path),f.hash);assert.deepEqual(fs.readdirSync(f.store.outputDir()),[]);
});

for(const target of ['原形象','源视频'])realTest('真实封面生成期间'+target+'变化拒绝最终登记',async t=>{
 const f=fixture(t);let changed=false,watcher;
 try{
  await assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar),{local:details=>{
   watcher=fs.watch(details.directory,(_event,file)=>{
    if(changed||file!=='poster.png')return;
    changed=true;
    // 由真实FFmpeg写入新封面触发变更，确保发生在旧版最终校验之后。
    if(target==='原形象')f.avatar.name='封面阶段外部编辑';else fs.appendFileSync(f.source.path,Buffer.from('封面阶段外部更改'));
   });
  }}),/原形象.*变化/);
 }finally{watcher?.close();}
 assert.equal(changed,true,'必须确实观察到真实FFmpeg封面阶段变更');assert.equal(f.store.data.avatars.length,1);assert.equal(f.store.data.assets.length,1);assert.deepEqual(fs.readFileSync(f.store.file),f.disk);assert.deepEqual(fs.readdirSync(f.store.assetDir).sort(),[path.basename(f.source.path)]);assert.deepEqual(fs.readdirSync(f.store.outputDir()),[]);
 if(target==='原形象')assert.equal(digest(f.source.path),f.hash);else assert.notEqual(digest(f.source.path),f.hash);
});

realTest('同库人物优化互斥，预取消任务不登记资产',async t=>{
 const f=fixture(t),controller=new AbortController();controller.abort();await assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar),{signal:controller.signal}));
 let checked=false;await processAvatarAppearance(f.store,f.media,input(f.avatar),{progress:value=>{if(value===2&&!checked){checked=true;f.pending=assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar)),/正在执行/);}}});await f.pending;assert.equal(checked,true);assert.equal(f.store.data.avatars.length,2);assert.notEqual(f.store.data.avatars[0].name,f.store.data.avatars[1].name);assert(f.store.data.avatars[1].name.endsWith(f.store.data.avatars[1].id.slice(0,6)));
});

realTest('处理过程中停止等待工作器退出，无资产登记并回收临时目录',async t=>{
 const f=fixture(t),controller=new AbortController();await assert.rejects(processAvatarAppearance(f.store,f.media,input(f.avatar),{signal:controller.signal,local:()=>controller.abort()}),/已取消/);
 assert.deepEqual(f.store.data,f.before);assert.deepEqual(fs.readFileSync(f.store.file),f.disk);assert.deepEqual(fs.readdirSync(f.store.outputDir()),[]);assert.equal(digest(f.source.path),f.hash);
});

test('停止等待本次子进程树退出后才结束',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-stop-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const marker=path.join(directory,'heartbeat'),controller=new AbortController();let pid;
 const childCode="require('node:fs').appendFileSync(process.argv[1],'started');setInterval(()=>require('node:fs').appendFileSync(process.argv[1],'.'),10)";
 const parentCode="const c=require('node:child_process').spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{windowsHide:true});console.log(JSON.stringify({pid:c.pid}));setInterval(()=>{},1000)";
 await assert.rejects(runAppearanceProcess(process.execPath,['-e',parentCode,childCode,marker],{signal:controller.signal,onEvent:event=>{pid=event.pid;setTimeout(()=>controller.abort(),250);}}),/已取消/);assert(pid>0);assert.throws(()=>process.kill(pid,0));const size=fs.existsSync(marker)?fs.statSync(marker).size:0;await new Promise(resolve=>setTimeout(resolve,80));assert.equal(fs.existsSync(marker)?fs.statSync(marker).size:0,size);
});
