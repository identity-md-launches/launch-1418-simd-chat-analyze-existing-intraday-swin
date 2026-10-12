import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPreview } from '../scripts/preview.mjs';
import { installMarketFixture } from './market-fixture.mjs';

await mkdir('artifacts', { recursive: true });
const report = { checks: [], axes: [], precision: [], typography: [], errors: [], limitations: ['Chromium emulation; no physical device, screen reader, Firefox, WebKit, or native browser zoom check.', 'Live history uses a local CSV fixture; no provider or trading credentials are used.'] };
const check = message => { report.checks.push(message); console.log(`PASS ${message}`); };
const csv = ['time,open,high,low,close,volume,sentiment', ...Array.from({ length: 50 }, (_, i) => `${1700000000 + 300 * i},100,101,99,100,1,70`)].join('\n');
let fixture;
const preview = await createPreview(async (req, res) => {
  if (req.url.startsWith('/mock/api/snapshot')) {
    const now = Math.floor(Date.now() / 1000), offset = Math.floor(now / 300) * 300 - 300 - fixture.candles.at(-1).time;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...fixture, mode: 'live', asOf: now, sources: fixture.sources.map(s => ({ ...s, updatedAt: now })), candles: fixture.candles.map(c => ({ ...c, time: c.time + offset })) }));
    return true;
  }
  if (req.url.startsWith('/mock/api/history')) {
    res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(csv); return true;
  }
  return false;
});
const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_CHROMIUM ? { executablePath: process.env.PULSE_CHROMIUM } : {}), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installMarketFixture(page, () => fixture);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  async function navigate(hash) {
    const mobile = page.getByRole('button', { name: 'Open navigation' });
    if (await mobile.isVisible()) {
      await mobile.click(); await page.getByRole('dialog').locator(`a[href="#${hash}"]`).click();
    } else await page.locator(`.sidebar a[href="#${hash}"]`).last().click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
  }
  async function exportHistory() {
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export data', exact: true }).click();
    return readFile(await (await promise).path(), 'utf8');
  }
  await page.goto(preview.url);
  for (const width of [320, 390, 533, 534, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.fonts.ready);
    for (const interval of ['5m', '15m', '1h', '4h']) {
      await page.getByRole('button', { name: interval, exact: true }).click();
      const axis = await page.locator('.price-chart').evaluate(svg => {
        const ticks = [...svg.querySelectorAll('.time-tick')];
        const labels = ticks.map(x => { const r = x.getBoundingClientRect(), b = x.getBBox(); return { text: x.textContent, x: r.x, right: r.right, localX: b.x, localRight: b.x + b.width, tick: x.x.baseVal[0].value }; });
        return { viewport: innerWidth, chartWidth: svg.viewBox.baseVal.width, plotWidth: svg.viewBox.baseVal.width - 76, labels, gaps: labels.slice(1).map((x, i) => x.x - labels[i].right), pageOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      report.axes.push({ interval, ...axis });
      assert.equal(axis.labels.length, axis.chartWidth < 480 ? 3 : 6);
      assert.ok(axis.gaps.every(gap => gap >= 8), `Time labels need separation: ${JSON.stringify(axis)}`);
      assert.ok(axis.labels.every(label => label.localX >= -.1 && label.localRight <= axis.plotWidth + .1), 'Labels must stay inside the plot');
      const step = axis.plotWidth / (axis.labels.length - 1);
      assert.ok(axis.labels.every((label, i) => Math.abs(label.tick - i * step) < .01), 'Ticks must be evenly spaced');
      assert.equal(axis.pageOverflow, false);
    }
  }
  check('All four intervals have separated, evenly spaced, plot-contained time labels at seven widths, including both sides of the 480px chart breakpoint');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByLabel('Chart asset').selectOption('SOL');
    await page.getByRole('button', { name: '5m', exact: true }).click();
    const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
    const snapshot = JSON.parse(await readFile(await (await promise).path(), 'utf8'));
    const format = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const offset of [1, 2]) {
      if (offset === 2) { await page.getByRole('button', { name: 'Inspect previous candle' }).focus(); await page.keyboard.press('Space'); }
      const c = snapshot.candles.at(-offset), expected = [c.open, c.high, c.low, c.close].map(format);
      await expect(page.locator('.chart-legend b')).toHaveText(expected);
      const visible = await page.locator('.chart-legend b').allTextContents();
      report.precision.push({ width, offset, visible });
    }
    await page.getByLabel('Chart asset').selectOption('BTC');
  }
  check('Latest and keyboard-inspected previous SOL candles show exact cents on mobile and desktop');
  const snapshotDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  fixture = JSON.parse(await readFile(await (await snapshotDownload).path(), 'utf8'));
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate('backtest');
  await page.getByLabel('Import historical CSV').setInputFiles({ name: 'my-research.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await expect(page.locator('.result-metrics')).toContainText('-0.15%');
  const originalResults = await page.locator('.result-metrics').innerText();
  await navigate('signals'); await page.getByRole('link', { name: 'Test this strategy' }).click();
  await expect(page.getByText('Imported: my-research.csv', { exact: true })).toBeVisible();
  assert.equal(await page.locator('.result-metrics').innerText(), originalResults);
  assert.equal(await exportHistory(), csv);
  await page.getByLabel('Historical data').selectOption('1');
  await page.getByLabel('Starting capital (USD)').fill('12345');
  await page.getByText('Trading costs',{exact:true}).click();
  await page.getByLabel('Fee / side (%)', { exact: true }).fill('0.2');
  await page.getByLabel('Slippage / side (%)', { exact: true }).fill('0.07');
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  const configuredResults = await page.locator('.result-metrics').innerText();
  await navigate('signals'); await page.getByLabel('Buy at or above').fill('66'); await page.getByRole('button', { name: 'Save strategy', exact: true }).click();
  await page.getByRole('link', { name: 'Test this strategy' }).click();
  assert.equal(await page.locator('.result-metrics').innerText(), configuredResults);
  await page.getByRole('button', { name: 'Load saved signal rules', exact: true }).click();
  await expect(page.getByLabel('Buy threshold', { exact: true })).toHaveValue('66');
  await expect(page.getByLabel('Starting capital (USD)')).toHaveValue('12345');
  await expect(page.getByLabel('Fee / side (%)', { exact: true })).toHaveValue('0.2');
  await expect(page.getByLabel('Slippage / side (%)', { exact: true })).toHaveValue('0.07');
  await expect(page.getByLabel('Historical data')).toHaveValue('1');
  await expect(page.getByRole('heading', { name: 'Backtest results', exact: true })).toHaveCount(0);
  await expect(page.getByText('Synthetic data is ready to explore', { exact: true })).toHaveCount(0);
  assert.equal(await exportHistory(), csv);
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await page.getByRole('button', { name: 'Load saved signal rules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backtest results', exact: true })).toBeVisible();
  const savedResults = await page.locator('.result-metrics').innerText();
  check('Imported candles, provenance, range, costs, capital and results survive navigation; loading changed rules only updates rules and invalidates results');
  await navigate('overview'); await page.getByLabel('Chart asset').selectOption('SOL'); await navigate('backtest');
  await expect(page.getByText('Synthetic demo · 7 days · 5-minute bars', { exact: true })).toBeVisible();
  await page.getByLabel('Starting capital (USD)').fill('2500');
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  const solResults = await page.locator('.result-metrics').innerText();
  await navigate('overview'); await page.getByLabel('Chart asset').selectOption('BTC'); await navigate('backtest');
  await expect(page.getByText('Imported: my-research.csv', { exact: true })).toBeVisible();
  assert.equal(await page.locator('.result-metrics').innerText(), savedResults);
  assert.equal(await exportHistory(), csv);
  await page.getByLabel('Import historical CSV').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('bad,header\n1,2') });
  await expect(page.getByRole('alert')).toContainText('Use the header');
  assert.equal(await page.locator('.result-metrics').innerText(), savedResults);
  assert.equal(await exportHistory(), csv);
  await navigate('overview'); await page.getByLabel('Chart asset').selectOption('SOL'); await navigate('backtest');
  await expect(page.getByLabel('Starting capital (USD)')).toHaveValue('2500');
  assert.equal(await page.locator('.result-metrics').innerText(), solResults);
  check('Each asset retains its own dataset, configuration and results; rejected imports preserve existing evidence');
  await navigate('overview'); await page.getByLabel('Chart asset').selectOption('BTC'); await navigate('connections');
  await page.getByLabel('Service URL').fill(`${preview.origin}/mock`); await page.getByRole('button', { name: 'Connect sentiment service', exact: true }).click();
  await expect(page.getByText('Streaming',{exact:true})).toBeVisible();
  await navigate('backtest'); await expect(page.getByText('Imported: my-research.csv', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load recorded history', exact: true }).click();
  await expect(page.getByText('Recorded live data · 5-minute bars', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backtest results', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
  await navigate('signals'); await page.getByRole('link', { name: 'Test this strategy' }).click();
  await expect(page.getByText('Recorded live data · 5-minute bars', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backtest results', exact: true })).toBeVisible();
  assert.equal(await exportHistory(), csv);
  check('Explicit recorded-history replacement invalidates results, then preserves the recorded dataset and rerun across navigation');
  await navigate('connections'); await page.getByRole('button', { name: 'Use demo data', exact: true }).click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const hash of ['overview', 'sentiment', 'signals', 'backtest', 'risk', 'connections', 'guide']) {
      await navigate(hash);
      await expect(page.locator('.page-heading p')).toHaveCount(hash === 'overview' ? 1 : 0);
      await expect(page.locator('.foundation small')).toHaveCount(0);
      await expect(page.locator('.foundation')).toHaveText('Built on Jev-X');
      const weights = await page.evaluate(() => [...new Set([...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().height && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(el => getComputedStyle(el).fontWeight))].sort());
      report.typography.push({ width, hash, weights });
      assert.ok(weights.every(weight => ['400', '500', '600'].includes(weight)));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  check('All seven routes at mobile and desktop use only 400/500/600, retain Jev-X attribution, keep the product description on Overview and avoid page overflow');
  await page.goto(`${preview.url}#toString`); await expect(page.getByRole('heading',{level:1})).toHaveText('Market overview');
  check('Unknown/prototype-like hash names safely fall back to Overview');
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally { await writeFile('artifacts/revision-results.json', JSON.stringify(report, null, 2) + '\n'); await browser.close(); await preview.close(); }
