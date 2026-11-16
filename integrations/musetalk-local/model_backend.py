"""适配已固定的MuseTalk 1.5 API；不调用上游shell推理入口。"""
import os
import json
from pathlib import Path
import sys


def generate(home, plan, frames, output, event, checkpoint, write_frame=None):
    # 所有模型导入只发生在工作器完整检查通过之后。
    sys.path.insert(0, str(home))
    sys.path.insert(1, str(home / "musetalk/utils"))
    os.chdir(home)
    import cv2
    import numpy as np
    import torch
    from transformers import WhisperModel
    from mmpose.apis import inference_topdown
    from mmpose.structures import merge_data_samples
    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.utils.utils import load_all_model
    from musetalk.utils.face_parsing import FaceParsing
    from musetalk.utils.blending import get_image
    from musetalk.utils.preprocessing import model, fa
    from worker import validate_box, source_index
    from face_selection import select_primary, intersection, area

    device = torch.device("cuda:0")
    torch.manual_seed(42)
    torch.cuda.manual_seed_all(42)
    vae, unet, pe = load_all_model(unet_model_path=str(home / "models/musetalkV15/unet.pth"),
                                   unet_config=str(home / "models/musetalkV15/musetalk.json"),
                                   vae_type="sd-vae", device=device)
    vae.vae = vae.vae.half().to(device).eval()
    unet.model = unet.model.half().to(device).eval()
    pe = pe.half().to(device).eval()
    whisper = WhisperModel.from_pretrained(str(home / "models/whisper"), local_files_only=True)
    whisper = whisper.to(device=device, dtype=unet.model.dtype).eval()
    whisper.requires_grad_(False)
    parser = FaceParsing(left_cheek_width=90, right_cheek_width=90)
    processor = AudioProcessor(feature_extractor_path=str(home / "models/whisper"))
    cached = {}
    previous_face = None
    with torch.inference_mode():
        features, length = processor.get_audio_feature(plan["driver"]["path"])
        if length != plan["driver"]["samples"]:
            raise ValueError("Whisper实际音频长度与驱动不符")
        chunks = processor.get_whisper_chunk(features, device, unet.model.dtype, whisper, length,
                                            fps=plan["fps"], audio_padding_length_left=2, audio_padding_length_right=2)
        if len(chunks) != plan["frameCount"]:
            raise ValueError("音频特征帧数不符，禁止循环或跳帧")
        event("audio_features_ready", count=len(chunks))
        # 保持源索引，逐批处理；无脸或任何融合失败都停止，不能继续导致声画错位。
        for start in range(0, plan["frameCount"], 4):
            checkpoint()
            stop = min(start + 4, plan["frameCount"])
            originals, boxes, latents = [], [], []
            for index in range(start, stop):
                checkpoint()
                source = source_index(index, plan)
                file = frames / f"{source:08d}.png"
                original = cv2.imdecode(np.frombuffer(file.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
                if original is None or original.shape != (plan["height"], plan["width"], 3):
                    raise ValueError("源帧解码或尺寸不符，帧" + str(index))
                if source not in cached:
                    prediction = merge_data_samples(inference_topdown(model, original))
                    keypoints = prediction.pred_instances.keypoints
                    detections = fa.face_detector.detect_from_batch(np.asarray([original])[..., ::-1].copy())
                    if len(keypoints) != 1 or len(detections) != 1:
                        raise ValueError("未检出唯一主体关键点，帧" + str(index))
                    primary, selection = select_primary(detections[0], plan["width"], plan["height"], source, previous_face)
                    previous_face = primary
                    with (output.parent / "face-detections.jsonl").open("a", encoding="utf-8") as stream:
                        stream.write(json.dumps(selection) + "\n")
                    face = keypoints[0][23:91].astype(np.int32)
                    if face.shape != (68, 2) or not np.isfinite(face).all():
                        raise ValueError("人脸关键点无效，帧" + str(index))
                    half = face[29]
                    upper = max(0, int(half[1] - (np.max(face[:, 1]) - half[1])))
                    box = [np.min(face[:, 0]), upper, np.max(face[:, 0]), np.max(face[:, 1])]
                    if box[2] <= box[0] or box[3] <= box[1] or box[0] < 0:
                        box = primary[:4]
                    box = validate_box(box, plan["width"], plan["height"], index)
                    if intersection(box, primary) / min(area(box), area(primary)) < .7:
                        raise ValueError("关键点与主体检测框不一致，帧" + str(index))
                    x1, y1, x2, y2 = box
                    box = (x1, y1, x2, min(y2 + 10, plan["height"]))
                    crop = cv2.resize(original[box[1]:box[3], box[0]:box[2]], (256, 256), interpolation=cv2.INTER_LANCZOS4)
                    cached[source] = (box, vae.get_latents_for_unet(crop).cpu())
                box, latent = cached[source]
                latents.append(latent.to(device))
                originals.append(original)
                boxes.append(box)
            conditioning = pe(chunks[start:stop].to(device=device, dtype=unet.model.dtype))
            event("inference_started", firstFrame=start, lastFrame=stop - 1)
            predicted = unet.model(torch.cat(latents, dim=0).to(dtype=unet.model.dtype),
                                   torch.tensor([0], device=device), encoder_hidden_states=conditioning).sample
            decoded = vae.decode_latents(predicted)
            if len(decoded) != stop - start:
                raise ValueError("模型返回的批次帧数不符")
            for offset, face_result in enumerate(decoded):
                checkpoint()
                box, original = boxes[offset], originals[offset]
                resized = cv2.resize(face_result.astype(np.uint8), (box[2] - box[0], box[3] - box[1]))
                combined = get_image(original.copy(), resized, list(box), mode="jaw", fp=parser)
                if combined is None or combined.shape != original.shape or not np.isfinite(combined).all():
                    raise ValueError("融合帧无效")
                x1, y1, x2, y2 = box
                outside_matches = (np.array_equal(combined[:y1], original[:y1])
                                   and np.array_equal(combined[y2:], original[y2:])
                                   and np.array_equal(combined[y1:y2, :x1], original[y1:y2, :x1])
                                   and np.array_equal(combined[y1:y2, x2:], original[y1:y2, x2:]))
                if not outside_matches:
                    raise ValueError("融合修改了人脸框外画面，拒绝输出")
                if write_frame:
                    write_frame(start + offset, combined)
                else:
                    valid, encoded = cv2.imencode(".png", combined)
                    if not valid:
                        raise ValueError("融合PNG编码失败")
                    with (output / f"{start + offset:08d}.png").open("xb") as stream:
                        stream.write(encoded.tobytes())
                with (output.parent / "face-measurements.jsonl").open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps({"frame": start + offset, "sourceFrame": source_index(start + offset, plan), "box": list(box),
                                            "outsideFaceBoxIdenticalBeforeEncoding": outside_matches,
                                            "changedPixelsInsideFaceBox": int(np.count_nonzero(np.any(
                                                combined[y1:y2, x1:x2] != original[y1:y2, x1:x2], axis=2)))}) + "\n")
            event("inferred", completed=stop, total=plan["frameCount"])
