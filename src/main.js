// SETOUT — 진입점

import { fitView } from './iso.js';
import { clear, drawFloor, drawPlates, drawStroke, drawHoverCell, drawInkGauge } from './render.js';
import { pointer, attachPointer } from './input.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let viewW = 0;
let viewH = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;

  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  fitView(viewW, viewH);
}

function frame() {
  clear(ctx, viewW, viewH);
  drawFloor(ctx);
  drawPlates(ctx);
  drawStroke(ctx);
  // 긋는 중에는 획 자체가 커서를 대신하므로 하이라이트를 겹쳐 띄우지 않는다.
  if (pointer.mode !== 'draw') drawHoverCell(ctx, pointer);
  drawInkGauge(ctx, viewW, viewH);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
attachPointer(canvas);
resize();
requestAnimationFrame(frame);
