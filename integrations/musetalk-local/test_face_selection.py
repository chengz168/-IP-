"""主体选择的明确边界，不把协议夹具当成真实模型验收。"""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from face_selection import select_primary


class SelectionTests(unittest.TestCase):
    def test_real_failed_frame_duplicate_boxes_are_same_primary(self):
        detections = [[380.555969, 430.563171, 729.109863, 882.928588, .9999889],
                      [371.176239, 476.388977, 559.956421, 716.953979, .5728234]]
        primary, receipt = select_primary(detections, 1080, 1920, 282)
        self.assertEqual(primary, detections[0])
        self.assertEqual(len(receipt["duplicates"]), 1)
        self.assertEqual(receipt["smallBackgroundFaces"], [])

    def test_small_background_remains_untouched_and_two_foreground_fail(self):
        main = [360, 396, 727, 872, .9999]
        primary, receipt = select_primary([main, [83, 710, 150, 800, .95]], 1080, 1920, 400)
        self.assertEqual(primary, main)
        self.assertEqual(len(receipt["smallBackgroundFaces"]), 1)
        with self.assertRaisesRegex(ValueError, "多个明显前景"):
            select_primary([main, [0, 400, 300, 850, .99]], 1080, 1920, 5)

    def test_no_face_low_confidence_invalid_boxes_and_identity_jump_fail(self):
        for detections in [[], [[300, 400, 700, 900, .8]], [[-1, 1, 50, 50, 1]], [[1, 1, 50, 50, float("nan")]]]:
            with self.assertRaises(ValueError):
                select_primary(detections, 1080, 1920, 6)
        with self.assertRaisesRegex(ValueError, "位置不连续"):
            select_primary([[650, 400, 1000, 850, .999]], 1080, 1920, 7, [0, 400, 350, 850, .999])


if __name__ == "__main__":
    unittest.main()
