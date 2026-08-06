// 입력 — 화면의 커서를 격자의 칸으로 옮기고, 드래그를 획으로 만든다.
//
// 이 파일이 하는 일은 결국 screenToGrid 한 줄이다.
// 나머지는 좌표계를 어디서 재느냐와, 언제 획이 시작되고 끝나느냐의 문제.

import { screenToGrid, screenToPlateGrid } from './iso.js';
import {
  inBounds, pickAt, movePlate,
  beginStroke, extendStroke, commitStroke, cancelStroke,
  beginErase, extendErase, commitErase,
} from './board.js';
import { walkTo } from './actor.js';
import { flip } from './session.js';

// cell  : 커서가 가리키는 바닥칸. 부지 밖이거나 창을 벗어나면 null
// hit   : 커서 아래에 실제로 보이는 판 칸. 없으면 null
// mode  : null | 'draw' | 'erase'
// button: 그 동작을 시작한 마우스 버튼
//
// 둘을 따로 두는 이유는 판이 뜨면 서로 다른 칸을 가리키게 되기 때문이다.
// 그리기는 바닥에서 일어나므로 cell 을 보고, 지우기·휠·하이라이트는
// 눈에 보이는 것을 대상으로 하므로 hit 을 본다.
export const pointer = { cell: null, hit: null, mode: null, button: -1 };

export function attachPointer(canvas) {
  // 캔버스가 창을 꽉 채우더라도 좌표는 캔버스 기준으로 잰다.
  // 나중에 캔버스가 창의 일부만 차지하게 되어도 이 코드는 그대로 맞는다.
  function toCell(e) {
    const r = canvas.getBoundingClientRect();
    const g = screenToGrid(e.clientX - r.left, e.clientY - r.top);
    return inBounds(g.x, g.y) ? g : null;
  }

  // 판을 겨냥할 때 쓰는 바닥칸. 부지 밖이라고 버리지 않는다.
  // 뜬 판은 (x−z, y−z) 자리, 즉 부지 바깥 위쪽에 나타나므로
  // 여기서 경계를 걸면 올린 판을 아예 집을 수 없게 된다.
  function toPlateCell(e) {
    const r = canvas.getBoundingClientRect();
    return screenToPlateGrid(e.clientX - r.left, e.clientY - r.top);
  }

  function finish() {
    if (pointer.mode === 'draw') commitStroke();
    else if (pointer.mode === 'erase') commitErase();
    pointer.mode = null;
    pointer.button = -1;
  }

  // 이번 휠 제스처가 붙잡고 있는 판, 그리고 아직 한 칸에 못 미친 나머지.
  let wheelHit = null;
  let wheelAccum = 0;

  // 우클릭이 지우개이므로 브라우저 기본 메뉴를 막는다.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    // 도면을 넘기는 중에는 받지 않는다. 손 밑에서 도면이 빠져나가는 중이라
    // 어느 층에 그은 것인지가 정해지지 않는다.
    if (flip.on) return;

    // 이미 한 버튼으로 작업 중이면 다른 버튼은 무시한다.
    // 좌클릭으로 긋다가 우클릭이 끼어들면 두 동작이 섞인다.
    if (pointer.mode) return;
    if (e.button !== 0 && e.button !== 2) return;

    // 포인터를 캔버스에 붙잡아 둔다. 이렇게 해야 드래그가 창 밖으로
    // 나가도 이벤트가 계속 들어와, 밖에서 손을 떼도 획이 유령처럼
    // 남지 않는다.
    canvas.setPointerCapture(e.pointerId);

    const pc = toPlateCell(e);
    pointer.cell = toCell(e);
    pointer.hit = pickAt(pc.x, pc.y);
    pointer.button = e.button;

    if (e.button === 0) {
      // 무엇을 눌렀는가가 무엇을 하는가를 정한다.
      // 판 위를 눌렀으면 걷기, 빈 바닥을 눌렀으면 그리기다. 수식 키가 없다.
      //
      // 목적지는 누른 칸이고 뗀 위치는 보지 않는다. 모드가 pointerdown 에서
      // 확정되므로 뗄 때 다시 물을 것이 없고, 뜬 판은 올린 만큼 화면에서
      // 물러나 있어 누른 채 커서를 움직이면 판이 커서 밑을 벗어난다.
      // 뗀 지점을 목적지로 잡으면 높은 판일수록 조준이 어긋난다.
      if (pointer.hit) {
        pointer.mode = 'walk';
        walkTo(pointer.hit.x, pointer.hit.y);
      } else {
        pointer.mode = 'draw';
        beginStroke(pointer.cell);
      }
    } else {
      pointer.mode = 'erase';
      beginErase(pc);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    // 커서가 움직이면 휠이 붙잡고 있던 판을 놓는다. 아래 wheel 참조.
    wheelHit = null;
    wheelAccum = 0;

    const pc = toPlateCell(e);
    pointer.cell = toCell(e);
    pointer.hit = pickAt(pc.x, pc.y);

    if (pointer.mode === 'draw') extendStroke(pointer.cell);
    else if (pointer.mode === 'erase') extendErase(pc);
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
    if (pointer.mode) return;
    pointer.cell = null;
    pointer.hit = null;
    wheelHit = null;
  });

  // --- 휠: 판 높이 ---
  //
  // 판을 한 칸 올리면 그 판은 화면에서 (x−z, y−z) 만큼, 즉 위쪽 뒤로 빠진다.
  // 커서는 그 자리에 있으므로 매번 다시 집으면 한 칸 올리고 놓치기를 반복한다.
  // 그래서 제스처가 시작될 때 잡힌 판을 붙잡아 두고, 커서가 움직일 때 놓는다.
  // 휠을 굴리는 동안 커서는 보통 가만히 있으므로 제스처 전체가 한 판에 걸린다.
  //
  // 한 노치가 한 칸이다. 그런데 deltaY 를 그대로 믿을 수가 없다.
  // 단위가 브라우저마다 다르고(픽셀 / 줄 / 페이지), 같은 픽셀 단위라도
  // 휠 마우스는 한 번에 100 안팎을 보내는 반면 트랙패드는 4 정도를 잘게
  // 여러 번 보낸다. 어느 한쪽에 문턱을 맞추면 다른 쪽이 죽거나 폭주한다.
  //
  // 그래서 크기를 재지 않고 종류를 가른다. 한 번에 크게 오면 그것이 노치
  // 하나이고 값의 크기는 무시한다. 잘게 오면 쌓아서 문턱을 넘을 때 한 칸.
  const WHEEL_NOTCH = 50;   // 이 이상이면 그 자체로 한 노치
  const WHEEL_FINE  = 30;   // 잘게 오는 장치는 이만큼 쌓일 때마다 한 칸

  canvas.addEventListener('wheel', (e) => {
    // 긋는 중에는 무시한다. 한 손으로 두 가지를 하는 상황이라 의도를 알 수 없다.
    if (pointer.mode || flip.on) return;

    if (!wheelHit) {
      const pc = toPlateCell(e);
      wheelHit = pickAt(pc.x, pc.y);
    }
    if (!wheelHit) return;   // 빈 바닥 위에서는 페이지 스크롤을 막지 않는다

    e.preventDefault();

    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
    const delta = e.deltaY * unit;
    if (Math.sign(delta) !== Math.sign(wheelAccum)) wheelAccum = 0;

    let steps;
    if (Math.abs(delta) >= WHEEL_NOTCH) {
      steps = Math.sign(delta);
      wheelAccum = 0;
    } else {
      wheelAccum += delta;
      steps = Math.trunc(wheelAccum / WHEEL_FINE);
      wheelAccum -= steps * WHEEL_FINE;
    }
    if (!steps) return;

    // 휠을 위로 굴리면 deltaY 가 음수다. 판은 올라가야 한다.
    if (movePlate(wheelHit.plate, -steps)) {
      // 하이라이트가 판을 따라 올라간다. 잡고 있는 것이 무엇인지 보여야 한다.
      wheelHit.z = wheelHit.plate.z;
      pointer.hit = wheelHit;
    }
  }, { passive: false });

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
