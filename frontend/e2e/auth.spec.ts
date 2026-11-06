import { expect, PASSWORD, signUp, test, uniqueEmail } from "./support";

test.describe("signup and login", () => {
  // Signed-out visits to protected pages and wrong passwords are 401s the UI handles.
  test.use({ expectedHttpErrors: [401, 409] });

  test("signs up, lands in the new workspace, signs out and back in", async ({ page }) => {
    const email = uniqueEmail("signup");

    await page.goto("/signup");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText("Use at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Enter an email address.")).toBeVisible();
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);

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

  test("does not redirect to another site after login", async ({ page, request }) => {
    const account = await signUp(request, "redirect");
    await page.goto("/login?next=//evil.example.com");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/localhost:3006\/overview$/);
  });
});
