const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// 只在回环地址接收协议验收，不调用模型；返回既有视频，绝不作为口型效果证据。
const root=path.resolve('evidence/validation/avatar-boundaries'),file=path.resolve('evidence/validation/caption-entry/五张原图与既有音轨_无旧字幕源.mp4'),port=18769;
const state={controlledProtocolFixture:true,realAvatarModelRequests:0,driverApplied:false,requests:[],downloads:0,mode:'hold'},pending=new Map();let next=1;
const write=()=>fs.writeFileSync(path.join(root,'bridge-report.json'),JSON.stringify(state,null,2));
const json=(res,data,status=200)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}};
const server=http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(url.pathname==='/status')return json(res,{...state,pending:[...pending.keys()]});
  if(url.pathname==='/mode'){state.mode=url.searchParams.get('value')||'hold';write();return json(res,{mode:state.mode});}
  if(url.pathname==='/release'){for(const [id,item]of pending){item.record.releasedAt=new Date().toISOString();json(item.response,{videoUrl:`http://127.0.0.1:${port}/result.mp4`});pending.delete(id);}write();return json(res,{released:true});}
  if(url.pathname==='/remote-status')return json(res,{status:'running',progress:35});
  if(url.pathname==='/result.mp4'){state.downloads++;write();res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':fs.statSync(file).size});return fs.createReadStream(file).pipe(res);}
  if(req.method==='POST'&&['/avatar','/alternate'].includes(url.pathname)){
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>30000000)throw Error('验收请求超出限制');chunks.push(chunk);}
   const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData();
   const fields={};for(const [key,value]of form){fields[key]=typeof value==='string'?value:{name:value.name,size:value.size,sha256:crypto.createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex')};}
   const id=next++,record={id,receivedAt:new Date().toISOString(),path:url.pathname,fields,mode:state.mode,closedBeforeRelease:false};state.requests.push(record);write();
   if(state.mode==='remote')return json(res,{jobId:'controlled-avatar-job-'+id,status:'running',progress:5,statusUrl:`http://127.0.0.1:${port}/remote-status`});
   pending.set(id,{response:res,record});res.on('close',()=>{if(pending.has(id)){record.closedBeforeRelease=true;pending.delete(id);write();}});return;
  }
  json(res,{error:'不存在的验收路径'},404);
 }catch(error){json(res,{error:error.message},500);}
});
server.listen(port,'127.0.0.1',()=>{write();console.log(JSON.stringify({listening:true,port,controlledProtocolFixture:true,driverApplied:false,source:file}));});
process.on('SIGINT',()=>{server.close();for(const item of pending.values())item.response.destroy();write();});
