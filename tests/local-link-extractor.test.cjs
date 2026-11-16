const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawnSync}=require('node:child_process');
const {shareLink,extractionMode,LocalLinkExtractor,runWorker}=require('../server/local-link-extractor.cjs');
const {Store}=require('../server/store.cjs');
const {Media}=require('../server/media.cjs');
const {createService}=require('../server/service.cjs');
const python=process.env.LINK_PYTHON||'C:/Python314/python.exe',packagePath=process.env.YTDLP_PACKAGE||'D:/AI-Runtimes/super-ip/link-extractor/2026.10.26/package';
const ready=fs.existsSync(python)&&fs.existsSync(path.join(packagePath,'yt_dlp','__main__.py'));
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-extract-test-')),store=new Store(root),media=new Media(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));Object.assign(store.data.settings.provider,{extractProtocol:'local',extractPythonPath:python,extractPackagePath:packagePath});return {root,store,media};}
function wav(){const samples=16000,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/16000)*4000),44+i*2);return b;}
async function serve(t){const requests=[],bytes=wav(),server=http.createServer((req,res)=>{requests.push(req.url);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes.length});res.end(bytes);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return {url:'http://127.0.0.1:'+server.address().port+'/own-source.wav',requests,bytes};}
test('从分享文本提取唯一URL，空值、多链接、凭据与错误协议拒绝',()=>{
 assert.equal(shareLink('3.4 分享内容 https://v.douyin.com/Abc123/。复制打开'),'https://v.douyin.com/Abc123/');
 assert.equal(shareLink('查看 https://example.com/a.mp4?x=%E4%B8%AD&token=abc%2F123。'),'https://example.com/a.mp4?x=%E4%B8%AD&token=abc%2F123');
 for(const value of ['',null,'file:///C:/secret.mp4','https://a.test/x https://b.test/y','https://user:pass@example.com/x'])assert.throws(()=>shareLink(value));
 assert.equal(extractionMode({extractUrl:'https://bridge.test'}),'bridge');assert.equal(extractionMode({extractProtocol:'browser-session'}),'browser-session');assert.equal(extractionMode({}),'local');assert.throws(()=>extractionMode({extractProtocol:'unknown'}));
});
test('本地解析配置在启动前检查完整路径，不把目录当解释器',t=>{const {store,media}=fixture(t);const parser=new LocalLinkExtractor(store,media,{});store.data.settings.provider.extractPythonPath='python';assert.throws(()=>parser.options(),/完整路径/);store.data.settings.provider.extractPythonPath=store.root;assert.throws(()=>parser.options(),/完整路径/);});

test('浏览器下载的MP4依据真实流登记类型，缺音轨时在登记和识别前拒绝',async t=>{
 for(const [streams,expected]of [[[{codec_type:'audio'}],'audio'],[[{codec_type:'video'},{codec_type:'audio'}],'video'],[[{codec_type:'video'}],null]]){
  const {root,store,media}=fixture(t),file=path.join(root,'downloaded.mp4');fs.writeFileSync(file,'探针边界夹具');media.probe=async()=>({format:{duration:1},streams});let transcribed=0;
  const parser=new LocalLinkExtractor(store,media,{transcribe:async id=>{transcribed++;assert.equal(store.asset(id).type,expected);return {text:'识别边界夹具'};}});
  if(expected){const result=await parser.extractDownloaded(file,'https://video.test/item');assert.equal(store.asset(result.sourceAssetId).type,expected);assert.equal(transcribed,1);assert.equal(new Store(root).asset(result.sourceAssetId).type,expected);}
  else{await assert.rejects(parser.extractDownloaded(file,'https://video.test/item'),/没有音轨/);assert.equal(transcribed,0);assert.equal(store.data.assets.length,0);assert.equal(fs.readdirSync(store.assetDir).length,0);}
  assert(!fs.existsSync(file));
 }
});

test('真实FFmpeg音轨MP4经本地下载和浏览器导入均登记audio，音轨正文仅使用识别接口回包',{skip:!ready||!process.env.FFMPEG_PATH||!process.env.FFPROBE_PATH},async t=>{
 const {root,store,media}=fixture(t),file=path.join(root,'source-audio.mp4');const generated=spawnSync(process.env.FFMPEG_PATH,['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','0.5','-vn','-c:a','aac',file],{encoding:'utf8',windowsHide:true});assert.equal(generated.status,0,generated.stderr);
 const probe=await media.probe(file);assert(probe.streams.some(s=>s.codec_type==='audio'));assert(!probe.streams.some(s=>s.codec_type==='video'));
 const bytes=fs.readFileSync(file),server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':bytes.length});res.end(bytes);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const url='http://127.0.0.1:'+server.address().port+'/source.mp4';let calls=0;
 const parser=new LocalLinkExtractor(store,media,{transcribe:async id=>{calls++;const asset=store.asset(id);assert.equal(path.extname(asset.path),'.mp4');assert.equal(asset.type,'audio');return {text:'接口替身正文，不是实际语音识别'};}});
 const downloaded=await parser.extract(url);assert.equal(store.asset(downloaded.sourceAssetId).type,'audio');const imported=await parser.extractDownloaded(file,url);assert.equal(store.asset(imported.sourceAssetId).type,'audio');assert.equal(calls,2);assert.equal(new Store(root).data.assets.filter(a=>a.type==='audio').length,2);
});
test('实际yt-dlp版本与本机HTTP WAV下载可追溯，正文只来自ASR',{skip:!ready||!process.env.FFPROBE_PATH},async t=>{
 const {store,media}=fixture(t),f=await serve(t);let transcribed=0;
 const parser=new LocalLinkExtractor(store,media,{transcribe:async id=>{transcribed++;assert.equal(store.asset(id).type,'audio');assert.deepEqual(fs.readFileSync(store.asset(id).path),f.bytes);return {text:'来自识别的正文。',segments:[{start:0,end:1,text:'来自识别的正文。'}]};}});
 assert.equal((await parser.check()).engine,'yt-dlp');const result=await parser.extract('分享 '+f.url+'。');assert.equal(result.text,'来自识别的正文。');assert.equal(transcribed,1);assert.equal(result.linkSource.url,f.url);assert(result.linkSource.sha256);assert.equal(store.data.assets.length,1);assert.equal(fs.readdirSync(store.outputDir()).filter(x=>x.startsWith('.link-input-')).length,0);
});
test('识别失败与落盘失败都回滚下载素材，不返回标题充当正文',{skip:!ready||!process.env.FFPROBE_PATH},async t=>{
 for(const mode of ['asr','save']){const {store,media}=fixture(t),f=await serve(t);const parser=new LocalLinkExtractor(store,media,{transcribe:async()=>{if(mode==='asr')throw Error('识别失败夹具');store.save=()=>{throw Error('保存失败夹具');};return {text:'正文'};}});await assert.rejects(parser.extract(f.url),/失败夹具/);assert.equal(store.data.assets.length,0);assert.equal(fs.readdirSync(store.assetDir).length,0);assert.equal(fs.readdirSync(store.outputDir()).length,0);}
});
test('已有外部桥保持原路径，但传入归一化链接；非法分享文本不创建执行',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'link-bridge-')),before=new Set(process.listeners('exit')),service=createService(root);t.after(()=>{for(const listener of process.listeners('exit'))if(!before.has(listener))process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const draft=service.store.draft();draft.sourceUrl='分享 https://video.test/id。';service.store.data.settings.provider.extractUrl='https://bridge.test/extract';let payload;
 service.providers.bridge=async(url,body)=>{assert.equal(url,'https://bridge.test/extract');payload=body;return {text:'真实桥协议夹具正文'};};
 await service.invoke('extract',{id:draft.id});assert.deepEqual(payload,{url:'https://video.test/id'});assert.equal(service.store.data.runs[0].parameters.protocol,'bridge');draft.sourceUrl='没有链接';await assert.rejects(service.invoke('extract',{id:draft.id}),/没有识别到/);assert.equal(service.store.data.runs.length,1);
});
test('真实Python超时和取消等待退出；解释器缺失不会挂起',{skip:!fs.existsSync(python)},async t=>{
 const {root}=fixture(t),worker=path.join(root,'wait.py'),readyFile=path.join(root,'ready');fs.writeFileSync(worker,'import time,sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text("ready")\ntime.sleep(20)\n');
 const controller=new AbortController(),pending=runWorker(python,worker,[readyFile],{signal:controller.signal}),rejected=assert.rejects(pending,/已取消/);for(let i=0;i<100&&!fs.existsSync(readyFile);i++)await new Promise(resolve=>setTimeout(resolve,20));assert(fs.existsSync(readyFile));controller.abort();await rejected;
 await assert.rejects(runWorker(python,worker,[readyFile],{},120),/超过允许时限/);await assert.rejects(runWorker(path.join(root,'missing.exe'),worker,[]),/未找到/);
});
