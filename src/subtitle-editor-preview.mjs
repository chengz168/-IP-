// 按原版弹窗的固定示意画布计算，和视频区的绝对坐标预览分别处理。
export function subtitleEditorPreview(s,fontFamily=s.fontFamily){
 const horizontal=s.referenceHeight===1080,h=horizontal?270:480,scale=Number((h/1080).toFixed(3)),edge=s.outlineWidth*.25,distance=s.shadowDistance*.25;
 const alpha=(color,opacity)=>color+Math.round(opacity/100*255).toString(16).padStart(2,'0');
 const shadows=[];
 if(s.outlineEnabled&&edge>0)for(const [x,y] of [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1],[-1,0],[1,0]])shadows.push(`${x*edge}px ${y*edge}px 0 ${s.outlineColor}`);
 if(s.shadowEnabled&&distance>0)shadows.push(`${distance}px ${distance}px ${distance*2}px ${alpha(s.shadowColor,s.shadowOpacity)}`);
 // 弹窗按公开字族名交给系统解析；本机同参数截图已核实微软雅黑回退近似，真实烧录仍使用所选文件。
 return {fontFamily:'"'+fontFamily+'", "Microsoft YaHei"',fontSize:Math.max(8,s.fontSize*scale)+'px',fontWeight:s.bold?'bold':'normal',fontStyle:s.italic?'italic':'normal',textDecoration:s.underline?'underline':'none',color:s.color,opacity:s.opacity/100,letterSpacing:s.letterSpacing*.25+'px',lineHeight:s.lineHeight||1.2,position:'absolute',left:'50%',bottom:s.bottomMargin*.25+'px',transform:'translateX(-50%)',whiteSpace:'pre-line',zIndex:10,textAlign:'center',WebkitTextStroke:s.outlineEnabled&&edge>0?edge+'px '+s.outlineColor:undefined,WebkitTextFillColor:s.outlineEnabled?s.color:undefined,textShadow:shadows.length?shadows.join(', '):undefined,...(s.backgroundEnabled?{background:alpha(s.backgroundColor,s.backgroundOpacity),padding:'2px 4px',borderRadius:'1.5px'}:{})};
}
