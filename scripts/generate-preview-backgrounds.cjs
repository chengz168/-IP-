// 用标准库绘制自制的中性字幕预览背景，不使用参考人物或第三方图片。
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const table=Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc(bytes){let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,check]);}
function make(width,height){
 const stride=width*3+1,raw=Buffer.alloc(stride*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=y*stride+1+x*3,vertical=y/height,dx=(x/width-.5),dy=(vertical-.38);
  const glow=Math.max(0,1-Math.sqrt(dx*dx+dy*dy)*1.8),grid=x%120<2||y%120<2;
  const head=dx*dx+Math.pow((vertical-.35)*height/width,2)<.085*.085;
  const body=vertical>.46&&vertical<.75&&Math.abs(dx)<.15*(1-(vertical-.46)*.25);
  const base=grid?4:0,shape=head||body?24:0;
  raw[at]=Math.round(21+glow*10+base+shape);raw[at+1]=Math.round(27+glow*14+base+shape);raw[at+2]=Math.round(39+glow*20+base+shape);
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const target=path.resolve(__dirname,'../server/preview-assets');fs.mkdirSync(target,{recursive:true});
for(const [name,width,height] of [['portrait',1080,1920],['landscape',1920,1080]]){
 const file=path.join(target,'subtitle-'+name+'.png');fs.writeFileSync(file,make(width,height));console.log(JSON.stringify({file,width,height,bytes:fs.statSync(file).size}));
}
