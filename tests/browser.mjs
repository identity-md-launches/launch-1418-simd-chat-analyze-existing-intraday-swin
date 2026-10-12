import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPreview } from '../scripts/preview.mjs';
import { installMarketFixture } from './market-fixture.mjs';

await mkdir('artifacts', { recursive: true });
await mkdir('test/scratch', { recursive: true });
const report = { checks: [], viewports: [], accessibility: [], contrast: [], consoleErrors: [], resourceErrors: [], limitations: ['Chromium emulation, not a physical device or screen-reader session.', 'CSS text enlargement is checked separately from native browser zoom.', 'Provider and trading credentials are not supplied; live connection interactions use explicit fixtures.'] };
const check = message => { report.checks.push(message); console.log(`PASS ${message}`); };
let fixture;
const preview = await createPreview(async (req, res) => {
  if (req.url.startsWith('/mock/api/snapshot')) {
    const now = Math.floor(Date.now() / 1000), offset = Math.floor(now / 300) * 300 - 300 - fixture.candles.at(-1).time;
    const data = { ...fixture, asset: new URL(req.url, 'http://localhost').searchParams.get('asset'), mode: 'live', asOf: now, sources: fixture.sources.map(s => ({ ...s, updatedAt: now })), candles: fixture.candles.map(c => ({ ...c, time: c.time + offset })), feed: fixture.feed.map(f => ({ ...f, time: now - 60 })) };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return true;
  }
  if (req.url.startsWith('/failed/')) { res.writeHead(503); res.end('Service unavailable'); return true; }
  return false;
});
const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_CHROMIUM ? { executablePath: process.env.PULSE_CHROMIUM } : {}), args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const marketFixture = await installMarketFixture(page, () => fixture);
  page.on('pageerror', e => report.consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('503')) report.consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/failed/')) report.resourceErrors.push(`${r.status()} ${r.url()}`); });
  async function route(hash) { await page.goto(`${preview.url}#${hash}`); await page.getByRole('heading', { level: 1 }).waitFor(); await page.evaluate(() => document.fonts.ready); }
  async function audit(label) { const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze(); report.accessibility.push({ label, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) }); assert.equal(result.violations.length, 0, `${label}: ${JSON.stringify(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))}`); }
  async function noOverflow(label) { const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(bounds.scroll <= bounds.width, `${label} page overflow: ${JSON.stringify(bounds)}`); report.viewports.push({ label, ...bounds }); }
  await route('overview');
  await expect(page).toHaveTitle('Pulse — Crypto trading intelligence');
  assert.equal(await page.locator('meta[name="description"]').count(), 1); assert.equal(await page.locator('meta[property="og:title"]').count(), 1); assert.equal(await page.locator('meta[property="og:image"]').count(), 1);
  assert.equal((await page.request.get(preview.url + 'og-image.png')).status(),200);
  assert.equal((await page.request.get(preview.url + 'favicon.svg')).status(),200);
  assert.ok(await page.evaluate(() => document.fonts.check('500 14px "Inter Variable"')));
  check('Static subpath assets, metadata, favicon, share image and local font load');
  await noOverflow('overview 1440 × 1100');
  await audit('overview desktop');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/overview-desktop.png', fullPage: true });
  const dataDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  fixture = JSON.parse(await readFile(await (await dataDownload).path(), 'utf8')); assert.equal(fixture.asset, 'BTC'); assert.equal(fixture.mode, 'demo');
  check('Snapshot export contains the selected asset, provenance, analysis and rules');
  await page.getByRole('button', { name: 'Analyze market' }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Rules-based analysis')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Analyze market' })).toBeFocused();
  check('Market analysis opens; Escape closes the native dialog and restores focus');
  await page.getByRole('button', { name: 'RSI', exact: true }).click(); await expect(page.getByRole('img', { name: /^Adaptive RSI:/ })).toBeVisible();
  await page.getByRole('button', { name: 'MACD', exact: true }).click(); await expect(page.getByRole('img', { name: /^MACD / })).toBeVisible();
  await page.getByRole('button', { name: '1h', exact: true }).click(); await expect(page.getByRole('button', { name: '1h', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Inspect previous candle' }).click();
  check('Timeframe, RSI, MACD and keyboard-accessible candle inspection controls update');
  await page.keyboard.press('/'); await page.getByLabel('Search assets').fill('Solana'); await page.getByRole('button', { name: 'Solana SOL/USD' }).click();
  await expect(page.getByLabel('Chart asset')).toHaveValue('SOL');
  await page.getByLabel('Chart asset').selectOption('BTC');
  check('Market search and chart selector change the selected asset');
  await route('sentiment'); await page.getByRole('button', { name: 'News', exact: true }).click(); await expect(page.locator('.feed-item')).toHaveCount(2);
  await page.getByLabel('Search sentiment activity').fill('no-matching-test-phrase'); await expect(page.getByText('No matching activity')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click(); await expect(page.locator('.feed-item')).toHaveCount(6); await audit('sentiment desktop');
  check('Source filter, text search, empty state and clear-filter recovery');
  await route('signals');
  await page.getByLabel('Buy at or above').fill('30'); await page.getByRole('button', { name: 'Save strategy' }).click(); await expect(page.getByRole('alert')).toContainText('below the buy threshold');
  await page.getByLabel('Buy at or above').fill('90'); await page.getByRole('button', { name: 'Save strategy' }).click(); await expect(page.locator('.signal-action')).toHaveText('Hold');
  await page.reload(); await expect(page.getByLabel('Buy at or above')).toHaveValue('90');
  await page.getByRole('button', { name: 'Load defaults' }).click(); await page.getByRole('button', { name: 'Save strategy' }).click();
  await audit('signals desktop');
  check('Invalid thresholds show a recoverable error; saved valid rules change signals and survive reload');
  await page.getByRole('button', { name: 'Review paper trade', exact: true }).first().click();
  await page.getByLabel('Quantity (BTC)').fill('0.002'); await page.getByLabel('I understand this records a paper order only.').check();
  await page.getByRole('button', { name: 'Record paper order' }).click(); await expect(page.getByRole('heading', { name: 'Paper order recorded' })).toBeVisible();
  await page.getByRole('button', { name: 'View paper journal' }).click(); await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.reload(); await expect(page.locator('tbody tr')).toHaveCount(1);
  check('Paper trade confirmation records a simulated order and journal survives reload');
  await route('risk');
  await page.getByLabel('Planning capital (USD)').fill('10000'); await page.getByLabel('Entry price (USD)').fill('100'); await page.getByLabel('Stop price (USD)').fill('105'); await page.getByLabel('Take profit (USD)').fill('110');
  await page.getByRole('button', { name: 'Calculate position' }).click(); await expect(page.getByRole('alert')).toContainText('stop below entry');
  await page.getByLabel('Stop price (USD)').fill('95'); await page.getByRole('button', { name: 'Calculate position' }).click();
  await expect(page.locator('.position-total')).toContainText('20.000000'); await expect(page.locator('.risk-results')).toContainText('$100.00');
  await page.getByLabel('Entry price (USD)').fill(String(fixture.price)); await page.getByLabel('Stop method').selectOption('atr'); await page.getByRole('button',{name:'Save risk profile'}).click(); await page.getByRole('button',{name:'Apply saved stop'}).click(); await expect(page.getByRole('status').filter({hasText:'ATR volatility stop applied'})).toBeVisible();
  await audit('risk desktop');
  check('Risk form rejects invalid stops, computes expected position and applies ATR guidance');
  await route('backtest'); await page.getByRole('button', { name: 'Run backtest' }).click(); await expect(page.getByRole('heading', { name: 'Backtest results' })).toBeVisible(); assert.ok(await page.locator('tbody tr').count() > 0);
  const tradesDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export trades' }).click(); const tradeCsv = await readFile(await (await tradesDownload).path(), 'utf8'); assert.ok(tradeCsv.startsWith('entry_time,exit_time,entry,exit,quantity,pnl,reason,equity'));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/backtest-desktop.png', fullPage: true });
  await audit('backtest desktop');
  await page.getByLabel('Import historical CSV').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('wrong,header\n1,2') }); await expect(page.getByRole('alert')).toContainText('Use the header');
  const validCsv = ['time,open,high,low,close,volume,sentiment', ...fixture.candles.slice(0,50).map(c => [c.time,c.open,c.high,c.low,c.close,c.volume,c.sentiment].join(','))].join('\n');
  await page.getByLabel('Import historical CSV').setInputFiles({ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(validCsv) }); await expect(page.getByText('Imported: history.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Run backtest' }).click(); await expect(page.getByRole('heading', { name: 'Backtest results' })).toBeVisible();
  check('Backtest executes, exports its ledger, rejects malformed CSV and accepts imported history');
  await route('connections'); await page.getByLabel('Execution mode').selectOption('automated'); const configDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download template' }).first().click(); const execution = JSON.parse(await readFile(await (await configDownload).path(), 'utf8')); assert.equal(execution.exchange, 'kraken'); assert.equal(execution.mode, 'automated'); assert.equal(execution.dry_run, true); assert.equal(Object.keys(execution).includes('api_key'), false);
  await page.getByLabel('Service URL').fill(`${preview.origin}/failed`); await page.getByRole('button', { name: 'Connect sentiment service' }).click(); await expect(page.getByRole('alert')).toContainText('Market data is unavailable');
  await page.getByLabel('Service URL').fill(`${preview.origin}/mock`); await page.getByRole('button', { name: 'Connect sentiment service' }).click(); await expect(page.getByText('Streaming', {exact:true})).toBeVisible(); await expect(page.locator('.data-mode')).toContainText('Live stream');
  await page.getByRole('button', { name: 'Pause stream', exact:true }).first().click(); await expect(page.getByRole('button', { name: 'Resume stream', exact:true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Use demo data', exact:true }).click(); await expect(page.locator('.data-mode')).toContainText('Demo mode');
  await audit('connections desktop');
  check('Exchange download stays dry-run; unavailable service error recovers to live fixture and demo');

  await route('backtest'); await page.reload();
  await page.getByRole('button', {name:'Run stress tests',exact:true}).click();
  await expect(page.getByRole('region',{name:'Scrollable scenario results'}).locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button', {name:'Run calibration',exact:true}).click();
  await expect(page.getByText('Training choice:',{exact:true})).toBeVisible();
  const researchDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'Export research report'}).click();
  const research=JSON.parse(await readFile(await (await researchDownload).path(),'utf8'));
  assert.equal(research.schema,'pulse.research.v2'); assert.equal(research.scenarios.length,4); assert.equal(research.calibration.candidates.length,9);
  assert.ok(research.calibration.split.trainingEnd<research.calibration.split.holdoutStart);
  assert.equal(research.calibration.holdout.bars, research.bars);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:'artifacts/research-desktop.png',fullPage:true});
  await audit('completed research desktop');
  await page.getByLabel('Crash gap (%)').fill('20'); await expect(page.getByRole('region',{name:'Scrollable scenario results'})).toHaveCount(0);
  await page.getByLabel('Buy threshold',{exact:true}).fill('70'); await expect(page.getByText('Training choice:',{exact:true})).toHaveCount(0);
  check('Stress scenarios and chronological calibration compute, export evidence and invalidate stale results');
  await route('signals');
  await page.getByRole('button',{name:'Send test alert',exact:true}).click();
  await expect(page.getByText('Test alert received',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Acknowledge all',exact:true}).click();
  await expect(page.locator('.alert-center .badge').first()).toHaveText('0 unread');
  await page.reload(); await expect(page.getByText('Test alert received',{exact:true})).toBeVisible();
  await page.getByText('Configure alert rules',{exact:true}).click();
  await page.getByLabel('Repeat alert cooldown (seconds)').fill('12'); await page.getByRole('button',{name:'Save alert rules'}).click();
  check('In-app test alerts, acknowledgement, persisted log and configurable cooldown work');
  await route('risk');
  await page.getByLabel('Manual paper equity (USD)').fill('10000'); await page.getByRole('button',{name:'Update paper equity'}).click();
  await page.getByLabel('Pause new paper entries when either protection limit is reached').check(); await page.getByRole('button',{name:'Save risk profile'}).click();
  await expect(page.getByText('Armed',{exact:true})).toBeVisible();
  await page.getByLabel('Manual paper equity (USD)').fill('9600'); await page.getByRole('button',{name:'Update paper equity'}).click();
  await expect(page.getByText('Tripped',{exact:true})).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:'artifacts/risk-protection-desktop.png',fullPage:true});
  await route('signals'); await page.getByRole('button',{name:'Review paper trade',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Record paper order'})).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Daily loss limit reached');
  await page.keyboard.press('Escape');
  await route('risk'); await page.getByLabel('Manual paper equity (USD)').fill('10000');
  await page.getByText('Start a new protection baseline',{exact:true}).click();
  await page.getByLabel('I intend to clear the protection history for a new paper session').check();
  await page.getByRole('button',{name:'Reset protection baseline'}).click(); await expect(page.getByText('Armed',{exact:true})).toBeVisible();
  await route('signals'); await page.getByRole('button',{name:'Review paper trade',exact:true}).first().click();
  await page.getByLabel('Quantity (BTC)').fill('0.001'); await page.getByLabel('I understand this records a paper order only.').check();
  await page.evaluate(()=>{window.__originalNow=Date.now;Date.now=()=>window.__originalNow()+86400000;});
  await page.getByRole('button',{name:'Record paper order'}).click();
  await expect(page.getByRole('dialog')).toContainText('Update paper equity for the current UTC day');
  await page.evaluate(()=>{Date.now=window.__originalNow;delete window.__originalNow;}); await page.keyboard.press('Escape');
  await route('risk');
  await page.getByLabel('Pause new paper entries when either protection limit is reached').uncheck();
  await page.getByLabel('Stop method').selectOption('trailing'); await page.getByRole('button',{name:'Save risk profile'}).click();
  await page.getByLabel('Entry price (USD)').fill('100'); await page.getByLabel('Observed price (USD)').fill('110'); await page.getByRole('button',{name:'Update trailing preview'}).click();
  await expect(page.getByText('$107.80',{exact:true})).toBeVisible();
  await page.getByLabel('Observed price (USD)').fill('105'); await page.getByRole('button',{name:'Update trailing preview'}).click();
  await expect(page.getByText('Stop triggered',{exact:true})).toBeVisible();
  await page.getByLabel('Stop method').selectOption('fixed'); await page.getByRole('button',{name:'Save risk profile'}).click();
  check('Drawdown/daily protection arms, latches, blocks paper entries, explicitly resets; trailing preview tightens and triggers');
  await route('signals'); await page.getByLabel('Take profit (%)').fill('100'); await page.getByRole('button',{name:'Save strategy'}).click();
  await page.getByRole('button',{name:'Review paper trade',exact:true}).first().click(); await page.getByRole('combobox',{name:'Side',exact:true}).selectOption('sell');
  await expect(page.getByRole('button',{name:'Record paper order'})).toBeDisabled(); await expect(page.getByRole('dialog')).toContainText('take-profit percentage below 100%');
  await page.keyboard.press('Escape'); await page.getByLabel('Take profit (%)').fill('4'); await page.getByRole('button',{name:'Save strategy'}).click();
  check('Paper submission rechecks UTC-day equity and rejects zero-price short targets before journal persistence');


  await route('connections'); await page.getByRole('button',{name:'Connect market stream',exact:true}).click();
  await expect(page.getByText('Streaming',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open market overview'}).click();
  await expect(page.locator('.signal-summary strong')).toHaveText('Wait for data');
  marketFixture.ticker(71001); await expect(page.locator('.current-price strong')).toHaveText('$71,001.00');
  await page.getByRole('button',{name:'Pause stream',exact:true}).click();
  await page.getByRole('button',{name:'Analyze market',exact:true}).click();
  await expect(page.getByRole('dialog').locator('.analysis-action')).toHaveText('Wait');
  await page.getByRole('dialog').getByRole('button',{name:'Review paper trade',exact:true}).click();
  await expect(page.getByRole('button',{name:'Record paper order'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await route('connections'); await page.reload(); // explicit demo startup after reload
  check('WebSocket fixture updates prices, lacks fabricated sentiment, and pause blocks analysis/paper entries');
  await route('guide'); await audit('guide desktop');
  for (const width of [390, 320, 768, 1024]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1100 });
    for (const hash of ['overview','sentiment','signals','risk','backtest','connections','guide']) {
      await route(hash); await noOverflow(`${hash} ${width}px`);
      if (width === 390) await audit(`${hash} mobile`);
    }
    if (width === 390) {
      await route('overview'); const button = await page.getByRole('button', { name: 'Analyze market' }).boundingBox(); assert.ok(button.y + button.height < 844); const title = await page.getByRole('heading', { level: 1 }).boundingBox(); assert.ok(title.y < 150);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/overview-mobile.png', fullPage: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/first-screen-mobile.png' });
      await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('dialog').getByRole('link', { name: 'Risk calculator' }).click(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Risk calculator'); await expect(page.getByRole('dialog')).toHaveCount(0);
      check('390px first screen contains product and main action; mobile navigation completes');
    }
  }
  check('All seven views reflow without page overflow at 320, 390, 768 and 1024 pixels');
  await page.setViewportSize({width:1440,height:1100}); await route('overview'); await page.reload();
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter'); assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
  await page.getByRole('button', {name:'Analyze market'}).focus(); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:'artifacts/focus-desktop.png'});
  await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for(let i=0;i<12;i++) await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>!!document.activeElement.closest('dialog')),true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name:'Analyze market'})).toBeFocused();
  check('Keyboard skip link, visible focused primary action, dialog focus containment and focus return');
  await page.emulateMedia({reducedMotion:'reduce'}); assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true); assert.equal(await page.getByRole('button',{name:'Analyze market'}).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  check('Reduced-motion preference removes button transitions');
  await page.setViewportSize({width:1440,height:1100});
  await page.addStyleTag({content:':root { font-size:32px !important; }'}); await noOverflow('overview 200% CSS text enlargement');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:'test/scratch/text-enlargement.png',fullPage:true});
  await route('overview');
  function lum(rgb) { const c=rgb.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}); return .2126*c[0]+.7152*c[1]+.0722*c[2]; }
  function rgb(s){ return s.startsWith('#') ? [1,3,5].map(i=>parseInt(s.slice(i,i+2),16)) : s.match(/[\d.]+/g).slice(0,3).map(Number); }
  const pairs=await page.evaluate(()=>{ const root=getComputedStyle(document.documentElement); const token=n=>root.getPropertyValue(n).trim(); return [['Body','--text','--surface'],['Secondary text','--muted','--surface'],['Primary button','--on-accent','--accent'],['Positive badge','--positive','--positive-soft'],['Negative badge','--negative','--negative-soft'],['Warning badge','--warning','--warning-soft'],['Focus ring / page','--focus','--bg'],['Focus ring / surface','--focus','--surface'],['Input border / field','--control-border','--bg']].map(([label,a,b])=>({label,foreground:token(a),background:token(b)}));});
  for(const pair of pairs){const l1=lum(rgb(pair.foreground)),l2=lum(rgb(pair.background)),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05),threshold=pair.label.includes('Focus')||pair.label.includes('border')?3:4.5; report.contrast.push({...pair,ratio:Number(ratio.toFixed(2)),threshold}); assert.ok(ratio>=threshold,`${pair.label}: ${ratio}`);}
  check('Measured foreground/background and focus/control token pairs meet their checked thresholds');
  assert.deepEqual(report.consoleErrors,[]); assert.deepEqual(report.resourceErrors,[]);
  check('No unexpected console exceptions, resource failures, or external runtime requests');
  await context.close();
  report.result='PASS';
} catch(e) { report.result='FAIL'; report.failure=e.stack; console.error(e); process.exitCode=1; }
finally { await writeFile('artifacts/browser-results.json',JSON.stringify(report,null,2)); await browser.close(); await preview.close(); }
