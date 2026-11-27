// End-to-end tests, run locally against servers you start yourself (not in CI:
// they need Postgres, the API, the frontend and a browser).
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
//
// E2E_BASE_URL defaults to http://localhost:3000. The account must be a
// SUPER_ADMIN in the portal named by E2E_REALM (default UG).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.spec.mjs",
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
		acceptDownloads: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
