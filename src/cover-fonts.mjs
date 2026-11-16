const aliases={'东方大楷':'阿里妈妈东方大楷','江城斜黑体':'江城斜黑体 900W','优设标题黑':'优设标题黑','文道潮黑体':'文道潮黑体','方正粗黑宋简体':'方正粗黑宋简体','江城斜黑体 900W':'江城斜黑体 900W'};
// 前台和后台共用真实字体匹配，不能用字体名称相似冒充已加载该字形。
export async function prepareCoverFonts(input,fonts,loadFont){
 const next=JSON.parse(JSON.stringify(input));
 await Promise.all(next.layers.map(async layer=>{const s=layer.style,font=fonts.find(f=>f.id===s.fontId)||fonts.find(f=>f.label===(aliases[s.fontFamily]||s.fontFamily)||f.family===s.fontFamily);if(s.fontId&&!font)throw new Error('封面字体已缺失，请重新选择');if(font)s.renderFamily=await loadFont(font);else if(!['Microsoft YaHei','微软雅黑','Arial'].includes(s.fontFamily))throw new Error('未找到封面字体“'+s.fontFamily+'”，请在设置中配置字体目录或重新选择');}));return next;
}
