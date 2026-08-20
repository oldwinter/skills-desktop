import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { _electron as electron } from "playwright";

const electronApp = await electron.launch({ args: ["."], cwd: process.cwd() });

try {
  const page = await electronApp.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.waitForSelector(".skills-table, .error-state", { timeout: 70_000 });
  const evidence = await page.evaluate(() => ({
    apiType: typeof window.skillsDesktop,
    caption: document.querySelector(".section-caption span")?.textContent ?? "",
    error: document.querySelector(".error-state")?.textContent ?? "",
    rows: document.querySelectorAll(".skills-table tbody tr").length,
    version: document.querySelector(".scope-footer")?.textContent ?? "",
  }));

  assert.equal(evidence.apiType, "object", "sandboxed preload must expose window.skillsDesktop");
  assert.equal(evidence.error, "", `inventory rendered an error: ${evidence.error}`);
  assert.ok(evidence.rows > 0, "real npx skills inventory must render at least one row");
  assert.match(evidence.caption, new RegExp(`^显示 ${evidence.rows} 项$`));
  assert.match(evidence.version, /npx skills \d+\.\d+\.\d+/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);

  await mkdir("visual-qa", { recursive: true });
  await page.screenshot({ path: "visual-qa/electron-local-real.png" });
  console.log(JSON.stringify(evidence));
} finally {
  await electronApp.close();
}
