"""使用现有 MuseTalk BiSeNet 语义分割输出脸部皮肤mask。

协议：stdin 逐帧写入 width*height*3 的 RGB uint8；stdout 返回 width*height
的 uint8 mask。stdout 不输出日志，便于主工作器按帧读取；诊断信息写 stderr。
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--width', required=True, type=int)
    parser.add_argument('--height', required=True, type=int)
    args = parser.parse_args()
    protocol = sys.stdout.buffer
    # 第三方库的任何文本日志进入stderr，stdout仅传输定长mask。
    sys.stdout = sys.stderr
    sys.path.insert(0, args.root)
    import cv2
    import numpy as np
    import torch
    from musetalk.utils.face_parsing.model import BiSeNet

    model_dir = f'{args.root}/models/face-parse-bisent'
    net = BiSeNet(f'{model_dir}/resnet18-5c106cde.pth')
    net.load_state_dict(torch.load(f'{model_dir}/79999_iter.pth', map_location=torch.device('cpu')))
    net.eval()
    torch.set_num_threads(min(4, torch.get_num_threads()))
    detector_file = Path(cv2.data.haarcascades) / 'haarcascade_frontalface_default.xml'
    detector = cv2.CascadeClassifier(str(detector_file))
    if detector.empty():
        raise RuntimeError('现有人脸检测配置不可读')
    protocol.write((json.dumps({'kind': 'face-skin-ready-v1', 'detector': 'opencv-haar-frontalface', 'detectorSha256': hashlib.sha256(detector_file.read_bytes()).hexdigest(), 'skinClass': 1, 'opencvVersion': cv2.__version__, 'torchVersion': torch.__version__}) + '\n').encode('utf-8'))
    protocol.flush()
    frame_size = args.width * args.height * 3
    while True:
        raw = bytearray()
        while len(raw) < frame_size:
            block = sys.stdin.buffer.read(frame_size - len(raw))
            if not block:
                break
            raw.extend(block)
        if not raw:
            break
        if len(raw) != frame_size:
            raise RuntimeError('人脸语义分割收到不完整帧')
        frame = np.frombuffer(raw, dtype=np.uint8).reshape(args.height, args.width, 3)
        scale = min(640 / max(args.width, args.height), 1)
        detect_frame = cv2.resize(frame, None, fx=scale, fy=scale)
        faces = detector.detectMultiScale(cv2.cvtColor(detect_frame, cv2.COLOR_RGB2GRAY), scaleFactor=1.1, minNeighbors=5, minSize=(32, 32))
        mask = np.zeros((args.height, args.width), dtype=np.uint8)
        if len(faces) == 0:
            protocol.write(mask.tobytes())
            protocol.flush()
            continue
        # 检测框只用于选取推理区域，不作为美颜mask；实际权重来自语义分类。
        x, y, width, height = max(faces, key=lambda face: face[2] * face[3]) / scale
        x1, y1 = max(0, int(x - width * .18)), max(0, int(y - height * .18))
        x2, y2 = min(args.width, int(x + width * 1.18)), min(args.height, int(y + height * 1.18))
        resized = cv2.resize(frame[y1:y2, x1:x2], (512, 512), interpolation=cv2.INTER_LINEAR)
        # 与训练预处理保持一致；仅保留class 1脸部皮肤，不把嘴唇、眼眉、头发、衣服当皮肤。
        tensor = torch.from_numpy(resized.copy()).float().permute(2, 0, 1) / 255
        tensor = (tensor - torch.tensor([.485, .456, .406])[:, None, None]) / torch.tensor([.229, .224, .225])[:, None, None]
        with torch.no_grad():
            parsing = net(tensor.unsqueeze(0))[0].argmax(1).squeeze(0).cpu().numpy().astype(np.uint8)
        skin = (parsing == 1).astype(np.uint8) * 255
        mask[y1:y2, x1:x2] = cv2.resize(skin, (x2-x1, y2-y1), interpolation=cv2.INTER_LINEAR)
        protocol.write(mask.tobytes())
        protocol.flush()


if __name__ == '__main__':
    main()
