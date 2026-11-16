"""合并同脸重复框，识别占主导且连续的主体；不降低检测器置信度。"""
import math


def area(box):
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def intersection(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def iou(a, b):
    inside = intersection(a, b)
    return inside / (area(a) + area(b) - inside) if inside else 0


def select_primary(detections, width, height, index, previous=None):
    faces = []
    for detection in detections:
        values = [float(value) for value in detection]
        if (len(values) != 5 or not all(math.isfinite(value) for value in values)
                or not 0 <= values[0] < values[2] <= width or not 0 <= values[1] < values[3] <= height
                or not .5 <= values[4] <= 1):
            raise ValueError("检测框或置信度无效，帧" + str(index))
        faces.append(values)
    faces.sort(key=lambda box: area(box), reverse=True)
    if not faces or area(faces[0]) < width * height * .01 or faces[0][4] < .9:
        raise ValueError("没有足够清晰的主体人脸，帧" + str(index))
    primary = faces[0]
    remaining, duplicates = [], []
    for face in faces[1:]:
        # 同一张脸局部框可能在上游IoU NMS后仍保留；同时要求包含度及中心距离。
        distance = math.hypot((primary[0] + primary[2] - face[0] - face[2]) / 2,
                              (primary[1] + primary[3] - face[1] - face[3]) / 2)
        diagonal = math.hypot(primary[2] - primary[0], primary[3] - primary[1])
        if intersection(primary, face) / area(face) >= .9 and distance < diagonal * .25:
            duplicates.append(face)
        else:
            remaining.append(face)
    if remaining and area(remaining[0]) >= area(primary) * .2:
        raise ValueError("出现多个明显前景人脸，无法唯一确认主体，帧" + str(index))
    if previous is not None and iou(primary, previous) < .35:
        raise ValueError("主体人脸位置不连续，拒绝自动切换人物，帧" + str(index))
    return primary, {"frame": index, "primary": primary, "duplicates": duplicates,
                     "smallBackgroundFaces": remaining, "originalDetections": faces,
                     "policy": "dominant-face-containment-temporal-v1"}
