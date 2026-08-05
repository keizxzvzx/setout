// SETOUT — 진입점

import { fitView } from './iso.js';
import { board } from './board.js';
import { updateActor } from './actor.js';
import { beginRun, nextStage } from './session.js';
import {
  clear, drawFloor, drawGoal, drawPlates, drawStroke, drawHoverCell, drawInkGauge,
} from './render.js';
import { pointer, attachPointer } from './input.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let viewW = 0;
let viewH = 0;

// 목표에 닿고 나서 다음 층까지 두는 사이. 도착한 것을 볼 새는 줘야 한다.
const CLEAR_PAUSE = 1.2;
let clearedFor = 0;

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

// 탭이 뒤로 갔다 오면 프레임 간격이 몇 초로 벌어진다.
// 그대로 쓰면 캐릭터가 경로를 순간이동으로 끝내므로 한 프레임 몫으로 자른다.
let lastTime = 0;

function frame(now) {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;

  updateActor(dt);

  // 도착하면 잠깐 두었다가 다음 층으로. 디렉터는 여기서 처음 불린다.
  if (board.cleared) {
    clearedFor += dt;
    if (clearedFor >= CLEAR_PAUSE) {
      clearedFor = 0;
      nextStage();
    }
  }

  clear(ctx, viewW, viewH);
  drawFloor(ctx);
  drawGoal(ctx);        // 바닥에 찍힌 표식. 판을 깔면 가려지는 것이 맞다
  drawPlates(ctx);      // 캐릭터는 자기가 선 칸 다음에 여기서 같이 그려진다
  drawStroke(ctx);
  // 긋는 중에는 획 자체가 커서를 대신하므로 하이라이트를 겹쳐 띄우지 않는다.
  if (pointer.mode !== 'draw') drawHoverCell(ctx, pointer);
  drawInkGauge(ctx, viewW, viewH);

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
attachPointer(canvas);

// 창 크기를 먼저 잡는다. 층을 세울 때 iso 가 그 크기를 기억하고 있어야
// 상한이 바뀔 때마다 같은 창에 다시 맞출 수 있다.
resize();
beginRun();
requestAnimationFrame(frame);
