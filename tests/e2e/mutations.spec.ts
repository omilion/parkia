import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { invalidatedDomains } from "../../src/lib/useApiMutation";

test("toda escritura HTTP del frontend pertenece a una mutacion de Query", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
      item.isDirectory()
        ? files(join(dir, item.name))
        : /\.tsx?$/.test(item.name)
          ? [join(dir, item.name)]
          : [],
    );
  const direct: string[] = [];
  for (const file of files("src")) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ["fetch", "apiFetchJson"].includes(node.expression.getText(source))
      ) {
        const options = node.arguments[1];
        const method =
          options &&
          ts.isObjectLiteralExpression(options) &&
          (options.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name.getText(source) === "method",
          ) as ts.PropertyAssignment | undefined);
        if (method && !/['"]GET['"]/.test(method.initializer.getText(source))) {
          let parent: ts.Node | undefined = node;
          let inMutation = false;
          while (parent) {
            if (
              ts.isPropertyAssignment(parent) &&
              parent.name.getText(source) === "mutationFn"
            )
              inMutation = true;
            parent = parent.parent;
          }
          if (!inMutation)
            direct.push(
              `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
            );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(direct).toEqual([]);
  expect(invalidatedDomains("/api/contracts/1/renew")).toEqual(
    expect.arrayContaining([
      "contracts",
      "clients",
      "spaces",
      "finance",
      "documents",
    ]),
  );
  expect(invalidatedDomains("/api/visitors/1/pay")).toEqual(
    expect.arrayContaining([
      "operator",
      "spaces",
      "access",
      "dashboard",
      "finance",
    ]),
  );
});

test("un fallo de escritura conserva el formulario y permite guardar y refrescar sin recargar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: { email: "admin@parkia.local", password: "admin123" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/clients");
  await page
    .getByRole("button", { name: "Nuevo Cliente", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Registrar Nuevo Cliente" });
  await dialog.locator('input[name="name"]').fill("Cliente Query E2E");
  await dialog.locator('input[name="rut"]').fill("11111111-1");
  await dialog.locator('input[name="phone"]').fill("+56912345678");
  await dialog.locator('input[name="email"]').fill("query@example.test");
  let posts = 0;
  await page.route("**/api/clients", async (route) => {
    if (route.request().method() === "POST" && ++posts === 1)
      await route.abort("connectionfailed");
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "Guardar Cliente" }).click();
  await expect(dialog.getByRole("alert")).toContainText("No se pudo conectar");
  await expect(dialog.locator('input[name="name"]')).toHaveValue(
    "Cliente Query E2E",
  );
  await expect(
    dialog.getByRole("button", { name: "Guardar Cliente" }),
  ).toBeEnabled();
  expect(posts).toBe(1);
  await dialog.getByRole("button", { name: "Guardar Cliente" }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toBe(2);
  await expect(
    page
      .getByRole("region", { name: "Clientes", exact: true })
      .getByRole("button", { name: "Cliente Query E2E", exact: true }),
  ).toBeVisible();
});
