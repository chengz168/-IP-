const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

// 只读字体的公开名称表，不执行字体文件，也不接受任务提交的任意文件路径。
function readFontNames(buffer){
  const faces=buffer.toString('ascii',0,4)==='ttcf'?Array.from({length:Math.min(buffer.readUInt32BE(8),100)},(_,i)=>buffer.readUInt32BE(12+i*4)):[0];
  return faces.flatMap(offset=>{
    if(offset+12>buffer.length)return [];
    const count=buffer.readUInt16BE(offset+4);let table;
    for(let i=0;i<count;i++){const p=offset+12+i*16;if(p+16>buffer.length)return [];if(buffer.toString('ascii',p,p+4)==='name'){table=buffer.readUInt32BE(p+8);break;}}
    if(table===undefined||table+6>buffer.length)return [];
    const length=buffer.readUInt16BE(table+2),strings=table+buffer.readUInt16BE(table+4),names=[];
    for(let i=0;i<length;i++){const p=table+6+i*12;if(p+12>buffer.length)break;const platform=buffer.readUInt16BE(p),language=buffer.readUInt16BE(p+4),id=buffer.readUInt16BE(p+6),size=buffer.readUInt16BE(p+8),start=strings+buffer.readUInt16BE(p+10);if(![1,16].includes(id)||start+size>buffer.length)continue;let text;if(platform===0||platform===3){text='';for(let j=start;j+1<start+size;j+=2)text+=String.fromCharCode(buffer.readUInt16BE(j));}else if(platform===1)text=buffer.toString('latin1',start,start+size);if(text&&!/[\r\n,\\{}]/.test(text))names.push({text:text.trim(),id,language});}
    const family=names.find(n=>n.id===1&&n.language===0x409)||names.find(n=>n.id===1)||names[0];
    const display=names.find(n=>n.id===1&&n.language===0x804)||family;
    return family?[{family:family.text,label:display.text}]:[];
  });
}
class SubtitleFonts{
  constructor(store){this.store=store;this.cached=null;}
  catalog(){
    const extra=this.store.data.settings.subtitleFontsDir||'',signature=extra;
    if(this.cached?.signature===signature&&Date.now()-this.cached.time<30000)return this.cached.fonts;
    const roots=[path.join(process.env.WINDIR||'C:/Windows','Fonts'),...(extra?[path.resolve(extra)]:[])],fonts=[];
    for(const [index,root] of roots.entries()){
      if(!fs.existsSync(root)||!fs.statSync(root).isDirectory()){if(index>0)throw new Error('字幕字体目录不存在，请在设置中更正');continue;}
      for(const item of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))){
        if(!item.isFile()||! /\.(ttf|otf|ttc)$/i.test(item.name))continue;
        const file=path.join(root,item.name);if(fs.statSync(file).size>100000000)continue;
        let names;try{names=readFontNames(fs.readFileSync(file));}catch{continue;}
        names.forEach((name,face)=>{const id='font-'+crypto.createHash('sha256').update(file.toLowerCase()+'#'+face).digest('hex').slice(0,20);fonts.push({id,...name,face,file,source:index?'local':'system'});});
      }
    }
    if(!fonts.length)throw new Error('未找到可读取的本地字体，请在设置中指定字体目录');
    this.cached={signature,time:Date.now(),fonts};return fonts;
  }
  list(){return this.catalog().map(({file,...font})=>font);}
  resolve(style){const font=this.catalog().find(f=>f.id===style.fontId);if(!font||!fs.existsSync(font.file))throw new Error('所选字幕字体已缺失，请重新选择');if(font.family!==style.fontFamily)throw new Error('字幕字体标识与名称不一致，请重新选择');return font;}
}
module.exports={SubtitleFonts,readFontNames};
