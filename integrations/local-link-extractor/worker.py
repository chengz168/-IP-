import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True)
    parser.add_argument('--url')
    parser.add_argument('--mode', choices=['check', 'metadata', 'download'], required=True)
    parser.add_argument('--output')
    parser.add_argument('--cookies', help='可选的浏览器会话 Netscape Cookie 文件')
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.package).resolve()))
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.version import __version__
    except Exception as error:
        raise RuntimeError('本地链接解析器依赖无法加载：' + str(error))
    if args.mode == 'check':
        print(json.dumps({'version': __version__, 'engine': 'yt-dlp'}))
        return
    if not args.url or not args.output:
        raise RuntimeError('解析缺少链接或独立输出目录')
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    options = {
        'quiet': True,
        'no_warnings': True,
        'ignoreconfig': True,
        'noplaylist': True,
        'socket_timeout': 30,
        'retries': 2,
        'nocheckcertificate': False,
        'playlistend': 1,
        'logger': QuietLogger(),
    }
    if args.cookies:
        cookie_file = Path(args.cookies).resolve()
        if not cookie_file.is_file() or cookie_file.stat().st_size <= 0:
            raise RuntimeError('浏览器会话 Cookie 文件不存在或为空')
        options['cookiefile'] = str(cookie_file)
    if args.mode == 'download':
        def accept_media(info, *, incomplete=False):
            if info.get('is_live') or info.get('live_status') in ['is_live', 'is_upcoming']:
                return '不支持直播或预告'
            duration = info.get('duration')
            if duration is not None and (duration <= 0 or duration > 1800):
                return '媒体时长须大于0且不超过30分钟'
            return None
        options.update({
            'format': 'bestaudio/best',
            'outtmpl': str(output / 'source.%(ext)s'),
            'max_filesize': 200 * 1024 * 1024,
            'overwrites': False,
            'match_filter': accept_media,
            'progress_hooks': [download_progress],
        })
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(args.url, download=False)
        if not isinstance(info, dict) or info.get('_type') in ['playlist', 'multi_video'] or 'entries' in info:
            raise RuntimeError('仅支持单条音视频，请使用具体作品链接')
        if args.mode == 'download':
            if info.get('has_drm'):
                raise RuntimeError('不支持受保护媒体')
            info = downloader.process_ie_result(info, download=True)
    result = {
        'id': info.get('id', ''),
        'title': info.get('title', ''),
        'webpage_url': info.get('webpage_url') or args.url,
        'duration': info.get('duration'),
        'is_live': bool(info.get('is_live')),
        'extractor': info.get('extractor_key') or info.get('extractor'),
        'mode': args.mode,
        'version': __version__,
    }
    if args.mode == 'download':
        files = [item for item in output.iterdir() if item.is_file() and item.name.startswith('source.') and item.suffix not in ['.part', '.ytdl']]
        if len(files) != 1:
            raise RuntimeError('链接解析器没有生成唯一媒体文件')
        result['file'] = str(files[0])
        result['bytes'] = files[0].stat().st_size
    print(json.dumps(result, ensure_ascii=False))


class QuietLogger:
    # 只输出结构化结果；平台诊断由异常保留，避免下载器输出污染JSON。
    def debug(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


def download_progress(status):
    if status.get('downloaded_bytes', 0) > 200 * 1024 * 1024:
        raise RuntimeError('下载超过200MB，已停止')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        raise
