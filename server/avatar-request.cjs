const fs=require('node:fs');

// 只保存本次视频实际使用的配置、资源和文件属性，不记录认证信息。
function fileStamp(asset){
 const stat=fs.statSync(asset.path);
 if(!stat.isFile()||stat.size<=0)throw Error('驱动音频或形象视频文件无效，请重新导入');
 return {assetId:asset.id,path:asset.path,type:asset.type,size:stat.size,mtimeMs:stat.mtimeMs};
}
function avatarContext(store,draft){
 const route=require('./video-routing.cjs').effectiveVideoRoute(draft);
 if(['story','product'].includes(draft.video.mode)||route.policy==='auto'&&['story','product'].includes(route.mode))throw Error(`当前文案使用分镜创作或商品宣传，不能直接走人物口型生成；请先进入对应制作流程，或明确手动选择口播。判断依据：${route.reason}`);
 const avatarUrl=(store.data.settings.provider.avatarUrl||'').trim();
 const muse=store.data.settings.provider.avatarProtocol==='musetalk-local';
 const musetalkHome=String(store.data.settings.provider.musetalkHome||'').trim();
 if(muse&&!musetalkHome)throw Error('请先在模型设置中填写本地 MuseTalk 环境目录');
 if(!muse&&!avatarUrl)throw Error('请先接入数字人口型服务；已有视频可直接导入剪辑');
 const local=store.data.settings.provider.avatarProtocol==='comfy-h3';
 const shots=draft.video.mode==='multi'?require('./video-shots.mjs').validateShots(draft.video.shots,store.data.avatars):[];
 const effectiveAvatarId=(local||muse)&&draft.video.mode==='multi'?shots[0].avatarId:draft.video.avatarId;
 const avatar=store.data.avatars.find(a=>a.id===effectiveAvatarId);
 if(!avatar)throw Error('请选择数字人形象');
 const audioId=draft.video.audioId||draft.voice.audioId;
 if(!audioId)throw Error('请先生成声音或选择驱动音频');
 const audio=structuredClone(store.asset(audioId)),video=structuredClone(store.asset(avatar.assetId));
 const shotAvatars=shots.map(shot=>{
  const shape=store.data.avatars.find(a=>a.id===shot.avatarId);
  if(!shape)throw Error('镜头形象不存在，请重新配置镜头');
  return {avatarId:shape.id,source:fileStamp(store.asset(shape.assetId))};
 });
 return {avatarUrl:muse?'':avatarUrl,audio,video,protocol:muse?'musetalk-local':local?'comfy-h3':'compatible',input:{version:'avatar-request-v1',avatarUrl:muse?'':avatarUrl,...(muse?{protocol:'musetalk-local',musetalkHome}:local?{protocol:'comfy-h3'}:{}),mode:draft.video.mode,model:muse?'MuseTalk-1.5':draft.video.model,avatarId:avatar.id,audio:fileStamp(audio),video:fileStamp(video),shots,shotAvatars}};
}
function avatarCurrent(input,store,draft){
 try{return JSON.stringify(input)===JSON.stringify(avatarContext(store,draft).input);}catch{return false;}
}
function avatarFilesCurrent(context){
 try{return [...[context.input.audio,context.input.video],...context.input.shotAvatars.map(a=>a.source)].every(source=>JSON.stringify(fileStamp({id:source.assetId,path:source.path,type:source.type}))===JSON.stringify(source));}catch{return false;}
}
module.exports={avatarContext,avatarCurrent,avatarFilesCurrent};
