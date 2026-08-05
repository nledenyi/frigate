from unittest import TestCase, main

import cv2
import numpy as np

from frigate.util.image import copy_yuv_to_position, get_yuv_crop


class TestCopyYuvToPosition(TestCase):
    def setUp(self):
        self.source_frame_bgr = np.zeros((400, 800, 3), np.uint8)
        self.source_frame_bgr[:] = (0, 0, 255)
        self.source_yuv_frame = cv2.cvtColor(
            self.source_frame_bgr, cv2.COLOR_BGR2YUV_I420
        )
        y, u1, u2, v1, v2 = get_yuv_crop(
            self.source_yuv_frame.shape,
            (
                0,
                0,
                self.source_frame_bgr.shape[1],
                self.source_frame_bgr.shape[0],
            ),
        )
        self.source_channel_dims = {
            "y": y,
            "u1": u1,
            "u2": u2,
            "v1": v1,
            "v2": v2,
        }

        self.dest_frame_bgr = np.zeros((400, 800, 3), np.uint8)
        self.dest_frame_bgr[:] = (112, 202, 50)
        self.dest_frame_bgr[100:300, 200:600] = (255, 0, 0)
        self.dest_yuv_frame = cv2.cvtColor(self.dest_frame_bgr, cv2.COLOR_BGR2YUV_I420)

    def test_clear_position(self):
        copy_yuv_to_position(self.dest_yuv_frame, (100, 100), (100, 100))
        # cv2.imwrite(f"source_frame_yuv.jpg", self.source_yuv_frame)
        # cv2.imwrite(f"dest_frame_yuv.jpg", self.dest_yuv_frame)

    def test_copy_position(self):
        copy_yuv_to_position(
            self.dest_yuv_frame,
            (100, 100),
            (100, 200),
            self.source_yuv_frame,
            self.source_channel_dims,
        )

    # cv2.imwrite(f"source_frame_yuv.jpg", self.source_yuv_frame)
    # cv2.imwrite(f"dest_frame_yuv.jpg", self.dest_yuv_frame)

    def test_letterboxed_source_is_centered(self):
        """Test a source that cannot fill its cell sits between equal bars.

        The cell is square and the source is 2:1, so it is drawn 400x200 with
        200 rows of slack to share between the top and the bottom.
        """
        copy_yuv_to_position(
            self.dest_yuv_frame,
            (0, 0),
            (400, 400),
            self.source_yuv_frame,
            self.source_channel_dims,
        )

        # everything outside the drawn image was cleared to the black level
        luma = self.dest_yuv_frame[0:400, 0:400]
        drawn = np.flatnonzero(luma.max(axis=1) > 16)
        top_bar = int(drawn[0])
        bottom_bar = 400 - int(drawn[-1]) - 1

        # the offsets are snapped to a multiple of 4, so they can differ by that
        assert abs(top_bar - bottom_bar) <= 4, (
            f"image is not centered: {top_bar} above, {bottom_bar} below"
        )

    def test_copy_position_full_screen(self):
        copy_yuv_to_position(
            self.dest_yuv_frame,
            (0, 0),
            (400, 800),
            self.source_yuv_frame,
            self.source_channel_dims,
        )
        # cv2.imwrite(f"source_frame_yuv.jpg", self.source_yuv_frame)
        # cv2.imwrite(f"dest_frame_yuv.jpg", self.dest_yuv_frame)


if __name__ == "__main__":
    main(verbosity=2)
