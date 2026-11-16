const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// 回环协议验收只返回既有视频，不执行任何口型模型；记录提交次数以核对查询没有重交。
const root=path.resolve('evidence/validation/avatar-recovery'),file=path.resolve('evidence/validation/caption-entry/五张原图与既有音轨_无旧字幕源.mp4'),port=18770,base='http://127.0.0.1:'+port;
const state={controlledProtocolFixture:true,realAvatarModelRequests:0,driverApplied:false,pid:process.pid,submissions:[],queries:[],downloads:[],jobs:{}};
const persist=()=>fs.writeFileSync(path.join(root,'bridge-report.json'),JSON.stringify(state,null,2));
const json=(res,value,status=200)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,base);
  if(url.pathname==='/report')return json(res,state);
  if(url.pathname==='/control'){const job=state.jobs[url.searchParams.get('id')];if(!job)return json(res,{error:'任务不存在'},404);job.status=url.searchParams.get('status')||job.status;job.progress=Number(url.searchParams.get('progress')||job.progress);persist();return json(res,job);}
  if(req.method==='POST'&&url.pathname==='/avatar'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData(),fields={};
   for(const [key,value]of form)fields[key]=typeof value==='string'?value:{name:value.name,size:value.size,sha256:crypto.createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex')};
   const id='protocol-recovery-'+(state.submissions.length+1),job={id,status:'running',progress:27};state.jobs[id]=job;state.submissions.push({id,at:new Date().toISOString(),fields});persist();return json(res,{jobId:id,status:'running',progress:27,statusUrl:base+'/jobs/'+id});
  }
  if(url.pathname.startsWith('/jobs/')){
   const id=url.pathname.split('/').at(-1),job=state.jobs[id];if(!job)return json(res,{error:'不存在任务'},404);
   const entry={id,at:new Date().toISOString(),status:job.status,aborted:false};state.queries.push(entry);persist();
   if(job.status==='hold'){req.on('close',()=>{entry.aborted=true;persist();});return;}
   if(job.status==='network-error')return json(res,{error:{message:'受控查询不可用'}},503);
   if(job.status==='bad-media')return json(res,{jobId:id,status:'succeeded',videoUrl:base+'/bad-media'});
   return json(res,{jobId:id,status:job.status,progress:job.progress,...(job.status==='succeeded'?{videoUrl:base+'/result.mp4'}:{}),...(['failed','cancelled'].includes(job.status)?{error:'协议夹具确认'+job.status}:{})});
  }
  if(url.pathname==='/result.mp4'){state.downloads.push({at:new Date().toISOString(),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});persist();res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':fs.statSync(file).size});return fs.createReadStream(file).pipe(res);}
  if(url.pathname==='/bad-media'){res.writeHead(200,{'Content-Type':'video/mp4'});return res.end('这不是有效视频，必须拒绝');}
  json(res,{error:'不存在路径'},404);
 }catch(error){json(res,{error:error.message},500);}
});
server.listen(port,'127.0.0.1',()=>{persist();console.log(JSON.stringify({listening:true,port,pid:process.pid,realAvatarModelRequests:0,driverApplied:false}));});
process.on('SIGINT',()=>{persist();server.closeAllConnections();server.close();});
