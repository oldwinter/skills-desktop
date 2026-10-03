import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { createPackagedQaFixture } from "../packaged-ui-qa/fixture.mjs";
import { launchPackagedElectron } from "../packaged-ui-qa/launch.mjs";

const artifactRoot = resolve("visual-qa/dual-ui");
const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
await mkdir(artifactRoot, { recursive: true });
const fixture = await createPackagedQaFixture();
let session;

async function waitForInventory(page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(`document.body?.textContent?.includes("qa-project-skill")`)) return;
    } catch (error) {
      // The first document can be replaced while Electron finishes startup.
      if (!error.message.includes("execution context")) throw error;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Fixture inventory did not become ready.");
}

try {
  session = await launchPackagedElectron({ fixture });
  const { page } = session;
  await waitForInventory(page);
  await page.setMediaFeature("prefers-reduced-motion", "reduce");
  const routes = ["inventory", "comparison", "collections", "targets", "publish", "studio", "recovery", "about"];
  const measurements = [];
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize(width, 900);
    for (const route of routes) {
      await page.evaluate(`document.querySelector('[data-nav-view="${route}"]').click()`);
      await page.waitFor(`document.querySelector('[data-nav-view="${route}"]').getAttribute('aria-current') === 'page'`, route);
      const layout = await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const main = document.querySelector('main');
        const evidence = document.querySelector('.evidence-list');
        resolve({
          documentWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          heading: main?.querySelector('h1')?.textContent,
          mainWidth: main?.getBoundingClientRect().width,
          evidenceClipped: evidence ? evidence.scrollHeight > evidence.clientHeight + 1 : false,
          evidenceOverflow: evidence ? getComputedStyle(evidence).overflowY : null,
          searchHeight: document.querySelector('.search-control')?.getBoundingClientRect().height,
        });
      })))`);
      assert.ok(layout.documentWidth <= layout.viewport, `${route} overflows at ${width}px`);
      assert.ok(layout.heading && layout.mainWidth > 0, `${route} is not visible`);
      if (route === "inventory") {
        assert.equal(layout.evidenceClipped, false, `Skill evidence must not be a clipped nested scroller at ${width}px`);
        assert.equal(layout.evidenceOverflow, "visible");
        assert.ok(layout.searchHeight >= 40, `Search target collapsed at ${width}px`);
      }
      measurements.push({ width, route, ...layout });
      const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(resolve(artifactRoot, `desktop-${route}-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
  }
  await page.setViewportSize(1440, 900);
  for (const appearance of ["light", "dark", "high-contrast"]) {
    await page.evaluate(`document.querySelector('[data-nav-view="about"]').click()`);
    await page.waitFor(`document.querySelector('[data-testid="preferences-panel"] select') !== null`, "preferences");
    await page.evaluate(`(() => {
      const select = [...document.querySelectorAll('[data-testid="preferences-panel"] select')].find(s => [...s.options].some(o => o.value === 'high-contrast'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${appearance}');
      select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await page.waitFor(`document.documentElement.dataset.appearance === '${appearance}'`, appearance);
    await page.evaluate(`document.querySelector('[data-nav-view="inventory"]').click()`);
    await page.evaluate(axe);
    const violations = await page.evaluate(`axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r => r.violations.map(v => ({id:v.id,nodes:v.nodes.map(n => n.target)})))`);
    assert.deepEqual(violations, [], `${appearance} inventory accessibility`);
    const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(artifactRoot, `desktop-inventory-${appearance}.png`), Buffer.from(screenshot.data, "base64"));
  }
  assert.deepEqual(session.errors, [], "Renderer errors");
  await writeFile(resolve(artifactRoot, "desktop-layout.json"), `${JSON.stringify(measurements, null, 2)}\n`);
  console.log(`desktop craft QA passed: ${measurements.length} route/viewport checks`);
} finally {
  await session?.close();
  await fixture.cleanup();
}
