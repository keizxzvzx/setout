// 좌표계 — 등각 투영과 자동 축척 카메라
//
// 좌표 변환은 틀려도 화면상 그럴듯해 보인다. 눈으로 확인하지 않는다.

import * as iso from '../src/iso.js';
import * as cfg from '../src/config.js';

const { GRID_W, GRID_H } = cfg;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const WINDOWS = [[1489, 863], [1366, 768], [1920, 1080], [3840, 2160], [900, 600]];

for (const [w, h] of WINDOWS) {
  iso.fitView(w, h);
  const label = `${w}×${h}`;

  // 1) 판 네 꼭짓점이 화면 안에 있는가
  //    심사자가 링크를 열었을 때 첫 화면이 잘려 있으면 그것으로 끝이다.
  const pts = [
    iso.worldToScreen(0, 0), iso.worldToScreen(GRID_W, 0),
    iso.worldToScreen(GRID_W, GRID_H), iso.worldToScreen(0, GRID_H),
  ];
  check(`${label} 판 네 꼭짓점이 화면 안`,
    pts.every((p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h),
    `scale=${iso.view.scale.toFixed(4)}`);

  // 2) 투영 → 역투영 왕복이 원래 칸으로 돌아오는가 (칸 중앙 표본)
  //    여기가 어긋나면 그은 곳과 칠해지는 곳이 다른 게임이 된다.
  let bad = 0;
  for (let gx = 0; gx < GRID_W; gx++) {
    for (let gy = 0; gy < GRID_H; gy++) {
      const c = iso.worldToScreen(gx + 0.5, gy + 0.5);
      const g = iso.screenToGrid(c.x, c.y);
      if (g.x !== gx || g.y !== gy) bad++;
    }
  }
  check(`${label} 왕복 ${GRID_W * GRID_H}칸`, bad === 0, `${bad}건 어긋남`);

  // 3) 착시 등식 — (x+1, y+1) 이동과 (z−1) 이동이 같은 픽셀인가
  //    이 등식이 이 게임의 전제다. 배율이 걸린 상태에서도 유지되어야 한다.
  //    균등 배율은 양변에 똑같이 곱해지므로 등식을 보존하고,
  //    가로·세로를 따로 늘리는 비균등 배율만 이것을 깬다.
  const b = iso.worldToScreen(4, 4, 2);
  const c = iso.worldToScreen(3, 3, 1);
  check(`${label} (4,4,z=2) = (3,3,z=1)`,
    Math.abs(b.x - c.x) < 1e-9 && Math.abs(b.y - c.y) < 1e-9,
    `${b.x.toFixed(3)},${b.y.toFixed(3)} vs ${c.x.toFixed(3)},${c.y.toFixed(3)}`);
}

// 4) 배율이 균등한가
//    비균등 배율은 착시 등식을 깨므로 가로·세로를 따로 잡는 일이 없어야 한다.
iso.fitView(900, 600);
const dx = iso.worldToScreen(1, 0).x - iso.worldToScreen(0, 0).x;
const dy = iso.worldToScreen(1, 1).y - iso.worldToScreen(0, 0).y;
check('가로·세로 배율이 같음',
  Math.abs(dx / (cfg.TILE_W / 2) - dy / cfg.TILE_H) < 1e-9,
  `가로 ${(dx / (cfg.TILE_W / 2)).toFixed(6)} vs 세로 ${(dy / cfg.TILE_H).toFixed(6)}`);

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
