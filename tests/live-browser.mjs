import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPreview } from '../scripts/preview.mjs';

// This optional smoke check contacts public Kraken endpoints; deterministic transport
// behavior is covered by live.test.ts and does not depend on exchange availability.
const report = { startedAt: new Date().toISOString(), checks: [], websocketChannels: {}, consoleErrors: [], requestFailures: [], limitations: ['Public exchange availability and the browser network are external dependencies.', 'Message delay estimates include device clock skew; this is not an RTT benchmark.', 'No sentiment-provider credentials or real trade execution are exercised.'] };
const check = value => { report.checks.push(value); console.log(`PASS ${value}`); };
const preview = await createPreview();
const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_CHROMIUM ? { executablePath: process.env.PULSE_CHROMIUM } : {}), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => report.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try { const message = JSON.parse(String(frame.payload)); if (message.channel) report.websocketChannels[message.channel] = (report.websocketChannels[message.channel] ?? 0) + 1; } catch { /* Browser frame record need not contain JSON. */ }
  }));
  await page.goto(`${preview.url}#connections`);
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  const connect = page.getByRole('button', { name: 'Connect market stream', exact: true });
  const box = await connect.boundingBox(); assert.ok(box && box.y + box.height <= 844, 'Connect market stream is visible in the first 390 px screen');
  check('390 px connection screen exposes the product and Connect market stream action');
  await connect.click();
  await expect(page.locator('.connection-status [role="status"]')).toHaveText('Streaming', { timeout: 25_000 });
  check('Real Kraken WebSocket connection reaches Streaming without credentials or a service');
  await expect(page.getByText(/\d+ candles ready/)).toBeVisible({ timeout: 15_000 });
  const history = await page.getByText(/\d+ candles ready/).innerText();
  report.closedHistory = history;
  assert.ok(Number.parseInt(history, 10) >= 30);
  check('Browser CORS allows real REST history hydration with at least 30 closed candles');
  await page.getByRole('button', { name: 'Pause stream', exact: true }).last().click();
  await expect(page.locator('.connection-status [role="status"]')).toHaveText('Paused');
  await expect(page.getByText('Stream paused. Prices are frozen; signals are held.', { exact: true })).toBeVisible();
  check('Pause immediately exposes held signal state');
  await page.getByRole('button', { name: 'Resume stream', exact: true }).last().click();
  await expect(page.locator('.connection-status [role="status"]')).toHaveText('Streaming', { timeout: 25_000 });
  check('Resume resubscribes and recovers genuine market updates');
  await page.getByRole('link', { name: 'Open market overview', exact: true }).click();
  await expect(page.getByLabel('Chart asset')).toHaveValue('BTC');
  await expect(page.getByText('Some enabled sources are unavailable')).toBeVisible();
  await expect(page.getByText('Wait for data', { exact: true })).toBeVisible();
  check('Price-only live workspace clearly withholds signals while sentiment sources are unavailable');
  await page.getByLabel('Chart asset').selectOption('ETH');
  await expect(page.getByLabel('Chart asset')).toHaveValue('ETH', { timeout: 25_000 });
  await expect(page.locator('.chart-caption')).toContainText('Kraken WebSocket');
  await expect(page.getByRole('img', { name: /^ETH .*candlestick chart/ })).toBeVisible({ timeout: 25_000 });
  check('Changing the live market replaces its subscription and renders the selected asset');
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(bounds.content <= bounds.viewport); report.mobileBounds = bounds;
  await page.getByRole('link', { name: 'Feed details', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo data', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect market stream', exact: true })).toBeVisible();
  check('Returning to demo closes the stream and restores a deterministic workspace');
  assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
  check('Live browser walkthrough has no runtime or console errors');
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); await preview.close();
  report.finishedAt = new Date().toISOString();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/live-browser-report.json', JSON.stringify(report, null, 2));
}
