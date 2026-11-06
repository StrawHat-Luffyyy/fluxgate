import path from "node:path";
import type { Page } from "@playwright/test";
import {
  expect,
  GATEWAY_URL,
  logIn,
  PASSWORD,
  postAlert,
  signUp,
  startServer,
  tenantIdOf,
  test,
  uniqueEmail,
  viaGateway,
} from "./support";

const OUT = path.join(__dirname, "artifacts", "screenshots");

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};
const THEMES = ["light", "dark"] as const;

const shoot = async (page: Page, name: string) => {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

const everyVariant = async (page: Page, visit: (label: string) => Promise<void>) => {
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    for (const theme of THEMES) {
      await page.addInitScript((value) => localStorage.setItem("fluxgate-theme", value), theme);
      await visit(`${device}-${theme}`);
    }
  }
};

/**
 * Screenshots for review. All of it comes from a real workspace: real proxied
 * requests to a local upstream, a real 429 burst, real webhook attempts. The alerts
 * are signed POSTs to the endpoint ai-service calls, with values chosen here.
 */
test("every page, desktop and mobile, light and dark", async ({ page, request, browser }) => {
  test.setTimeout(240_000);

  const upstream = await startServer((url) => {
    if (url.startsWith("/slow")) return { status: 200, delayMs: 120 + Math.random() * 150 };
    if (url.startsWith("/flaky")) return { status: Math.random() < 0.4 ? 503 : 200, delayMs: 30 };
    return { status: 200, delayMs: 5 + Math.random() * 25 };
  });
  const receiver = await startServer((url) => ({ status: url.includes("down") ? 500 : 200 }));

  await logIn(page, await signUp(request, "screens"));
  const tenantId = await tenantIdOf(page);

  for (const prefix of ["orders", "search", "payments"]) {
    await page.request.post(`${GATEWAY_URL}/admin/routes`, {
      data: { pathPrefix: `/${prefix}`, targetUrl: `${upstream.url}/${prefix === "search" ? "slow" : prefix === "payments" ? "flaky" : "ok"}` },
    });
  }
  const keys: string[] = [];
  for (const name of ["checkout-api", "mobile-app"]) {
    const res = await page.request.post(`${GATEWAY_URL}/keys`, {
      data: { name, ...(name === "mobile-app" ? { expiresInDays: 90 } : {}) },
    });
    keys.push((await res.json()).apiKey);
  }
  const retired = await page.request.post(`${GATEWAY_URL}/keys`, { data: { name: "legacy-batch" } });
  await page.request.delete(`${GATEWAY_URL}/keys/${(await retired.json()).key.id}`);

  await page.request.put(`${GATEWAY_URL}/admin/rate-limit`, {
    data: { strategy: "token_bucket", capacity: 60, refillRate: 8, windowMs: 60_000 },
  });
  await expect
    .poll(async () => viaGateway(request, keys[0], "/orders/warm"), { timeout: 15_000 })
    .toBe(200);

  // Spread over a couple of minutes' worth of buckets is not possible in a test, so
  // the 1h view shows what actually happened: one or two busy minutes.
  for (let i = 0; i < 90; i += 1) {
    const key = keys[i % 3 === 0 ? 1 : 0];
    const route = ["/orders", "/search", "/payments"][i % 3];
    await viaGateway(request, key, `${route}/${i}`);
  }
  // Past the bucket's capacity on purpose, for real 429s.
  await Promise.all(Array.from({ length: 80 }, (_, i) => viaGateway(request, keys[0], `/orders/b${i}`)));

  await postAlert(request, tenantId);
  await postAlert(request, tenantId, {
    detector: "range_guard",
    topFeature: "responseByteSize",
    topFeatureValue: 52_428_800,
    attribution: { responseByteSize: -2.41, latencyMs: 0.18, requestByteSize: 0.05 },
    features: { latencyMs: 212, responseByteSize: 52_428_800, requestByteSize: 340 },
    message: "Response of 50 MB is far outside the range seen in training",
  });
  await postAlert(request, tenantId, {
    message: "Request size of 8 MB is unusual for this traffic",
    topFeature: "requestByteSize",
    topFeatureValue: 8_388_608,
    attribution: { requestByteSize: -1.87, latencyMs: -0.12, responseByteSize: 0.33 },
    features: { latencyMs: 96, responseByteSize: 1024, requestByteSize: 8_388_608 },
  });

  const webhook = await page.request.post(`${GATEWAY_URL}/webhooks`, {
    data: { url: `${receiver.url}/fluxgate` },
  });
  const down = await page.request.post(`${GATEWAY_URL}/webhooks`, {
    data: { url: `${receiver.url}/down` },
  });
  await page.request.post(`${GATEWAY_URL}/webhooks/${(await webhook.json()).endpoint.id}/test`);
  await page.request.post(`${GATEWAY_URL}/webhooks/${(await down.json()).endpoint.id}/test`);
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${GATEWAY_URL}/webhooks/deliveries`);
        const { deliveries } = await res.json();
        return deliveries.filter((d: { status: string }) => d.status === "pending").length;
      },
      { timeout: 30_000 },
    )
    .toBe(0);

  await page.request.post(`${GATEWAY_URL}/team`, {
    data: { email: uniqueEmail("viewer"), password: PASSWORD, role: "viewer" },
  });

  // Request logs are written in one-second batches, and analytics are cached for ten.
  await page.waitForTimeout(12_000);

  await everyVariant(page, async (variant) => {
    await page.goto("/overview?range=1h");
    await expect(page.getByRole("heading", { name: "Traffic" })).toBeVisible();
    await shoot(page, `overview-${variant}`);

    await page.goto("/routes");
    await expect(page.getByTestId("route-/orders")).toBeVisible();
    await shoot(page, `routes-${variant}`);

    await page.goto("/keys");
    await expect(page.getByTestId("key-checkout-api")).toBeVisible();
    await shoot(page, `keys-${variant}`);

    await page.goto("/rate-limit");
    await expect(page.getByTestId("rate-limit-summary")).toBeVisible();
    await shoot(page, `rate-limit-${variant}`);

    await page.goto("/anomalies");
    await page.getByTestId("anomaly-row").filter({ hasText: "50 MB" }).getByRole("button").first().click();
    await shoot(page, `anomalies-${variant}`);

    await page.goto("/webhooks");
    await expect(page.getByTestId("delivery-row").first()).toBeVisible();
    await shoot(page, `webhooks-${variant}`);

    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await shoot(page, `team-${variant}`);

    if (variant.startsWith("mobile")) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `navigation-${variant}.png`) });
    }
  });

  // States a populated workspace never shows: the secret dialog, and first-run empties.
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/keys");
  await page.getByRole("button", { name: "Create key" }).click();
  await page.getByLabel("Name").fill("screenshot-key");
  await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("one-time-secret")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "dialog-secret-desktop-dark.png") });
  await page.getByRole("button", { name: "I have stored it" }).click();

  const signedOut = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const fresh = await signedOut.newPage();
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    await fresh.setViewportSize(viewport);
    for (const theme of THEMES) {
      await fresh.addInitScript((value) => localStorage.setItem("fluxgate-theme", value), theme);
      await fresh.goto("/login");
      await shoot(fresh, `login-${device}-${theme}`);
      await fresh.goto("/signup");
      await shoot(fresh, `signup-${device}-${theme}`);
    }
  }

  await logIn(fresh, await signUp(request, "empty"));
  await fresh.setViewportSize(VIEWPORTS.desktop);
  await fresh.addInitScript(() => localStorage.setItem("fluxgate-theme", "light"));
  for (const route of ["overview", "routes", "keys", "anomalies", "webhooks"]) {
    await fresh.goto(`/${route}`);
    await expect(fresh.getByRole("heading", { level: 1 })).toBeVisible();
    await shoot(fresh, `empty-${route}-desktop-light`);
  }
  await signedOut.close();

  await upstream.close();
  await receiver.close();
});
