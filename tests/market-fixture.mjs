// Explicit transport fixtures for repeatable UI checks. Production code has no test feed.
export async function installMarketFixture(page, getFixture) {
  let activeSocket;
  let symbol = 'BTC/USD';
  const quote = (price) => ({ channel: 'ticker', type: 'update', data: [{ symbol, last: price ?? getFixture().price, change_pct: 1.5, volume: 1000, vwap: price ?? getFixture().price, timestamp: new Date().toISOString() }] });
  await page.route('https://api.kraken.com/0/public/OHLC**', async route => {
    const fixture = getFixture();
    const now = Math.floor(Date.now() / 1000 / 300) * 300;
    const bars = fixture.candles.slice(-300), offset = now - 300 - bars.at(-1).time;
    await route.fulfill({ json: { error: [], result: { XBTUSD: bars.map(c => [c.time + offset, String(c.open), String(c.high), String(c.low), String(c.close), String(c.close), String(c.volume), 1]), last: now } } });
  });
  await page.routeWebSocket('wss://ws.kraken.com/v2', ws => {
    activeSocket = ws;
    ws.onMessage(raw => {
      const request = JSON.parse(String(raw));
      if (request.method === 'subscribe') {
        symbol = request.params.symbol[0];
        ws.send(JSON.stringify({ method: 'subscribe', success: true, req_id: request.req_id }));
        if (request.params.channel === 'ticker') ws.send(JSON.stringify(quote()));
      }
      if (request.method === 'ping') ws.send(JSON.stringify({ method: 'pong' }));
    });
  });
  return {
    ticker: price => activeSocket?.send(JSON.stringify(quote(price))),
    disconnect: () => activeSocket?.close({ code: 1001, reason: 'Fixture connection interrupted' }),
  };
}
