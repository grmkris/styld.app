import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
await page.goto("file:///tmp/design-lab/gallery.html", { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
await page.waitForTimeout(3000);
const phones = await page.$$(".phones .shot");
for (let i = 0; i < phones.length; i += 4) {
  const box0 = await phones[i].boundingBox();
  const last = phones[Math.min(i + 3, phones.length - 1)];
  const box1 = await last.boundingBox();
  await page.screenshot({ path: `/tmp/design-lab/g-phones-${i / 4}.png`, fullPage: true, clip: { x: box0.x, y: box0.y, width: box1.x + box1.width - box0.x, height: box0.height } });
}
const desks = await page.$$(".desks .shot");
for (let i = 0; i < desks.length; i++) await desks[i].screenshot({ path: `/tmp/design-lab/g-desk-${i}.png` });
await browser.close();
console.log("phones", phones.length, "desks", desks.length);
