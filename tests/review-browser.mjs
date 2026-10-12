import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPreview } from '../scripts/preview.mjs';
import { installMarketFixture } from './market-fixture.mjs';

await mkdir('artifacts', { recursive: true });
const report = { checks: [], axes: [], equity: [], risk: [], audits: [], errors: [], limitations: ['Chromium emulation; no physical device, screen reader, Firefox, WebKit or native browser zoom.', 'Sentiment and market transports use explicit fixtures; no credentials or real orders.'] };
const check = message => { report.checks.push(message); console.log(`PASS ${message}`); };
let fixture, sourceAge = 960, emptyFeed = false;
const preview = await createPreview(async (req, res) => {
  if (!req.url.startsWith('/mock/api/snapshot')) return false;
  const now = Math.floor(Date.now() / 1000);
  const offset = Math.floor(now / 300) * 300 - 300 - fixture.candles.at(-1).time;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ...fixture, mode: 'live', asOf: now,
    feed: emptyFeed ? [] : fixture.feed,
    sources: fixture.sources.map(s => ({ ...s, updatedAt: now - sourceAge })),
    candles: fixture.candles.map(c => ({ ...c, time: c.time + offset })) }));
  return true;
});
const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_CHROMIUM ? { executablePath: process.env.PULSE_CHROMIUM } : {}), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Pacific/Honolulu' });
  const page = await context.newPage();
  await installMarketFixture(page, () => fixture);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  const route = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await expect(page).toHaveURL(new RegExp(`#${hash}$`)); };
  const audit = async name => {
    const { violations } = await new AxeBuilder({ page }).analyze();
    report.audits.push({ name, violations }); assert.deepEqual(violations, []);
  };
  await page.goto(preview.url);
  await page.evaluate(() => document.fonts.ready);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  fixture = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  for (const width of [320, 390, 533, 534, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const interval of ['5m', '15m', '1h', '4h']) {
      await page.getByRole('button', { name: interval, exact: true }).click();
      const geometry = await page.locator('.price-chart').evaluate(svg => {
        const m = svg.querySelector('rect[rx="3"]').getBBox();
        const ticks = [...svg.querySelectorAll('.price-tick')].map(g => {
          const t = g.querySelector('text'), b = t.getBBox(), line = g.querySelector('line');
          return { text: t.textContent, top: b.y, bottom: b.y+b.height,
            gap: Math.max(m.y-b.y-b.height, b.y-m.y-m.height),
            originalY: line.y1.baseVal.value, labelY: t.y.baseVal[0].value, leader: !!g.querySelector('polyline') };
        });
        return { ticks, timeLabels: [...svg.querySelectorAll('.time-tick')].map(t => t.textContent), marker: { top: m.y, bottom: m.y+m.height }, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(geometry.ticks.every(t => t.gap >= 4), JSON.stringify({width,interval,...geometry}));
      for (const tick of geometry.ticks) if (Math.abs(tick.labelY-tick.originalY-4)>.01) assert.equal(tick.leader,true);
      const sorted = geometry.ticks.toSorted((a,b)=>a.top-b.top);
      assert.ok(sorted.slice(1).every((t,i)=>t.top-sorted[i].bottom>=4));
      assert.equal(geometry.overflow, false);
      if (interval === '4h') assert.ok(geometry.timeLabels.every(t => /May/.test(t)));
      report.axes.push({ width, interval, ...geometry });
    }
    if (width === 390 || width === 1440) {
      await page.getByRole('button', { name: '15m', exact: true }).click();
      await page.locator('.technical-chart').screenshot({ path: `artifacts/chart-${width}.png` });
    }
  }
  check('All price ticks keep at least 4 SVG px from the close marker and each other across four intervals and seven widths; moved labels have leaders');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '4h', exact: true }).click();
  await expect(page.locator('.candle-inspector span')).toHaveText('18 May 2026, 12:00 UTC');
  const previous = page.getByRole('button', { name: 'Inspect previous candle' });
  await previous.focus();
  for (let i=0;i<6;i++) await page.keyboard.press('Space');
  await expect(page.locator('.candle-inspector span')).toHaveText('17 May 2026, 12:00 UTC');
  await expect(page.locator('.technical-chart .sr-only[aria-live]')).toContainText('Selected candle 17 May 2026, 12:00 UTC');
  assert.equal(await page.locator('.time-tick tspan').count(),3);
  await page.locator('.technical-chart').screenshot({ path: 'artifacts/chart-multiday-mobile.png' });
  check('4h inspector and live announcement distinguish the previous day by keyboard; three mobile date ticks remain visible in a non-UTC browser timezone');

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await route('risk');
    for (const [name,value] of [['Planning capital (USD)','10000'],['Entry price (USD)','100'],['Stop price (USD)','95'],['Take profit (USD)','110']]) await page.getByLabel(name).fill(value);
    await page.getByRole('button', { name: 'Calculate position' }).focus();
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name: 'Position estimate', exact: true });
    await expect(heading).toBeFocused();
    await expect(page.locator('.position-total')).toContainText('20.000000 BTC');
    await expect(page.locator('.risk-results')).toContainText('$100.00');
    await expect(page.locator('.risk-results')).toContainText('$200.00');
    const geometry = await page.locator('.position-total').evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, viewportHeight: innerHeight, scrollY }));
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight);
    report.risk.push({ width, ...geometry });
    if (width===390) { await page.screenshot({ path: 'artifacts/risk-result-mobile.png' }); await audit('risk result mobile'); }
    const entry = page.getByLabel('Entry price (USD)');
    await entry.scrollIntoViewIfNeeded(); await entry.focus();
    const before = await page.evaluate(() => scrollY);
    await entry.fill('101');
    await expect(entry).toBeFocused();
    assert.ok(Math.abs((await page.evaluate(() => scrollY))-before)<2, 'Editing inputs must not jump to result');
    await expect(page.locator('.risk-results')).toHaveCount(0);
    await page.getByLabel('Stop price (USD)').fill('110');
    await page.getByRole('button', { name: 'Calculate position' }).click();
    await expect(page.getByLabel('Stop price (USD)')).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('stop below entry');
    await route('overview');
  }
  check('Successful risk calculations reveal and focus the correct result on mobile and desktop; edits and invalid submissions retain form focus');

  for (const width of [320,390,1440]) {
    await page.setViewportSize({ width, height: 844 });
    await route('backtest');
    for (const capital of ['1000','1000000','1000000000']) {
      await page.getByLabel('Starting capital (USD)').fill(capital);
      await page.getByRole('button', { name: 'Run backtest', exact: true }).click();
      await expect(page.locator('.equity-chart')).toBeVisible();
      const geometry = await page.locator('.equity-chart').evaluate(svg => ({ width: svg.viewBox.baseVal.width, plotEnd: svg.querySelector('line').x2.baseVal.value, ticks: [...svg.querySelectorAll('text')].map(t => { const b=t.getBBox(); return { text:t.textContent, x:b.x, right:b.x+b.width, size:getComputedStyle(t).fontSize }; }) }));
      assert.ok(geometry.ticks.every(t => t.right<=geometry.width-3.9 && t.x>=geometry.plotEnd+9.9 && t.size==='12px'), JSON.stringify(geometry));
      report.equity.push({ width, capital, ...geometry });
      if (width===390 && capital==='1000000') await page.locator('.equity-wrap').screenshot({ path: 'artifacts/equity-million-mobile.png' });
    }
  }
  check('Complete equity amounts fit at 320/390/1440px with $1K, $1M and $1B capital, 12px text and a measured 10px plot gap');

  await page.setViewportSize({ width: 390, height: 844 });
  await route('connections');
  await page.getByRole('button', { name: 'Connect market stream', exact: true }).click();
  await expect(page.getByText('Streaming', { exact: true })).toBeVisible();
  for (const hash of ['overview','sentiment']) {
    await route(hash);
    await expect(page.getByRole('heading', { name: 'No sentiment service connected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open Connections', exact: true }).click();
    await expect(page).toHaveURL(/#connections$/);
  }
  await page.getByRole('button', { name: 'Use demo data', exact: true }).click();
  await route('sentiment');
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search sentiment activity' }).fill('no headline contains this phrase');
  await expect(page.getByRole('heading', { name: 'No matching activity' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.feed-item').first()).toBeVisible();
  check('Price-only empty feeds lead to Connections from both views; Clear filters appears only when filters remove available activity and restores it');

  await route('connections');
  await page.getByLabel('Service URL').fill(`${preview.origin}/mock`);
  await page.getByRole('button', { name: 'Connect sentiment service' }).click();
  await expect(page.locator('.source-connections .badge')).toHaveText(['Stale','Stale','Stale']);
  await expect(page.locator('.source-connections')).toContainText('16m ago');
  await page.locator('.source-connections').screenshot({ path: 'artifacts/stale-connections-mobile.png' });
  await route('sentiment');
  await expect(page.locator('.source-detail-grid .badge')).toHaveText(['Stale','Stale','Stale']);
  await expect(page.locator('.sentiment-metrics')).toContainText('0 of 3 enabled sources');
  assert.equal(await page.locator('.metric-detail').filter({hasText:'Stale · 16m ago'}).count(),3);
  await page.locator('.source-detail-grid').screenshot({ path: 'artifacts/stale-sources-mobile.png' });
  await audit('stale sentiment mobile');
  sourceAge = 0; emptyFeed = true;
  await route('connections');
  await page.getByRole('button', { name: 'Connect sentiment service' }).click();
  await expect(page.locator('.source-connections .badge')).toHaveText(['Ready','Ready','Ready']);
  await route('sentiment');
  await expect(page.locator('.source-detail-grid .badge')).toHaveText(['Ready','Ready','Ready']);
  await expect(page.locator('.sentiment-metrics')).toContainText('3 of 3 enabled sources');
  await expect(page.getByRole('heading', { name: 'No source activity yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await audit('connected empty sentiment mobile');
  check('Expired sources show Stale and observation ages in Sentiment and Connections; fresh observations recover Ready; a connected empty feed explains its state');
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally { await writeFile('artifacts/review-results.json', JSON.stringify(report,null,2)+'\n'); await browser.close(); await preview.close(); }
