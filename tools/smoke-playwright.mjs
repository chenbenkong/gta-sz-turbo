// Headless visual smoke test with Playwright + Edge.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  // fallback to npx cache
  const p = 'C:/Users/moli/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core';
  ({ chromium } = require(p));
}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = process.argv[3] || 'output/playwright';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const logs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  logs.push(`[${m.type()}] ${m.text()}`);
  if (m.type() === 'error') errors.push(m.text());
});

console.log('goto', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// wait for loading to finish or error
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(OUT, '01-loading-or-game.png'), fullPage: false });

// wait more for city gen
await page.waitForTimeout(5000);
await page.screenshot({ path: path.join(OUT, '02-game.png'), fullPage: false });

// drive a bit
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
await page.screenshot({ path: path.join(OUT, '03-driving.png'), fullPage: false });

// on-foot
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '05-onfoot.png'), fullPage: false });
await page.keyboard.down('KeyW');
await page.waitForTimeout(800);
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyF'); // back in car

// plane
await page.keyboard.press('KeyB');
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '06-plane.png'), fullPage: false });
await page.keyboard.press('KeyB'); // land

// pixel sanity on DAY frame (before night)
const statsDay = await page.evaluate(() => {
  const c = document.getElementById('game');
  const gl = c.getContext('webgl2');
  if (!gl) return { ok: false, reason: 'no webgl2' };
  const w = Math.min(200, c.width), h = Math.min(120, c.height);
  const x = Math.floor((c.width - w) / 2), y = Math.floor((c.height - h) / 2);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const colors = new Set();
  let sum = 0, sum2 = 0, dark = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    colors.add((r << 16) | (g << 8) | b);
    const l = (r + g + b) / 3;
    sum += l; sum2 += l * l;
    if (l < 8) dark++;
  }
  const n = px.length / 4;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return {
    ok: true,
    colorCount: colors.size,
    mean: Math.round(mean),
    std: Math.round(std * 10) / 10,
    darkRatio: Math.round((dark / n) * 1000) / 1000,
    fps: window.__OPEN_ROADS__?.fps ?? null,
  };
});

// night
await page.keyboard.press('KeyN');
await page.waitForTimeout(1500);
await page.keyboard.press('KeyN');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '04-night.png'), fullPage: false });

const stats = await page.evaluate(() => {
  const c = document.getElementById('game');
  const gl = c.getContext('webgl2');
  if (!gl) return { ok: false, reason: 'no webgl2' };
  const w = Math.min(200, c.width), h = Math.min(120, c.height);
  const x = Math.floor((c.width - w) / 2), y = Math.floor((c.height - h) / 2);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const colors = new Set();
  let sum = 0, sum2 = 0, dark = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    colors.add((r << 16) | (g << 8) | b);
    const l = (r + g + b) / 3;
    sum += l; sum2 += l * l;
    if (l < 8) dark++;
  }
  const n = px.length / 4;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return {
    ok: true,
    colorCount: colors.size,
    mean: Math.round(mean),
    std: Math.round(std * 10) / 10,
    darkRatio: Math.round((dark / n) * 1000) / 1000,
    fps: window.__OPEN_ROADS__?.fps ?? null,
  };
});

const report = { errors, statsDay, statsNight: stats, logsTail: logs.slice(-30) };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('day', JSON.stringify(statsDay));
console.log('night', JSON.stringify(stats));
console.log('errors', errors.length, errors.slice(0, 5));

await browser.close();

if (errors.length > 0) {
  console.error('FAIL: page errors');
  process.exit(1);
}
if (!statsDay.ok || statsDay.colorCount < 20 || statsDay.std < 4) {
  console.error('FAIL: day frame looks flat/empty', statsDay);
  process.exit(2);
}
console.log('PASS');
