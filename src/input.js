// 입력 — 화면의 커서를 격자의 칸으로 옮긴다.
//
// 이 파일이 하는 일은 결국 screenToGrid 한 줄이다.
// 나머지는 좌표계를 어디서 재느냐의 문제.

import { GRID_W, GRID_H } from './config.js';
import { screenToGrid } from './iso.js';

// 커서가 가리키는 칸. 판 밖이거나 창을 벗어나면 null.
export const pointer = { cell: null };

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

export function attachPointer(canvas) {
  // 캔버스가 창을 꽉 채우더라도 좌표는 캔버스 기준으로 잰다.
  // 나중에 캔버스가 창의 일부만 차지하게 되어도 이 코드는 그대로 맞는다.
  function toCell(e) {
    const r = canvas.getBoundingClientRect();
    const g = screenToGrid(e.clientX - r.left, e.clientY - r.top);
    return inBounds(g.x, g.y) ? g : null;
  }

  canvas.addEventListener('pointermove', (e) => {
    pointer.cell = toCell(e);
  });

  // 창 밖으로 나가면 하이라이트를 남겨두지 않는다.
  canvas.addEventListener('pointerleave', () => {
    pointer.cell = null;
  });
}
