import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  expect,
  GATEWAY_URL,
  logIn,
  PASSWORD,
  postAlert,
  signUp,
  tenantIdOf,
  test,
  uniqueEmail,
} from "./support";

const PAGES = ["/overview", "/routes", "/keys", "/rate-limit", "/anomalies", "/webhooks", "/team"];

/** A workspace with one of everything, so read-only rows can be checked for actions. */
async function seedWorkspace(page: Page) {
  const tenantId = await tenantIdOf(page);
  await page.request.post(`${GATEWAY_URL}/admin/routes`, {
    data: { pathPrefix: "/orders", targetUrl: "http://127.0.0.1:9/" },
  });
  await page.request.post(`${GATEWAY_URL}/keys`, { data: { name: "ci-runner" } });
  await page.request.post(`${GATEWAY_URL}/webhooks`, {
    data: { url: "http://127.0.0.1:9/hook" },
  });
  await postAlert(page.request, tenantId);
}

test("a viewer sees the data but is offered no action the API would refuse", async ({
  page,
  request,
  browser,
}) => {
  const admin = await browser.newPage();
  await logIn(admin, await signUp(request, "roles"));
  await seedWorkspace(admin);
  const viewerEmail = uniqueEmail("viewer");
  const created = await admin.request.post(`${GATEWAY_URL}/team`, {
    data: { email: viewerEmail, password: PASSWORD, role: "viewer" },
  });
  expect(created.status()).toBe(201);

  await logIn(page, { email: viewerEmail, password: PASSWORD });

  await page.goto("/routes");
  await expect(page.getByTestId("route-/orders")).toBeVisible();
  await expect(page.getByText("Read-only: an admin can change this")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create route/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Edit|Delete/ })).toHaveCount(0);

  await page.goto("/keys");
  await expect(page.getByTestId("key-ci-runner")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create key|Rotate|Revoke/ })).toHaveCount(0);

  await page.goto("/rate-limit");
  await expect(page.getByLabel("Capacity", { exact: true })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Token bucket/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  await page.goto("/anomalies");
  const row = page.getByTestId("anomaly-row");
  await row.getByRole("button", { name: /Latency of 4200 ms/ }).click();
  await expect(row.getByRole("list", { name: "SHAP attribution by feature" })).toBeVisible();
  await expect(row.getByRole("button", { name: /Acknowledge|Resolve|Reopen/ })).toHaveCount(0);

  await page.goto("/webhooks");
  await expect(page.getByTestId("endpoint-row")).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add endpoint|test event|Edit|Delete/ })).toHaveCount(0);

  await page.goto("/team");
  await expect(page.getByTestId(`member-${viewerEmail}`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add member|Remove/ })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);

  await admin.close();
});

test.describe("last admin", () => {
  test("cannot be demoted, which the gateway would refuse anyway", async ({ page, request }) => {
    const account = await signUp(request, "lastadmin");
    await logIn(page, account);
    await page.goto("/team");
    await expect(page.getByLabel(`Role for ${account.email}`)).toBeDisabled();

    await page.getByRole("button", { name: "Add member" }).click();
    await page.getByLabel("Email").fill(uniqueEmail("second"));
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByLabel("Role", { exact: true }).selectOption("admin");
    await page.getByRole("button", { name: "Add member" }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // With a second admin it becomes available.
    await expect(page.getByLabel(`Role for ${account.email}`)).toBeEnabled();
  });
});

test("keyboard: dialogs trap focus, close on Esc and return focus", async ({ page, request }) => {
  await logIn(page, await signUp(request, "keyboard"));
  await page.goto("/keys");
  const trigger = page.getByRole("button", { name: "Create key" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Name")).toBeFocused();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () =>
        document.activeElement === document.body ||
        Boolean(document.activeElement?.closest("dialog")),
    );
    expect(inside).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("no serious accessibility violations on any page, in either theme", async ({
  page,
  request,
}) => {
  await logIn(page, await signUp(request, "axe"));
  await seedWorkspace(page);

  for (const theme of ["light", "dark"]) {
    await page.addInitScript((value) => localStorage.setItem("fluxgate-theme", value), theme);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${path} [${theme}] ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      expect(serious).toEqual([]);
    }
  }
});

test.describe("signed out pages", () => {
  test("have no serious accessibility violations", async ({ page }) => {
    for (const path of ["/login", "/signup"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
      ).toEqual([]);
    }
  });
});
