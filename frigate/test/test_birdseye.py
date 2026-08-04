"""Test camera user and password cleanup."""

import multiprocessing as mp
import os
import tempfile
import unittest

from pydantic import ValidationError

from frigate.config import FrigateConfig
from frigate.config.camera.birdseye import (
    BirdseyeDrawnLayoutConfig,
    BirdseyeLayoutConfig,
    parse_layout_slots,
)
from frigate.output.birdseye import BirdsEyeFrameManager, get_canvas_shape
from frigate.util.builtin import flatten_config_data, update_yaml_file_bulk

SAVING_CONFIG = """
mqtt:
  enabled: false
birdseye:
  enabled: true
  mode: continuous
cameras:
  back:
    ffmpeg:
      inputs:
        - path: rtsp://10.0.0.1:554/video
          roles:
            - detect
    detect:
      height: 1080
      width: 1920
      fps: 5
"""


def build_manager(
    layout: dict, cameras: dict[str, dict]
) -> tuple[FrigateConfig, BirdsEyeFrameManager]:
    """Build a frame manager showing every camera with nothing to draw.

    The cameras are marked as continuously active without a frame, which
    exercises the layout without needing real yuv frames.
    """
    config = FrigateConfig(
        **{
            "mqtt": {"enabled": False},
            "birdseye": {"enabled": True, "mode": "continuous", "layout": layout},
            "cameras": {
                camera: {
                    "birdseye": birdseye,
                    "ffmpeg": {
                        "inputs": [
                            {"path": "rtsp://10.0.0.1:554/video", "roles": ["detect"]}
                        ]
                    },
                    "detect": {"height": 1080, "width": 1920, "fps": 5},
                }
                for camera, birdseye in cameras.items()
            },
        }
    )
    manager = BirdsEyeFrameManager(config, mp.Event())

    for camera_data in manager.cameras.values():
        camera_data["current_frame"] = None
        camera_data["current_frame_time"] = 1.0
        camera_data["last_active_frame"] = 1.0

    return config, manager


def layout_rects(manager: BirdsEyeFrameManager) -> dict[str, tuple[int, int, int, int]]:
    """Return the rectangle each camera is drawn into."""
    return {
        position[0]: position[1] for row in manager.camera_layout for position in row
    }


class TestBirdseye(unittest.TestCase):
    def test_16x9(self):
        """Test 16x9 aspect ratio works as expected for birdseye."""
        width = 1280
        height = 720
        canvas_width, canvas_height = get_canvas_shape(width, height)
        assert canvas_width == width
        assert canvas_height == height

    def test_4x3(self):
        """Test 4x3 aspect ratio works as expected for birdseye."""
        width = 1280
        height = 960
        canvas_width, canvas_height = get_canvas_shape(width, height)
        assert canvas_width == width
        assert canvas_height == height

    def test_32x9(self):
        """Test 32x9 aspect ratio works as expected for birdseye."""
        width = 2560
        height = 720
        canvas_width, canvas_height = get_canvas_shape(width, height)
        assert canvas_width == width
        assert canvas_height == height

    def test_9x16(self):
        """Test 9x16 aspect ratio works as expected for birdseye."""
        width = 720
        height = 1280
        canvas_width, canvas_height = get_canvas_shape(width, height)
        assert canvas_width == width
        assert canvas_height == height

    def test_non_16x9(self):
        """Test non 16x9 aspect ratio fails for birdseye."""
        width = 1280
        height = 840
        canvas_width, canvas_height = get_canvas_shape(width, height)
        assert canvas_width == width  # width will be the same
        assert canvas_height != height


class TestBirdseyeCameraOrder(unittest.TestCase):
    """Test that birdseye reacts to camera order changes without a restart."""

    def setUp(self):
        config = {
            "mqtt": {"enabled": False},
            "birdseye": {"enabled": True, "mode": "continuous"},
            "cameras": {
                camera: {
                    "ffmpeg": {
                        "inputs": [
                            {"path": "rtsp://10.0.0.1:554/video", "roles": ["detect"]}
                        ]
                    },
                    "detect": {"height": 1080, "width": 1920, "fps": 5},
                }
                for camera in ("back", "front", "side")
            },
        }
        self.config = FrigateConfig(**config)
        self.manager = BirdsEyeFrameManager(self.config, mp.Event())

        # mark every camera as continuously active with no frame to draw, which
        # exercises the layout without needing real yuv frames
        for camera_data in self.manager.cameras.values():
            camera_data["current_frame"] = None
            camera_data["current_frame_time"] = 1.0
            camera_data["last_active_frame"] = 1.0

    def layout_order(self) -> list[str]:
        """Return the cameras in the order the current layout renders them."""
        return [position[0] for row in self.manager.camera_layout for position in row]

    def test_layout_uses_configured_order(self):
        """Test the layout is sorted by order, then by name when tied."""
        self.config.cameras["side"].birdseye.order = 0
        self.config.cameras["back"].birdseye.order = 10
        self.config.cameras["front"].birdseye.order = 20

        self.manager.update_frame()

        assert self.layout_order() == ["side", "back", "front"]

    def test_order_change_rebuilds_layout(self):
        """Test a reorder relayouts even though the active cameras are unchanged."""
        self.manager.update_frame()
        assert self.layout_order() == ["back", "front", "side"]

        # a stable active set means only an order change can reset the layout,
        # which is what a settings reorder publishes to this process
        self.config.cameras["side"].birdseye.order = -10

        _, layout_changed = self.manager.update_frame()

        assert layout_changed
        assert self.layout_order() == ["side", "back", "front"]

    def test_unchanged_order_keeps_layout(self):
        """Test a repeat update with no order change doesn't reset the layout."""
        self.manager.update_frame()

        _, layout_changed = self.manager.update_frame()

        assert not layout_changed
        assert self.layout_order() == ["back", "front", "side"]


class TestBirdseyeDrawnLayouts(unittest.TestCase):
    """Test reading the layouts drawn in the config."""

    def test_slots_are_read_as_rectangles(self):
        """Test each slot becomes a column, row, column span and row span."""
        slots = parse_layout_slots(["AAB", "AAC"])

        assert slots == {"A": (0, 0, 2, 2), "B": (2, 0, 1, 1), "C": (2, 1, 1, 1)}

    def test_empty_cells_are_skipped(self):
        """Test a cell can be left empty."""
        slots = parse_layout_slots(["AB", ".C"])

        assert slots == {"A": (0, 0, 1, 1), "B": (1, 0, 1, 1), "C": (1, 1, 1, 1)}

    def test_ragged_rows_are_rejected(self):
        """Test every row has to describe the same number of columns."""
        with self.assertRaises(ValueError):
            parse_layout_slots(["AAB", "AC"])

    def test_split_slot_is_rejected(self):
        """Test a slot that is not a rectangle cannot be drawn as one tile."""
        with self.assertRaises(ValueError):
            parse_layout_slots(["ABA", "CCC"])

    def test_slot_count_has_to_match_the_camera_count(self):
        """Test a layout drawn for the wrong number of cameras is rejected."""
        with self.assertRaises(ValidationError):
            BirdseyeLayoutConfig(
                mode="dynamic", layouts=[{"cameras": 3, "rows": ["AB"]}]
            )

    def test_one_layout_per_camera_count(self):
        """Test two layouts drawn for the same number of cameras are rejected."""
        with self.assertRaises(ValidationError):
            BirdseyeLayoutConfig(
                mode="dynamic",
                layouts=[
                    {"cameras": 2, "rows": ["AB"]},
                    {"cameras": 2, "rows": ["A", "B"]},
                ],
            )


class TestBirdseyeDynamicLayout(unittest.TestCase):
    """Test the layout follows the number of cameras being shown."""

    def setUp(self):
        config = {
            "mqtt": {"enabled": False},
            "birdseye": {
                "enabled": True,
                "mode": "continuous",
                "layout": {
                    "mode": "dynamic",
                    "layouts": [
                        {"cameras": 2, "rows": ["AB"]},
                        {"cameras": 3, "rows": ["AAB", "AAC"]},
                    ],
                },
            },
            "cameras": {
                camera: {
                    "ffmpeg": {
                        "inputs": [
                            {"path": "rtsp://10.0.0.1:554/video", "roles": ["detect"]}
                        ]
                    },
                    "detect": {"height": 1080, "width": 1920, "fps": 5},
                }
                for camera in ("back", "front", "side")
            },
        }
        self.config = FrigateConfig(**config)
        self.manager = BirdsEyeFrameManager(self.config, mp.Event())

        for camera_data in self.manager.cameras.values():
            camera_data["current_frame"] = None
            camera_data["current_frame_time"] = 1.0
            camera_data["last_active_frame"] = 1.0

    def deactivate(self, camera: str) -> None:
        """Age a camera out of the view without removing it."""
        self.manager.cameras[camera]["current_frame_time"] = 1000.0

    def layout(self) -> dict[str, tuple[int, int, int, int]]:
        """Return the rectangle each camera is drawn into."""
        return {
            position[0]: position[1]
            for row in self.manager.camera_layout
            for position in row
        }

    def test_layout_matches_the_camera_count(self):
        """Test the drawn layout for three cameras is used for three cameras."""
        self.manager.update_frame()

        # 1280x720 split into three columns and two rows, with the first
        # camera spanning all of both rows
        assert self.layout() == {
            "back": (0, 0, 854, 720),
            "front": (854, 0, 426, 360),
            "side": (854, 360, 426, 360),
        }

    def test_layout_follows_a_camera_leaving(self):
        """Test the view relayouts when a camera is no longer shown."""
        self.manager.update_frame()
        self.deactivate("side")

        self.manager.update_frame()

        assert self.layout() == {
            "back": (0, 0, 640, 720),
            "front": (640, 0, 640, 720),
        }

    def test_dwell_holds_the_layout(self):
        """Test the tiles stay put while the dwell time has not passed."""
        self.config.birdseye.layout.dwell = 60
        self.manager.update_frame()
        before = self.layout()

        self.deactivate("side")
        self.manager.update_frame()

        assert self.layout() == before

    def test_largest_drawn_layout_caps_the_cameras(self):
        """Test the lowest priority cameras are left out above the largest layout."""
        self.config.birdseye.layout.layouts = [
            BirdseyeDrawnLayoutConfig(cameras=2, rows=["AB"])
        ]

        self.manager.update_frame()

        assert sorted(self.layout()) == ["back", "front"]

    def test_undrawn_count_falls_back_to_the_automatic_layout(self):
        """Test a count between drawn layouts still shows every camera."""
        self.config.birdseye.layout.layouts = [
            BirdseyeDrawnLayoutConfig(cameras=2, rows=["AB"]),
            BirdseyeDrawnLayoutConfig(cameras=4, rows=["AB", "CD"]),
        ]

        self.manager.update_frame()

        assert sorted(self.layout()) == ["back", "front", "side"]


class TestBirdseyeFixedLayout(unittest.TestCase):
    """Test cameras are placed on the grid drawn in the config."""

    def setUp(self):
        # a 1280x720 canvas on a 2x2 grid, so the tiles are 640x360 and the
        # camera spanning both rows is 640x720
        self.config, self.manager = build_manager(
            {"mode": "fixed", "cols": 2, "rows": 2},
            {
                "back": {"cell": (0, 0), "span": (1, 2)},
                "front": {"cell": (1, 0)},
                "side": {"cell": (1, 1)},
            },
        )

    def test_cameras_are_placed_on_their_cells(self):
        """Test every camera is drawn into the cell it was given."""
        self.manager.update_frame()

        assert layout_rects(self.manager) == {
            "back": (0, 0, 640, 720),
            "front": (640, 0, 640, 360),
            "side": (640, 360, 640, 360),
        }

    def test_an_inactive_camera_leaves_its_cell_empty(self):
        """Test the cameras still being shown keep their place."""
        self.manager.update_frame()

        # age the camera out of the view without removing it
        self.manager.cameras["front"]["current_frame_time"] = 1000.0
        self.manager.update_frame()

        assert layout_rects(self.manager) == {
            "back": (0, 0, 640, 720),
            "side": (640, 360, 640, 360),
        }

    def test_a_camera_without_a_cell_is_skipped(self):
        """Test a camera that was never placed is left out of the layout."""
        self.config.cameras["side"].birdseye.cell = None

        self.manager.update_frame()

        assert sorted(layout_rects(self.manager)) == ["back", "front"]

    def test_a_cell_outside_the_grid_is_skipped(self):
        """Test a camera placed off the grid is left out rather than drawn."""
        self.config.cameras["front"].birdseye.cell = (2, 0)

        self.manager.update_frame()

        assert sorted(layout_rects(self.manager)) == ["back", "side"]

    def test_an_overlapping_cell_is_skipped(self):
        """Test the camera that would cover another one is left out."""
        self.config.cameras["back"].birdseye.span = (2, 2)

        self.manager.update_frame()

        assert layout_rects(self.manager) == {"back": (0, 0, 1280, 720)}

    def test_no_cells_falls_back_to_the_automatic_layout(self):
        """Test an empty grid still shows the cameras rather than nothing."""
        for camera in self.config.cameras.values():
            camera.birdseye.cell = None

        self.manager.update_frame()

        assert sorted(layout_rects(self.manager)) == ["back", "front", "side"]


class TestBirdseyeLayoutSaving(unittest.TestCase):
    """Test a layout painted in the settings can be written to the config."""

    def save(self, config_data: dict) -> FrigateConfig:
        """Write a settings payload to a config file the way the API does."""
        with tempfile.NamedTemporaryFile(
            "w", suffix=".yml", delete=False
        ) as config_file:
            config_file.write(SAVING_CONFIG)
            path = config_file.name

        try:
            update_yaml_file_bulk(path, flatten_config_data(config_data))

            with open(path) as written:
                return FrigateConfig.parse(written.read())
        finally:
            os.unlink(path)

    def test_drawn_layouts_are_written(self):
        """Test the drawn layouts survive a round trip through the config file."""
        config = self.save(
            {
                "birdseye": {
                    "layout": {
                        "mode": "dynamic",
                        "layouts": [
                            {"cameras": 1, "rows": ["A"]},
                            {"cameras": 3, "rows": ["AAB", "AAC"]},
                        ],
                    }
                }
            }
        )

        assert config.birdseye.layout.drawn_layouts == {
            1: ["A"],
            3: ["AAB", "AAC"],
        }

    def test_camera_placement_is_written(self):
        """Test a camera's cell and span survive the same round trip."""
        config = self.save(
            {"cameras": {"back": {"birdseye": {"cell": [1, 0], "span": [2, 1]}}}}
        )

        assert config.cameras["back"].birdseye.cell == (1, 0)
        assert config.cameras["back"].birdseye.span == (2, 1)
