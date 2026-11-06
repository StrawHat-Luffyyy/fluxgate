import { expect, PASSWORD, signUp, test, uniqueEmail } from "./support";
import { FRONTEND_URL } from "./constants";

test.describe("signup and login", () => {
  // Signed-out visits to protected pages and wrong passwords are 401s the UI handles.
  test.use({ expectedHttpErrors: [400, 401, 409] });

  test("signs up, lands in the new workspace, signs out and back in", async ({ page }) => {
    const email = uniqueEmail("signup");

    await page.goto("/signup");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText("Use at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Enter an email address.")).toBeVisible();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
    // Focus lands on the first problem, not somewhere the user has to find it from.
    await expect(page.getByLabel("Workspace name")).toBeFocused();

    await page.getByLabel("Workspace name").fill("Acme Payments");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create workspace" }).click();

    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByTestId("workspace-name")).toHaveText("Acme Payments");
    await expect(page.getByTestId("identity")).toContainText(email);
    await expect(page.getByTestId("identity")).toContainText("Admin");
    await expect(page.getByText("No traffic in the last 24 hours")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/keys");
    await expect(page).toHaveURL(/\/login\?next=%2Fkeys$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid credentials" })).toBeVisible();

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/keys$/);
  });

  test("shows the gateway's answer when the email is taken", async ({ page, request }) => {
    const { email } = await signUp(request, "taken");
    await page.goto("/signup");
    await page.getByLabel("Workspace name").fill("Second Workspace");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "An account with this email already exists" }),
    ).toBeVisible();
  });

  test("does not redirect to another site after login", async ({ request, browser }) => {
    const account = await signUp(request, "redirect");

    // A fresh context each time. Clearing cookies instead would race the signed-in
    // page's own 401 redirect against the next navigation.
    const signInWith = async (query: string, expectedUrl: string) => {
      const context = await browser.newContext({ baseURL: FRONTEND_URL });
      const page = await context.newPage();
      await page.goto(`/login?next=${query}`);
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password").fill(account.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page, `next=${query}`).toHaveURL(expectedUrl);
      await context.close();
    };

    const attempts = [
      "//evil.example.com",
      "/%09/evil.example.com", // A tab: URL parsing removes it, leaving //evil.example.com.
      "/%0A/evil.example.com", // A newline, likewise.
      "/%0D%0A/evil.example.com",
      "/%5Cevil.example.com", // A backslash counts as a slash.
      "https://evil.example.com/",
      "javascript:alert(1)",
    ];
    for (const next of attempts) await signInWith(next, `${FRONTEND_URL}/overview`);

    // A real path, with its query, still works.
    await signInWith(encodeURIComponent("/overview?range=7d"), `${FRONTEND_URL}/overview?range=7d`);
  });

  test("shows validation errors beside the field", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Workspace name").fill("Validation Co");
    await page.getByLabel("Password").fill(PASSWORD);

    // Caught here, the same way the gateway would.
    await page.getByLabel("Email").fill("a@b.c");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText(/Enter a valid email address/)).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();

    // Passes the check here, is refused by the gateway, and still lands on the field.
    await page.getByLabel("Email").fill("a..b@example.com");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByRole("alert").filter({ hasText: /email/i })).toHaveCount(0);
    await expect(page).toHaveURL(/\/signup$/);

    // 40 characters, but 80 bytes: more than bcrypt uses.
    await page.getByLabel("Email").fill(uniqueEmail("bytes"));
    await page.getByLabel("Password").fill("é".repeat(40));
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText(/Use 72 bytes or fewer/)).toBeVisible();
  });

  test("does not advertise the framework", async ({ request }) => {
    const res = await request.get(`${FRONTEND_URL}/login`);
    expect(res.headers()["x-powered-by"]).toBeUndefined();
  });
});
