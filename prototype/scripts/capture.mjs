import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const prototypeRoot = path.resolve(currentDir, "..");
const captureDir = path.join(prototypeRoot, "visual-qa");
const variants = ["A", "B", "C"];
const views = ["inventory", "compare", "collections"];
const viewports = [
  { height: 900, name: "desktop", width: 1280 },
  { height: 900, name: "tablet", width: 768 },
  { height: 812, name: "mobile", width: 375 },
];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await fs.mkdir(captureDir, { recursive: true });
const previewServer = await preview({
  root: prototypeRoot,
  preview: { host: "127.0.0.1", port: 4179, strictPort: true },
});
const baseUrl = previewServer.resolvedUrls.local[0];
console.log(`capture:base ${baseUrl}`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});

async function loadCase(variant, view, viewport) {
  await page.setViewportSize({ height: viewport.height, width: viewport.width });
  await page.goto(`${baseUrl}?prototype=1&variant=${variant}&view=${view}`, { waitUntil: "networkidle" });
  try {
    await page.waitForSelector(".prototype-shell", { timeout: 8_000 });
  } catch (error) {
    console.error(`capture:load-failed ${variant}-${view}-${viewport.name}`, browserErrors);
    throw error;
  }
  await wait(450);

  const metrics = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, input, select")]
      .map((element) => (element.matches("input, select") ? element.closest("label") || element : element))
      .filter((element, index, elements) => elements.indexOf(element) === index)
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const smallControls = controls
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: Math.round(rect.height), label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40) || element.tagName, width: Math.round(rect.width) };
      })
      .filter(({ height, width }) => height < 40 || width < 40);

    return {
      appClientWidth: document.querySelector("#app")?.clientWidth || 0,
      appScrollHeight: document.querySelector("#app")?.scrollHeight || 0,
      appScrollWidth: document.querySelector("#app")?.scrollWidth || 0,
      bodyHeight: document.body.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        (document.querySelector("#app")?.scrollWidth || 0) > (document.querySelector("#app")?.clientWidth || 0),
      smallControls,
      title: document.querySelector("h1")?.textContent || "",
      variant: new URLSearchParams(location.search).get("variant"),
      view: new URLSearchParams(location.search).get("view"),
    };
  });
  const filename = `${variant}-${view}-${viewport.name}.png`;
  await page.screenshot({ path: path.join(captureDir, filename) });
  const captures = [{ filename, height: viewport.height, metrics, width: viewport.width }];

  if (viewport.name === "mobile") {
    const fullFilename = `${variant}-${view}-mobile-full.png`;
    const image = await page.screenshot({ fullPage: true, path: path.join(captureDir, fullFilename) });
    const fullHeight = image.readUInt32BE(20);
    captures.push({ filename: fullFilename, height: fullHeight, metrics, width: viewport.width });
  }
  return captures;
}

async function captureInteraction() {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`${baseUrl}?prototype=1&variant=A&view=inventory`, { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  await wait(450);
  await page.screenshot({ path: path.join(captureDir, "interaction-rest.png") });

  const input = page.locator("[data-search]");
  await input.focus();
  await page.locator("[data-refresh]").hover();
  await page.screenshot({ path: path.join(captureDir, "interaction-focus-hover.png") });

  const beforeVariant = await page.evaluate(() => new URLSearchParams(location.search).get("variant"));
  await input.press("ArrowRight");
  const whileEditing = await page.evaluate(() => new URLSearchParams(location.search).get("variant"));
  await input.blur();
  await page.keyboard.press("ArrowRight");
  const afterVariant = await page.evaluate(() => new URLSearchParams(location.search).get("variant"));
  await page.locator('[data-view="compare"]').click();
  await page.locator('[data-compare-target="right"]').selectOption("design-claude");
  const targetsBeforeSwap = await page.locator("[data-compare-target]").evaluateAll((elements) => elements.map((element) => element.value));
  await page.locator("[data-swap-targets]").click();
  const targetsAfterSwap = await page.locator("[data-compare-target]").evaluateAll((elements) => elements.map((element) => element.value));
  await page.locator('[data-command="reconcile"]').click();
  await wait(60);
  await page.screenshot({ path: path.join(captureDir, "interaction-mid.png") });
  await wait(180);
  await page.screenshot({ path: path.join(captureDir, "interaction-settled.png") });

  const compareCommand = await page.locator(".command-preview code").first().textContent();

  await page.locator('[data-view="inventory"]').click();
  await page.locator('.filter-rail [data-scope="global"]').click();
  const activeScope = await page.locator(".filter-rail .filter-row.is-active").textContent();

  await page.goto(`${baseUrl}?prototype=1&variant=C&view=collections`, { waitUntil: "networkidle" });
  await page.locator('[data-collection-target="build-box:pi"]').check();
  const remoteTargetStatus = await page.locator('[data-collection-target="build-box:pi"]').locator("xpath=..").locator(".target-status").textContent();
  const collectionCommand = await page.locator(".command-preview code").textContent();
  await page.locator('[data-command="update-collection"]').click();
  const collectionUpdateCommand = await page.locator(".command-preview code").textContent();
  await page.screenshot({ path: path.join(captureDir, "interaction-collection-update.png") });

  await page.setViewportSize({ height: 812, width: 375 });
  await page.goto(`${baseUrl}?prototype=1&variant=A&view=inventory`, { waitUntil: "networkidle" });
  await page.locator('.mobile-view-nav [data-view="compare"]').click();
  const mobileNavigation = {
    title: await page.locator("h1").first().textContent(),
    view: await page.evaluate(() => new URLSearchParams(location.search).get("view")),
  };

  return {
    activeScope: activeScope?.trim(),
    afterVariant,
    beforeVariant,
    collectionCommand,
    collectionUpdateCommand,
    compareCommand,
    mobileNavigation,
    remoteTargetStatus,
    targetsAfterSwap,
    targetsBeforeSwap,
    whileEditing,
  };
}

const captures = [];
try {
  for (const variant of variants) {
    for (const view of views) {
      for (const viewport of viewports) {
        captures.push(...(await loadCase(variant, view, viewport)));
      }
    }
  }

  await page.setViewportSize({ height: 751, width: 1200 });
  await page.goto(`${baseUrl}?prototype=1&variant=A&view=inventory`, { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  await wait(450);
  await page.screenshot({ path: path.join(captureDir, "A-inventory-reference-size.png") });

  const interaction = await captureInteraction();
  const missingTitles = captures.filter(({ metrics }) => !metrics.title).map(({ filename }) => filename);
  const overflow = captures.filter(({ metrics }) => metrics.horizontalOverflow).map(({ filename }) => filename);
  const smallControls = captures
    .filter(({ metrics }) => metrics.smallControls.length)
    .map(({ filename, metrics }) => ({ controls: metrics.smallControls, filename }));
  const wrongRoute = captures
    .filter(({ filename, metrics }) => !filename.startsWith(`${metrics.variant}-${metrics.view}-`))
    .map(({ filename }) => filename);
  await fs.writeFile(
    path.join(captureDir, "report.json"),
    `${JSON.stringify({ browserErrors, captures, interaction, missingTitles, overflow, smallControls, wrongRoute }, null, 2)}\n`,
  );
} finally {
  await browser.close();
  await previewServer.close();
}
