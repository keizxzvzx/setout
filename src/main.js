// SETOUT — 진입점

import { START_CELL, GOAL_CELL } from './config.js';
import { fitView } from './iso.js';
import { board, addPlate } from './board.js';
import { placeActor, updateActor } from './actor.js';
import {
  clear, drawFloor, drawGoal, drawPlates, drawStroke, drawHoverCell, drawInkGauge,
} from './render.js';
import { pointer, attachPointer } from './input.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let viewW = 0;
let viewH = 0;

// 층 하나를 세운다. 6단계부터는 AI 디렉터가 이 세 줄을 정한다.
//
// 시작 발판은 한 칸뿐이다. 판이 없으면 캐릭터가 설 자리가 없어서 하나는
// 필요하지만, 넓게 깔면 그리기를 배우기 전에 걷기부터 하게 된다.
// 한 칸만 주면 갈 곳이 없으므로 무조건 바닥을 문질러 보게 된다.
function setupStage() {
  addPlate([START_CELL]);
  placeActor(START_CELL.x, START_CELL.y);
  board.goal = { x: GOAL_CELL.x, y: GOAL_CELL.y };
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

  fitView(viewW, viewH);
}

// 탭이 뒤로 갔다 오면 프레임 간격이 몇 초로 벌어진다.
// 그대로 쓰면 캐릭터가 경로를 순간이동으로 끝내므로 한 프레임 몫으로 자른다.
let lastTime = 0;

function frame(now) {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;

  updateActor(dt);

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
setupStage();
resize();
requestAnimationFrame(frame);
