// 独立资产图不能把整片分镜表画进一张图片；全局剧本仍保留在生成凭据中。
function assetImagePrompt(input){
 if(input.target?.kind!=='asset')return null;
 const asset=input.assetDefinition||{},roles={character:'Show only the designated character. Do not add other people or perform a sequence of story actions.',scene:'Show only the designated environment and its explicitly described furniture or fixtures. Do not add story characters.',prop:'Show only the designated portable object on a simple neutral surface. Do not add people, extra objects, or a whole story scene.'};
 if(asset.kind!==undefined&&!Object.hasOwn(roles,asset.kind))throw Error('独立资产类型无效，未提交图片生成');
 return ['Create one standalone asset reference image, one continuous composition. Never render a storyboard, montage, inset, or split screen.',roles[asset.kind]||'Show only the single asset described below; do not enact the full story.',asset.name?'Asset name: '+asset.name:'',asset.description?'Asset appearance: '+asset.description:'','Asset image request: '+input.prompt,input.style?'Visual treatment only (lighting, palette and texture; not additional subjects): '+input.style:'',input.instruction?'Corrections for this asset only: '+input.instruction:'','Do not invent readable text, logos, watermarks, or subtitles.'].filter(Boolean).join('\n');
}
module.exports={assetImagePrompt};
