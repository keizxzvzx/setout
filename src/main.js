// SETOUT — 진입점

import {
  GRID_W, GRID_H, TILE_W, TILE_H, BLOCK_H,
  VIEW_MARGIN, VIEW_HEADROOM,
} from './config.js';
import { setView } from './iso.js';
import { clear, drawFloor, drawHoverCell } from './render.js';
import { pointer, attachPointer } from './input.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let viewW = 0;
let viewH = 0;

// 판 전체가 창 안에 들어오도록 배율과 원점을 잡는다.
//
// 원점 기준 배율 1 일 때의 경계 상자:
//   왼쪽   worldToScreen(0, GRID_H) → -GRID_H * TILE_W/2
//   오른쪽 worldToScreen(GRID_W, 0) → +GRID_W * TILE_W/2
//   위쪽   판을 올릴 여유(VIEW_HEADROOM)만큼 더 확보
//   아래쪽 worldToScreen(GRID_W, GRID_H)
//
// 이 상자를 여백 안에 넣는 배율을 구하고, 상자 중심을 화면 중심에 맞춘다.
// 배율은 1을 넘기지 않는다 — 큰 모니터에서 선을 억지로 늘려 흐려지는 것보다
// 여백이 넓은 편이 청사진 톤에 맞는다.
function fitView() {
  const left   = -GRID_H * (TILE_W / 2);
  const right  =  GRID_W * (TILE_W / 2);
  const top    = -VIEW_HEADROOM * BLOCK_H;
  const bottom = (GRID_W + GRID_H) * (TILE_H / 2);

  const boxW = right - left;
  const boxH = bottom - top;

  const scale = Math.min(
    1,
    (viewW - VIEW_MARGIN * 2) / boxW,
    (viewH - VIEW_MARGIN * 2) / boxH,
  );

  setView(
    viewW / 2 - ((left + right) / 2) * scale,
    viewH / 2 - ((top + bottom) / 2) * scale,
    scale,
  );
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;

  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  fitView();
}

function frame() {
  clear(ctx, viewW, viewH);
  drawFloor(ctx);
  drawHoverCell(ctx, pointer.cell);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
attachPointer(canvas);
resize();
requestAnimationFrame(frame);
