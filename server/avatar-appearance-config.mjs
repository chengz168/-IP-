import fs from 'node:fs';
import path from 'node:path';

export function appearanceOptions(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('人物优化参数无效');
 const {avatarId,look='natural',background='original',beautyStrength=0}=input;
 if(typeof avatarId!=='string'||!avatarId.trim())throw Error('请选择需要优化的原人物形象');
 if(!['natural','original'].includes(look)||!['original','business-studio','content-image','custom-image'].includes(background))throw Error('人物优化样式或背景无效');
 if(!Number.isInteger(beautyStrength)||beautyStrength<0||beautyStrength>30)throw Error('自然美颜强度需为0至30的整数，0表示关闭');
 if(look==='original'&&background==='original'&&!beautyStrength)throw Error('请至少选择自然画质优化、背景替换或轻度美颜');
 const result={avatarId,look,background,beautyStrength};
 if(['content-image','custom-image'].includes(background)){
  if(typeof input.backgroundAssetId!=='string'||!input.backgroundAssetId.trim())throw Error('请先生成或选择实际背景图片');
  result.backgroundAssetId=input.backgroundAssetId;
  if(background==='content-image'){
   if(typeof input.id!=='string'||!input.id||typeof input.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceHash))throw Error('文案背景来源无效，请重新选择当前文案生成的背景');
   result.id=input.id;result.sourceHash=input.sourceHash;
  }
 }
 return result;
}

export function appearanceRuntime(provider={},options){
 const python=String(provider.portraitPython||'').trim(),model=String(provider.portraitModel||'').trim();
 if(!python||!path.isAbsolute(python)||!fs.existsSync(python)||!fs.statSync(python).isFile())throw Error('请在模型设置中配置已安装的本地人物优化Python完整路径');
 if(options.background!=='original'&&(!model||!path.isAbsolute(model)||!fs.existsSync(model)||!fs.statSync(model).isFile()||!fs.statSync(model).size))throw Error('本地人物抠像模型缺失，请配置已有RVM ONNX模型；软件不会自动下载');
 const runtime={python,model:options.background==='original'?'':model};
 if(options.beautyStrength>0){
  const beautyRoot=String(provider.musetalkHome||'').trim(),beautyPython=path.join(beautyRoot,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const beautyModels=['resnet18-5c106cde.pth','79999_iter.pth'].map(name=>path.join(beautyRoot,'models','face-parse-bisent',name));
  if(!path.isAbsolute(beautyRoot)||![beautyPython,...beautyModels].every(file=>fs.existsSync(file)&&fs.statSync(file).isFile()&&fs.statSync(file).size))throw Error('轻度美颜需要已配置的本地MuseTalk Python与BiSeNet人脸解析权重，请检查模型设置；不会自动下载');
  Object.assign(runtime,{beautyRoot,beautyPython,beautyModels});
 }
 return runtime;
}

export function appearanceVideoPlan(info){
 const videos=info.streams?.filter(stream=>stream.codec_type==='video')||[],video=videos[0],frames=Number(video?.nb_read_frames),ratio=String(video?.avg_frame_rate||'').split('/').map(Number),fps=ratio.length===2&&ratio[1]?ratio[0]/ratio[1]:NaN,duration=Number(video?.duration||info.format?.duration);
 if(videos.length!==1||!Number.isSafeInteger(frames)||frames<1||!Number.isFinite(fps)||fps<=0||fps>120||!Number.isFinite(duration)||duration<=0||!Number.isSafeInteger(video.width)||video.width<2||!Number.isSafeInteger(video.height)||video.height<2)throw Error('人物视频帧数、尺寸、帧率或时长无效');
 const rotation=Number(video.tags?.rotate||video.side_data_list?.find(item=>item.rotation!==undefined)?.rotation||0);
 if(rotation%360)throw Error('当前人物优化需要先将旋转元数据应用为正向画面，请转存正向视频后重试');
 return {width:video.width,height:video.height,frames,fps,frameRate:video.avg_frame_rate,duration,audio:(info.streams||[]).filter(stream=>stream.codec_type==='audio').map(stream=>({codec:stream.codec_name,duration:Number(stream.duration)||null})),durationTolerance:Math.max(.12,2/fps)};
}
