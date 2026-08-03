import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { toast } from "sonner";
import useSWR from "swr";
import cloneDeep from "lodash/cloneDeep";
import get from "lodash/get";
import set from "lodash/set";
import { LuCheck, LuPlus, LuTrash2 } from "react-icons/lu";
import { SplitCardRow } from "@/components/card/SettingsGroupCard";
import { CameraNameLabel } from "@/components/camera/FriendlyNameLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { FrigateConfig } from "@/types/frigateConfig";
import type { ConfigSectionData, JsonObject } from "@/types/configForm";
import { cn } from "@/lib/utils";
import type { SectionRendererProps } from "./registry";

const SAVED_INDICATOR_MS = 1500;
const EMPTY_CELL = "empty";
const MAX_GRID_SIDE = 12;
const SLOT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type SaveStatus = "idle" | "saving" | "saved";

/** A grid of slot keys, indexed as cells[row][col], with null for empty. */
type Cells = (string | null)[][];

function buildCells(rows: number, cols: number): Cells {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );
}

/**
 * Read a painted grid back into a rectangle per slot, the same way the backend
 * reads a drawn layout. Returns the keys that were painted into something
 * other than a rectangle, which cannot be drawn as one tile.
 */
function readRects(cells: Cells): {
  rects: Record<string, [number, number, number, number]>;
  invalid: string[];
} {
  const positions: Record<string, [number, number][]> = {};

  cells.forEach((row, rowIndex) =>
    row.forEach((key, colIndex) => {
      if (!key) return;
      (positions[key] ??= []).push([colIndex, rowIndex]);
    }),
  );

  const rects: Record<string, [number, number, number, number]> = {};
  const invalid: string[] = [];

  Object.entries(positions).forEach(([key, cellPositions]) => {
    const cols = cellPositions.map(([col]) => col);
    const rows = cellPositions.map(([, row]) => row);
    const col = Math.min(...cols);
    const row = Math.min(...rows);
    const spanC = Math.max(...cols) - col + 1;
    const spanR = Math.max(...rows) - row + 1;

    if (cellPositions.length !== spanC * spanR) {
      invalid.push(key);
      return;
    }

    rects[key] = [col, row, spanC, spanR];
  });

  return { rects, invalid };
}

type LayoutGridProps = {
  cells: Cells;
  options: { key: string; label: React.ReactNode }[];
  emptyLabel: string;
  onChange: (cells: Cells) => void;
};

/** The grid itself: every cell picks which slot it belongs to. */
function LayoutGrid({ cells, options, emptyLabel, onChange }: LayoutGridProps) {
  const cols = cells[0]?.length ?? 0;

  const handleCellChange = (row: number, col: number, value: string) => {
    const next = cells.map((cellRow) => [...cellRow]);
    next[row][col] = value === EMPTY_CELL ? null : value;
    onChange(next);
  };

  return (
    <div
      className="grid gap-1 rounded-lg bg-secondary p-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {cells.map((row, rowIndex) =>
        row.map((key, colIndex) => (
          <Select
            key={`${rowIndex}-${colIndex}`}
            value={key ?? EMPTY_CELL}
            onValueChange={(value) =>
              handleCellChange(rowIndex, colIndex, value)
            }
          >
            <SelectTrigger
              className={cn(
                "h-auto min-h-12 justify-center px-1 py-2 text-center text-xs",
                key ? "bg-selected/20" : "text-muted-foreground",
              )}
            >
              <span className="truncate">
                {options.find((option) => option.key === key)?.label ?? "-"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_CELL}>{emptyLabel}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )),
      )}
    </div>
  );
}

type GridSizeProps = {
  cols: number;
  rows: number;
  onChange: (cols: number, rows: number) => void;
};

function GridSize({ cols, rows, onChange }: GridSizeProps) {
  const { t } = useTranslation(["views/settings"]);

  return (
    <div className="flex flex-row items-end gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("birdseye.layoutBuilder.columns")}
        </Label>
        <Input
          className="w-20"
          type="number"
          min={1}
          max={MAX_GRID_SIDE}
          value={cols}
          onChange={(event) =>
            onChange(clampSide(event.target.valueAsNumber, cols), rows)
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("birdseye.layoutBuilder.rows")}
        </Label>
        <Input
          className="w-20"
          type="number"
          min={1}
          max={MAX_GRID_SIDE}
          value={rows}
          onChange={(event) =>
            onChange(cols, clampSide(event.target.valueAsNumber, rows))
          }
        />
      </div>
    </div>
  );
}

function clampSide(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_GRID_SIDE, Math.max(1, Math.round(value)));
}

/** Grow or shrink a grid, keeping whatever still fits. */
function resizeCells(cells: Cells, cols: number, rows: number): Cells {
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => {
      const key = cells[rowIndex]?.[colIndex];
      return key === undefined ? null : key;
    }),
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const { t } = useTranslation(["views/settings"]);

  return (
    <div
      aria-live="polite"
      className={cn(
        "flex h-4 items-center justify-start gap-1 text-xs transition-opacity duration-200",
        status === "idle" ? "opacity-0" : "opacity-100",
      )}
    >
      {status === "saving" && (
        <span className="text-muted-foreground">
          {t("birdseye.cameraOrder.saving")}
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center gap-1 text-success">
          <LuCheck className="size-3.5" />
          {t("birdseye.cameraOrder.saved")}
        </span>
      )}
    </div>
  );
}

/**
 * Places each camera on the fixed grid. Cells are painted with a camera and
 * the rectangle a camera covers becomes its cell and span, so the grid is
 * edited the same way for both layout modes.
 *
 * Camera placement lives on the cameras rather than in this section, so it is
 * saved on its own like the camera order above it.
 */
function FixedLayoutBuilder({
  config,
  cols,
  rows,
  onSizeChange,
}: {
  config: FrigateConfig;
  cols: number;
  rows: number;
  onSizeChange: (cols: number, rows: number) => void;
}) {
  const { t } = useTranslation(["views/settings", "common"]);
  const { mutate: updateConfig } = useSWR<FrigateConfig>("config");

  const cameras = useMemo(
    () =>
      Object.keys(config.cameras)
        .filter(
          (name) =>
            config.cameras[name].enabled_in_config &&
            config.cameras[name].birdseye?.enabled !== false,
        )
        .sort((a, b) => {
          const orderA = config.cameras[a].birdseye?.order ?? 0;
          const orderB = config.cameras[b].birdseye?.order ?? 0;
          if (orderA !== orderB) return orderA - orderB;
          return a.localeCompare(b);
        }),
    [config],
  );

  const configuredCells = useMemo(() => {
    const next = buildCells(rows, cols);

    cameras.forEach((camera) => {
      const settings = config.cameras[camera].birdseye;
      const cell = settings?.cell;
      if (!cell) return;

      const [col, row] = cell;
      const [spanC, spanR] = settings?.span ?? [1, 1];

      for (let r = row; r < row + spanR; r++) {
        for (let c = col; c < col + spanC; c++) {
          if (next[r]?.[c] !== undefined) {
            next[r][c] = camera;
          }
        }
      }
    });

    return next;
  }, [cameras, config, cols, rows]);

  const [cells, setCells] = useState<Cells>(configuredCells);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCells(configuredCells);
  }, [configuredCells]);

  useEffect(() => {
    return () => {
      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
      }
    };
  }, []);

  const { invalid } = useMemo(() => readRects(cells), [cells]);

  const save = useCallback(
    async (nextCells: Cells) => {
      const { rects, invalid: invalidCameras } = readRects(nextCells);

      if (invalidCameras.length > 0) {
        return;
      }

      const cameraUpdates: Record<string, JsonObject> = {};
      cameras.forEach((camera) => {
        const rect = rects[camera];
        cameraUpdates[camera] = {
          birdseye: rect
            ? { cell: [rect[0], rect[1]], span: [rect[2], rect[3]] }
            : { cell: null },
        };
      });

      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
        savedResetTimerRef.current = null;
      }
      setSaveStatus("saving");

      try {
        await axios.put("config/set", {
          requires_restart: 0,
          update_topic: "config/cameras/*/birdseye",
          config_data: { cameras: cameraUpdates },
        });
        await updateConfig();
        setSaveStatus("saved");
        savedResetTimerRef.current = setTimeout(() => {
          setSaveStatus("idle");
          savedResetTimerRef.current = null;
        }, SAVED_INDICATOR_MS);
      } catch (error) {
        setCells(configuredCells);
        setSaveStatus("idle");
        const errorMessage =
          axios.isAxiosError(error) &&
          (error.response?.data?.message || error.response?.data?.detail)
            ? error.response?.data?.message || error.response?.data?.detail
            : t("toast.save.error.noMessage", { ns: "common" });

        toast.error(
          t("toast.save.error.title", { errorMessage, ns: "common" }),
          { position: "top-center" },
        );
      }
    },
    [cameras, configuredCells, updateConfig, t],
  );

  const handleChange = (nextCells: Cells) => {
    setCells(nextCells);
    save(nextCells);
  };

  return (
    <SplitCardRow
      label={t("birdseye.layoutBuilder.fixed.label", { ns: "views/settings" })}
      description={t("birdseye.layoutBuilder.fixed.description", {
        ns: "views/settings",
      })}
      content={
        <div className="max-w-md space-y-3">
          <GridSize cols={cols} rows={rows} onChange={onSizeChange} />
          <LayoutGrid
            cells={cells}
            options={cameras.map((camera) => ({
              key: camera,
              label: <CameraNameLabel camera={camera} />,
            }))}
            emptyLabel={t("birdseye.layoutBuilder.emptyCell", {
              ns: "views/settings",
            })}
            onChange={handleChange}
          />
          {invalid.length > 0 ? (
            <div className="text-xs text-danger">
              {t("birdseye.layoutBuilder.notARectangle", {
                ns: "views/settings",
                slots: invalid.join(", "),
              })}
            </div>
          ) : (
            <SaveStatusIndicator status={saveStatus} />
          )}
        </div>
      }
    />
  );
}

/**
 * Draws a layout for each number of cameras. These live in this section, so
 * they are edited as form data and saved with the rest of the section.
 */
function DynamicLayoutsBuilder({
  layouts,
  onChange,
}: {
  layouts: Record<string, string[]>;
  onChange: (layouts: Record<string, string[]>) => void;
}) {
  const { t } = useTranslation(["views/settings"]);

  const counts = useMemo(
    () =>
      Object.keys(layouts)
        .map((count) => Number(count))
        .filter((count) => Number.isInteger(count) && count > 0)
        .sort((a, b) => a - b),
    [layouts],
  );

  const nextCount = useMemo(() => {
    for (let count = 1; count <= SLOT_LETTERS.length; count++) {
      if (!counts.includes(count)) return count;
    }
    return null;
  }, [counts]);

  const handleAdd = () => {
    if (!nextCount) return;

    const cols = Math.ceil(Math.sqrt(nextCount));
    const rows = Math.ceil(nextCount / cols);
    const drawn = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const slot = row * cols + col;
        return slot < nextCount ? SLOT_LETTERS[slot] : ".";
      }).join(""),
    );

    onChange({ ...layouts, [nextCount]: drawn });
  };

  const handleRemove = (count: number) => {
    const next = { ...layouts };
    delete next[count];
    onChange(next);
  };

  const handleLayoutChange = (count: number, drawn: string[]) => {
    onChange({ ...layouts, [count]: drawn });
  };

  return (
    <SplitCardRow
      label={t("birdseye.layoutBuilder.dynamic.label")}
      description={t("birdseye.layoutBuilder.dynamic.description")}
      content={
        <div className="max-w-md space-y-4">
          {counts.map((count) => (
            <DynamicLayout
              key={count}
              count={count}
              drawn={layouts[count]}
              onChange={(drawn) => handleLayoutChange(count, drawn)}
              onRemove={() => handleRemove(count)}
            />
          ))}
          <Button
            type="button"
            variant="select"
            size="sm"
            disabled={!nextCount}
            onClick={handleAdd}
          >
            <LuPlus className="mr-1 size-4" />
            {t("birdseye.layoutBuilder.addLayout")}
          </Button>
        </div>
      }
    />
  );
}

function DynamicLayout({
  count,
  drawn,
  onChange,
  onRemove,
}: {
  count: number;
  drawn: string[];
  onChange: (drawn: string[]) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(["views/settings"]);

  const cells = useMemo(
    () =>
      drawn.map((row) =>
        row.split("").map((slot) => (slot === "." ? null : slot)),
      ),
    [drawn],
  );

  const cols = cells[0]?.length ?? 1;
  const rows = cells.length;
  const slots = useMemo(() => SLOT_LETTERS.slice(0, count).split(""), [count]);

  const { rects, invalid } = useMemo(() => readRects(cells), [cells]);
  const missing = slots.filter((slot) => !(slot in rects));

  const write = (nextCells: Cells) =>
    onChange(nextCells.map((row) => row.map((slot) => slot ?? ".").join("")));

  return (
    <div className="space-y-2 rounded-lg border border-secondary-foreground/20 p-3">
      <div className="flex flex-row items-center justify-between">
        <Label className="text-sm font-medium">
          {t("birdseye.layoutBuilder.cameraCount", { count })}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("birdseye.layoutBuilder.removeLayout")}
          onClick={onRemove}
        >
          <LuTrash2 className="size-4 text-danger" />
        </Button>
      </div>
      <GridSize
        cols={cols}
        rows={rows}
        onChange={(nextCols, nextRows) =>
          write(resizeCells(cells, nextCols, nextRows))
        }
      />
      <LayoutGrid
        cells={cells}
        options={slots.map((slot) => ({ key: slot, label: slot }))}
        emptyLabel={t("birdseye.layoutBuilder.emptyCell")}
        onChange={write}
      />
      {invalid.length > 0 && (
        <div className="text-xs text-danger">
          {t("birdseye.layoutBuilder.notARectangle", {
            slots: invalid.join(", "),
          })}
        </div>
      )}
      {missing.length > 0 && (
        <div className="text-xs text-danger">
          {t("birdseye.layoutBuilder.missingSlots", {
            slots: missing.join(", "),
          })}
        </div>
      )}
    </div>
  );
}

export default function BirdseyeLayoutBuilder({
  formContext,
}: SectionRendererProps) {
  const { data: config } = useSWR<FrigateConfig>("config");

  const formData = formContext?.formData as JsonObject | undefined;
  const onFormDataChange = formContext?.onFormDataChange;

  const updateLayout = useCallback(
    (path: string, value: unknown) => {
      if (!onFormDataChange || !formData) return;
      const next = cloneDeep(formData);
      set(next, `layout.${path}`, value);
      onFormDataChange(next as ConfigSectionData);
    },
    [formData, onFormDataChange],
  );

  if (formContext?.level && formContext.level !== "global") {
    return null;
  }

  if (!config || !formData || !onFormDataChange) {
    return null;
  }

  const mode = get(formData, "layout.mode");

  if (mode === "fixed") {
    const cols = Number(get(formData, "layout.cols")) || 1;
    const rows = Number(get(formData, "layout.rows")) || 1;

    return (
      <FixedLayoutBuilder
        config={config}
        cols={cols}
        rows={rows}
        onSizeChange={(nextCols, nextRows) => {
          const next = cloneDeep(formData);
          set(next, "layout.cols", nextCols);
          set(next, "layout.rows", nextRows);
          onFormDataChange(next as ConfigSectionData);
        }}
      />
    );
  }

  if (mode === "dynamic") {
    const layouts = (get(formData, "layout.layouts") ?? {}) as Record<
      string,
      string[]
    >;

    return (
      <DynamicLayoutsBuilder
        layouts={layouts}
        onChange={(next) => updateLayout("layouts", next)}
      />
    );
  }

  return null;
}
