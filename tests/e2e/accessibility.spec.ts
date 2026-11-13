import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const routes = [
  "/",
  "/operar",
  "/access",
  "/spaces",
  "/clients",
  "/contracts",
  "/tasks",
  "/documents",
  "/staff",
  "/audit",
  "/settings",
  "/settings?tab=sii",
  "/settings?tab=tariffs",
  "/validar",
  "/restablecer",
  "/registro",
  "/verificar-correo",
  "/inicio",
  "/settings?tab=payments",
  "/finanzas/pagos",
  "/finanzas/cobranza",
  "/finanzas/banco",
  "/finanzas/gastos",
  "/finanzas/reportes",
  "/finanzas/cierres",
  "/finanzas/documentos-tributarios",
];
for (const width of [360, 768]) {
  test(`accesibilidad de todas las rutas a ${width}px`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 900 });
    expect(
      (
        await page.request.post("/api/auth/login", {
          data: { email: "admin@parkia.local", password: "admin123" },
        })
      ).ok(),
    ).toBeTruthy();
    const failures: unknown[] = [];
    page.on("pageerror", (error) =>
      failures.push({ runtimeError: error.message }),
    );
    for (const route of routes) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading").first()).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      if (result.violations.length)
        failures.push({
          route,
          violations: result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        });
    }
    expect(failures).toEqual([]);
  });
}
test("accesibilidad del modo operador con rol guardia", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.request.post("/api/auth/login", {
    data: { email: "guardia@parkia.local", password: "Cambiar123!" },
  });
  await page.goto("/operar", { waitUntil: "networkidle" });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
