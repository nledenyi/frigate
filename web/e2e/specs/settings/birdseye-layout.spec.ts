/**
 * Birdseye layout settings tests -- MEDIUM tier.
 *
 * Covers the painted grid for both layout modes: the fixed grid writes a cell
 * and span onto every camera, the drawn layouts are saved with the section,
 * and neither asks for a restart. A shape that cannot be drawn as one tile is
 * reported instead of being saved.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../../fixtures/frigate-test";
import type { Page } from "@playwright/test";
import { configFactory } from "../../fixtures/mock-data/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_SCHEMA = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../fixtures/mock-data/config-schema.json"),
    "utf-8",
  ),
);

const SETTINGS_URL = "/settings?page=systemBirdseye";
const FIRST_CAMERA = /front.?door/i;
const NOT_A_RECTANGLE = /not painted as a rectangle/;
const MISSING_SLOTS = /not on the grid yet/;
const SAVE_FIRST = /before placing cameras/;
const RESTART_REQUIRED = /Restart Frigate to apply/;
const SAVE_FAILED = /Failed to save config changes/;

/** Merge a saved section into the config the way the backend would. */
function mergeInto(target: Record<string, unknown>, source: object) {
  Object.entries(source).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ??= {};
      mergeInto(target[key] as Record<string, unknown>, value);
      return;
    }
    target[key] = value;
  });
}

async function installRoutes(page: Page) {
  // saves are merged back into this, so it has to be this test's own copy and
  // not a fixture shared with every other test in the worker
  const config = structuredClone(
    configFactory({ birdseye: { enabled: true } }),
  );

  let lastSavedConfig: unknown = null;
  let saveCount = 0;
  let placementSaveCount = 0;
  let rejectPlacement = false;

  await page.route("**/api/config/schema.json", (route) =>
    route.fulfill({ json: CONFIG_SCHEMA }),
  );
  await page.route("**/api/config", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: config });
    }
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/api/config/set", async (route) => {
    const body = route.request().postDataJSON();
    lastSavedConfig = body;
    saveCount += 1;
    if (body?.update_topic === "config/cameras/*/birdseye") {
      placementSaveCount += 1;

      // a placement the backend refuses has to leave the config alone, the
      // same way a rejected save does
      if (rejectPlacement) {
        await route.fulfill({
          status: 400,
          json: { success: false, message: "cell is already taken" },
        });
        return;
      }
    }
    // the builder reads the saved layout back to decide whether it can be
    // painted on, so a save has to be visible to the next config read
    if (body?.config_data) {
      mergeInto(config as unknown as Record<string, unknown>, body.config_data);
    }
    await route.fulfill({ json: { success: true, require_restart: false } });
  });
  await page.route("**/api/config/raw_paths", (route) =>
    route.fulfill({ json: { birdseye: {} } }),
  );

  return {
    capturedConfig: () => lastSavedConfig,
    saveCount: () => saveCount,
    placementSaveCount: () => placementSaveCount,
    rejectPlacement: (value = true) => {
      rejectPlacement = value;
    },
  };
}

/** Save the section, which is what unlocks painting in fixed mode. */
async function saveSection(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(SAVE_FIRST)).toBeHidden();
}

/** Open the layout group and pick a layout mode from its select. */
async function selectLayoutMode(page: Page, mode: string) {
  await page.getByRole("heading", { name: "Layout", exact: true }).click();
  await page.getByRole("combobox", { name: /Layout mode/ }).click();
  await page.getByRole("option", { name: mode, exact: true }).click();
}

/** Set the size of the grid that is being painted. */
async function setGridSize(page: Page, cols: number, rows: number) {
  // a size is applied once it has been typed out, not on every keystroke
  await page.getByLabel("Columns").fill(String(cols));
  await page.getByLabel("Columns").press("Enter");
  await page.getByLabel("Rows").fill(String(rows));
  await page.getByLabel("Rows").press("Enter");
}

/** Address a cell of the grid the way it is announced. */
function cell(page: Page, row: number, col: number) {
  return page
    .locator("div.grid")
    .getByRole("combobox", { name: `Row ${row}, column ${col}` });
}

/** Paint a cell of the grid, addressed the way it is announced. */
async function paintCell(
  page: Page,
  row: number,
  col: number,
  option: string | RegExp,
) {
  await cell(page, row, col).click();
  await page.getByRole("option", { name: option }).click();
}

test.describe("birdseye layout settings @medium", () => {
  test("painting the fixed grid saves a cell and span per camera", async ({
    frigateApp,
  }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Fixed grid");
    await expect(frigateApp.page.getByText("Camera placement")).toBeVisible();

    await setGridSize(frigateApp.page, 2, 2);
    await saveSection(frigateApp.page);

    // the top row is one camera, so it is saved as a two column span
    await paintCell(frigateApp.page, 1, 1, FIRST_CAMERA);
    await paintCell(frigateApp.page, 1, 2, FIRST_CAMERA);

    // placement lives on the cameras, so it is saved as it is painted rather
    // than waiting for the section save
    await expect
      .poll(() => capture.capturedConfig(), { timeout: 5_000 })
      .toMatchObject({
        requires_restart: 0,
        update_topic: "config/cameras/*/birdseye",
        config_data: {
          cameras: {
            front_door: { birdseye: { cell: [0, 0], span: [2, 1] } },
          },
        },
      });

    // a camera that is not on the grid has no placement to clear, and asking
    // to clear a key the config does not have is rejected by the config API
    expect(capture.capturedConfig()).not.toHaveProperty(
      "config_data.cameras.backyard",
    );
  });

  test("a painted shape that is not a rectangle is reported, not saved", async ({
    frigateApp,
  }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Fixed grid");
    await setGridSize(frigateApp.page, 2, 2);
    await saveSection(frigateApp.page);

    await paintCell(frigateApp.page, 1, 1, FIRST_CAMERA);
    await expect
      .poll(() => capture.placementSaveCount(), { timeout: 5_000 })
      .toBe(1);

    // the two cells share a corner, which cannot be composed as one tile
    await paintCell(frigateApp.page, 2, 2, FIRST_CAMERA);

    await expect(frigateApp.page.getByText(NOT_A_RECTANGLE)).toBeVisible();
    expect(capture.placementSaveCount()).toBe(1);
  });

  test("camera placement waits until the layout itself is saved", async ({
    frigateApp,
  }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Fixed grid");
    await setGridSize(frigateApp.page, 2, 2);

    // placement is written onto the cameras as it is painted, so it cannot run
    // ahead of a grid size and a mode that are still unsaved section data
    await expect(frigateApp.page.getByText(SAVE_FIRST)).toBeVisible();
    await expect(
      frigateApp.page
        .locator("div.grid")
        .getByRole("combobox", { name: "Row 1, column 1" }),
    ).toBeDisabled();

    await saveSection(frigateApp.page);

    await paintCell(frigateApp.page, 1, 1, FIRST_CAMERA);
    await expect
      .poll(() => capture.placementSaveCount(), { timeout: 5_000 })
      .toBe(1);
  });

  test("a drawn layout is saved with the section without a restart", async ({
    frigateApp,
  }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");
    await expect(frigateApp.page.getByText("Layouts")).toBeVisible();

    // a new layout is drawn full for the number of cameras it is for
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await expect(frigateApp.page.getByLabel("Cameras shown")).toHaveValue("1");

    await frigateApp.page
      .getByRole("button", { name: "Save", exact: true })
      .click();

    await expect
      .poll(() => capture.capturedConfig(), { timeout: 5_000 })
      .toMatchObject({
        requires_restart: 0,
        update_topic: "config/birdseye",
        config_data: {
          birdseye: {
            layout: {
              mode: "dynamic",
              layouts: [{ cameras: 1, rows: ["A"] }],
            },
          },
        },
      });

    await expect(frigateApp.page.getByText(RESTART_REQUIRED)).toBeHidden();
  });

  test("a new layout is seeded on a square grid", async ({ frigateApp }) => {
    await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");

    // Two cameras were seeded as 2x1, whose cells are 8:9 on a 16:9 canvas and
    // letterbox both cameras before anything has been painted. Only a square
    // grid gives cells the aspect ratio of the canvas itself.
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();

    await expect(
      frigateApp.page.getByLabel("Cameras shown").last(),
    ).toHaveValue("2");
    await expect(frigateApp.page.getByLabel("Columns").last()).toHaveValue("2");
    await expect(frigateApp.page.getByLabel("Rows").last()).toHaveValue("2");
  });

  test("a painted drawn layout round trips through the saved rows", async ({
    frigateApp,
  }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");
    // two clicks, since the count offered is always the lowest unused one
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await expect(
      frigateApp.page.getByLabel("Cameras shown").last(),
    ).toHaveValue("2");

    // stack the two slots instead of putting them side by side, which is the
    // cells to rows conversion a user actually drives. It starts as
    // ["AB", ".."], so A takes the top row and B the bottom one.
    await frigateApp.page.getByLabel("Rows").last().fill("2");
    await frigateApp.page.getByLabel("Rows").last().press("Enter");
    await paintCell(frigateApp.page, 1, 2, "A");
    await paintCell(frigateApp.page, 2, 1, "B");
    await paintCell(frigateApp.page, 2, 2, "B");

    await frigateApp.page
      .getByRole("button", { name: "Save", exact: true })
      .click();

    await expect
      .poll(() => capture.capturedConfig(), { timeout: 5_000 })
      .toMatchObject({
        config_data: {
          birdseye: {
            layout: {
              layouts: [
                { cameras: 1, rows: ["A"] },
                { cameras: 2, rows: ["AA", "BB"] },
              ],
            },
          },
        },
      });
  });

  test("a drawn layout can be pointed at the camera count it is for", async ({
    frigateApp,
  }) => {
    await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();

    // a layout for ten cameras without first creating the nine below it
    await frigateApp.page.getByLabel("Cameras shown").fill("10");
    await frigateApp.page.getByLabel("Cameras shown").press("Enter");

    await expect(frigateApp.page.getByLabel("Cameras shown")).toHaveValue("10");
    // the slots follow the count, so nine of them are not on the grid yet
    await expect(frigateApp.page.getByText(MISSING_SLOTS)).toBeVisible();

    // a count that already has a layout would collide with it, so it is
    // refused. The cards are ordered by count, so the new one comes first.
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await expect(
      frigateApp.page.getByLabel("Cameras shown").first(),
    ).toHaveValue("1");

    await frigateApp.page.getByLabel("Cameras shown").first().fill("10");
    await frigateApp.page.getByLabel("Cameras shown").first().press("Enter");

    await expect(
      frigateApp.page.getByLabel("Cameras shown").first(),
    ).toHaveValue("1");
  });

  test("a drawn layout can be removed again", async ({ frigateApp }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await expect(
      frigateApp.page.getByLabel("Cameras shown").last(),
    ).toHaveValue("2");

    await frigateApp.page
      .getByRole("button", { name: /Remove the layout for/ })
      .last()
      .click();
    await expect(frigateApp.page.getByLabel("Cameras shown")).toHaveCount(1);

    await frigateApp.page
      .getByRole("button", { name: "Save", exact: true })
      .click();

    await expect
      .poll(() => capture.capturedConfig(), { timeout: 5_000 })
      .toMatchObject({
        config_data: {
          birdseye: { layout: { layouts: [{ cameras: 1, rows: ["A"] }] } },
        },
      });
  });

  test("a drawn layout with an unplaced slot cannot be saved", async ({
    frigateApp,
  }) => {
    await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await expect(frigateApp.page.getByLabel("Cameras shown")).toHaveValue("1");

    // taking the only slot off the grid leaves the layout short of a slot,
    // which the backend rejects, failing the whole section save with it
    await paintCell(frigateApp.page, 1, 1, "Empty");

    await expect(frigateApp.page.getByText(MISSING_SLOTS)).toBeVisible();
    await expect(
      frigateApp.page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
  });

  test("a rejected placement is reported and taken back off the grid", async ({
    frigateApp,
  }) => {
    const capture = await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Fixed grid");
    await setGridSize(frigateApp.page, 2, 2);
    await saveSection(frigateApp.page);

    await paintCell(frigateApp.page, 1, 1, FIRST_CAMERA);
    await expect
      .poll(() => capture.placementSaveCount(), { timeout: 5_000 })
      .toBe(1);

    capture.rejectPlacement();
    await paintCell(frigateApp.page, 2, 1, FIRST_CAMERA);

    await expect(frigateApp.page.getByText(SAVE_FAILED)).toBeVisible();

    // the grid cannot keep showing a placement the config does not have, so
    // the painted cell goes back to what was last saved
    await expect(cell(frigateApp.page, 2, 1)).toHaveText("-");
    await expect(cell(frigateApp.page, 1, 1)).not.toHaveText("-");
  });

  test("the grid can be painted as wide as the config allows", async ({
    frigateApp,
  }) => {
    await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Fixed grid");
    // the config allows up to 16 columns and rows, so a grid that size has to
    // be paintable rather than clamped to something narrower
    await setGridSize(frigateApp.page, 16, 16);

    await expect(frigateApp.page.getByLabel("Columns")).toHaveValue("16");
    await expect(frigateApp.page.getByLabel("Rows")).toHaveValue("16");
    await expect(cell(frigateApp.page, 16, 16)).toBeVisible();
  });
});
