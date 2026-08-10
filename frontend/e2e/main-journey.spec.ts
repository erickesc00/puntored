/**
 * E2E browser test for the main user journey.
 *
 * PREREQUISITE: Docker Compose must be running.
 *   docker compose up --build
 *
 * Run: npx playwright test
 */

import { test, expect } from "@playwright/test";

const OPERATOR = { username: "operator", password: "Puntored123!" };
const SUPERVISOR = { username: "supervisor", password: "Puntored123!" };

const CONCEPT = "Matrícula agosto E2E";
const AMOUNT = "1250.50";
const CURRENCY = "MXN";
const DUE_DATE = "2026-08-20T10:00";

test.describe("Main user journey", () => {
  test("create reference as operator, view in list, then cancel as supervisor", async ({
    page,
  }) => {
    // ── Step 1-2: Login as operator ──────────────────────────────────────
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Ingresa a tu cuenta" }),
    ).toBeVisible();

    await page.getByLabel("Usuario").fill(OPERATOR.username);
    await page.locator("#password").fill(OPERATOR.password);
    await page.getByRole("button", { name: "Ingresar" }).click();

    // ── Step 3: Verify redirected to main page ───────────────────────────
    await page.waitForURL("**/references**");
    await expect(
      page.getByRole("heading", { name: "Workspace de referencias" }),
    ).toBeVisible();
    // Verify the operator header is visible (username is rendered as <strong> in the layout)
    await expect(
      page.getByRole("strong").filter({ hasText: OPERATOR.username }),
    ).toBeVisible();

    // ── Step 4: Create a reference ───────────────────────────────────────
    await page.getByRole("link", { name: "Crear referencia" }).click();
    await expect(
      page.getByRole("heading", { name: "Crear referencia de pago" }),
    ).toBeVisible();

    await page.getByLabel("Concepto").fill(CONCEPT);
    await page.getByLabel("Monto").fill(AMOUNT);
    await page.getByLabel("Moneda").selectOption(CURRENCY);
    await page.getByLabel("Fecha de Vencimiento").fill(DUE_DATE);

    await page.getByRole("button", { name: "Crear referencia" }).click();

    // ── Step 5: Verify the new reference appears in the list ────────────
    await expect(
      page.getByRole("heading", { name: "Workspace de referencias" }),
    ).toBeVisible();
    // The success banner shows the created ID
    await expect(
      page.getByText(/Referencia creada correctamente/),
    ).toBeVisible();
    // The concept should appear in the table or card list
    await expect(page.getByText(CONCEPT).first()).toBeVisible();

    // ── Step 6: Click on the new reference to view detail ────────────────
    await page
      .getByRole("link", { name: `Ver detalle de ${CONCEPT}` })
      .first()
      .click();
    // Wait for detail page to fully load (the concept is the h1 after data fetch)
    await page.waitForURL("**/references/**");
    await expect(page.getByRole("heading", { name: CONCEPT })).toBeVisible();

    // ── Step 7: Verify detail shows reference data ───────────────────────
    await expect(page.getByText("Resumen de referencia")).toBeVisible();
    await expect(page.getByText("Historial y auditoría")).toBeVisible();
    // The detail should show the status pill (Pendiente for a new reference)
    await expect(page.getByText("Pendiente").first()).toBeVisible();

    // ── Step 8: Click logout ─────────────────────────────────────────────
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    // Should land back on login
    await expect(
      page.getByRole("heading", { name: "Ingresa a tu cuenta" }),
    ).toBeVisible();

    // ── Step 9-10: Login as supervisor and find the reference ────────────
    await page.getByLabel("Usuario").fill(SUPERVISOR.username);
    await page.locator("#password").fill(SUPERVISOR.password);
    await page.getByRole("button", { name: "Ingresar" }).click();

    await page.waitForURL("**/references**");
    await expect(
      page.getByRole("heading", { name: "Workspace de referencias" }),
    ).toBeVisible();
    await expect(
      page.getByRole("strong").filter({ hasText: SUPERVISOR.username }),
    ).toBeVisible();

    // The reference should still be in the list
    await expect(page.getByText(CONCEPT).first()).toBeVisible();

    // ── Step 11: Click detail, then cancel ───────────────────────────────
    await page
      .getByRole("link", { name: `Ver detalle de ${CONCEPT}` })
      .first()
      .click();
    await page.waitForURL("**/references/**");
    await expect(page.getByRole("heading", { name: CONCEPT })).toBeVisible();

    // Supervisor sees the "Cancelar referencia" button
    const cancelButton = page.getByRole("button", {
      name: "Cancelar referencia",
    });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Confirmation dialog appears
    await expect(
      page.getByRole("alertdialog", { name: "Cancelar referencia de pago" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();

    // ── Step 12: Verify cancellation succeeded ───────────────────────────
    await expect(
      page.getByText(/Referencia cancelada correctamente/),
    ).toBeVisible();
    // The status should now show "Cancelada"
    await expect(page.getByText("Cancelada").first()).toBeVisible();
    // The history should include a successful cancellation entry
    await expect(page.getByText(/CANCEL REFERENCE · SUCCESS/)).toBeVisible();
  });
});
