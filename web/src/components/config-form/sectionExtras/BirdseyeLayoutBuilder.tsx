import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { BirdseyeDrawnLayout, FrigateConfig } from "@/types/frigateConfig";
import type { ConfigSectionData, JsonObject } from "@/types/configForm";
import { cn } from "@/lib/utils";
import type { SectionRendererProps } from "./registry";

const SAVED_INDICATOR_MS = 1500;
const EMPTY_CELL = "empty";
// what a cell holds is a camera name or a slot letter, either of which could be
// the word "empty", so the two are kept apart by prefixing rather than by hoping
const SLOT_VALUE = "slot:";
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

/** Read a drawn layout back into the grid the editor paints. */
function layoutCells(drawn: string[]): Cells {
  return drawn.map((row) =>
    row.split("").map((slot) => (slot === "." ? null : slot)),
  );
}

/**
 * The slots a layout can be painted with. Any letter is a slot as far as the
 * backend is concerned, so the ones already drawn are kept rather than replaced
 * with A, B, C, which would rewrite a hand-written layout on the first click.
 */
function layoutSlots(count: number, drawn: string[]): string[] {
  const used = Array.from(
    new Set(
      drawn
        .join("")
        .split("")
        .filter((slot) => slot !== "."),
    ),
  );
  const slots = used.slice(0, count);

  for (const letter of SLOT_LETTERS) {
    if (slots.length >= count) break;
    if (!slots.some((slot) => slot.toUpperCase() === letter))
      slots.push(letter);
  }

  return slots.sort();
}

/** The problems that stop a drawn layout from being saved. */
function layoutErrors(
  count: number,
  drawn: string[],
): { invalid: string[]; missing: string[] } {
  const { rects, invalid } = readRects(layoutCells(drawn));

  return {
    invalid,
    missing: layoutSlots(count, drawn).filter((slot) => !(slot in rects)),
  };
}

type LayoutGridProps = {
  cells: Cells;
  options: { key: string; label: React.ReactNode }[];
  emptyLabel: string;
  disabled?: boolean;
  onChange: (cells: Cells) => void;
};

/** The grid itself: every cell picks which slot it belongs to. */
function LayoutGrid({
  cells,
  options,
  emptyLabel,
  disabled,
  onChange,
}: LayoutGridProps) {
  const { t } = useTranslation(["views/settings"]);
  const cols = cells[0]?.length ?? 0;

  const handleCellChange = (row: number, col: number, value: string) => {
    const next = cells.map((cellRow) => [...cellRow]);
    next[row][col] =
      value === EMPTY_CELL ? null : value.slice(SLOT_VALUE.length);
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
            value={key === null ? EMPTY_CELL : `${SLOT_VALUE}${key}`}
            disabled={disabled}
            onValueChange={(value) =>
              handleCellChange(rowIndex, colIndex, value)
            }
          >
            <SelectTrigger
              // the trigger reads as the slot it holds, or as a dash, so it
              // needs a name of its own to be told apart from its neighbors
              aria-label={t("birdseye.layoutBuilder.cell", {
                row: rowIndex + 1,
                col: colIndex + 1,
              })}
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
                <SelectItem
                  key={option.key}
                  value={`${SLOT_VALUE}${option.key}`}
                >
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
  // a page can hold a grid per camera count, so the labels need ids of their own
  const id = useId();
  // a size is only applied once it has been typed out, since resizing on every
  // keystroke would apply the first digit of a two digit size as a real resize
  const [draft, setDraft] = useState({
    cols: String(cols),
    rows: String(rows),
  });

  useEffect(() => {
    setDraft({ cols: String(cols), rows: String(rows) });
  }, [cols, rows]);

  const commit = (side: "cols" | "rows") => {
    const next = clampSide(Number(draft[side]), side === "cols" ? cols : rows);
    setDraft((previous) => ({ ...previous, [side]: String(next) }));
    onChange(side === "cols" ? next : cols, side === "rows" ? next : rows);
  };

  return (
    <div className="flex flex-row items-end gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor={`${id}-cols`}>
          {t("birdseye.layoutBuilder.columns")}
        </Label>
        <Input
          id={`${id}-cols`}
          className="w-20"
          type="number"
          min={1}
          max={MAX_GRID_SIDE}
          value={draft.cols}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, cols: event.target.value }))
          }
          onBlur={() => commit("cols")}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor={`${id}-rows`}>
          {t("birdseye.layoutBuilder.rows")}
        </Label>
        <Input
          id={`${id}-rows`}
          className="w-20"
          type="number"
          min={1}
          max={MAX_GRID_SIDE}
          value={draft.rows}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, rows: event.target.value }))
          }
          onBlur={() => commit("rows")}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}

function clampSide(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_GRID_SIDE, Math.max(1, Math.round(value)));
}

/** Compare two grids cell by cell. */
function sameCells(a: Cells, b: Cells): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, rowIndex) =>
        row.length === b[rowIndex].length &&
        row.every((key, colIndex) => key === b[rowIndex][colIndex]),
    )
  );
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

/** Reports the per-click placement save. The camera order strip has its
 * own copy of this, with its own keys: the two are saved separately. */
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
          {t("birdseye.layoutBuilder.saving")}
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center gap-1 text-success">
          <LuCheck className="size-3.5" />
          {t("birdseye.layoutBuilder.saved")}
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
 * saved on its own like the camera order above it. That write cannot run ahead
 * of the grid it is painted on, so painting waits until the layout mode and the
 * grid size have actually been saved: see `locked`.
 */
function FixedLayoutBuilder({
  config,
  cols,
  rows,
  locked,
  onSizeChange,
}: {
  config: FrigateConfig;
  cols: number;
  rows: number;
  locked: boolean;
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
  const savingRef = useRef(false);

  useEffect(() => {
    // every painted cell is saved and the config is read back, so taking the
    // grid from a refetch that is the placement being saved would discard
    // whatever has been painted since
    if (savingRef.current) {
      return;
    }

    setCells((previous) =>
      sameCells(previous, configuredCells) ? previous : configuredCells,
    );
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

        if (rect) {
          cameraUpdates[camera] = {
            birdseye: { cell: [rect[0], rect[1]], span: [rect[2], rect[3]] },
          };
          return;
        }

        // a null clears the key rather than writing one, so only cameras that
        // are on the grid have a placement to take off it
        if (config.cameras[camera].birdseye?.cell) {
          cameraUpdates[camera] = { birdseye: { cell: null } };
        }
      });

      if (Object.keys(cameraUpdates).length === 0) {
        return;
      }

      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
        savedResetTimerRef.current = null;
      }
      setSaveStatus("saving");
      savingRef.current = true;

      try {
        await axios.put("config/set", {
          requires_restart: 0,
          update_topic: "config/cameras/*/birdseye",
          config_data: { cameras: cameraUpdates },
        });
        await updateConfig();
        savingRef.current = false;
        setSaveStatus("saved");
        savedResetTimerRef.current = setTimeout(() => {
          setSaveStatus("idle");
          savedResetTimerRef.current = null;
        }, SAVED_INDICATOR_MS);
      } catch (error) {
        savingRef.current = false;
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
    [cameras, config, configuredCells, updateConfig, t],
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
            disabled={locked}
            onChange={handleChange}
          />
          {locked ? (
            <div className="text-xs text-muted-foreground">
              {t("birdseye.layoutBuilder.fixed.saveFirst", {
                ns: "views/settings",
              })}
            </div>
          ) : invalid.length > 0 ? (
            <div className="text-xs text-danger">
              {t("birdseye.layoutBuilder.notARectangleCameras", {
                ns: "views/settings",
              })}{" "}
              {invalid.map((camera, index) => (
                <span key={camera}>
                  {index > 0 && ", "}
                  <CameraNameLabel camera={camera} className="text-xs" />
                </span>
              ))}
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
  setValidationErrors,
}: {
  layouts: BirdseyeDrawnLayout[];
  onChange: (layouts: BirdseyeDrawnLayout[]) => void;
  setValidationErrors?: (hasErrors: boolean) => void;
}) {
  const { t } = useTranslation(["views/settings"]);

  const drawn = useMemo(
    () => [...layouts].sort((a, b) => a.cameras - b.cameras),
    [layouts],
  );

  // a layout the builder is already reporting in red is rejected by the
  // backend, which fails the whole section save, so it has to hold Save shut
  const hasErrors = drawn.some((layout) => {
    const { invalid, missing } = layoutErrors(layout.cameras, layout.rows);
    return invalid.length > 0 || missing.length > 0;
  });

  useEffect(() => {
    setValidationErrors?.(hasErrors);
    return () => setValidationErrors?.(false);
  }, [hasErrors, setValidationErrors]);

  const nextCount = useMemo(() => {
    for (let count = 1; count <= SLOT_LETTERS.length; count++) {
      if (!drawn.some((layout) => layout.cameras === count)) return count;
    }
    return null;
  }, [drawn]);

  const handleAdd = () => {
    if (!nextCount) return;

    const cols = Math.ceil(Math.sqrt(nextCount));
    const rows = Math.ceil(nextCount / cols);

    onChange([
      ...layouts,
      {
        cameras: nextCount,
        rows: Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => {
            const slot = row * cols + col;
            return slot < nextCount ? SLOT_LETTERS[slot] : ".";
          }).join(""),
        ),
      },
    ]);
  };

  const handleRemove = (count: number) => {
    onChange(layouts.filter((layout) => layout.cameras !== count));
  };

  const handleLayoutChange = (count: number, rows: string[]) => {
    onChange(
      layouts.map((layout) =>
        layout.cameras === count ? { ...layout, rows } : layout,
      ),
    );
  };

  const handleCountChange = (count: number, next: number) => {
    onChange(
      layouts.map((layout) =>
        layout.cameras === count ? { ...layout, cameras: next } : layout,
      ),
    );
  };

  return (
    <SplitCardRow
      label={t("birdseye.layoutBuilder.dynamic.label")}
      description={t("birdseye.layoutBuilder.dynamic.description")}
      content={
        <div className="max-w-md space-y-4">
          {drawn.map((layout) => (
            <DynamicLayout
              key={layout.cameras}
              count={layout.cameras}
              drawn={layout.rows}
              taken={drawn
                .map((other) => other.cameras)
                .filter((cameras) => cameras !== layout.cameras)}
              onChange={(rows) => handleLayoutChange(layout.cameras, rows)}
              onCountChange={(next) => handleCountChange(layout.cameras, next)}
              onRemove={() => handleRemove(layout.cameras)}
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
  taken,
  onChange,
  onCountChange,
  onRemove,
}: {
  count: number;
  drawn: string[];
  taken: number[];
  onChange: (drawn: string[]) => void;
  onCountChange: (count: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(["views/settings"]);
  // a page holds one of these per layout, so the label needs an id of its own
  const id = useId();
  // the count is only applied once it has been typed out, for the same reason
  // the grid size is: a two digit count passes through its first digit
  const [draftCount, setDraftCount] = useState(String(count));

  useEffect(() => {
    setDraftCount(String(count));
  }, [count]);

  const commitCount = () => {
    const next = Math.round(Number(draftCount));

    // a layout is keyed by the number of cameras it is drawn for, so a count
    // that already has one would collide with it
    if (
      !Number.isFinite(next) ||
      next < 1 ||
      next > SLOT_LETTERS.length ||
      taken.includes(next)
    ) {
      setDraftCount(String(count));
      return;
    }

    setDraftCount(String(next));
    if (next !== count) onCountChange(next);
  };

  const cells = useMemo(() => layoutCells(drawn), [drawn]);

  const cols = cells[0]?.length ?? 1;
  const rows = cells.length;
  const slots = useMemo(() => layoutSlots(count, drawn), [count, drawn]);

  const { invalid, missing } = useMemo(
    () => layoutErrors(count, drawn),
    [count, drawn],
  );

  const write = (nextCells: Cells) =>
    onChange(nextCells.map((row) => row.map((slot) => slot ?? ".").join("")));

  return (
    <div className="space-y-2 rounded-lg border border-secondary-foreground/20 p-3">
      <div className="flex flex-row items-end justify-between gap-3">
        <div className="space-y-1.5">
          <Label
            className="text-xs text-muted-foreground"
            htmlFor={`${id}-count`}
          >
            {t("birdseye.layoutBuilder.camerasShown")}
          </Label>
          <Input
            id={`${id}-count`}
            className="w-20"
            type="number"
            min={1}
            max={SLOT_LETTERS.length}
            value={draftCount}
            onChange={(event) => setDraftCount(event.target.value)}
            onBlur={commitCount}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("birdseye.layoutBuilder.removeLayout", {
            count: count,
          })}
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
  setValidationErrors,
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
    const saved = config.birdseye.layout;
    // placement is written straight onto the cameras, outside this section, so
    // it must not run ahead of the grid it is painted on. Until the mode and
    // the grid size are saved, a painted cell could be left pointing outside a
    // grid that is never saved, or written while the mode is still auto.
    const locked =
      saved.mode !== "fixed" || saved.cols !== cols || saved.rows !== rows;

    return (
      <FixedLayoutBuilder
        config={config}
        cols={cols}
        rows={rows}
        locked={locked}
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
    const layouts = (get(formData, "layout.layouts") ??
      []) as unknown as BirdseyeDrawnLayout[];

    return (
      <DynamicLayoutsBuilder
        layouts={layouts}
        onChange={(next) => updateLayout("layouts", next)}
        setValidationErrors={setValidationErrors}
      />
    );
  }

  return null;
}
