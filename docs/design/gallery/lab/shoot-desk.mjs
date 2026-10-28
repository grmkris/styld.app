import { chromium } from "/home/kristjan/code/agent-jobs/node_modules/playwright-core/index.mjs";
const browser = await chromium.launch({ executablePath: "/home/kristjan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://100.105.51.45:8793/index.html", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
for (const id of ["gallery", "mono"]) {
  await (await page.$(`#${id} .desk`)).screenshot({ path: `/tmp/design-lab/${id}-desk.png` });
}
await (await page.$(`#mono .frames`)).screenshot({ path: `/tmp/design-lab/mono-phones.png` });
await browser.close();
console.log("ok");
