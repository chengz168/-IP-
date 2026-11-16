const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const directory=path.resolve('evidence/research/generation-chain-20261115/lipsync-plan');
const sources=JSON.parse(fs.readFileSync(path.join(directory,'sources.json'),'utf8'));
const selections={
 'TMElyralab/MuseTalk':['musetalkV15/musetalk.json','musetalkV15/unet.pth'],
 'stabilityai/sd-vae-ft-mse':['config.json','diffusion_pytorch_model.bin'],
 'openai/whisper-tiny':['config.json','pytorch_model.bin','preprocessor_config.json'],
 'yzd-v/DWPose':['dw-ll_ucoco_384.pth'],
 'ManyOtherFunctions/face-parse-bisent':['79999_iter.pth','resnet18-5c106cde.pth'],
};
const files=[];
for(const [repo,names]of Object.entries(selections)){
 const source=sources.files.find(item=>item.kind==='huggingface-metadata'&&item.name===repo);assert(source&&/^[a-f0-9]{40}$/.test(source.commit));
 for(const name of names){const item=source.files.find(file=>file.name===name);assert(item&&Number.isSafeInteger(item.size)&&item.size>0);
  const target=repo==='TMElyralab/MuseTalk'?name:repo==='stabilityai/sd-vae-ft-mse'?'sd-vae/'+name:repo==='openai/whisper-tiny'?'whisper/'+name:repo==='yzd-v/DWPose'?'dwpose/'+name:'face-parse-bisent/'+name;
  files.push({repo,commit:source.commit,name,target:'models/'+target,bytes:item.size,expectedSha256:item.sha256||'',metadataOrigin:source.actualUrl,officialMetadataIndependentlyVerified:source.officialMetadataIndependentlyVerified,downloadUrl:'https://hf-mirror.com/'+repo+'/resolve/'+source.commit+'/'+name});
 }
}
const headers=fs.readFileSync(path.join(directory,'s3fd-origin-head.txt'),'utf8'),length=Number(headers.match(/^Content-Length:\s*(\d+)/im)?.[1]);assert(Number.isSafeInteger(length)&&length>0);
files.push({name:'s3fd-619a316812.pth',target:'musetalk/utils/face_detection/detection/sfd/s3fd.pth',bytes:length,expectedSha256:'',metadataOrigin:'官方固定源码中的模型地址及该地址真实HEAD',downloadUrl:'https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth',knownFullChecksum:false});
const totalBytes=files.reduce((sum,item)=>sum+item.bytes,0);
const plan={at:new Date().toISOString(),candidate:'MuseTalk 1.5',sourceCommit:sources.commit,targetDirectory:'D:/AI-Runtimes/super-ip/musetalk-1.5',files,fileCount:files.length,totalBytes,totalGB:totalBytes/1e9,totalGiB:totalBytes/1024**3,weightsDownloaded:false,approvalReceived:false,dependenciesInstalled:false,dependencyBytesKnown:false,independentEnvironmentRequired:true,sourceCodeExecuted:false,modelQualityValidated:false,notes:['只选择1.5推理所需权重，不下载1.0主模型或训练用SyncNet。','S3FD为固定源码中的隐式下载，须显式预置以避免运行时额外联网。','HF官方站连接失败，当前文件大小/权重SHA来自镜像元数据；不能冒称已独立从官方核验。','小配置及S3FD尚无独立完整已知SHA；实际下载后需记录完整SHA和来源，不把自算SHA冒称官方校验。','Python依赖下载量尚未解析，模型字节数不包含依赖。','固定源码中的os.system路径拼接和异常吞掉不可直接进入产品；需封装参数化FFmpeg、退出码、原尺寸/帧数/音轨与失败隔离。','需要先做同一示例二8秒真实推理、背景保持、逐句口型和听审，再决定正式接入，不能保证效果。']};
fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2));console.log(JSON.stringify({fileCount:plan.fileCount,totalBytes,totalGB:plan.totalGB,totalGiB:plan.totalGiB,weightsDownloaded:false,approvalReceived:false}));
