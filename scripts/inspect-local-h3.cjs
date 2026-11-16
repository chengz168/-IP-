const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3');fs.mkdirSync(root,{recursive:true});
const comfy='D:/Comfy-Desktop/ComfyUI-Installs/test-1/ComfyUI';
const report={checkedAt:new Date().toISOString(),comfy,workflowChecks:[],modelFiles:[],inferenceVerified:false};
for(const name of ['video_minimax_h3_t2v.json','video_minimax_h3_r2v.json']){
 const file=path.join(comfy,'user/default/workflows',name),body=fs.readFileSync(file),flow=JSON.parse(body);
 fs.writeFileSync(path.join(root,name),body);
 report.workflowChecks.push({name,sha256:crypto.createHash('sha256').update(body).digest('hex'),nodes:flow.nodes.map(n=>({id:n.id,type:n.type,mode:n.mode,widgets:n.widgets_values,inputs:n.inputs})),links:flow.links});
}
for(const category of ['diffusion_models','text_encoders','vae','loras']){
 for(const name of fs.readdirSync(path.join('E:/ComfyUI-Models',category)).filter(name=>name.toLowerCase().includes('h3'))){
  const file=path.join('E:/ComfyUI-Models',category,name),stat=fs.statSync(file),fd=fs.openSync(file,'r');
  try{
   const size=Buffer.alloc(8);fs.readSync(fd,size,0,8,0);const count=Number(size.readBigUInt64LE());
   if(count>64*1024*1024)throw Error('权重头超出读取预算');
   const header=Buffer.alloc(count);fs.readSync(fd,header,0,count,8);const data=JSON.parse(header);
   report.modelFiles.push({category,name,bytes:stat.size,metadata:data.__metadata__||{},tensorCount:Object.keys(data).length-(data.__metadata__?1:0)});
  }finally{fs.closeSync(fd);}
 }
}
fs.writeFileSync(path.join(root,'inventory.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({models:report.modelFiles.map(({name,bytes,metadata,tensorCount})=>({name,bytes,metadata,tensorCount})),workflows:report.workflowChecks.map(w=>({name:w.name,nodes:w.nodes.map(({id,type,mode,widgets})=>({id,type,mode,widgets}))}))},null,2));
