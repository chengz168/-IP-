const {test}=require('node:test'),assert=require('node:assert/strict');
const {mapNarrationReference}=require('../server/narration-reference.cjs');
const recognition=text=>({segments:Array.from(text).map((word,index)=>({text:word,start:index*.5,end:(index+1)*.5,words:[{word,start:index*.5,end:(index+1)*.5}]}))});
const split=(a,b)=>[{id:'a',text:a},{id:'b',text:b}];

test('繁简及同音字可显式映射，保留真实词边界、原识别和差异审计',async()=>{
 const shots=split('大家看板面。','表面光滑。'),raw=recognition('大家看版面表面光滑'),before=structuredClone(raw),out=await mapNarrationReference(shots,shots.map(s=>s.text).join(''),raw,5);
 assert.equal(out.method,'asr-reference-character-pinyin-boundaries');assert.equal(out.shots[0].end,2.5);assert.equal(out.shots[1].start,2.5);assert.equal(out.shots[0].endMethod,'asr-word-end');assert.equal(out.estimatedBoundaries,0);assert.equal(out.requiresReview,true);assert.equal(out.referenceMapping.differences[0].kind,'same-reading-character');assert.match(out.referenceMapping.limitation,/不证明实际发音/);assert.match(out.referenceMapping.recognitionSha256,/^[a-f0-9]{64}$/);assert.deepEqual(raw,before);
 const traditional=await mapNarrationReference([{id:'a',text:'这里有板材。'}],'这里有板材。',recognition('這裡有板材'),4);assert.equal(traditional.referenceMapping.similarity,1);assert(traditional.referenceMapping.differences.length>=2);
});

test('明确量化数字小数和否定变化严格拒绝',async()=>{
 for(const [actual,reference] of [['厚度10毫米','厚度12毫米'],['约1368.94万股','约1368.95万股'],['这个不能用','这个可以用'],['没有残渣','已有残渣'],['三款板面','四款板面'],['十二毫米','十三毫米'],['一百元','二百元']])await assert.rejects(mapNarrationReference([{id:'a',text:reference}],reference,recognition(actual),8),/数字或否定|长度/);
});

test('缺句、低相似和局部失配不能用长稿平均分掩盖',async()=>{
 const original='大家先看板面的外观再看厚度然后检查边缘最后演示清理';
 await assert.rejects(mapNarrationReference([{id:'a',text:original}],original,recognition('大家先看板面的外观最后演示清理'),15),/长度|缺句/);
 await assert.rejects(mapNarrationReference([{id:'a',text:'春天花草盛开适合出去游玩'}],'春天花草盛开适合出去游玩',recognition('大家先看板面具体外观情况'),10),/长度|匹配不足/);
 const text='我们现在来介绍工厂设备可以先仔细看看表面以及边缘形状'.repeat(4),shots=split('错误',text),raw=recognition('错哈'+text);await assert.rejects(mapNarrationReference(shots,'错误'+text,raw,70),/局部匹配不足/);
});

test('词内切点只在显式估算许可下插值并标记，不自动降级',async()=>{
 const shots=split('大家。','看板面。'),raw={segments:[{start:0,end:5,text:'大家看版面'}]};
 await assert.rejects(mapNarrationReference(shots,'大家。看板面。',raw,5),/词内部|估算/);
 const out=await mapNarrationReference(shots,'大家。看板面。',raw,5,{allowEstimated:true});assert.equal(out.estimatedBoundaries,1);assert.equal(out.shots[0].end,2);assert.equal(out.shots[0].endMethod,'asr-segment-interpolation-estimate');assert.equal(out.method,'asr-reference-with-explicit-interpolation');assert.equal(out.allowEstimated,true);
});

test('真实段落边界可映射，过短过长只提示限制不截音',async()=>{
 const raw={segments:[{start:0,end:2,text:'看看版面'},{start:2,end:22,text:'然后介绍细节'}]},shots=split('看看板面。','然后介绍细节。'),out=await mapNarrationReference(shots,'看看板面。然后介绍细节。',raw,22.01);
 assert.equal(out.shots[0].endMethod,'asr-segment-end');assert.equal(out.shots[0].duration,2);assert.equal(out.shots[1].end,Math.ceil(22.01*24)/24);assert.equal(out.limitations.length,2);assert.equal(out.timelineDuration,out.shots[1].end);
});

test('无效输入不写原始识别或猜测词时间',async()=>{
 const shots=split('大家。','看板面。'),raw=recognition('大家看板面');
 await assert.rejects(mapNarrationReference(shots,'不同正文',raw,5),/逐字覆盖/);
 await assert.rejects(mapNarrationReference(shots,'大家。看板面。',raw,5,{allowEstimated:'yes'}),/布尔/);
 await assert.rejects(mapNarrationReference(shots,'大家。看板面。',raw,601),/600秒/);
 const broken=structuredClone(raw);broken.segments[0].words[0].end=3;await assert.rejects(mapNarrationReference(shots,'大家。看板面。',broken,5),/时间轴无效/);
});

test('否定词总数相同但位置变化仍拒绝，新增字处不能冒充真实词边界',async()=>{
 const tail='我们现在来介绍工厂设备可以先仔细看看表面以及边缘形状';
 const actual='这个不能用'+tail,reference='这个能用'+tail+'不';await assert.rejects(mapNarrationReference([{id:'a',text:reference}],reference,recognition(actual),20),/位置变化|数字或否定/);
 const raw='大家看看'+tail,first='大家来',rest='看看'+tail,text=first+rest,shots=split(first,rest);
 await assert.rejects(mapNarrationReference(shots,text,recognition(raw),20),/差异处|局部匹配/);
 const adjustedFirst='大家看看'+tail.slice(0,5)+'呀',adjustedRest=tail.slice(5),adjustedShots=split(adjustedFirst,adjustedRest),adjustedText=adjustedFirst+adjustedRest;
 await assert.rejects(mapNarrationReference(adjustedShots,adjustedText,recognition(raw),20),/差异处|内部/);
 const timing=await mapNarrationReference(adjustedShots,adjustedText,recognition(raw),20,{allowEstimated:true});assert.equal(timing.estimatedBoundaries,1);assert.equal(timing.shots[0].endMethod,'reference-ambiguous-boundary-estimate');
});

test('一起一看一晃和同音设备名可留疑似数词差异供回听，未当作数值修改',async()=>{
 const text='大家一起看一看板面让镜头一晃而过再看看扒炉',raw=recognition('大家一起看一看版面让镜头以晃而过再看看八炉');
 const result=await mapNarrationReference([{id:'a',text}],text,raw,12);assert.equal(result.requiresReview,true);assert.equal(result.referenceMapping.ambiguousNumeralChanges.length,2);assert.match(result.referenceMapping.limitation,/疑似数词/);assert.equal(result.referenceMapping.recognitionText,raw.segments.map(r=>r.text).join(''));
});

test('量化数词移位不能因总数相同而放行',async()=>{
 const tail='我们现在来介绍工厂设备可以先仔细看看表面以及边缘形状';
 const raw='三款'+tail+'板面',text=tail+'三款板面';await assert.rejects(mapNarrationReference([{id:'a',text}],text,recognition(raw),20),/量化表达位置|匹配不足|缺句/);
});
