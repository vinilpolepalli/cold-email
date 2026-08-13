// Tiny static server for the fictional Averton Tech faculty site — a local
// test fixture for the Sloan scraping agent. Run: npm run mock:university
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const PORT = Number(process.env.MOCK_UNIVERSITY_PORT ?? 4001);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let filePath = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!filePath.startsWith(ROOT)) throw new Error('forbidden');
    if (!path.extname(filePath)) filePath += '.html';
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Averton Tech (mock university) serving at http://localhost:${PORT}`);
});
