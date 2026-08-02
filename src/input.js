// 입력 — 화면의 커서를 격자의 칸으로 옮기고, 드래그를 획으로 만든다.
//
// 이 파일이 하는 일은 결국 screenToGrid 한 줄이다.
// 나머지는 좌표계를 어디서 재느냐와, 언제 획이 시작되고 끝나느냐의 문제.

import { screenToGrid } from './iso.js';
import {
  inBounds,
  beginStroke, extendStroke, commitStroke, cancelStroke,
  beginErase, extendErase, commitErase,
} from './board.js';

// cell  : 커서가 가리키는 칸. 판 밖이거나 창을 벗어나면 null
// mode  : null | 'draw' | 'erase'
// button: 그 동작을 시작한 마우스 버튼
export const pointer = { cell: null, mode: null, button: -1 };

export function attachPointer(canvas) {
  // 캔버스가 창을 꽉 채우더라도 좌표는 캔버스 기준으로 잰다.
  // 나중에 캔버스가 창의 일부만 차지하게 되어도 이 코드는 그대로 맞는다.
  function toCell(e) {
    const r = canvas.getBoundingClientRect();
    const g = screenToGrid(e.clientX - r.left, e.clientY - r.top);
    return inBounds(g.x, g.y) ? g : null;
  }

  function finish() {
    if (pointer.mode === 'draw') commitStroke();
    else if (pointer.mode === 'erase') commitErase();
    pointer.mode = null;
    pointer.button = -1;
  }

  // 우클릭이 지우개이므로 브라우저 기본 메뉴를 막는다.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    // 이미 한 버튼으로 작업 중이면 다른 버튼은 무시한다.
    // 좌클릭으로 긋다가 우클릭이 끼어들면 두 동작이 섞인다.
    if (pointer.mode) return;
    if (e.button !== 0 && e.button !== 2) return;

    // 포인터를 캔버스에 붙잡아 둔다. 이렇게 해야 드래그가 창 밖으로
    // 나가도 이벤트가 계속 들어와, 밖에서 손을 떼도 획이 유령처럼
    // 남지 않는다.
    canvas.setPointerCapture(e.pointerId);

    pointer.cell = toCell(e);
    pointer.button = e.button;

    if (e.button === 0) {
      pointer.mode = 'draw';
      beginStroke(pointer.cell);
    } else {
      pointer.mode = 'erase';
      beginErase(pointer.cell);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    pointer.cell = toCell(e);
    if (pointer.mode === 'draw') extendStroke(pointer.cell);
    else if (pointer.mode === 'erase') extendErase(pointer.cell);
  });

  canvas.addEventListener('pointerup', (e) => {
    // 시작한 버튼이 떼어졌을 때만 끝낸다.
    if (!pointer.mode || e.button !== pointer.button) return;
    finish();
  });

  // 시스템이 제스처를 가로챈 경우. 긋던 획은 확정하지 않고 버린다.
  canvas.addEventListener('pointercancel', () => {
    if (pointer.mode === 'draw') cancelStroke();
    else if (pointer.mode === 'erase') commitErase();
    pointer.mode = null;
    pointer.button = -1;
  });

  canvas.addEventListener('pointerleave', () => {
    if (!pointer.mode) pointer.cell = null;
  });

  // 긋는 도중 무르기. 확정된 판은 건드리지 않는다.
  // 지우기는 이미 반영된 뒤라 무를 것이 없고, 갈라진 판만 정리하고 끝낸다.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pointer.mode) return;
    if (pointer.mode === 'draw') {
      cancelStroke();
      pointer.mode = null;
      pointer.button = -1;
    } else {
      finish();
    }
  });
}
