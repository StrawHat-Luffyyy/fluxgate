import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { formatPercentTick } from "../lib/format";
import {
  expect,
  GATEWAY_URL,
  logIn,
  postAlert,
  signUp,
  startServer,
  tenantIdOf,
  test,
  viaGateway,
  withDb,
} from "./support";

const stat = (page: Page, label: string) => page.getByTestId(`stat-${label}`);

/** Real rows, with a timestamp no live request could have. */
const insertRequestLog = (tenantId: string, ageSql: string) =>
  withDb(
    (sql) => sql`
      insert into request_logs (
        request_id, tenant_id, api_key_id, method, route_prefix, status_code, latency_ms,
        request_bytes, response_bytes, rate_limited, upstream_called, created_at
      ) values (
        ${randomUUID()}, ${tenantId}, ${randomUUID()}, 'GET', '/seeded', 200, 50, 0, 100, false, true,
        now() - ${ageSql}::interval
      )`,
  );

const logCount = (tenantId: string) =>
  withDb(async (sql) => {
    const [row] = await sql`select count(*)::int as n from request_logs where tenant_id = ${tenantId}`;
    return row.n as number;
  });

test("shows the values that known traffic should produce", async ({ page, request }) => {
  const upstream = await startServer((url) =>
    url.startsWith("/boom") ? { status: 500 } : { status: 200, delayMs: 100 },
  );
  await logIn(page, await signUp(request, "known"));
  const tenantId = await tenantIdOf(page);
  const created = await page.request.post(`${GATEWAY_URL}/keys`, { data: { name: "known-client" } });
  const key = (await created.json()).apiKey;
  await page.request.post(`${GATEWAY_URL}/admin/routes`, {
    data: { pathPrefix: "/shop", targetUrl: upstream.url },
  });
  await page.request.put(`${GATEWAY_URL}/admin/rate-limit`, {
    data: { strategy: "sliding_window", capacity: 12, refillRate: 1, windowMs: 3_600_000 },
  });

  // 15 requests: 9 succeed, 3 are answered 500 by the upstream, 3 are over the limit.
  const statuses: number[] = [];
  for (let i = 0; i < 9; i += 1) statuses.push(await viaGateway(request, key, "/shop/ok"));
  for (let i = 0; i < 3; i += 1) statuses.push(await viaGateway(request, key, "/shop/boom"));
  for (let i = 0; i < 3; i += 1) statuses.push(await viaGateway(request, key, "/shop/ok"));
  expect(statuses).toEqual([...Array(9).fill(200), 500, 500, 500, 429, 429, 429]);

  // Wait for the batch writer before the first read: the gateway caches analytics for 10s.
  await expect.poll(() => logCount(tenantId), { timeout: 15_000 }).toBe(15);

  await page.goto("/overview?range=1h");
  await expect(stat(page, "Requests")).toContainText("15");
  await expect(stat(page, "Requests")).toContainText("last hour");
  await expect(stat(page, "Error rate")).toContainText("20.0%");
  await expect(stat(page, "Error rate")).toContainText("3 5xx");
  await expect(stat(page, "Rate limited")).toContainText("3");
  await expect(stat(page, "Rate limited")).toContainText("20.0% of requests");
  await expect(stat(page, "Anomalies")).toContainText("0 open");

  // 9 of the 12 upstream calls took at least 100 ms, and a 429 must not count.
  const p95 = Number(/(\d+) ms/.exec((await stat(page, "p95 latency").innerText()) ?? "")?.[1]);
  expect(p95).toBeGreaterThanOrEqual(100);
  expect(p95).toBeLessThan(2000);

  const topRoute = page.getByRole("group", { name: "Top routes" }).getByRole("row", { name: /\/shop/ });
  await expect(topRoute.getByRole("cell").nth(1)).toHaveText("15");
  await expect(topRoute.getByRole("cell").nth(2)).toHaveText("3");
  const consumer = page.getByRole("group", { name: "Top consumers" }).getByRole("row", { name: /known-client/ });
  await expect(consumer.getByRole("cell").nth(1)).toHaveText("15");
  await expect(consumer.getByRole("cell").nth(2)).toHaveText("3");

  // The chart data adds up to the same totals, wherever the minute boundaries fell.
  await page.getByText("Chart data as a table").click();
  const bucketRows = page.getByRole("group", { name: "Traffic per time bucket" }).locator("tbody tr");
  const cells = await bucketRows.evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent ?? "")),
  );
  const sum = (column: number) => cells.reduce((total, row) => total + Number(row[column]), 0);
  expect(sum(1)).toBe(15);
  expect(sum(2)).toBe(3);
  expect(sum(4)).toBe(3);

  // The charts are drawn, and say what they measure.
  await expect(page.getByRole("figure", { name: /^Requests per minute/ }).locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(page.getByRole("figure", { name: /^Latency percentiles/ })).toContainText(" ms");
  await expect(page.getByText("Gateway latency of upstream requests")).toBeVisible();
  await expect(page.getByText("First and last buckets are partial.").first()).toBeVisible();

  await upstream.close();
});

test("switching range queries that range, by mouse and by keyboard", async ({ page, request }) => {
  await logIn(page, await signUp(request, "ranges"));
  const tenantId = await tenantIdOf(page);
  // One row inside each window, and one outside them all.
  for (const age of ["10 minutes", "3 hours", "2 days", "8 days"]) {
    await insertRequestLog(tenantId, age);
  }

  await page.goto("/overview");
  const requests = stat(page, "Requests");
  await expect(requests).toContainText("2");
  await expect(requests).toContainText("last 24 hours");

  await page.getByRole("radio", { name: "1h" }).click();
  await expect(page).toHaveURL(/range=1h/);
  await expect(requests).toContainText("last hour");
  await expect(requests).toContainText("1");

  // Arrow keys move along the group: 1h, 24h, 7d. Only the selected radio is a tab stop.
  await expect(page.getByRole("radio", { name: "1h" })).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("radio", { name: "7d" })).toHaveAttribute("tabindex", "-1");
  await page.getByRole("radio", { name: "1h" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByRole("radio", { name: "7d" })).toBeFocused();
  await expect(requests).toContainText("last 7 days");
  await expect(requests).toContainText("3");

  // Every 7d tick has a date, since the hours repeat.
  await expect(page.getByRole("figure", { name: /^Requests per 6 hours/ })).toContainText(
    new Date().toLocaleString(undefined, { month: "short" }),
  );
});

test("percent ticks have enough decimals for their scale", () => {
  expect(formatPercentTick(0.45, 0.6)).toBe("45%");
  expect(formatPercentTick(0.135, 0.18)).toBe("13.5%");
  expect(formatPercentTick(0.015, 0.06)).toBe("1.5%");
  expect(formatPercentTick(0.0025, 0.004)).toBe("0.25%");
  expect(formatPercentTick(0.00025, 0.0004)).toBe("0.025%");
});

test.describe("when a refresh fails", () => {
  test.use({ expectedHttpErrors: [500] });

  test("keeps the data on screen and says it is stale", async ({ page, request }) => {
    test.setTimeout(120_000);
    await logIn(page, await signUp(request, "stale"));
    const tenantId = await tenantIdOf(page);
    await insertRequestLog(tenantId, "10 minutes");
    await postAlert(request, tenantId);

    const fail = (route: import("@playwright/test").Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "INTERNAL_ERROR", message: "An unexpected error occurred" }),
      });
    const banner = page.getByRole("alert").filter({ hasText: "Could not refresh this page" });

    await page.goto("/overview");
    await expect(stat(page, "Requests")).toContainText("1");
    await expect(banner).toHaveCount(0);

    await page.route("**/analytics/overview*", fail);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText("Showing data from");
    await expect(stat(page, "Requests")).toContainText("1");

    await page.unroute("**/analytics/overview*");
    await expect(banner).toHaveCount(0, { timeout: 30_000 });

    await page.goto("/anomalies");
    await expect(page.getByTestId("anomaly-row")).toHaveCount(1);
    await page.route("**/anomalies?*", fail);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("anomaly-row")).toHaveCount(1);
  });

  test("the account area says so if /auth/me fails", async ({ page, request }) => {
    await logIn(page, await signUp(request, "mefail"));
    await page.route("**/auth/me", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/keys");
    await expect(page.getByText("Could not load your account")).toBeVisible({ timeout: 20_000 });

    await page.unroute("**/auth/me");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("workspace-name")).toHaveText("E2E mefail");
  });
});
