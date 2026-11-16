const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/h3-progress-ui-fixture'),workspace=path.join(directory,'workspace');
const write=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2));
function frame(message){const data=Buffer.from(JSON.stringify(message));if(data.length<126)return Buffer.concat([Buffer.from([129,data.length]),data]);const head=Buffer.alloc(4);head[0]=129;head[1]=126;head.writeUInt16BE(data.length,2);return Buffer.concat([head,data]);}
async function main(){
 fs.mkdirSync(directory,{recursive:true});if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('夹具已存在，不覆盖');
 const source=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/h3-progress/workspace/studio.json'),'utf8')),draft=source.drafts[0];
 draft.id=crypto.randomUUID();draft.title='H3真实进度界面协议夹具（非模型生成）';draft.video.assetId='';source.currentId=draft.id;source.runs=[];source.workflowJobs=[];source.settings.outputDir=path.join(workspace,'outputs');source.settings.provider.avatarUrl='http://127.0.0.1:18194';
 fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(source,null,2));
 let submitted,uploads=0;const connections=[],calls=[];
 const emit=(type,data)=>{for(const socket of connections)if(!socket.destroyed)socket.write(frame({type,data}));};
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);calls.push({at:new Date().toISOString(),method:req.method,url:req.url});write('http-calls.json',calls);
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/upload/image')return json({name:uploads++===0?'reference.png':'driver.wav',subfolder:'fixture',type:'input'});
  if(req.url==='/prompt'){
   if(submitted){res.writeHead(409);res.end('{}');return;}
   submitted={id:'fixture-'+crypto.randomUUID(),...JSON.parse(body)};write('submitted.json',{...submitted,fixture:true,realModelGeneration:false});
   emit('executing',{prompt_id:submitted.id,node:'12'});emit('progress',{prompt_id:submitted.id,node:'12',value:3,max:8});
   return json({prompt_id:submitted.id});
  }
  if(req.url==='/queue'&&req.method==='GET')return json({queue_running:submitted?[[0,submitted.id,submitted.prompt,{client_id:submitted.client_id}]]:[],queue_pending:[]});
  if(req.url.startsWith('/history/'))return json({});
  if(req.url==='/qa/progress'){emit('progress',{prompt_id:submitted.id,node:'12',value:4,max:8});return json({fixture:true});}
  if(req.url==='/qa/drop'){for(const socket of connections)socket.destroy();return json({fixture:true});}
  if(req.url==='/queue'||req.url==='/interrupt')return json({});
  res.writeHead(404);res.end('{}');
 });
 server.on('upgrade',(req,socket)=>{
  const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.on('error',()=>{});socket.on('data',data=>{if((data[0]&15)===8)socket.end(Buffer.from([136,0]));});connections.push(socket);
 });
 await new Promise(resolve=>server.listen(18194,'127.0.0.1',resolve));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9345','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,workspace,fixture:true,realModelGeneration:false});const log=fs.createWriteStream(path.join(directory,'electron.log'));child.stdout.pipe(log);child.stderr.pipe(log);
 console.log(JSON.stringify({pid:child.pid,port:9345,fixture:true}));
 child.on('exit',()=>{for(const socket of connections)socket.destroy();server.close();log.end();});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
