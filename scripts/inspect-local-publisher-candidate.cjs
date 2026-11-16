// 固定候选仓库版本并保存公开文档与源码供静态核对，不执行第三方登录或上传代码。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const root=path.resolve('evidence/research/local-publisher-20261116');
async function get(url){const result=await promisify(execFile)('curl.exe',['--ipv4','--fail','--location','--silent','--show-error','--max-time','30','--header','User-Agent: super-ip-local-research',url],{windowsHide:true,maxBuffer:12000000});return result.stdout;}
async function main(){
 fs.mkdirSync(root,{recursive:true});const receipt=path.join(root,'candidate.json');assert(!fs.existsSync(receipt),'已有候选调查，不覆盖');
 const repo='dreammis/social-auto-upload',commitFile=path.join(root,'commit.json'),treeFile=path.join(root,'tree.json');
 const commit=fs.existsSync(commitFile)?JSON.parse(fs.readFileSync(commitFile,'utf8')):JSON.parse(await get('https://api.github.com/repos/'+repo+'/commits/main'));
 if(!fs.existsSync(commitFile))fs.writeFileSync(commitFile,JSON.stringify(commit,null,2),{flag:'wx'});
 const tree=fs.existsSync(treeFile)?JSON.parse(fs.readFileSync(treeFile,'utf8')):JSON.parse(await get('https://api.github.com/repos/'+repo+'/git/trees/'+commit.sha+'?recursive=1'));if(!fs.existsSync(treeFile))fs.writeFileSync(treeFile,JSON.stringify(tree,null,2),{flag:'wx'});
 const names=tree.tree.filter(t=>t.type==='blob'&&(/^(README.md|LICENSE|pyproject.toml|sau_cli.py|conf.py)$/.test(t.path)||/^skills\/(social-auto-upload|douyin-upload)\/SKILL.md$/.test(t.path)||/^uploader\/douyin_uploader\//.test(t.path)||/^utils\/.*(browser|cookie|account|session).*\.py$/.test(t.path)||/^docs\/.*(cli|install|agent|douyin|license).*\.md$/i.test(t.path))).map(t=>t.path);
 const files=[];for(const name of names){const file=path.join(root,'source',name),blob=tree.tree.find(t=>t.path===name);let bytes;
  if(fs.existsSync(file))bytes=fs.readFileSync(file);else{const result=JSON.parse(await get('https://api.github.com/repos/'+repo+'/git/blobs/'+blob.sha));assert.equal(result.encoding,'base64');bytes=Buffer.from(result.content,'base64');}
  assert.equal(crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),blob.sha,'公开源码Git blob校验失败');fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});files.push({name,file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
 fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),repo,commit:commit.sha,commitDate:commit.commit.committer.date,files,thirdPartyCodeExecuted:false,installed:false,uploaded:false},null,2),{flag:'wx'});console.log(JSON.stringify({repo,commit:commit.sha,files:files.map(f=>f.name)}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
