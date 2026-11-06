import { expect, logIn, signUp, startServer, test, viaGateway } from "./support";

test("creates a key, shows the secret once, and rotation and revocation really take effect", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const upstream = await startServer(() => ({ status: 200 }));
  await logIn(page, await signUp(request, "keys"));

  // The key is exercised against a real route, so a working key means a 200.
  await page.goto("/routes");
  await page.getByRole("button", { name: "Create your first route" }).click();
  await page.getByLabel("Path prefix").fill("echo");
  await page.getByLabel("Target URL").fill(upstream.url);
  await page.getByRole("dialog").getByRole("button", { name: "Create route" }).click();
  await expect(page.getByTestId("route-/echo")).toBeVisible();

  await page.goto("/keys");
  await page.getByRole("button", { name: "Create your first key" }).click();

  // Validation runs before anything is sent.
  await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Name the key after the client that will use it.")).toBeVisible();
  await page.getByLabel("Name").fill("billing-service");
  await page.getByLabel("Expires after (days)").fill("0");
  await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Expiry must be between 1 and 3,650.")).toBeVisible();
  await page.getByLabel("Expires after (days)").fill("30");
  await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();

  const secretBox = page.getByTestId("one-time-secret");
  await expect(secretBox).toHaveText(/^fg_live_[0-9a-f]{48}$/);
  const secret = (await secretBox.textContent())!;

  await page.getByRole("button", { name: "Copy to clipboard" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);

  // Esc must not lose the only copy.
  await page.keyboard.press("Escape");
  await expect(secretBox).toBeVisible();

  await page.getByRole("button", { name: "I have stored it" }).click();
  await expect(secretBox).toHaveCount(0);

  // Once closed, the secret exists nowhere on the page, then or after a reload.
  const row = page.getByTestId("key-billing-service");
  await expect(row).toContainText(`${secret.slice(0, 12)}...${secret.slice(-4)}`);
  await expect(row).toContainText("Active");
  expect(await page.content()).not.toContain(secret);
  await page.reload();
  await expect(row).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  expect(await viaGateway(request, secret, "/echo/ping")).toBe(200);

  // Rotation: the old key stops working as the new one starts.
  await page.getByRole("button", { name: "Rotate billing-service" }).click();
  await page.getByRole("button", { name: "Rotate key" }).click();
  await expect(secretBox).toBeVisible();
  const rotated = (await secretBox.textContent())!;
  expect(rotated).not.toBe(secret);
  await page.getByRole("button", { name: "I have stored it" }).click();

  expect(await viaGateway(request, secret, "/echo/ping")).toBe(401);
  expect(await viaGateway(request, rotated, "/echo/ping")).toBe(200);

  const active = page.locator('[data-testid="key-billing-service"][data-state="active"]');
  const revoked = page.locator('[data-testid="key-billing-service"][data-state="revoked"]');
  await expect(active).toHaveCount(1);
  await expect(revoked).toHaveCount(1);
  // Revoked keys offer no actions: the API would refuse them.
  await expect(revoked.getByRole("button")).toHaveCount(0);

  await active.getByRole("button", { name: "Revoke billing-service" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(revoked).toHaveCount(2);
  await expect(page.getByText('Key "billing-service" revoked')).toBeVisible();
  expect(await viaGateway(request, rotated, "/echo/ping")).toBe(401);

  await upstream.close();
});
