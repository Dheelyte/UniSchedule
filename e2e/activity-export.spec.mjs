// Activity Logs: filter the page, check the chips and the URL, open "Export
// analysis", confirm it starts from those filters, download the XLSX, and check
// its name and its Filters sheet. See playwright.config.mjs for how to run it.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const REALM = process.env.E2E_REALM || "UG";

test.skip(!EMAIL || !PASSWORD, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to a SUPER_ADMIN account on the local servers.");

test("filter the Activity Logs, export the analysis, check the file", async ({ page }) => {
	// Signing in records an auth.login, so the Auth category has an event in the last 7 days.
	await page.goto(`/login?realm=${REALM}`);
	await page.getByLabel("Email address").fill(EMAIL);
	await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL((url) => url.pathname === "/");

	await page.goto("/activity");
	const bar = page.getByTestId("activity-filter-bar");
	await expect(bar).toBeVisible();

	await bar.getByLabel("Timeframe").selectOption("last_7_days");
	await expect(page).toHaveURL(/[?&]range=last_7_days/);
	// Categories sit under "More filters", folded away until opened.
	await page.getByTestId("page-more-toggle").click();
	await page.getByTestId("page-categories").click();
	await page.getByRole("listbox", { name: "Categories" }).getByLabel("Auth", { exact: true }).check();
	await expect(page).toHaveURL(/[?&]cat=auth/);
	await page.keyboard.press("Escape");

	const chips = page.getByTestId("activity-chips");
	await expect(chips).toContainText("Last 7 days");
	await expect(chips).toContainText("Category: Auth");
	await expect(chips.getByRole("button", { name: "Clear all" })).toBeVisible();
	await expect(page.getByTestId("activity-table")).toContainText("auth.login");

	// The modal opens with the page's filters.
	await page.getByTestId("export-analysis-button").click();
	const modal = page.getByTestId("export-modal");
	await expect(modal).toBeVisible();
	await expect(modal.getByLabel("Timeframe")).toHaveValue("last_7_days");
	await expect(modal.getByTestId("export-categories")).toHaveText(/Auth/);
	await expect(modal.getByTestId("export-count")).toContainText("matching event");

	await modal.getByTestId("export-format-xlsx").check();
	await expect(modal.getByTestId("export-download")).toBeEnabled();
	const downloading = page.waitForEvent("download");
	await modal.getByTestId("export-download").click();
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/^unischedule-activity-analysis_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);

	const files = unzipSync(readFileSync(await download.path()));
	const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
	expect(names).toEqual(expect.arrayContaining(["Summary", "Members", "Raw data", "Filters"]));
	const filtersSheet = strFromU8(files[`xl/worksheets/sheet${names.indexOf("Filters") + 1}.xml`]);
	expect(filtersSheet).toContain("Last 7 days");
	expect(filtersSheet).toContain("Auth");
	expect(filtersSheet).toContain("All times Africa/Lagos (WAT, UTC+01:00)");

	// The export is recorded in the log.
	await page.goto("/activity?range=today&cat=activity_log");
	await expect(page.getByTestId("activity-table")).toContainText("activity_log.export");

	// No matching events: no file, unless the member list is wanted on its own.
	await page.goto("/activity?range=last_7_days&q=matches-nothing-at-all");
	await page.getByTestId("export-analysis-button").click();
	await expect(page.getByTestId("export-count")).toContainText("0");
	await page.getByTestId("export-section-members").uncheck();
	await expect(page.getByTestId("export-empty")).toBeVisible();
	await expect(page.getByTestId("export-download")).toBeDisabled();
	await page.getByTestId("export-section-members").check();
	await expect(page.getByTestId("export-download")).toBeEnabled();
});
