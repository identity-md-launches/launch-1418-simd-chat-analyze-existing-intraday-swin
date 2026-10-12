import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

// Tests own this server and close it in finally; it is not a background daemon.
export async function createPreview(extraHandler) {
  const root = resolve('dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = createServer(async (req, res) => {
    try {
      if (extraHandler && await extraHandler(req, res)) return;
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/preview/')) { res.writeHead(404); res.end('Not found'); return; }
      const file = resolve(root, pathname.slice('/preview/'.length) || 'index.html');
      if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/preview/`, close: () => new Promise(resolve => server.close(resolve)) };
}
