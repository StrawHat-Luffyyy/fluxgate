import { createHmac } from "node:crypto";
import { expect, logIn, postAlert, signUp, startServer, tenantIdOf, test } from "./support";

test("the anomaly feed explains an alert and triages it", async ({ page, request }) => {
  await logIn(page, await signUp(request, "anomalies"));
  const tenantId = await tenantIdOf(page);

  await page.goto("/anomalies");
  await expect(page.getByText("Nothing here")).toBeVisible();

  await postAlert(request, tenantId);
  // Sent twice with the same id, it stays one row: redelivery from Kafka is harmless.
  const requestId = "00000000-0000-4000-8000-000000000001";
  await postAlert(request, tenantId, { requestId, message: "Redelivered alert" });
  await postAlert(request, tenantId, { requestId, message: "Redelivered alert" });

  await page.reload();
  const rows = page.getByTestId("anomaly-row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Anomalies.*Open/ })).toBeVisible();

  const row = rows.filter({ hasText: "Latency of 4200 ms" });
  await expect(row).toContainText("4.20 s");
  await row.getByRole("button", { name: /Latency of 4200 ms/ }).click();

  const shap = row.getByRole("list", { name: "SHAP attribution by feature" });
  await expect(shap.getByRole("listitem")).toHaveCount(3);
  // Largest contribution first, signs and direction as sent.
  await expect(shap.getByRole("listitem").first()).toContainText("-3.142");
  await expect(shap.getByRole("listitem").first()).toContainText("toward anomalous");
  await expect(shap.getByRole("listitem").nth(1)).toContainText("+0.212");
  await expect(shap.getByRole("listitem").nth(1)).toContainText("toward normal");

  await row.getByRole("button", { name: "Acknowledge" }).click();
  await expect(row).toContainText("Acknowledged");

  await page.getByRole("radio", { name: "Open" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Redelivered alert");

  await page.getByRole("radio", { name: "Acknowledged" }).click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("anomaly-row").filter({ hasText: "4200" })).toContainText("Acknowledged");
});

test("webhook endpoints: secret once, signed test delivery, failure and retry", async ({
  page,
  request,
}) => {
  let failing = true;
  const receiver = await startServer((path) =>
    path.includes("flaky") && failing ? { status: 500 } : { status: 200 },
  );
  await logIn(page, await signUp(request, "webhooks"));

  await page.goto("/webhooks");
  await expect(page.getByText("No endpoints yet")).toBeVisible();
  await page.getByRole("button", { name: "Add your first endpoint" }).click();
  await page.getByLabel("Endpoint URL").fill("nope");
  await page.getByRole("dialog").getByRole("button", { name: "Add endpoint" }).click();
  await expect(page.getByText(/Enter a full URL/)).toBeVisible();
  await page.getByLabel("Endpoint URL").fill(`${receiver.url}/ok`);
  await page.getByRole("dialog").getByRole("button", { name: "Add endpoint" }).click();

  const secretBox = page.getByTestId("one-time-secret");
  await expect(secretBox).toHaveText(/^whsec_[0-9a-f]{48}$/);
  const secret = (await secretBox.textContent())!;
  await page.getByRole("button", { name: "I have stored it" }).click();
  await expect(secretBox).toHaveCount(0);

  await page.getByRole("button", { name: `Send test event to ${receiver.url}/ok` }).click();
  await expect(
    page.getByTestId("delivery-row").filter({ hasText: "webhook.test" }).first(),
  ).toHaveAttribute("data-status", "delivered", { timeout: 20_000 });

  // The receiver got a payload signed with the secret that was shown.
  const received = receiver.requests.find((r) => r.path === "/ok")!;
  expect(received.headers["x-fluxgate-event"]).toBe("webhook.test");
  const [t, v1] = String(received.headers["x-fluxgate-signature"]).split(",");
  const timestamp = t.split("=")[1];
  expect(v1.split("=")[1]).toBe(
    createHmac("sha256", secret).update(`${timestamp}.${received.body}`).digest("hex"),
  );

  // A failing endpoint uses up its attempts, then can be retried by hand.
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.getByLabel("Endpoint URL").fill(`${receiver.url}/flaky`);
  await page.getByRole("dialog").getByRole("button", { name: "Add endpoint" }).click();
  await page.getByRole("button", { name: "I have stored it" }).click();

  await page.getByRole("button", { name: `Send test event to ${receiver.url}/flaky` }).click();
  const flaky = page.getByTestId("delivery-row").filter({ hasText: "/flaky" }).first();
  await expect(flaky).toHaveAttribute("data-status", "dead", { timeout: 30_000 });
  await expect(flaky).toContainText("500");

  failing = false;
  await flaky.getByRole("button", { name: "Retry" }).click();
  await expect(flaky).toHaveAttribute("data-status", "delivered", { timeout: 30_000 });
  await expect(flaky.getByRole("button", { name: "Retry" })).toHaveCount(0);

  // Disabling is optimistic and persists; a disabled endpoint offers no test.
  const flakyRow = page.getByTestId("endpoint-row").filter({ hasText: "/flaky" });
  await flakyRow.getByRole("switch").click();
  await expect(flakyRow.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await expect(flakyRow.getByRole("button", { name: /test event/ })).toBeDisabled();
  await page.reload();
  await expect(flakyRow.getByRole("switch")).toHaveAttribute("aria-checked", "false");

  await receiver.close();
});
