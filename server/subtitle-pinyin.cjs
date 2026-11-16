const {setImmediate:yieldToLoop}=require('node:timers/promises');

const pinyinProvider=Object.freeze({pinyinProvider:'npm-pinyin-single-character',pinyinVersion:'4.0.0',pinyinReferencePackageRange:'^4.0.0',pinyinReferenceInstalledVersionVerified:false,pinyinDictionaryParity:false});

async function pinyinRows(texts,{signal}={}){
 signal?.throwIfAborted();
 if(!Array.isArray(texts)||texts.length>20000)throw new Error('注音字幕超过本地处理上限，请拆分视频');
 let total=0;
 for(const text of texts){if(typeof text!=='string')throw new Error('注音字幕内容必须是文本');total+=text.length;if(total>200000)throw new Error('注音字幕超过本地处理上限，请拆分视频');}
 if(!texts.length)return [];
 const pinyin=require('pinyin').default,result=[];let processed=0;
 for(const text of texts){
  const values=[];
  for(const char of text){
   // 对齐原模板的单字查询与实际BMP范围，不使用词组上下文或拆Unicode代理对。
   const code=char.charCodeAt(0),cjk=(code>=0x3400&&code<=0x4dbf)||(code>=0x4e00&&code<=0x9fff);
   const value=cjk?pinyin(char,{style:pinyin.STYLE_TONE,heteronym:false})?.[0]?.[0]:'';
   if(typeof value!=='string')throw new Error('内置注音词典返回无效数据');
   values.push(value);
   // 让出事件循环，使大量字幕处理期间的取消请求可以生效。
   if(++processed%512===0){await yieldToLoop();signal?.throwIfAborted();}
  }
  result.push(values);
 }
 signal?.throwIfAborted();return result;
}

module.exports={pinyinRows,pinyinProvider};
