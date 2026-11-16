const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/render-stability-20261115'),version='40.10.6';
fs.mkdirSync(directory,{recursive:true});
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function download(url,file,timeout=45000){
 const response=await fetch(url,{signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw Error('下载HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());fs.writeFileSync(file,bytes);return bytes;
}
async function downloadRanges(url,file){
 const head=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(15000)}),total=Number(head.headers.get('content-length'));
 if(!head.ok||!Number.isSafeInteger(total)||total<=0||total>300*1024*1024)throw Error('运行时总字节数无效');
 const block=4*1024*1024,parts=file+'.parts';fs.mkdirSync(parts,{recursive:true});
 const count=Math.ceil(total/block);let next=0,completed=0;
 const consume=async()=>{while(next<count){const index=next++,start=index*block,end=Math.min(total-1,start+block-1),part=path.join(parts,String(index)+'.bin');
  if(!fs.existsSync(part)||fs.statSync(part).size!==end-start+1){
   let lastError;
   for(let attempt=0;attempt<3;attempt++){try{
    const response=await fetch(url,{headers:{Range:'bytes='+start+'-'+end},signal:AbortSignal.timeout(25000)});
    if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`)throw Error('分块响应范围不符');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==end-start+1)throw Error('分块字节数不符');fs.writeFileSync(part,bytes);lastError=null;break;
   }catch(error){lastError=error;}}
   if(lastError)throw lastError;
  }
  completed++;console.log('已校对分块 '+completed+'/'+count);
 }};
 await Promise.all([consume(),consume(),consume(),consume()]);
 const fd=fs.openSync(file,'w');try{for(let index=0;index<count;index++)fs.writeSync(fd,fs.readFileSync(path.join(parts,String(index)+'.bin')));}finally{fs.closeSync(fd);}
 return fs.readFileSync(file);
}
async function main(){
 const metadataUrl='https://registry.npmjs.org/electron/'+version;
 const metadata=JSON.parse((await download(metadataUrl,path.join(directory,'npm-metadata.json'))).toString('utf8'));
 if(metadata.version!==version||!metadata.dist.integrity.startsWith('sha512-'))throw Error('官方元数据版本或校验信息不符');
 const tarball=path.join(directory,'electron-package.tgz'),bytes=await download(metadata.dist.tarball,tarball);
 const actual='sha512-'+crypto.createHash('sha512').update(bytes).digest('base64');
 if(actual!==metadata.dist.integrity)throw Error('npm包完整性校验失败');
 const unpack=path.join(directory,'npm-package');fs.mkdirSync(unpack,{recursive:true});
 const result=spawnSync('tar',['-xf',tarball,'-C',unpack],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr||'npm包解压失败');
 const checksums=JSON.parse(fs.readFileSync(path.join(unpack,'package/checksums.json'),'utf8'));
 const filename='electron-v'+version+'-win32-x64.zip',expected=checksums[filename];if(!/^[a-f0-9]{64}$/.test(expected))throw Error('官方包缺少对应Windows运行时SHA256');
 const destination=path.join(directory,filename),attemptsFile=path.join(directory,'runtime-download-attempts.json'),attempts=fs.existsSync(attemptsFile)?JSON.parse(fs.readFileSync(attemptsFile,'utf8')):[];
 const candidates=['https://registry.npmmirror.com/-/binary/electron/'+version+'/'+filename];
 let selected='';
 if(fs.existsSync(destination)&&crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')===expected)selected='已校验本地下载';
 for(const url of selected?[]:candidates){
  try{console.log('下载候选 '+url);const data=await downloadRanges(url,destination),hash=crypto.createHash('sha256').update(data).digest('hex');if(hash!==expected)throw Error('运行时SHA256不符');selected=url;attempts.push({url,ok:true,bytes:data.length,sha256:hash,rangeDownload:true});break;}
  catch(error){attempts.push({url,ok:false,error:error.message});console.log('候选失败 '+error.message);write('runtime-download-attempts.json',attempts);}
 }
 if(!selected)throw Error('所有候选均未获得官方校验一致的运行时');
 const runtime=path.join('D:/AI-Runtimes/super-ip/electron',version);fs.mkdirSync(runtime,{recursive:true});
 // 使用官方包内校验值核对镜像文件；校验成功后才解压和执行。
 const extracted=spawnSync('tar',['-xf',destination,'-C',runtime],{encoding:'utf8',windowsHide:true,timeout:120000});
 if(extracted.status!==0)throw Error(extracted.stderr||extracted.error?.message||'运行时解压失败');
 const binary=path.join(runtime,'electron.exe');if(fs.readFileSync(path.join(runtime,'version'),'utf8').trim()!==version)throw Error('解压后运行时版本不符');
 write('runtime-provenance.json',{at:new Date().toISOString(),version,metadataUrl,packageIntegrity:actual,binaryArchiveSha256:expected,archive:destination,runtime,binary,selectedSource:selected,attempts,originalRuntimeModified:false});
 console.log(JSON.stringify({version,binary,sha256:expected}));
}
main().catch(error=>{write('runtime-prepare-failure.json',{at:new Date().toISOString(),error:error.stack});console.error(error);process.exitCode=1;});
