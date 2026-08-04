from enum import Enum

from pydantic import BaseModel, Field, model_validator

from ..base import FrigateBaseModel

__all__ = [
    "BirdseyeCameraConfig",
    "BirdseyeConfig",
    "BirdseyeDrawnLayoutConfig",
    "BirdseyeLayoutConfig",
    "BirdseyeLayoutModeEnum",
    "BirdseyeModeEnum",
    "parse_layout_slots",
]


def parse_layout_slots(rows: list[str]) -> dict[str, tuple[int, int, int, int]]:
    """Read a drawn layout into a rectangle per slot.

    Each row is one grid row and each character is one cell: a letter for the
    slot the cell belongs to, or "." for a cell that is left empty. Returns
    {slot: (column, row, column span, row span)} keyed by the slot letter.
    """
    if not rows:
        raise ValueError("layout has no rows")

    cols = len(rows[0])

    if cols == 0:
        raise ValueError("layout rows are empty")

    if any(len(row) != cols for row in rows):
        raise ValueError("layout rows are not all the same length")

    cells: dict[str, list[tuple[int, int]]] = {}

    for row_index, row in enumerate(rows):
        for col_index, slot in enumerate(row):
            if slot == ".":
                continue

            if not slot.isalpha():
                raise ValueError(f"'{slot}' is not a letter or '.'")

            cells.setdefault(slot, []).append((col_index, row_index))

    slots = {}

    for slot, positions in sorted(cells.items()):
        columns = [position[0] for position in positions]
        row_indexes = [position[1] for position in positions]
        col, row = min(columns), min(row_indexes)
        span_c = max(columns) - col + 1
        span_r = max(row_indexes) - row + 1

        # anything other than a solid rectangle cannot be drawn as one tile
        if len(positions) != span_c * span_r:
            raise ValueError(f"slot '{slot}' is not a rectangle")

        slots[slot] = (col, row, span_c, span_r)

    if not slots:
        raise ValueError("layout has no slots")

    return slots


class BirdseyeModeEnum(str, Enum):
    objects = "objects"
    motion = "motion"
    continuous = "continuous"

    @classmethod
    def get_index(cls, type):
        return list(cls).index(type)

    @classmethod
    def get(cls, index):
        return list(cls)[index]


class BirdseyeLayoutModeEnum(str, Enum):
    auto = "auto"
    fixed = "fixed"
    dynamic = "dynamic"


class BirdseyeDrawnLayoutConfig(FrigateBaseModel):
    cameras: int = Field(
        title="Camera count",
        description="Number of cameras being shown that this layout is drawn for.",
        ge=1,
    )
    rows: list[str] = Field(
        title="Drawn rows",
        description="The layout, drawn as a list of rows with one character per cell: a letter for the slot the cell belongs to, or '.' for an empty cell.",
    )

    @model_validator(mode="after")
    def validate_rows(self) -> "BirdseyeDrawnLayoutConfig":
        try:
            slots = parse_layout_slots(self.rows)
        except ValueError as err:
            raise ValueError(
                f"Birdseye layout for {self.cameras} cameras is invalid: {err}"
            ) from err

        if len(slots) != self.cameras:
            raise ValueError(
                f"Birdseye layout for {self.cameras} cameras has {len(slots)} slots"
            )

        return self


class BirdseyeLayoutConfig(FrigateBaseModel):
    mode: BirdseyeLayoutModeEnum = Field(
        default=BirdseyeLayoutModeEnum.auto,
        title="Layout mode",
        description="How tiles are placed: 'auto' packs the active cameras automatically, 'fixed' places each camera on a grid using its own cell and span, 'dynamic' picks a drawn layout matching the number of cameras being shown.",
    )
    cols: int = Field(
        default=4,
        title="Grid columns",
        description="Number of grid columns when the layout mode is 'fixed'.",
        ge=1,
        le=16,
    )
    rows: int = Field(
        default=4,
        title="Grid rows",
        description="Number of grid rows when the layout mode is 'fixed'.",
        ge=1,
        le=16,
    )
    layouts: list[BirdseyeDrawnLayoutConfig] = Field(
        default_factory=list,
        title="Drawn layouts",
        description="A layout drawn for each number of cameras being shown when the layout mode is 'dynamic'. Slots are filled in alphabetical order with the cameras being shown, ordered by their position.",
    )
    dwell: int = Field(
        default=0,
        title="Layout dwell time",
        description="Seconds a dynamic layout is kept before the view is laid out again, which keeps the tiles from moving every time a camera comes or goes.",
        ge=0,
    )
    scaling_factor: float = Field(
        default=2.0,
        title="Scaling factor",
        description="Scaling factor used by the layout calculator (range 1.0 to 5.0).",
        ge=1.0,
        le=5.0,
    )
    max_cameras: int | None = Field(
        default=None,
        title="Max cameras",
        description="Maximum number of cameras to display at once in Birdseye; shows the most recent cameras.",
    )

    @property
    def drawn_layouts(self) -> dict[int, list[str]]:
        """Get the drawn layouts by the number of cameras they are drawn for."""
        return {layout.cameras: layout.rows for layout in self.layouts}

    @model_validator(mode="after")
    def validate_layouts(self) -> "BirdseyeLayoutConfig":
        counts = [layout.cameras for layout in self.layouts]

        if len(set(counts)) != len(counts):
            raise ValueError("Birdseye has more than one layout for a camera count")

        return self


class BirdseyeConfig(FrigateBaseModel):
    enabled: bool = Field(
        default=True,
        title="Enable Birdseye",
        description="Enable or disable the Birdseye view feature.",
    )
    mode: BirdseyeModeEnum = Field(
        default=BirdseyeModeEnum.objects,
        title="Tracking mode",
        description="Mode for including cameras in Birdseye: 'objects', 'motion', or 'continuous'.",
    )

    restream: bool = Field(
        default=False,
        title="Restream RTSP",
        description="Re-stream the Birdseye output as an RTSP feed; enabling this will keep Birdseye running continuously.",
    )
    width: int = Field(
        default=1280,
        title="Width",
        description="Output width (pixels) of the composed Birdseye frame.",
    )
    height: int = Field(
        default=720,
        title="Height",
        description="Output height (pixels) of the composed Birdseye frame.",
    )
    quality: int = Field(
        default=8,
        title="Encoding quality",
        description="Encoding quality for the Birdseye mpeg1 feed (1 highest quality, 31 lowest).",
        ge=1,
        le=31,
    )
    inactivity_threshold: int = Field(
        default=30,
        title="Inactivity threshold",
        description="Seconds of inactivity after which a camera will stop being shown in Birdseye.",
        gt=0,
    )
    layout: BirdseyeLayoutConfig = Field(
        default_factory=BirdseyeLayoutConfig,
        title="Layout",
        description="Layout options for the Birdseye composition.",
    )
    idle_heartbeat_fps: float = Field(
        default=0.0,
        ge=0.0,
        le=10.0,
        title="Idle heartbeat FPS",
        description="Frames-per-second to resend the last composed Birdseye frame when idle; set to 0 to disable.",
    )


# uses BaseModel because some global attributes are not available at the camera level
class BirdseyeCameraConfig(BaseModel):
    enabled: bool = Field(
        default=True,
        title="Enable Birdseye",
        description="Enable or disable the Birdseye view feature.",
    )
    mode: BirdseyeModeEnum = Field(
        default=BirdseyeModeEnum.objects,
        title="Tracking mode",
        description="Mode for including cameras in Birdseye: 'objects', 'motion', or 'continuous'.",
    )

    order: int = Field(
        default=0,
        title="Position",
        description="Numeric position controlling the camera's ordering in the Birdseye layout.",
    )
    cell: tuple[int, int] | None = Field(
        default=None,
        title="Grid cell",
        description="Grid cell [column, row] this camera is placed in when the Birdseye layout mode is 'fixed'; zero-based, top-left origin.",
    )
    span: tuple[int, int] = Field(
        default=(1, 1),
        title="Grid span",
        description="How many [columns, rows] this camera occupies when the Birdseye layout mode is 'fixed'.",
    )
