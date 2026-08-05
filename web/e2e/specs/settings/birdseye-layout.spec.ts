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
const NOT_A_RECTANGLE = /do not form a rectangle/;
const MISSING_SLOTS = /not on the grid yet/;
const RESTART_REQUIRED = /Restart Frigate to apply/;

async function installRoutes(page: Page) {
  const config = configFactory({ birdseye: { enabled: true } });

  let lastSavedConfig: unknown = null;
  let saveCount = 0;

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
    lastSavedConfig = route.request().postDataJSON();
    saveCount += 1;
    await route.fulfill({ json: { success: true, require_restart: false } });
  });
  await page.route("**/api/config/raw_paths", (route) =>
    route.fulfill({ json: { birdseye: {} } }),
  );

  return {
    capturedConfig: () => lastSavedConfig,
    saveCount: () => saveCount,
  };
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

/** Paint a cell of the grid, addressed the way it is announced. */
async function paintCell(
  page: Page,
  row: number,
  col: number,
  option: string | RegExp,
) {
  await page
    .locator("div.grid")
    .getByRole("combobox", { name: `Row ${row}, column ${col}` })
    .click();
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

    await paintCell(frigateApp.page, 1, 1, FIRST_CAMERA);
    await expect.poll(() => capture.saveCount(), { timeout: 5_000 }).toBe(1);

    // the two cells share a corner, which cannot be composed as one tile
    await paintCell(frigateApp.page, 2, 2, FIRST_CAMERA);

    await expect(frigateApp.page.getByText(NOT_A_RECTANGLE)).toBeVisible();
    expect(capture.saveCount()).toBe(1);
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
    await expect(frigateApp.page.getByText("1 camera")).toBeVisible();

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

  test("a drawn layout with an unplaced slot cannot be saved", async ({
    frigateApp,
  }) => {
    await installRoutes(frigateApp.page);
    await frigateApp.goto(SETTINGS_URL);

    await selectLayoutMode(frigateApp.page, "Dynamic");
    await frigateApp.page.getByRole("button", { name: "Add layout" }).click();
    await expect(frigateApp.page.getByText("1 camera")).toBeVisible();

    // taking the only slot off the grid leaves the layout short of a slot,
    // which the backend rejects, failing the whole section save with it
    await paintCell(frigateApp.page, 1, 1, "Empty");

    await expect(frigateApp.page.getByText(MISSING_SLOTS)).toBeVisible();
    await expect(
      frigateApp.page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
  });
});
