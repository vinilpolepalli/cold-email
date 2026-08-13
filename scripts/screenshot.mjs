#!/usr/bin/env node
// Screenshot a running page and report layout problems. Used to check the UI
// against the design reference without leaving the terminal.
//
//   node scripts/screenshot.mjs <url> <out.png> [full|mobile]
//
// full   capture the whole scrollable page instead of the viewport
// mobile render at 390x844 instead of 1440x900
//
// Requires Chromium at PLAYWRIGHT_BROWSERS_PATH (preinstalled in CI images).
// Prints the page height and flags horizontal overflow, which is the failure
// this catches most often.

import { chromium } from 'playwright-core';

const [url, out, mode = 'viewport'] = process.argv.slice(2);
if (!url || !out) {
  console.error('Usage: node scripts/screenshot.mjs <url> <out.png> [full|mobile]');
  process.exit(1);
}

const mobile = mode === 'mobile';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const context = await browser.newContext({
  viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: mode === 'full' });

  const { overflows, height } = await page.evaluate(() => ({
    overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
    height: document.body.scrollHeight,
  }));
  console.log(`${out} | ${mobile ? 390 : 1440}px wide | page height ${height}px`);
  if (overflows) {
    console.error('FAIL: the page scrolls horizontally at this width');
    process.exitCode = 1;
  }
} finally {
  await context.close();
  await browser.close();
}
