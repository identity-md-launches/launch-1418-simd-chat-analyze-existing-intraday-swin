import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles, aggregateSentiment, backtest, DEFAULT_STRATEGY, ema, evaluate, indicators, parseCsv, rsi, sizePosition, suggestedStop, validateStrategy } from '../src/lib/engine';
import { demoHistory, demoSnapshot } from '../src/lib/data';
import { validateSnapshot } from '../src/lib/validation';
import type { BacktestConfig, Candle } from '../src/types';

const bar = (close: number, i = 0, sentiment: number | null = 50): Candle => ({ time: 1779062400 + i * 300, open: close, high: close, low: close, close, volume: 10, sentiment });
const config: BacktestConfig = { ...DEFAULT_STRATEGY, capital: 10000, fee: 0, slippage: 0 };

test('Wilder RSI matches a known 14-period calculation and flat prices return 50', () => {
  const prices = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  assert.ok(Math.abs(rsi(prices.map((v,i)=>bar(v,i))).at(-1)! - 70.464135) < .00001);
  assert.equal(rsi(Array.from({length:30},(_,i)=>bar(100,i))).at(-1),50);
  assert.equal(rsi(Array.from({length:10},(_,i)=>bar(100,i))).at(-1),null);
});
test('EMA, MACD and signal line remain flat for constant prices', () => {
  assert.deepEqual(ema([100,100,100],12),[100,100,100]);
  const t=indicators(Array.from({length:40},(_,i)=>bar(100,i)));
  assert.ok(t.macd.every(v=>v===0)); assert.ok(t.signal.every(v=>v===0)); assert.ok(t.histogram.every(v=>v===0));
});
test('VWAP is volume weighted and resets at UTC midnight', () => {
  const candles=[{...bar(100),time:1779148200,volume:2},{...bar(110),time:1779148500,volume:6},{...bar(120),time:1779148800,volume:1}];
  assert.deepEqual(indicators(candles).vwap,[100,107.5,120]);
});
test('Timeframe aggregation preserves OHLC, sums volume and uses the final score', () => {
  const bars=[bar(100,0,10),bar(102,1,20),bar(99,2,30)];
  const [c]=aggregateCandles(bars,15);
  assert.deepEqual([c.open,c.high,c.low,c.close,c.volume,c.sentiment],[100,102,99,99,30,30]);
});
test('Sentiment is normalized and missing or stale enabled sources block signals', () => {
  const s=demoSnapshot('BTC'); assert.equal(aggregateSentiment(s,DEFAULT_STRATEGY.weights).score,74);
  s.sources[0].score=null; s.sources[0].status='unavailable'; assert.equal(evaluate(s,DEFAULT_STRATEGY).action,'Wait');
  const weights={...DEFAULT_STRATEGY.weights,Social:0}; assert.equal(aggregateSentiment(s,weights).complete,true);
  s.sources[1].updatedAt=s.asOf-901; assert.equal(aggregateSentiment(s,weights).complete,false);
});
test('A stale live snapshot cannot emit a trade signal', () => {
  const s=demoSnapshot('BTC'); s.mode='live'; assert.equal(evaluate(s,DEFAULT_STRATEGY,s.asOf+121).action,'Wait');
});
test('Signal boundaries and RSI filter use saved strategy rules', () => {
  const s=demoSnapshot('BTC'); assert.equal(evaluate(s,DEFAULT_STRATEGY).action,'Buy');
  assert.equal(evaluate(s,{...DEFAULT_STRATEGY,buy:90}).action,'Hold');
  assert.equal(evaluate(s,{...DEFAULT_STRATEGY,buy:90,sell:80}).action,'Sell');
  assert.equal(evaluate(s,{...DEFAULT_STRATEGY,maxRsi:1}).action,'Hold');
  assert.match(validateStrategy({...DEFAULT_STRATEGY,buy:30,sell:40})!,/below/);
  assert.match(validateStrategy({...DEFAULT_STRATEGY,weights:{Social:0,News:0,'On-chain':0}})!,/at least one/);
});
test('Risk sizing honors stop distance, available capital and short-side direction', () => {
  assert.deepEqual(sizePosition(10000,1,100,95,110),{quantity:20,notional:2000,riskBudget:100,maxLoss:100,reward:200,ratio:2,capped:false});
  assert.equal(sizePosition(1000,10,100,99,110).quantity,10);
  assert.equal(sizePosition(10000,1,100,105,90,'sell').ratio,2);
  assert.throws(()=>sizePosition(1000,1,100,105,110),/below entry/);
  assert.throws(()=>sizePosition(1000,1,0,95,110),/positive/);
  assert.throws(()=>sizePosition(1000,20,100,95,110),/at most 10/);
});
test('Suggested stop is two ATRs away from entry', () => {
  const bars=Array.from({length:15},(_,i)=>({...bar(100,i),low:98,high:102}));
  assert.equal(suggestedStop(bars,100,'buy'),92); assert.equal(suggestedStop(bars,100,'sell'),108);
});
test('Backtest waits for the next open and does not use the current candle score', () => {
  const bars=Array.from({length:35},(_,i)=>bar(100,i,i===17?80:50));
  const result=backtest(bars,config);
  assert.equal(result.trades.length,1); assert.equal(result.trades[0].entryTime,bars[18].time);
  assert.equal(result.trades[0].reason,'End of period'); assert.equal(result.finalEquity,10000);
});
test('Backtest prioritizes a stop if both stop and target touch in one candle', () => {
  const bars=Array.from({length:35},(_,i)=>bar(100,i,i===17?80:50));
  bars[18]={...bars[18],low:90,high:110}; const result=backtest(bars,config);
  assert.equal(result.trades[0].reason,'Stop loss'); assert.equal(result.trades[0].exit,98); assert.equal(result.trades[0].pnl,-100);
});
test('Stops fill conservatively at the open when price gaps past the stop', () => {
  const bars=Array.from({length:35},(_,i)=>bar(100,i,i===17?80:50));
  bars[19]={...bar(90,19),high:91,low:89}; const result=backtest(bars,config);
  assert.equal(result.trades[0].exit,90); assert.equal(result.trades[0].pnl,-500);
});
test('Fees and adverse slippage reduce equity and exact cash reconciles', () => {
  const bars=Array.from({length:35},(_,i)=>bar(100,i,i===17?80:50));
  const result=backtest(bars,{...config,fee:.1,slippage:.1});
  assert.ok(result.returnPct<0); assert.ok(result.trades[0].entry>100); assert.ok(result.trades[0].exit<100);
  assert.ok(Math.abs(result.finalEquity-10000-result.trades.reduce((s,t)=>s+t.pnl,0))<1e-8);
});
test('Backtest no-signal series produces no trades or losses', () => {
  const result=backtest(Array.from({length:35},(_,i)=>bar(100,i,null)),config);
  assert.equal(result.trades.length,0); assert.equal(result.maxDrawdown,0); assert.equal(result.winRate,0); assert.equal(result.finalEquity,10000);
});
test('CSV import accepts exact exported data and rejects malformed prices/order/scores', () => {
  const bars=demoHistory('BTC').slice(0,40);
  const csv=['time,open,high,low,close,volume,sentiment',...bars.map(c=>[c.time,c.open,c.high,c.low,c.close,c.volume,c.sentiment].join(','))].join('\n');
  assert.deepEqual(parseCsv(csv),bars);
  assert.throws(()=>parseCsv(csv.replace('sentiment','score')),/header/);
  assert.throws(()=>parseCsv(csv.replace(String(bars[0].high),'1')),/Row 2/);
  assert.throws(()=>parseCsv(csv.replace(String(bars[1].time),String(bars[0].time))),/increasing/);
  assert.throws(()=>parseCsv(csv+'\n0,1,1,1,1,1,1000'),/Row/);
});
test('Live transport validates freshness, source identity and external link protocol', () => {
  const s=demoSnapshot('BTC'); s.mode='live'; const now=Math.floor(Date.now()/1000), delta=Math.floor(now/300)*300-300-s.candles.at(-1)!.time;
  s.asOf=now; s.candles=s.candles.map(c=>({...c,time:c.time+delta})); s.sources=s.sources.map(source=>({...source,updatedAt:now}));
  assert.equal(validateSnapshot(s,'BTC'),true); assert.equal(validateSnapshot(s,'ETH'),false);
  assert.equal(validateSnapshot({...s,asOf:now-121},'BTC'),false);
  assert.equal(validateSnapshot({...s,feed:[{...s.feed[0],url:'javascript:alert(1)'}]},'BTC'),false);
  assert.equal(validateSnapshot({...s,sources:[s.sources[0],s.sources[0],s.sources[2]]},'BTC'),false);
});
