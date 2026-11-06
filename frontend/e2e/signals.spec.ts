import { createHmac } from "node:crypto";
import {
  expect,
  FOREST_MESSAGE,
  guardMessage,
  logIn,
  postAlert,
  signUp,
  startServer,
  tenantIdOf,
  test,
} from "./support";

test("the anomaly feed explains an alert and triages it", async ({ page, request }) => {
  await logIn(page, await signUp(request, "anomalies"));
  const tenantId = await tenantIdOf(page);

  await page.goto("/anomalies");
  await expect(page.getByText("Nothing here")).toBeVisible();

  await postAlert(request, tenantId);
  // Sent twice with the same id, it stays one row: redelivery from Kafka is harmless.
  const requestId = "00000000-0000-4000-8000-000000000001";
  const redelivered = {
    requestId,
    topFeature: "requestByteSize",
    topFeatureValue: 8_388_608,
    message: "Isolation Forest flagged abnormal traffic, driven mainly by request size (8,388,608 bytes)",
  };
  await postAlert(request, tenantId, redelivered);
  await postAlert(request, tenantId, redelivered);

  await page.reload();
  const rows = page.getByTestId("anomaly-row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Anomalies.*Open/ })).toBeVisible();

  const row = rows.filter({ hasText: FOREST_MESSAGE });
  await expect(row).toContainText("4.20 s");
  await row.getByRole("button", { name: FOREST_MESSAGE }).click();

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
  await expect(rows.first()).toContainText("request size (8,388,608 bytes)");

  await page.getByRole("radio", { name: "Acknowledged" }).click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("anomaly-row").filter({ hasText: FOREST_MESSAGE })).toContainText("Acknowledged");
});

test("a range guard alert leads with the guard, and labels the bars as the model's view", async ({
  page,
  request,
}) => {
  await logIn(page, await signUp(request, "guard"));
  const tenantId = await tenantIdOf(page);
  const guard = {
    detector: "range_guard",
    topFeature: "responseByteSize",
    topFeatureValue: 52_428_800,
    attribution: { responseByteSize: 0.41, latencyMs: 0.18, requestByteSize: 0.05 },
    features: { latencyMs: 212, responseByteSize: 52_428_800, requestByteSize: 340 },
  };
  await postAlert(request, tenantId, { ...guard, score: 0.012, message: guardMessage("did not flag it") });
  await postAlert(request, tenantId, { ...guard, score: -0.03, message: guardMessage("also flagged it") });

  await page.goto("/anomalies");
  const normal = page.getByTestId("anomaly-row").filter({ hasText: "did not flag it" });
  await normal.getByRole("button").first().click();

  const why = normal.getByRole("region", { name: "Why this was flagged" });
  await expect(why).toContainText("range guard");
  await expect(why).toContainText("exceeds the range guard limit 31,457,100 bytes");
  // The limit is the reason, so the bars are not in this section.
  await expect(why.getByRole("list", { name: "SHAP attribution by feature" })).toHaveCount(0);

  const model = normal.getByRole("region", { name: "What the Isolation Forest saw" });
  await expect(model).toContainText("not the reason for this alert");
  await expect(model).toContainText("did not flag this request");
  await expect(model).toContainText("isolation-tree path");
  await expect(model).not.toContainText("log scale");
  await expect(model.getByRole("list", { name: "SHAP attribution by feature" })).toBeVisible();
  await expect(normal).toContainText("0 or above: normal to the model");

  const agreed = page.getByTestId("anomaly-row").filter({ hasText: "also flagged it" });
  await agreed.getByRole("button").first().click();
  await expect(agreed.getByRole("region", { name: "What the Isolation Forest saw" })).toContainText(
    "also flagged this request",
  );
  await expect(agreed).toContainText("Below 0: anomalous to the model");
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
