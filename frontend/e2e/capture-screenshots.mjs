// Captures the README screenshots from a running `pnpm demo`:
//   pnpm --filter frontend exec node e2e/capture-screenshots.mjs
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.DEMO_URL ?? "http://localhost:3001";
const OUT = path.resolve(import.meta.dirname, "../../docs/screenshots");
const PAGES = ["overview", "routes", "keys", "rate-limit", "anomalies", "webhooks", "team"];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const colorScheme of ["dark", "light"]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme,
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill("admin@fluxgate-demo.example.com");
  await page.getByLabel("Password").fill("fluxgate-demo-password");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/overview");

  // Light mode only needs one, to show the theme exists.
  for (const name of colorScheme === "dark" ? PAGES : ["overview"]) {
    await page.goto(`${BASE_URL}/${name}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800); // Chart entry animations.
    await page.screenshot({ path: path.join(OUT, `${name}-${colorScheme}.png`) });
  }
  await context.close();
}

await browser.close();
