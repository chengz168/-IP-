const fs = require('node:fs');
const path = require('node:path');
const {pinyinRows,pinyinProvider}=require('./subtitle-pinyin.cjs');
const {assColor} = require('./custom-subtitles.cjs');
const {SubtitleFonts} = require('./subtitle-fonts.cjs');
const {nativeSubtitleFontFiles,subtitleEngineVersion,simpleSubtitleIds}=require('./subtitle-output.mjs');

const {subtitleFontFamilies:fontFamilies}=require('./subtitle-templates.mjs');
const safe = text => String(text).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝');
const stamp = t => {const c=Math.max(0,Math.round(t*100));return `${Math.floor(c/360000)}:${String(Math.floor(c/6000)%60).padStart(2,'0')}:${String(Math.floor(c/100)%60).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
const rgb = hex => '&H'+hex.slice(5,7)+hex.slice(3,5)+hex.slice(1,3)+'&';
const n = value => Number(value.toFixed(3));

async function templateOptions(edit, store) {
  const {getSubtitleTemplate} = await import('./subtitle-templates.mjs');
  const template = getSubtitleTemplate(edit.subtitleTemplate);
  if (!template) throw new Error('字幕模板无效，请重新选择');
  const {subtitlePosition}=await import('./subtitle-position.mjs');
  const y = subtitlePosition(edit,template);
  if (!Number.isFinite(y) || y < (edit.subtitleOffsetY===undefined?100:0) || y > (edit.subtitleOffsetY===undefined?1820:1920)) throw new Error('字幕上下位置超出画面范围');
  // 旧任务没有关键词开关时默认关闭，非法的显式值仍需拒绝。
  const keywordSetting = edit.subtitleKeywords === undefined ? false : edit.subtitleKeywords;
  if (typeof keywordSetting !== 'boolean') throw new Error('关键词高亮设置无效');
  const family = fontFamilies[template.config.fontFamily];
  const catalog = new SubtitleFonts(store).catalog();
  const nativeFile=nativeSubtitleFontFiles[template.id];
  const font = nativeFile?catalog.find(f=>f.source==='local'&&path.basename(f.file)===nativeFile):catalog.find(f=>f.family===family&&f.source==='local') || catalog.find(f=>f.family===family);
  if (!font) throw new Error(`模板“${template.name}”缺少${nativeFile||template.config.fontFamily}字体，请在设置 → 常规设置中指定已有字体目录`);
  return {template, font, y, keywords:template.keywordSupported && keywordSetting};
}

// 读取字体的真实字宽；逐字动画与拼音用同一组字形宽度排版。
function fontMetrics(font) {
  const buffer = fs.readFileSync(font.file);
  const offset = buffer.toString('ascii',0,4)==='ttcf' ? buffer.readUInt32BE(12+(font.face||0)*4) : 0;
  const tables = {};
  for(let i=0;i<buffer.readUInt16BE(offset+4);i++) {const p=offset+12+i*16;tables[buffer.toString('ascii',p,p+4)]=buffer.readUInt32BE(p+8);}
  const units=buffer.readUInt16BE(tables.head+18),count=buffer.readUInt16BE(tables.hhea+34),cmap=tables.cmap;
  const maps=[];
  for(let i=0;i<buffer.readUInt16BE(cmap+2);i++){const p=cmap+4+i*8,start=cmap+buffer.readUInt32BE(p+4),format=buffer.readUInt16BE(start);if([4,12].includes(format))maps.push({start,format});}
  maps.sort((a,b)=>b.format-a.format);
  function glyph(code) {
    for(const {start,format} of maps) {
      if(format===12){let low=0,high=buffer.readUInt32BE(start+12)-1;while(low<=high){const mid=(low+high)>>1,p=start+16+mid*12,a=buffer.readUInt32BE(p),b=buffer.readUInt32BE(p+4);if(code<a)high=mid-1;else if(code>b)low=mid+1;else return buffer.readUInt32BE(p+8)+code-a;}}
      else if(code<=65535){const segments=buffer.readUInt16BE(start+6)/2,end=start+14,begin=end+segments*2+2,delta=begin+segments*2,range=delta+segments*2;for(let i=0;i<segments;i++){if(code>buffer.readUInt16BE(end+i*2))continue;if(code<buffer.readUInt16BE(begin+i*2))break;const diff=buffer.readInt16BE(delta+i*2),r=buffer.readUInt16BE(range+i*2);if(!r)return (code+diff)&65535;const p=range+i*2+r+(code-buffer.readUInt16BE(begin+i*2))*2,g=buffer.readUInt16BE(p);return g?(g+diff)&65535:0;}}
    }
    return 0;
  }
  return (ch,size) => buffer.readUInt16BE(tables.hmtx+Math.min(glyph(ch.codePointAt(0)),count-1)*4)/units*size;
}

function validateAuxiliary(rows, {template,keywords}) {
  const bilingual=template.id.endsWith('_bilingual');
  rows.forEach((row,index)=>{
    if(!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end<=row.start||typeof row.text!=='string'||!row.text.trim()||row.text.length>10000)throw new Error(`第${index+1}条字幕时间或内容无效`);
    if(!bilingual&&!keywords)return;
    const auxiliary=row.auxiliary;
    if(!auxiliary||auxiliary.sourceText!==row.text)throw new Error(`第${index+1}条字幕缺少与当前原文对应的${bilingual?'译文':'关键词'}，请编辑字幕或生成辅助文本`);
    if(bilingual&&(typeof auxiliary.translation!=='string'||!auxiliary.translation.trim()||auxiliary.translation.length>3000))throw new Error(`第${index+1}条字幕缺少有效译文，请编辑字幕或生成双语译文`);
    if(keywords&&(!Array.isArray(auxiliary.keywords)||auxiliary.keywords.length>20||auxiliary.keywords.some(word=>typeof word!=='string'||!word||!row.text.includes(word))))throw new Error(`第${index+1}条字幕关键词无效，请填写原文中出现的词语`);
  });
}

async function toTemplateAss(rows,width,height,edit,store,{speed=1,signal}={}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>7680||height>7680||!Number.isFinite(speed)||speed<.5||speed>2)throw new Error('字幕画面尺寸或倍速无效');
  if(!Array.isArray(rows)||rows.length>20000||rows.reduce((sum,row)=>sum+String(row.text).length,0)>200000)throw new Error('字幕总量超过本地动态排版上限，请拆分视频');
  const options=await templateOptions(edit,store),{template,font}=options,c=template.config,id=template.id;
  validateAuxiliary(rows,options);
  if(Object.hasOwn(nativeSubtitleFontFiles,id)){
    const {subtitleOffset}=await import('./subtitle-position.mjs'),offsetY=subtitleOffset(edit,template);
    const yellow=require('./yellow-template-subtitles.cjs'),color=require('./color-template-subtitles.cjs'),bilingual=require('./bilingual-template-subtitles.cjs');
    const renderer=simpleSubtitleIds.includes(id)?require('./simple-template-subtitles.cjs').toSimpleTemplateAss:yellow.yellowSubtitleIds.includes(id)?yellow.toYellowTemplateAss:color.colorSubtitleIds.includes(id)?color.toColorTemplateAss:bilingual.bilingualSubtitleIds.includes(id)?bilingual.toBilingualTemplateAss:require('./motion-template-subtitles.cjs').toMotionTemplateAss;
    const pinyin=id==='white_pinyin'?await pinyinRows(rows.map(row=>row.text),{signal}):undefined;
    const result=renderer(rows,width,height,id,font.family,{speed,offsetY,keywords:options.keywords,signal,pinyin});
    return {ass:result.ass,font,metadata:{templateId:id,name:template.name,font:{id:font.id,family:font.family,label:font.label},positionY:options.y,offsetY,pixelShift:result.shift,resolution:{width,height},keywords:options.keywords,...(pinyin?{pinyin,...pinyinProvider}:{}),...(id==='energy_pink_yellow'?{randomGroups:result.details}:{}),...(result.eventCount!==undefined?{eventCount:result.eventCount}:{}),engineVersion:subtitleEngineVersion(id)}};
  }
  const pinyin=id==='white_pinyin'?await pinyinRows(rows.map(row=>row.text),{signal}):null;
  const scale=height/1920,size=c.fontSize*scale,spacing=c.letterSpacing*scale,measure=fontMetrics(font),lineHeight=size*c.lineHeight;
  const y=options.y*scale,x=width/2,events=[];
  function split(text,fontSize=size,maxWidth=width*.88) {
    const lines=[];let line=[],used=0,index=0;
    for(const ch of Array.from(text)){const advance=measure(ch,fontSize)+spacing;if(ch==='\n'||(used+advance>maxWidth&&line.length)){lines.push(line);line=[];used=0;if(ch==='\n'){index++;continue;}}line.push({ch,index,advance});index++;used+=advance;}
    if(line.length)lines.push(line);return lines;
  }
  function emit(start,end,text,tags='',layer=1,style='Main') {if(end-start<.01)return;events.push(`Dialogue: ${layer},${stamp(start)},${stamp(end)},${style},,0,0,0,,{${tags}}${text}`);}
  function animation(ms, index=0) {
    const enter=Math.max(1,Math.min(260,Math.round(ms*.3))),exit=Math.max(1,Math.min(100,Math.round(ms*.12)));
    const fade=`\\fad(${Math.min(120,enter)},${exit})`;
    if(id==='3d_flip')return `\\frx85\\fscx70\\fscy70\\t(0,${enter},\\frx0\\fscx100\\fscy100)${fade}`;
    if(id==='purple_slide')return `\\fscx80\\t(0,${enter},\\fscx100)${fade}`;
    if(id==='yellow_white_split'||id==='yellow_white_italic'||id==='simple_yellow_white')return `\\fscx70\\fscy70\\t(0,${enter},\\fscx100\\fscy100)${fade}`;
    if(id==='cute_pink'||id==='yellow_white_bounce')return `\\fscx80\\fscy80\\t(0,${Math.round(enter*.55)},\\fscx116\\fscy116)\\t(${Math.round(enter*.55)},${enter},\\fscx100\\fscy100)${fade}`;
    if(id==='variety_wave'||id==='energy_pink_yellow')return `\\frz${index%2?6:-6}\\t(0,${enter},\\frz0)${fade}`;
    return fade;
  }
  function lineText(chars,row,color) {
    const text=row.text,words=options.keywords?row.auxiliary.keywords:[];
    return chars.map((item,index)=>{
      const offset=Array.from(text).slice(0,item.index).join('').length;
      const highlighted=words.some(word=>{let pos=text.indexOf(word);while(pos>=0){if(offset>=pos&&offset<pos+word.length)return true;pos=text.indexOf(word,pos+1);}return false;});
      const palette=['#FFFFFF','#FFD166','#FF9CCB','#A4DBFF'];
      const base=id==='cute_pink'?palette[item.index%palette.length]:color;
      return `{\\1c${rgb(highlighted?c.highlightStyle.color:base)}}${safe(item.ch)}`;
    }).join('');
  }
  const perCharacter=['yellow_white_split','yellow_white_bounce','yellow_box_white','white_pinyin','variety_wave','cartoon_yellow','energy_pink_yellow','cute_pink'].includes(id);
  for(const [index,row] of rows.entries()) {
    signal?.throwIfAborted();
    const start=row.start/speed,end=row.end/speed,ms=(end-start)*1000,lines=split(row.text);
    const extra=id==='white_pinyin'?size*.65:id.endsWith('_bilingual')?size*1.45:0;
    if(y+lines.length*lineHeight+extra>height*.98)throw new Error(`第${index+1}条字幕超出画面底部，请上移字幕或精简文本`);
    const color=['yellow_white_split','yellow_white_italic','yellow_white_calligraphy','yellow_white_bounce','simple_yellow_white','cartoon_yellow'].includes(id)&&index%2?'#FFFFFF':c.color;
    if(id==='scrolling_3lines'||id==='scrolling_4lines') {
      const count=id==='scrolling_4lines'?4:3,focus=Math.floor(count/2);
      for(let slot=0;slot<count;slot++){
        const item=rows[index+slot-focus];if(!item)continue;
        const chars=split(item.text,size,width*.84);if(chars.length>2)throw new Error('滚动字幕每条请控制在两行以内');
        const py=y+(slot-focus)*lineHeight*2,alpha=slot===focus?'00':'70';
        emit(start,end,lineText(chars[0],item,slot===focus?'#FFD700':'#FFFFFF')+(chars[1]?'\\N'+lineText(chars[1],item,'#FFFFFF'):''),`\\an8\\move(${n(x)},${n(py+lineHeight)},${n(x)},${n(py)},0,${Math.min(220,Math.round(ms/3))})\\1a&H${alpha}&${animation(ms)}`);
      }
      continue;
    }
    for(const [lineIndex,chars] of lines.entries()) {
      const py=y+lineIndex*lineHeight;
      if(perCharacter) {
        let px=x-chars.reduce((sum,a)=>sum+a.advance,0)/2;
        for(const [i,item] of chars.entries()) {
          const delay=['yellow_white_split','yellow_box_white','cartoon_yellow'].includes(id)?Math.min(ms*.45,chars.length*65)*i/Math.max(1,chars.length):0;
          const wave=['variety_wave','energy_pink_yellow'].includes(id)?Math.sin(i*1.3)*size*.15:0;
          const at=px+item.advance/2,move=(id==='variety_wave'||id==='energy_pink_yellow')?`\\move(${n(at)},${n(py+wave+size*.35)},${n(at)},${n(py+wave)},0,${Math.min(300,Math.round(ms*.4))})`:`\\pos(${n(at)},${n(py)})`;
          emit(start+delay/1000,end,lineText([item],row,color),`\\an8${move}${animation(ms-delay,i)}`);
          if(pinyin&&pinyin[index][item.index])emit(start,end,safe(pinyin[index][item.index]),`\\an2\\pos(${n(at)},${n(py-size*.1)})\\fs${n(size*.32)}\\1c${rgb('#FFFFFF')}\\bord${n(scale)}${animation(ms)}`);
          px+=item.advance;
        }
      } else emit(start,end,lineText(chars,row,color),`\\an8\\pos(${n(x)},${n(py)})${animation(ms)}`);
    }
    if(id.endsWith('_bilingual')) {
      const small=size*.46,translated=split(row.auxiliary.translation,small,width*.9);
      if(translated.length>3||y+lines.length*lineHeight+translated.length*small*1.35>height*.98)throw new Error(`第${index+1}条译文超出画面，请上移字幕或精简译文`);
      translated.forEach((chars,i)=>emit(start,end,chars.map(a=>safe(a.ch)).join(''),`\\an8\\pos(${n(x)},${n(y+lines.length*lineHeight+size*.15+i*small*1.35)})\\fs${n(small)}\\1c${rgb('#FFFFFF')}${animation(ms)}`));
    }
  }
  const primary=assColor(c.color,c.opacity*100),border=c.backgroundType==='solid'?3:1,outline=border===3?size*.12:c.enableStroke?c.strokeWidth*scale:0;
  const edge=border===3?assColor(c.backgroundColor,c.backgroundOpacity*100):assColor(c.strokeColor,100);
  const style=`Style: Main,${font.family},${n(size)},${primary},${primary},${edge},${assColor(c.shadowColor,c.shadowOpacity*100)},${c.fontStyles.includes('bold')?-1:0},${c.fontStyles.includes('italic')?-1:0},0,0,100,100,${n(spacing)},0,${border},${n(outline)},${n(c.enableShadow?c.shadowDistance*scale:0)},8,0,0,0,1`;
  const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${style}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}`;
  return {ass,font,metadata:{templateId:id,name:template.name,font:{id:font.id,family:font.family,label:font.label},positionY:options.y,keywords:options.keywords,pinyin,engineVersion:1}};
}
module.exports={templateOptions,toTemplateAss,validateAuxiliary,fontMetrics};
