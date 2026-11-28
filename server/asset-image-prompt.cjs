// 独立资产图不能把整片分镜表画进一张图片；全局剧本仍保留在生成凭据中。
function assetImagePrompt(input,{architecture}={}){
 if(input.target?.kind!=='asset')return null;
 const asset=input.assetDefinition||{},roles={character:'Show only the designated character. Do not add other people or perform a sequence of story actions.',scene:'Show only the designated environment and its explicitly described furniture or fixtures. Do not add story characters.',prop:'Show only the designated portable object on a simple neutral surface. Do not add people, extra objects, or a whole story scene.'};
 if(asset.kind!==undefined&&!Object.hasOwn(roles,asset.kind))throw Error('独立资产类型无效，未提交图片生成');
 // Z-Image 直接读取中文画面描述，避免把英文资产说明排版当成多幅设计图。
 if(architecture==='z-image-turbo'){
  const scopes={character:'画面主体仅为指定的人物或动物，保持一个静态姿态。',scene:'完整呈现指定环境及已有家具，场景中没有人物。',prop:'指定的单个道具放在简单中性表面上，主体完整可见。'};
  return ['一幅单一机位、连续空间的完整画面，图像充满整个画幅。',scopes[asset.kind]||'仅呈现下述指定实体。',asset.name?'主体名称：'+asset.name:'',asset.description?'外观与环境：'+asset.description:'','画面描述：'+input.prompt,input.style?'仅应用此视觉风格、光线与色彩：'+input.style:'',input.instruction?'本次修订要求：'+input.instruction:'','保持一种透视和一个取景范围，画面边缘自然延伸；没有白边、嵌入小图、重复画幅、字幕或水印。'].filter(Boolean).join('\n');
 }
 return ['Create one standalone asset reference image, one continuous composition. Never render a storyboard, montage, inset, or split screen.',roles[asset.kind]||'Show only the single asset described below; do not enact the full story.',asset.name?'Asset name: '+asset.name:'',asset.description?'Asset appearance: '+asset.description:'','Asset image request: '+input.prompt,input.style?'Visual treatment only (lighting, palette and texture; not additional subjects): '+input.style:'',input.instruction?'Corrections for this asset only: '+input.instruction:'','Do not invent readable text, logos, watermarks, or subtitles.'].filter(Boolean).join('\n');
}
module.exports={assetImagePrompt};
