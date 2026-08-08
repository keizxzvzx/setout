// 정적 서버 — node serve.mjs [포트]
//
// 게임을 직접 돌려 보려면 이것이 필요하다. ES 모듈은 file:// 로 열면
// CORS 정책에 막혀 import 가 통째로 실패한다. 그래서 아무 정적 서버로든
// http:// 로 띄워야 하는데, 그 "아무" 를 저장소 안에 두어 클론만 하면
// 되게 한다. 게임이 라이브러리를 하나도 안 쓰므로 이것도 안 쓴다 —
// node 표준 모듈뿐이다.
//
// Cache-Control: no-store 를 반드시 보낸다. 3단계에서 휠이 크롬에서는 되고
// 파이어폭스에서는 안 되는 일이 있었는데, 원인은 코드가 아니라 브라우저가
// 들고 있던 구버전 input.js 였다. 옛 판본에는 휠 리스너가 아예 없으므로
// 그리기·지우기는 멀쩡한데 휠만 죽는 증상과 정확히 맞았다.
//
// 구·신 모듈이 섞이면 오류 없이 조용히 다르게 동작한다. 그런 버그는 코드를
// 아무리 들여다봐도 안 보인다.
//
// 배포(GitHub Pages)에는 이 파일이 관여하지 않는다. 거기서는 정적 파일을
// 그대로 내보내므로 index.html 과 src/ 만 있으면 된다.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2]) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);

  // 부지 밖으로 나가지 못하게 한다
  const path = join(ROOT, normalize(rel).replace(/^([/\\])+/, ''));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('나갈 수 없음');
    return;
  }

  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end('없음: ' + rel);
  }
});

server.listen(PORT, () => {
  console.log(`SETOUT  →  http://localhost:${PORT}/`);
  console.log(`부지     ${ROOT}`);
  console.log('캐시 안 함 (no-store) — 고친 것이 바로 반영된다');
});
