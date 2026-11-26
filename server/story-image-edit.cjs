const fs=require('node:fs'),path=require('node:path');
const {runProcess}=require('./media.cjs');

function editRegion(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['x','y','width','height'].includes(key)))throw Error('局部重绘区域格式无效');
 const {x,y,width,height}=value;
 if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<.01||height<.01||x+width>1.000001||y+height>1.000001)throw Error('请在参考图片内框选有效区域');
 return {x,y,width,height};
}

function editGeometry(value,sourceWidth,sourceHeight,width,height,fit){
 const region=editRegion(value);
 if(![sourceWidth,sourceHeight,width,height].every(Number.isInteger)||Math.min(sourceWidth,sourceHeight,width,height)<16||!['contain','cover','blur'].includes(fit))throw Error('局部重绘参考图尺寸或适配策略无效');
 const scale=fit==='cover'?Math.max(width/sourceWidth,height/sourceHeight):Math.min(width/sourceWidth,height/sourceHeight);
 const fittedWidth=Math.round(sourceWidth*scale),fittedHeight=Math.round(sourceHeight*scale),offsetX=Math.floor((width-fittedWidth)/2),offsetY=Math.floor((height-fittedHeight)/2);
 const x=Math.round(offsetX+region.x*fittedWidth),y=Math.round(offsetY+region.y*fittedHeight),right=Math.round(offsetX+(region.x+region.width)*fittedWidth),bottom=Math.round(offsetY+(region.y+region.height)*fittedHeight);
 if(x<0||y<0||right>width||bottom>height)throw Error('框选区域被当前铺满策略裁切，请使用完整保留或柔化背景扩展');
 const selection={x,y,width:right-x,height:bottom-y};
 if(selection.width<8||selection.height<8)throw Error('框选区域过小，请扩大后重试');
 const side=Math.min(width,height,Math.ceil(Math.max(selection.width,selection.height)*1.8/8)*8);
 if(selection.width>side||selection.height>side)throw Error('当前框选区域过大，请缩小区域或关闭局部重绘后生成整图');
 const crop={x:Math.max(0,Math.min(width-side,Math.round(x+selection.width/2-side/2))),y:Math.max(0,Math.min(height-side,Math.round(y+selection.height/2-side/2))),width:side,height:side};
 return {version:1,region,selection,crop,resolution:768,denoise:1,fit,sourceWidth,sourceHeight,width,height,policy:'focused-inpaint-composite-outside-selection-preserved'};
}

function maskBytes(width,height,region,feather=0){
 const bytes=Buffer.alloc(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(x<region.x||y<region.y||x>=region.x+region.width||y>=region.y+region.height)continue;
  bytes[y*width+x]=feather?Math.round(255*Math.min(1,(x-region.x+1)/feather,(y-region.y+1)/feather,(region.x+region.width-x)/feather,(region.y+region.height-y)/feather)):255;
 }
 return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`),bytes]);
}

async function prepareEdit(media,original,directory,geometry,ctx={}){
 const {crop,selection,resolution}=geometry,patch=path.join(directory,'edit-patch.png'),generationMask=path.join(directory,'edit-generation-mask.png'),compositeMask=path.join(directory,'edit-composite-mask.png');
 const region={x:selection.x-crop.x,y:selection.y-crop.y,width:selection.width,height:selection.height};
 const generationRegion={x:Math.floor(region.x*resolution/crop.width),y:Math.floor(region.y*resolution/crop.height),width:Math.ceil(region.width*resolution/crop.width),height:Math.ceil(region.height*resolution/crop.height)};
 const masks=[{file:generationMask,width:resolution,height:resolution,region:generationRegion,feather:0},{file:compositeMask,width:crop.width,height:crop.height,region,feather:Math.max(3,Math.min(20,Math.round(Math.min(region.width,region.height)/5)))}];
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',original,'-vf',`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${resolution}:${resolution}:flags=lanczos`,'-frames:v','1','-update','1',patch],{signal:ctx.signal});
 for(const mask of masks){
  ctx.signal?.throwIfAborted();const source=mask.file+'.pgm';fs.writeFileSync(source,maskBytes(mask.width,mask.height,mask.region,mask.feather));
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',source,'-vf','format=rgb24','-frames:v','1','-update','1',mask.file],{signal:ctx.signal});
 }
 return {patch,generationMask,compositeMask};
}

function editGraph(base,{original,patch,generationMask,compositeMask,geometry}){
 const node=(class_type,inputs)=>({class_type,inputs}),graph=structuredClone(base),crop=geometry.crop;
 graph['9']=node('LoadImage',{image:patch});
 graph['21']=node('LoadImageMask',{image:generationMask,channel:'red'});
 graph['8']=node('VAEEncodeForInpaint',{pixels:['9',0],vae:['1',2],mask:['21',0],grow_mask_by:0});
 graph['5'].inputs.latent_image=['8',0];graph['5'].inputs.denoise=1;
 graph['3'].inputs.text=(graph['3'].inputs.text||'')+', duplicate subject, collage, rectangular patch, black background, hard edges, pasted image, split image';
 graph['22']=node('ImageScale',{image:['6',0],upscale_method:'lanczos',width:crop.width,height:crop.height,crop:'disabled'});
 graph['23']=node('LoadImage',{image:original});
 graph['24']=node('LoadImageMask',{image:compositeMask,channel:'red'});
 graph['25']=node('ImageCompositeMasked',{destination:['23',0],source:['22',0],x:crop.x,y:crop.y,resize_source:false,mask:['24',0]});
 graph['7'].inputs.images=['25',0];
 return graph;
}

module.exports={editRegion,editGeometry,maskBytes,prepareEdit,editGraph};
