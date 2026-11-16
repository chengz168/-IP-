const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
const root=path.resolve('evidence/research/generation-chain-20261115/lipsync-plan');fs.mkdirSync(root,{recursive:true});
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2));
const request=(url,file)=>new Promise((resolve,reject)=>execFile('curl.exe',['-fsSL','--retry','0','--max-time','25',url,'-o',file],{windowsHide:true},error=>error?reject(error):resolve(JSON.parse(fs.readFileSync(file,'utf8')))));
async function main(){
 const previous=JSON.parse(fs.readFileSync(path.resolve('evidence/research/generation-chain-20261115/musetalk/receipt.json'),'utf8'));
 const existingFile=path.join(root,'sources.json'),existing=fs.existsSync(existingFile)?JSON.parse(fs.readFileSync(existingFile,'utf8')):null;
 const sources=[
  ...['download_weights.bat','scripts/inference.py','musetalk/utils/blending.py','musetalk/utils/preprocessing.py','musetalk/utils/face_parsing/__init__.py','musetalk/utils/utils.py','musetalk/utils/face_detection/detection/sfd/sfd_detector.py','configs/inference/test.yaml'].map(name=>({kind:'github-source',name,url:`https://api.github.com/repos/${previous.repo}/contents/${name}?ref=${previous.commit}`})),
  ...['TMElyralab/MuseTalk','stabilityai/sd-vae-ft-mse','openai/whisper-tiny','yzd-v/DWPose','ManyOtherFunctions/face-parse-bisent'].map(name=>({kind:'huggingface-metadata',name,url:'https://huggingface.co/api/models/'+name+'?blobs=true'})),
 ];
 const result={at:new Date().toISOString(),commit:previous.commit,repo:previous.repo,files:[],errors:[],weightsDownloaded:false,dependenciesInstalled:false,codeExecuted:false,qualityAccepted:false};
 const responses=await Promise.allSettled(sources.map(async source=>{
  const output=path.join(root,source.name.replace(/[/\\]/g,'__')+'.json');let data,actualUrl=source.url,officialError='';
  try{data=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):await request(source.url,output);const cached=existing?.files.find(item=>item.name===source.name&&item.kind===source.kind);if(cached){actualUrl=cached.actualUrl||source.url;officialError=cached.officialError||'';}}catch(error){
   if(source.kind!=='huggingface-metadata')throw error;
   officialError=error.message;actualUrl=source.url.replace('https://huggingface.co','https://hf-mirror.com');
   data=await request(actualUrl,output);
  }
  if(source.kind==='github-source'){
   if(data.encoding!=='base64')throw Error('源码没有完整base64正文：'+source.name);
   const body=Buffer.from(data.content,'base64'),decoded=path.join(root,source.name.replace(/[/\\]/g,'__'));fs.writeFileSync(decoded,body);
   return {...source,file:decoded,bytes:body.length,sha256:hash(body)};
  }
  return {...source,file:output,actualUrl,officialError,officialMetadataIndependentlyVerified:!officialError,commit:data.sha,files:(data.siblings||[]).map(file=>({name:file.rfilename,size:file.size,sha256:file.lfs?.sha256||'',lfsSize:file.lfs?.size}))};
 }));
 responses.forEach((response,index)=>{if(response.status==='fulfilled')result.files.push(response.value);else result.errors.push({source:sources[index],error:response.reason.message});});
 write('sources.json',result);console.log(JSON.stringify({sources:result.files.length,errors:result.errors,weightsDownloaded:false}));
}
main().catch(error=>{write('error.json',{at:new Date().toISOString(),error:error.stack});console.error(error);process.exitCode=1;});
