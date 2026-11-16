// 名片参数取自原版可见配置；读取旧任务时不写入默认值。
export const namecardDefaults={version:1,displayMode:'duration',duration:5,offsetX:64,offsetY:96,fontId:'',fontFamily:'Microsoft YaHei',fontSize:28,textColor:'#FFFFFF',opacity:1,letterSpacing:0,lineSpacing:2,nameBold:true,backgroundColor:'#000000',backgroundOpacity:.52,backgroundPaddingX:18,backgroundPaddingY:12,backgroundRadius:0};
export const namecardRanges={duration:[1,60],offsetX:[0,900],offsetY:[0,1600],fontSize:[18,80],opacity:[0,1],letterSpacing:[0,30],lineSpacing:[0,40],backgroundOpacity:[0,1],backgroundPaddingX:[0,120],backgroundPaddingY:[0,80],backgroundRadius:[0,120]};
export function namecardDesign(edit){return {...namecardDefaults,...edit?.cardDesign};}
export function validateNamecard(edit){
 const design=namecardDesign(edit);
 if(design.version!==1||!['always','duration'].includes(design.displayMode))throw Error('名片显示方式无效');
 for(const [key,[min,max]]of Object.entries(namecardRanges))if(typeof design[key]!=='number'||!Number.isFinite(design[key])||design[key]<min||design[key]>max)throw Error('名片参数超出允许范围：'+key);
 if(typeof design.nameBold!=='boolean')throw Error('名片称呼粗体开关无效');
 for(const key of ['textColor','backgroundColor'])if(!/^#[a-f\d]{6}$/i.test(design[key]))throw Error('名片颜色请输入六位十六进制色值');
 if(typeof design.fontFamily!=='string'||!design.fontFamily.trim()||/[\r\n,\\{}]/.test(design.fontFamily)||design.fontFamily.length>150||typeof design.fontId!=='string')throw Error('名片字体无效');
 const name=String(edit.cardName||'').trim()||'人物称呼',lines=String(edit.cardDescription||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(name.length>500||lines.length>30||lines.some(s=>s.length>1000))throw Error('名片文字过长，请精简内容');
 return {design,name,lines:lines.length?lines:['简单介绍']};
}
export function namecardSnapshot(edit,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>8192||height>8192)throw Error('名片画面尺寸无效');
 return {...validateNamecard(edit),width,height};
}
