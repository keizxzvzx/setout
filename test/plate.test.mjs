import * as iso from '../src/iso.js';
import * as C from '../src/config.js';
const { PLATE_T } = C;

iso.setView(600, 200, 1);

let fail = 0;
const check = (n, c, e = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const t = PLATE_T * iso.view.scale;

for (const [x, y] of [[0, 0], [3, 5], [12, 12], [15, 15]]) {
  const base = iso.tileDiamond(x, y, 0);
  const top = base.map(p => ({ x: p.x, y: p.y - t }));

  // 판이 차지하는 화면 세로 범위
  const lo = Math.min(...top.map(p => p.y));
  const hi = Math.max(...base.map(p => p.y), ...top.map(p => p.y));

  // 같은 칸의 바닥 마름모 범위
  const fLo = Math.min(...base.map(p => p.y));
  const fHi = Math.max(...base.map(p => p.y));

  check(`(${x},${y}) 판 아랫변이 바닥 칸 아래끝과 일치`, Math.abs(hi - fHi) < 1e-9,
    `판 ${hi.toFixed(1)} vs 바닥 ${fHi.toFixed(1)}`);
  check(`(${x},${y}) 판이 앞칸을 침범하지 않음`, hi <= fHi + 1e-9);
  check(`(${x},${y}) 두께는 위로 ${PLATE_T}px`, Math.abs((fLo - lo) - t) < 1e-9,
    `위로 ${(fLo - lo).toFixed(1)}px`);
}

// 착시 등식이 두께 도입 뒤에도 유지되는가 — 모든 판이 같은 양만큼 올라가므로
// 판끼리의 상대 위치는 불변이어야 한다
const a = iso.tileDiamond(4, 4, 2).map(p => ({ x: p.x, y: p.y - t }));
const b = iso.tileDiamond(3, 3, 1).map(p => ({ x: p.x, y: p.y - t }));
const same = a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9);
check('두께를 넣어도 (4,4,z=2) 와 (3,3,z=1) 이 같은 픽셀', same);

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
