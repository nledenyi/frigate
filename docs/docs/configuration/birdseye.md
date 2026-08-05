# Birdseye

import ConfigTabs from "@site/src/components/ConfigTabs";
import TabItem from "@theme/TabItem";
import NavPath from "@site/src/components/NavPath";

In addition to Frigate's Live camera dashboard, Birdseye allows a portable heads-up view of your cameras to see what is going on around your property / space without having to watch all cameras that may have nothing happening. Birdseye allows specific modes that intelligently show and disappear based on what you care about.

Birdseye can be viewed by adding the "Birdseye" camera to a Camera Group in the Web UI. Add a Camera Group by pressing the pencil icon in the sidebar on the Live page, and choose "Birdseye" as one of the cameras.

Birdseye can also be used in Home Assistant dashboards, cast to media devices, etc.

:::note

Each camera tile in Birdseye is composed from the frames of the stream assigned the `detect` role, so a camera's image quality in Birdseye matches its detect stream resolution rather than a higher-resolution recording stream. If a camera looks low quality in Birdseye, increasing the detect width and height (or assigning the `detect` role to a higher-resolution stream) is what affects it. See [setting up camera inputs](./cameras.md#setting-up-camera-inputs) for how roles are assigned.

:::

## Birdseye Behavior

### Birdseye Modes

Birdseye offers different modes to customize which cameras show under which circumstances.

- **continuous:** All cameras are always included, whether or not they are still sending anything
- **online:** Every camera that is still sending a stream is included. A camera that goes offline is dropped once nothing has arrived from it for `inactivity_threshold` seconds, which pairs with the `dynamic` layout mode below: the view lays itself out again for the number of cameras that are actually up
- **motion:** Cameras that have detected motion within the last 30 seconds are included
- **objects:** Cameras that have tracked an active object within the last 30 seconds are included

### Custom Birdseye Icon

A custom icon can be added to the birdseye background by providing a 180x180 image named `custom.png` inside of the Frigate `media` folder. The file must be a png with the icon as transparent, any non-transparent pixels will be white when displayed in the birdseye view.

### Birdseye view override at camera level

To include a camera in Birdseye view only for specific circumstances, or exclude it entirely, configure Birdseye at the camera level.

<ConfigTabs>
<TabItem value="ui">

**Global settings:** Navigate to <NavPath path="Settings > System > Birdseye" /> to configure the default Birdseye behavior for all cameras.

**Per-camera overrides:** Navigate to <NavPath path="Settings > Camera configuration > Birdseye" /> to override the mode or disable Birdseye for a specific camera.

| Field               | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| **Enable Birdseye** | Whether this camera appears in Birdseye view                  |
| **Tracking mode**   | When to show the camera: `continuous`, `online`, `motion`, or `objects` |

</TabItem>
<TabItem value="yaml">

```yaml {8-10,12-14}
# Include all cameras by default in Birdseye view
birdseye:
  enabled: True
  mode: continuous

cameras:
  front:
    # Only include the "front" camera in Birdseye view when objects are detected
    birdseye:
      mode: objects
  back:
    # Exclude the "back" camera from Birdseye view
    birdseye:
      enabled: False
```

</TabItem>
</ConfigTabs>

### Birdseye Inactivity

By default birdseye shows all cameras that have had the configured activity in the last 30 seconds. This threshold can be configured.

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" />.

| Field                    | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| **Inactivity threshold** | Seconds of inactivity before a camera is hidden from Birdseye (default: 30) |

</TabItem>
<TabItem value="yaml">

```yaml
birdseye:
  enabled: True
  # highlight-next-line
  inactivity_threshold: 15
```

</TabItem>
</ConfigTabs>

## Birdseye Layout

### Birdseye Dimensions

The resolution and aspect ratio of birdseye can be configured. Resolution will increase the quality but does not affect the layout. Changing the aspect ratio of birdseye does affect how cameras are laid out.

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" />.

| Field      | Description                                     |
| ---------- | ----------------------------------------------- |
| **Width**  | Birdseye output width in pixels (default: 1280) |
| **Height** | Birdseye output height in pixels (default: 720) |

</TabItem>
<TabItem value="yaml">

```yaml
birdseye:
  enabled: True
  width: 1280
  height: 720
```

</TabItem>
</ConfigTabs>

### Sorting cameras in the Birdseye view

It is possible to override the order of cameras that are being shown in the Birdseye view. The order is set at the camera level (when using YAML).

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" /> and in the **Camera order** field, use the drag handle next to each camera name to control the display order.

</TabItem>
<TabItem value="yaml">

```yaml
# Include all cameras by default in Birdseye view
birdseye:
  enabled: True
  mode: continuous

cameras:
  front:
    birdseye:
      # highlight-next-line
      order: 1
  back:
    birdseye:
      # highlight-next-line
      order: 2
```

</TabItem>
</ConfigTabs>

_Note_: Cameras are sorted by default using their name to ensure a constant view inside Birdseye.

### Birdseye Cameras

It is possible to limit the number of cameras shown on birdseye at one time. When this is enabled, birdseye will show the cameras with most recent activity. There is a cooldown to ensure that cameras do not switch too frequently.

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" />.

| Field                    | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Layout > Max cameras** | Maximum number of cameras shown at once (e.g., `1` for only the most active camera) |

</TabItem>
<TabItem value="yaml">

```yaml {3-4}
birdseye:
  enabled: True
  layout:
    max_cameras: 1
```

</TabItem>
</ConfigTabs>

### Fixed Birdseye Layout

By default Birdseye packs the active cameras automatically, which means a camera's position and size change as cameras come and go, and every camera gets the same amount of the canvas. Setting the layout mode to `fixed` places each camera on a grid instead, so a camera always appears in the same place and can be given more room than its neighbors.

The grid is defined once with `cols` and `rows`, and each camera is placed with `cell: [column, row]`, counted from the top left starting at zero. A camera can cover several cells with `span: [columns, rows]`.

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" /> and set **Layout > Layout mode** to `Fixed grid`.

| Field                  | Default | Description                                                                                 |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------- |
| **Columns** / **Rows** | 4 / 4   | Size of the grid the cameras are placed on                                                  |
| **Camera placement**   | empty   | Which camera fills each cell; neighboring cells with the same camera become one larger tile |

Placement is stored on the cameras rather than in this section, so it is saved as it is
edited rather than with the Save button. That also means the grid it is painted on has to
exist first: the layout mode and the grid size are saved with the section, and placement
stays locked until they are.

</TabItem>
<TabItem value="yaml">

```yaml {5-8,11-17}
birdseye:
  enabled: True
  # a fixed layout only fills every cell if all cameras are always shown
  mode: continuous
  layout:
    mode: fixed
    cols: 4
    rows: 4

cameras:
  front:
    birdseye:
      cell: [0, 0]
      span: [2, 2]
  back:
    birdseye:
      cell: [2, 0]
```

The example above gives `front` a large 2x2 tile in the top left corner and `back` a single cell to the right of it.

</TabItem>
</ConfigTabs>

Notes on fixed layouts:

- A camera with no `cell` is left out of the view, and so is a camera whose cell and span fall outside the grid or overlap another camera. Each case is logged as a warning once, and again after the layout is edited.
- Cells belonging to cameras that are not currently shown stay black, so a fixed layout is normally used with `mode: continuous`.
- `layout.max_cameras` is ignored, since which camera goes where is already decided by the configuration.
- Tiles keep their camera's aspect ratio and are letterboxed inside their cell.
- Grid lines are rounded to keep tiles aligned for YUV420, so tiles can differ from each other by a pixel or two.

### Dynamic Birdseye Layout

A fixed layout keeps a camera in the same cell whether or not it is being shown, which leaves holes when Birdseye is set to `motion` or `objects`. The `dynamic` layout mode instead draws a layout for each number of cameras and picks the one matching how many cameras are being shown right now, so the view always fills the canvas.

Each layout says how many cameras it is drawn for and is drawn as a list of rows, one character per cell. A letter marks the slot the cell belongs to, and `.` leaves the cell empty. Slots are filled in alphabetical order with the cameras being shown, ordered by their `order`, so cameras keep their relative positions as the view changes.

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" /> and set **Layout > Layout mode** to `Dynamic`.

| Field                 | Default | Description                                                                              |
| --------------------- | ------- | ---------------------------------------------------------------------------------------- |
| **Layouts**           | none    | One drawn grid per number of cameras being shown; each cell picks the slot it belongs to |
| **Cameras shown**     | -       | How many cameras being shown a layout is drawn for; each count can have one layout       |
| **Layout dwell time** | 0       | Seconds a layout is kept before the view is laid out again                               |

</TabItem>
<TabItem value="yaml">

```yaml {3-5,7-22}
birdseye:
  enabled: True
  mode: motion
  layout:
    mode: dynamic
    # keep a layout for at least 15 seconds so tiles do not move constantly
    dwell: 15
    layouts:
      - cameras: 1
        rows: ["A"]
      - cameras: 2
        rows: ["AB"]
      - cameras: 3
        rows: ["AB", "CC"]
      - cameras: 4
        rows: ["AB", "CD"]
      - cameras: 5
        rows: ["AAB", "AAC", "DDE"]
      - cameras: 6
        rows: ["AAB", "AAC", "DEF"]
```

The layout for six cameras above gives the first camera a 2x2 tile in the top left corner and lays the other five out around it.

</TabItem>
</ConfigTabs>

Notes on dynamic layouts:

- A layout has to have exactly as many slots as the number of cameras it is drawn for, and each slot has to be a rectangle. Frigate reports the layout as a config error otherwise, and it does the same for two layouts drawn for the same number of cameras.
- If more cameras are being shown than the largest drawn layout has slots, the largest layout is used and the cameras that come last are left out, so the largest layout acts as a limit.
- If there is no layout drawn for the number of cameras being shown, Birdseye lays them out automatically and logs a warning. Draw a layout for every count you expect to see: with `mode: motion` or `mode: objects` the number of cameras being shown changes constantly, so a missing count sends the view back to the automatic layout at exactly the moment the drawn layouts are meant to keep it still.
- `layout.max_cameras` is ignored, since the largest drawn layout already limits how many cameras are shown.

### Birdseye Scaling

By default birdseye tries to fit 2 cameras in each row and then double in size until a suitable layout is found. The scaling can be configured with a value between 1.0 and 5.0 depending on use case.

<ConfigTabs>
<TabItem value="ui">

Navigate to <NavPath path="Settings > System > Birdseye" />.

| Field                       | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| **Layout > Scaling factor** | Camera scaling factor between 1.0 and 5.0 (default: 2.0) |

</TabItem>
<TabItem value="yaml">

```yaml {3-4}
birdseye:
  enabled: True
  layout:
    scaling_factor: 3.0
```

</TabItem>
</ConfigTabs>
