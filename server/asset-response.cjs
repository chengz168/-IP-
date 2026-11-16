const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const types={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.flac':'audio/flac','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
function assetResponse(asset,request){
  const size=fs.statSync(asset.path).size;
  const headers={'Content-Type':types[path.extname(asset.path).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache'};
  const range=request.headers.get('range');let start=0,end=size-1,status=200;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    if(!match[1]){const suffix=Number(match[2]);if(suffix<=0)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});start=Math.max(0,size-suffix);}
    else{start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),size-1);}
    if(start>=size||start>end)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  // 明确长度和范围，供桌面播放器计算WAV时长及执行拖动定位。
  const stream=size&&request.method!=='HEAD'?Readable.toWeb(fs.createReadStream(asset.path,{start,end})):null;
  return new Response(stream,{status,headers});
}
module.exports={assetResponse};
