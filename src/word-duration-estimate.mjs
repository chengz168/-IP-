// 仅根据字数和配音节奏粗估，不将其当成任意视频类型的实际成片时长。
export function estimateWordDuration(value,speed=1){
 const count=typeof value==='string'&&value.trim()===''?NaN:Number(value);
 if(!Number.isSafeInteger(count)||count<=0)return null;
 const requested=Number(speed),rate=Number.isFinite(requested)&&requested>=0.5&&requested<=2?requested:1;
 const minSeconds=Math.max(1,Math.ceil(count/(5*rate))),maxSeconds=Math.max(1,Math.ceil(count/(3*rate)));
 if(!Number.isSafeInteger(maxSeconds))return null;
 return {minSeconds,maxSeconds,speed:rate,text:`预计视频时长 ${minSeconds===maxSeconds?minSeconds:minSeconds+'–'+maxSeconds} 秒`,explanation:`仅按目标字数与当前配音节奏粗估：中文每秒 3–5 字为估算参数，当前语速 ${rate} 倍。目标字数含标点，未扣除不朗读的说明。分镜、动作、停顿、留白及转场会改变时长；纯画面或剧情视频不能仅凭字数确定。以实际成片为准。`};
}
