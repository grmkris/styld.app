import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1760, height: 1000 }, deviceScaleFactor: 1 });
await page.goto("file:///tmp/design-lab/gallery.html", { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
await page.waitForTimeout(3000);
const phones = await page.$$(".phones .shot");
// Compose sheets of 4 phones side by side
for (let s = 0; s < phones.length; s += 4) {
  const group = phones.slice(s, s + 4);
  const files = [];
  for (const [j, el] of group.entries()) { const f = `/tmp/design-lab/p-${s + j}.png`; await el.screenshot({ path: f }); files.push(f); }
}
await browser.close();
console.log(phones.length);
