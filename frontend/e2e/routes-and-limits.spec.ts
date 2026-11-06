import { expect, GATEWAY_URL, logIn, signUp, startServer, test, viaGateway } from "./support";

const createKey = async (page: import("@playwright/test").Page) => {
  const res = await page.request.post(`${GATEWAY_URL}/keys`, { data: { name: "test-client" } });
  return (await res.json()).apiKey as string;
};

test.describe("routes", () => {
  test.use({ expectedHttpErrors: [409] });

  test("creates, edits and deletes a route, and the gateway follows", async ({ page, request }) => {
    const first = await startServer(() => ({ status: 200, body: '{"from":"first"}' }));
    const second = await startServer(() => ({ status: 200, body: '{"from":"second"}' }));
    await logIn(page, await signUp(request, "routes"));
    const key = await createKey(page);

    await page.goto("/routes");
    await expect(page.getByText("No routes yet")).toBeVisible();
    await page.getByRole("button", { name: "Create route" }).first().click();

    await page.getByLabel("Path prefix").fill("two/segments");
    await page.getByLabel("Target URL").fill("not a url");
    await page.getByRole("dialog").getByRole("button", { name: "Create route" }).click();
    await expect(page.getByText(/Use a single path segment/)).toBeVisible();
    await expect(page.getByText(/Enter a full URL/)).toBeVisible();

    await page.getByLabel("Path prefix").fill("/orders/");
    await page.getByLabel("Target URL").fill(first.url);
    await page.getByRole("dialog").getByRole("button", { name: "Create route" }).click();

    const row = page.getByTestId("route-/orders");
    await expect(row).toContainText(first.url);
    await expect(row).toContainText(`${GATEWAY_URL}/gateway/orders`);
    expect(await viaGateway(request, key, "/orders/1")).toBe(200);
    expect(first.requests.at(-1)?.path).toBe("/1");
    // The API key is for the gateway and never reaches the upstream.
    expect(first.requests.at(-1)?.headers.authorization).toBeUndefined();

    // A duplicate prefix gets the gateway's 409, shown beside the field.
    await page.getByRole("button", { name: "Create route" }).first().click();
    await page.getByLabel("Path prefix").fill("orders");
    await page.getByLabel("Target URL").fill(first.url);
    await page.getByRole("dialog").getByRole("button", { name: "Create route" }).click();
    await expect(page.getByText("A route for /orders already exists")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Edit /orders" }).click();
    await page.getByLabel("Target URL").fill(second.url);
    await page.getByRole("button", { name: "Save route" }).click();
    await expect(row).toContainText(second.url);
    await expect
      .poll(async () => {
        await viaGateway(request, key, "/orders/2");
        return second.requests.length;
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "Delete /orders" }).click();
    await page.getByRole("button", { name: "Delete route" }).click();
    await expect(row).toHaveCount(0);
    expect(await viaGateway(request, key, "/orders/3")).toBe(404);

    await first.close();
    await second.close();
  });
});

test("saves a rate limit that the gateway then enforces", async ({ page, request }) => {
  const upstream = await startServer(() => ({ status: 200 }));
  await logIn(page, await signUp(request, "limits"));
  const key = await createKey(page);
  await page.request.post(`${GATEWAY_URL}/admin/routes`, {
    data: { pathPrefix: "/api", targetUrl: upstream.url },
  });

  await page.goto("/rate-limit");

  // Before any save, the real default from the gateway is shown.
  const summary = page.getByTestId("rate-limit-summary");
  await expect(summary).toHaveText("Bursts of up to 100 requests, refilling at 20 per second.");
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();

  await page.getByLabel("Capacity", { exact: true }).fill("0");
  await save.click();
  await expect(page.getByText("Capacity must be between 1 and 1,000,000.")).toBeVisible();

  // Only the sliding window takes a window length.
  await page.getByRole("radio", { name: /Sliding window/ }).check();
  await expect(page.getByLabel("Window (seconds)")).toBeVisible();
  await expect(page.getByLabel(/Refill rate/)).toHaveCount(0);

  await page.getByLabel("Capacity", { exact: true }).fill("3");
  await page.getByLabel("Window (seconds)").fill("60");
  await expect(summary).toHaveText("At most 3 requests in any 60 second window.");
  await save.click();
  await expect(page.getByText("Rate limit saved")).toBeVisible();
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("radio", { name: /Sliding window/ })).toBeChecked();
  await expect(page.getByLabel("Capacity", { exact: true })).toHaveValue("3");

  const statuses: number[] = [];
  for (let i = 0; i < 5; i += 1) statuses.push(await viaGateway(request, key, "/api/x"));
  expect(statuses).toEqual([200, 200, 200, 429, 429]);

  await upstream.close();
});
