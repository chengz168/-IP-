"""按序写入单个视频编码进程；取消或编码异常不留下成功回执。"""
import os
import queue
import subprocess
import threading
import time


class StreamEncoder:
    def __init__(self, job, ffmpeg, plan, target):
        self.job, self.plan = job, plan
        self.count, self.error = 0, None
        self.queue = queue.Queue(maxsize=1)
        self.log = (job.directory / "stream-encode.log").open("wb")
        try:
            self.child = subprocess.Popen([str(item) for item in [ffmpeg, "-v", "error", "-n",
                "-f", "rawvideo", "-pixel_format", "bgr24", "-video_size", f'{plan["width"]}x{plan["height"]}',
                "-framerate", plan["frameRate"], "-i", "pipe:0", "-an", "-c:v", "libx264",
                "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", target]],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.log, shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except BaseException:
            self.log.close()
            raise
        self.thread = threading.Thread(target=self._write, daemon=True)
        self.thread.start()

    def _write(self):
        try:
            while True:
                item = self.queue.get()
                if item is None:
                    break
                data, done = item
                try:
                    self.child.stdin.write(data)
                    self.child.stdin.flush()
                finally:
                    done.set()
            self.child.stdin.close()
        except BaseException as error:
            self.error = error

    def write(self, index, frame):
        if index != self.count or frame.shape != (self.plan["height"], self.plan["width"], 3) or str(frame.dtype) != "uint8":
            raise ValueError("编码帧索引、尺寸或像素格式不符")
        self.job.checkpoint()
        done = threading.Event()
        self.queue.put_nowait((frame.tobytes(), done))
        started = time.monotonic()
        while not done.wait(.05):
            self.job.checkpoint()
            if self.error or self.child.poll() is not None or time.monotonic() - started > 60:
                raise RuntimeError("流式编码进程失效或写入超时")
        # 写入线程先设置事件再传播异常，因此同时核对进程及错误。
        if self.error or self.child.poll() is not None:
            raise RuntimeError("流式编码写入失败：" + str(self.error))
        self.count += 1

    def finish(self):
        if self.count != self.plan["frameCount"]:
            raise ValueError("流式编码帧数不完整")
        self.queue.put_nowait(None)
        started = time.monotonic()
        while self.thread.is_alive() or self.child.poll() is None:
            self.job.checkpoint()
            if self.error or time.monotonic() - started > 120:
                raise RuntimeError("流式编码收尾失败或超时")
            time.sleep(.05)
        if self.error or self.child.returncode:
            raise RuntimeError("流式编码失败，退出码" + str(self.child.returncode))
        self.log.close()

    def close(self):
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()
        # 唤醒等待队列的线程；正在写入的线程因子进程退出而解除阻塞。
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            pass
        self.thread.join(timeout=5)
        if self.child.stdin and not self.child.stdin.closed:
            self.child.stdin.close()
        if not self.log.closed:
            self.log.close()
