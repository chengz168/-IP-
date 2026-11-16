const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {pinyinRows}=require('../server/subtitle-pinyin.cjs');
async function main(){
 const root=path.resolve('evidence/validation/subtitle-pinyin-runtime');
 const texts=[[0x3400,0x4dbf],[0x4e00,0x9fff]].map(([start,end])=>Array.from({length:end-start+1},(_,i)=>String.fromCharCode(start+i)).join(''));
 const previous=spawnSync('C:/Python314/python.exe',[path.join(root,'previous-subtitle-pinyin.py')],{input:JSON.stringify(texts),encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:30000});assert.equal(previous.status,0,previous.stderr);
 const old=JSON.parse(previous.stdout),current=await pinyinRows(texts),differences=[];
 for(let row=0;row<texts.length;row++){assert.equal(old[row].length,current[row].length);for(let i=0;i<texts[row].length;i++)if(old[row][i]!==current[row][i])differences.push({char:texts[row][i],codepoint:'U+'+texts[row].charCodeAt(i).toString(16).toUpperCase(),previous:old[row][i],current:current[row][i]});}
 const report={checkedAt:new Date().toISOString(),referenceOutputVerified:false,scope:'BMP两个原模板实际覆盖区间逐单字，无词组上下文；不是原版运行对照或读音质量验收',characters:texts.reduce((n,s)=>n+s.length,0),previous:'本批归档的pypinyin逐单字worker',current:'npm pinyin 4.0.0 STYLE_TONE heteronym=false',differences: differences.length,examples:differences.filter(r=>'行长重嗯谁说薄繁体乐和沈区单解厦柏曾翟'.includes(r.char)),allDifferences:differences,qualityAccepted:false};
 fs.writeFileSync(path.join(root,'dictionary-comparison.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,allDifferences:undefined},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
