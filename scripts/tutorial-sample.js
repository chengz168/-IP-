async (page) => {
  // 只读取已在页面中公开播放的视频，逐个时间点截取学习证据。
  const dir = 'D:/我的智能体/超级IP智能体/evidence/tutorial/new-version';
  const video = page.locator('video').nth(1);
  const info = await video.evaluate(v => ({src: v.currentSrc, duration: v.duration}));
  const samples = [];
  for (let time = 0; time < info.duration; time += 25) {
    await video.evaluate((v,time) => new Promise(resolve => {
      v.pause();
      v.addEventListener('seeked', resolve, {once: true});
      v.currentTime = time + 0.1;
      setTimeout(resolve, 8000);
    }), time);
    await video.screenshot({path: dir + '/' + String(time).padStart(4,'0') + '.png'});
    samples.push(time);
  }
  return {info,samples};
}
