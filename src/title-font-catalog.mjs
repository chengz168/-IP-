// 显示名来自原版菜单实测；不修改用于加载和渲染的字体标识与内部名称。
const referenceLabels=new Map([
 ['Alibaba Sans','阿里普惠体'],['Alimama DongFangDaKai','东方大楷'],
 ['FZCuHeiSongS-B-GB','方正粗黑宋简体'],['FZShuSong-Z01S','方正书宋简体'],
 ['SimHei','黑体'],['HouZunSongTi','猴尊宋体'],['HuXiaoBo-NanShenTi2.0','胡晓波男神体'],
 ['JiangChengLvDongSong','江城律动宋'],['江城斜黑体 900W','江城斜黑体'],
 ['jiangxizhuokai','江西拙楷'],['荆南波波黑','荆南波波黑'],
 ['PangMenZhengDaoBiaoTiTiMianFeiBan-4','庞门正道标题体免费版'],
 ['三极泼墨体','泼墨体'],['SJxingkai-C','三极行楷简体'],
 ['Source Han Sans SC Normal','思源黑体'],['Source Han Serif SC Heavy','思源宋体'],
 ['HanWang KaiBold-Gb5','王汉宗粗楷体简'],['HanWang FangSongMedium-Gb5','王汉宗中仿宋简'],
 ['HanWang WeiBeiMedium-Gb5','王汉宗中魏碑简'],['WDCHT','文道潮黑体'],
 ['AR PL KaitiM GB','文鼎PL简中楷'],['ZiZhiQuXiMaiTi','喜脉体'],
 ['LXGW WenKai Light','霞鹜文楷'],['也字工厂小石头','小石头体'],
 ['YRDZST-Semibold','杨任东竹石体'],['YouSheBiaoTiHei','优设标题黑'],
 ['GenYoMin JP SemiBold','源样明体'],['Moon Stars Kai Light','月星楷']
]);

export function titleFontCatalog(fonts=[],selection={}){
 const firstFaces=fonts.filter(font=>!font.face),local=firstFaces.filter(font=>font.source==='local');
 const rows=(local.length?local:firstFaces).map(font=>({...font,label:font.source==='local'?(referenceLabels.get(font.family)||font.label):font.label}));
 // 保留旧任务的系统字体；字体丢失时显示名称，不把内部ID当作可读标签。
 const selected=selection.fontId?fonts.find(font=>font.id===selection.fontId):fonts.find(font=>font.family===selection.fontFamily);
 if(selected&&!rows.some(font=>font.id===selected.id))rows.push({...selected});
 if(selection.fontId&&!selected)rows.push({id:selection.fontId,family:selection.fontFamily||'',label:selection.fontFamily||'字体已缺失',missing:true});
 return rows;
}
