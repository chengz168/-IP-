const {wrapLines}=require('./subtitles.cjs');
const stamp=t=>{const c=Math.max(0,Math.round(t*100));return `${Math.floor(c/360000)}:${String(Math.floor(c/6000)%60).padStart(2,'0')}:${String(Math.floor(c/100)%60).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
const assColor=(hex,opacity)=>'&H'+Math.round(255*(1-opacity/100)).toString(16).padStart(2,'0').toUpperCase()+hex.slice(5,7)+hex.slice(3,5)+hex.slice(1,3);
async function toCustomAss(rows,width,height,input,{speed=1}={}){
  const {validateSubtitleStyle}=await import('./subtitle-style.mjs'),s=validateSubtitleStyle(input);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>7680||height>7680||!Number.isFinite(speed)||speed<=0)throw new Error('字幕画面尺寸或倍速无效');
  const modern=s.version===2,scale=height/1080,size=s.fontSize*scale,spacing=modern?s.letterSpacing*width/1080:s.letterSpacing,margin=modern?s.bottomMargin*height/s.referenceHeight:s.bottomMargin;
  const edgeScale=modern?width/1080:1,outline=s.outlineEnabled?s.outlineWidth*edgeScale:0,shadow=s.shadowEnabled?s.shadowDistance*edgeScale:0,padding=Math.max(4,Math.round(size*.14));
  const chars=Math.min(18,Math.floor((width*.9-padding*2)/(size+Math.max(0,spacing))));
  if(chars<1)throw new Error('字幕字号或字间距过大，当前画面无法容纳');
  const safe=text=>wrapLines(String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝'),chars);
  const prepared=rows.map(row=>{if(!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end<=row.start||typeof row.text!=='string'||!row.text.trim()||row.text.length>10000)throw new Error('字幕时间或内容无效');const lines=safe(row.text);if(modern){const half=lines.length*size*s.lineHeight/2+padding+outline+shadow;if(height-margin-half<0||height-margin+half>height)throw new Error('字幕行数、字号或底部距离超出画面，请调整后重试');}else if(margin+lines.length*size*1.6+padding*2+outline+shadow>height)throw new Error('字幕行数、字号或底部距离超出画面，请调整后重试');return {...row,text:lines.join('\\N'),lines};});
  const primary=assColor(s.color,s.opacity),clear='&HFF000000';
  const style=(name,fg,edge,back,border,ow,sw)=>`Style: ${name},${s.fontFamily},${size.toFixed(3)},${fg},${fg},${edge},${back},${s.bold?-1:0},${s.italic?-1:0},${s.underline?-1:0},0,100,100,${spacing.toFixed(3)},0,${border},${ow.toFixed(3)},${sw.toFixed(3)},2,${Math.round(width*.05)},${Math.round(width*.05)},${Math.round(margin)},1`;
  const styles=[style('Foreground',primary,assColor(s.outlineColor,s.outlineOpacity),assColor(s.shadowColor,s.shadowOpacity),1,outline,shadow)];
  if(s.backgroundEnabled)styles.unshift(style('Background',clear,assColor(s.backgroundColor,s.backgroundOpacity),clear,3,padding,0));
  const events=prepared.flatMap(row=>{
    const line=(name,layer,text=row.text)=>`Dialogue: ${layer},${stamp(row.start/speed)},${stamp(row.end/speed)},${name},,0,0,0,,${text}`;
    if(modern)return row.lines.flatMap((text,i)=>{const y=height-margin+(i-(row.lines.length-1)/2)*size*s.lineHeight,positioned=`{\\an5\\pos(${(width/2).toFixed(3)},${y.toFixed(3)})}${text}`;return [...(s.backgroundEnabled?[line('Background',0,positioned)]:[]),line('Foreground',1,positioned)];});
    return [...(s.backgroundEnabled?[line('Background',0)]:[]),line('Foreground',1)];
  });
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles.join('\n')}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}`;
}
module.exports={toCustomAss,assColor};
