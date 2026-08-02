// 입력 — 화면의 커서를 격자의 칸으로 옮기고, 드래그를 획으로 만든다.
//
// 이 파일이 하는 일은 결국 screenToGrid 한 줄이다.
// 나머지는 좌표계를 어디서 재느냐와, 언제 획이 시작되고 끝나느냐의 문제.

import { screenToGrid } from './iso.js';
import { inBounds, beginStroke, extendStroke, commitStroke, cancelStroke } from './board.js';

// 커서가 가리키는 칸. 판 밖이거나 창을 벗어나면 null.
export const pointer = { cell: null, drawing: false };

export function attachPointer(canvas) {
  // 캔버스가 창을 꽉 채우더라도 좌표는 캔버스 기준으로 잰다.
  // 나중에 캔버스가 창의 일부만 차지하게 되어도 이 코드는 그대로 맞는다.
  function toCell(e) {
    const r = canvas.getBoundingClientRect();
    const g = screenToGrid(e.clientX - r.left, e.clientY - r.top);
    return inBounds(g.x, g.y) ? g : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    // 포인터를 캔버스에 붙잡아 둔다. 이렇게 해야 드래그가 창 밖으로
    // 나가도 이벤트가 계속 들어와, 밖에서 손을 떼도 획이 유령처럼
    // 남지 않는다.
    canvas.setPointerCapture(e.pointerId);

    pointer.cell = toCell(e);
    pointer.drawing = true;
    beginStroke(pointer.cell);
  });

  canvas.addEventListener('pointermove', (e) => {
    pointer.cell = toCell(e);
    if (pointer.drawing) extendStroke(pointer.cell);
  });

  canvas.addEventListener('pointerup', () => {
    if (!pointer.drawing) return;
    pointer.drawing = false;
    commitStroke();
  });

  // 시스템이 제스처를 가로챈 경우. 확정하지 않고 버린다.
  canvas.addEventListener('pointercancel', () => {
    pointer.drawing = false;
    cancelStroke();
  });

  canvas.addEventListener('pointerleave', () => {
    if (!pointer.drawing) pointer.cell = null;
  });

  // 긋는 도중 무르기. 확정된 판은 건드리지 않는다.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pointer.drawing) {
      pointer.drawing = false;
      cancelStroke();
    }
  });
}
