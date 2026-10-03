import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const session = `barnacle-craft-${process.pid}`;
const artifacts = resolve("visual-qa/dual-ui");
await mkdir(artifacts, { recursive: true });
function browser(...args) {
  const output = execFileSync("agent-browser", ["--session", session, "--json", ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(output);
  assert.equal(result.success, true, result.error);
  return result.data;
}
function evaluate(script) {
  const output = execFileSync("agent-browser", ["--session", session, "--json", "eval", "--stdin"], { input: script, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(output);
  assert.equal(result.success, true, result.error);
  return result.data.result;
}
const measurements = [];
try {
  browser("open", process.env.UI_CRAFT_URL ?? "http://127.0.0.1:4173");
  browser("set", "media", "reduced-motion");
  for (const locale of ["en", "zh-CN"]) {
    if (evaluate("document.documentElement.lang") !== locale) browser("click", ".site-nav .locale-switch");
    browser("wait", "--fn", `document.documentElement.lang === '${locale}'`);
    for (const width of [1440, 1024, 390]) {
      browser("set", "viewport", String(width), "900");
      evaluate("window.scrollTo({top:0,behavior:'instant'})");
      browser("wait", "--fn", "window.scrollY === 0");
      browser("wait", "--fn", "document.fonts.status === 'loaded'");
      evaluate(axe);
      const report = evaluate(`(async () => {
        await Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); }));
        const scan = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } });
        const figure = document.querySelector('.hero figure').getBoundingClientRect();
        return {
          width:innerWidth, pageWidth:document.documentElement.scrollWidth,
          images:[...document.images].every(image => image.complete && image.naturalWidth > 0),
          figureBottom:figure.bottom,
          violations:scan.violations.map(v => ({id:v.id,impact:v.impact,nodes:v.nodes.map(n => ({target:n.target,summary:n.failureSummary}))})),
          brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].map(a => a.hash).filter(hash => !document.getElementById(hash.slice(1))),
        };
      })()`);
      measurements.push({ locale, ...report });
      assert.ok(report.pageWidth <= width, `Page overflow at ${locale}/${width}`);
      assert.ok(report.images, "Broken screenshot or icon");
      assert.deepEqual(report.brokenAnchors, [], "Broken anchor");
      assert.deepEqual(report.violations, [], `axe violations at ${locale}/${width}`);
      if (width === 1440) assert.ok(report.figureBottom > 0 && report.figureBottom <= 850, "Product demonstration not visible in desktop first fold");
      browser("screenshot", resolve(artifacts, `website-${locale}-${width}.png`));
      if (width === 390) {
        browser("click", ".site-nav__menu-button");
        assert.equal(evaluate("document.querySelector('.site-nav__menu-button').getAttribute('aria-expanded')"), "true");
        browser("focus", ".site-nav__menu-panel a");
        browser("press", "Escape");
        assert.equal(evaluate("document.querySelector('.site-nav__menu-button').getAttribute('aria-expanded')"), "false");
        assert.ok(evaluate("document.activeElement.matches('.site-nav__menu-button')"));
      }
    }
    evaluate("document.querySelector('.pill-group').scrollIntoView({block:'center',behavior:'instant'})");
    browser("focus", '.pill-group button:nth-child(2)');
    browser("press", "Space");
    browser("wait", "--fn", "document.querySelector('.pill-group button:nth-child(2)').getAttribute('aria-pressed') === 'true'");
    assert.equal(evaluate("document.querySelector('.pill-group button:nth-child(2)').getAttribute('aria-pressed')"), "true");
    assert.ok(evaluate("document.querySelector('.hero figure').textContent.includes('~/code/api')"));
    browser("focus", '.pill-group button:nth-child(3)');
    browser("press", "Space");
    browser("wait", "--fn", "document.querySelector('.pill-group button:nth-child(3)').getAttribute('aria-pressed') === 'true'");
    assert.ok(evaluate("document.querySelector('.hero figure').textContent.includes('~/notes')"));
    browser("focus", '[role="tab"][aria-selected="true"]');
    browser("press", "End");
    assert.equal(evaluate("document.activeElement.id"), "cli-tab-update");
    browser("press", "Home");
    assert.equal(evaluate("document.activeElement.id"), "cli-tab-verify");
    evaluate(`(() => {
      window.craftCopyObserved = false;
      const button = document.querySelector('.terminal__copy');
      const observer = new MutationObserver(() => {
        if (button.textContent.includes('${locale === "en" ? "copied" : "已复制"}')) {
          window.craftCopyObserved = true;
          observer.disconnect();
        }
      });
      observer.observe(button, {childList:true,subtree:true,characterData:true});
    })()`);
    browser("click", ".terminal__copy");
    browser("wait", "--fn", "window.craftCopyObserved === true");
    assert.equal(evaluate("document.querySelectorAll('[role=tab][tabindex=\"0\"]').length"), 1);
    assert.ok(evaluate("[...document.querySelectorAll('a[href*=\"releases/download\"]')].every(a => /preview-v0\\.1\\.0-[a-f0-9]{40}/.test(a.href))"));
  }
  console.log(`website craft QA passed: ${measurements.length} locale/viewport checks; demo, menu, keyboard tabs, clipboard, images, anchors and axe`);
} finally {
  await writeFile(resolve(artifacts, "website-layout.json"), `${JSON.stringify(measurements, null, 2)}\n`);
  browser("close");
}
