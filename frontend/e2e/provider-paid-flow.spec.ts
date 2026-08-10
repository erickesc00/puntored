/**
 * E2E browser test: provider-paid flow.
 *
 * PREREQUISITE: Docker Compose must be running.
 *   docker compose up --build
 *
 * Run: npx playwright test
 */

import { test, expect } from "@playwright/test";

const OPERATOR = { username: "operator", password: "Puntored123!" };
const CONCEPT = "Pago proveedor E2E";
const AMOUNT = "750.00";
const CURRENCY = "COP";
const DUE_DATE = "2026-09-15T10:00";

const PROVIDER_STUB_URL = "http://localhost:3002";

test.describe("Provider-paid flow", () => {
  test("create as operator, then provider marks reference as PAID", async ({
    page,
    request,
  }) => {
    // ── Step 1: Login as operator ────────────────────────────────────────
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Ingresa a tu cuenta" }),
    ).toBeVisible();

    await page.getByLabel("Usuario").fill(OPERATOR.username);
    await page.locator("#password").fill(OPERATOR.password);
    await page.getByRole("button", { name: "Ingresar" }).click();

    // ── Step 2: Verify redirected to workspace ───────────────────────────
    await page.waitForURL("**/references**");
    await expect(
      page.getByRole("heading", { name: "Workspace de referencias" }),
    ).toBeVisible();
    await expect(
      page.getByRole("strong").filter({ hasText: OPERATOR.username }),
    ).toBeVisible();

    // ── Step 3: Create a reference ───────────────────────────────────────
    await page.getByRole("link", { name: "Crear referencia" }).click();
    await expect(
      page.getByRole("heading", { name: "Crear referencia de pago" }),
    ).toBeVisible();

    await page.getByLabel("Concepto").fill(CONCEPT);
    await page.getByLabel("Monto").fill(AMOUNT);
    await page.getByLabel("Moneda").selectOption(CURRENCY);
    await page.getByLabel("Fecha de Vencimiento").fill(DUE_DATE);
    await page.getByRole("button", { name: "Crear referencia" }).click();

    // ── Step 4: Verify reference appears in list ─────────────────────────
    await expect(
      page.getByRole("heading", { name: "Workspace de referencias" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Referencia creada correctamente/),
    ).toBeVisible();
    await expect(page.getByText(CONCEPT).first()).toBeVisible();

    // ── Step 5: Navigate to detail ───────────────────────────────────────
    await page
      .getByRole("link", { name: `Ver detalle de ${CONCEPT}` })
      .first()
      .click();
    await page.waitForURL("**/references/**");
    await expect(page.getByRole("heading", { name: CONCEPT })).toBeVisible();

    // Verify initial status is PENDING
    await expect(page.getByText("Pendiente").first()).toBeVisible();

    // ── Step 6: Extract backendReferenceId from the URL ──────────────────
    // The URL looks like: http://localhost:3001/references/<uuid>
    const url = page.url();
    const backendReferenceId = url.split("/references/")[1]?.split("?")[0];
    expect(backendReferenceId).toBeTruthy();

    // ── Step 7: Trigger provider callback as PAID (operator endpoint, no auth) ─
    const callbackResponse = await request.post(
      `${PROVIDER_STUB_URL}/operator/references/${backendReferenceId}/callback`,
      {
        headers: { "Content-Type": "application/json" },
        data: { status: "PAID" },
      },
    );

    expect(callbackResponse.ok()).toBeTruthy();

    // ── Step 8: Reload and verify status changed to PAID ────────────────
    await page.reload();
    await expect(page.getByRole("heading", { name: CONCEPT })).toBeVisible();
    await expect(page.getByText("Pagada").first()).toBeVisible();

    // ── Step 9: Verify history shows the PAID transition ─────────────────
    await expect(page.getByText(/PROVIDER EVENT · SUCCESS/)).toBeVisible();
  });
});
