const test=require('node:test'),assert=require('node:assert/strict');
const {profileShareLink,shareLink}=require('../server/share-link.mjs');

test('账号主页接受整段分享文字、纯短链和完整主页，保留查询参数',()=>{
 assert.equal(profileShareLink('长按复制此条消息，打开抖音搜索，查看TA的更多作品。 https://v.douyin.com/AccountSample/'),'https://v.douyin.com/AccountSample/');
 assert.equal(profileShareLink('https://v.douyin.com/AccountSample/'),'https://v.douyin.com/AccountSample/');
 assert.equal(profileShareLink('查看TA https://www.douyin.com/user/author?from=share&x=a%2Fb。'),'https://www.douyin.com/user/author?from=share&x=a%2Fb');
 assert.equal(profileShareLink('[账号](https://www.douyin.com/user/author)'),'https://www.douyin.com/user/author');
});

test('账号主页拒绝无链接、数字账号、多链接、非HTTP和URL内凭据',()=>{
 assert.throws(()=>profileShareLink('23783448116'),/抖音号不能代替链接/);
 assert.throws(()=>profileShareLink('https://a.example/user/a https://b.example/user/b'),/只保留一个账号主页/);
 for(const value of ['',null,'file:///C:/data','javascript:alert(1)','ftp://example.com/user','https://user:secret@example.com/user'])assert.throws(()=>profileShareLink(value));
 assert.throws(()=>profileShareLink('https://example.com/'+'a'.repeat(10000)),/10000字/);
});

test('明确的抖音作品引导到单视频入口，采集样本来源仍允许作品URL',()=>{
 for(const url of ['https://www.douyin.com/video/123','https://www.iesdouyin.com/share/video/123/','https://www.douyin.com/note/123','https://www.douyin.com/user/author?modal_id=123']){
  assert.throws(()=>profileShareLink(url),/单条抖音作品链接/);
  assert.equal(shareLink(url),url);
 }
 assert.equal(profileShareLink('https://example.com/video/author'),'https://example.com/video/author');
});
