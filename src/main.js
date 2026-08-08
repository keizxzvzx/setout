// SETOUT — 진입점

import { STUCK_PAUSE } from './config.js';
import { fitView, view, setView } from './iso.js';
import { board } from './board.js';
import { updateActor } from './actor.js';
import { session, beginRun, beginFlip, updateFlip, flip, isStuck } from './session.js';
import {
  clear, drawFloor, drawFootprints, drawGoal, drawPlates,
  drawStroke, drawHoverCell, drawInkGauge, drawControls, drawSheetNo, drawLogo,
  drawResetNotice,
} from './render.js';
import { pointer, attachPointer, abortGesture, resyncPointer } from './input.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let viewW = 0;
let viewH = 0;

// 목표에 닿고 나서 도면을 넘기기까지 두는 사이. 도착한 것을 볼 새는 줘야 한다.
const CLEAR_PAUSE = 0.8;
let clearedFor = 0;

// 못 쓰게 된 도면을 다시 뜨기까지. 손을 놓고 잠깐 두었을 때만 반응해야,
// 지우는 중에 도면이 넘어가지 않는다. 값과 그 근거는 config.STUCK_PAUSE —
// 화면에 남은 초를 적는 쪽과 같은 값을 봐야 해서 저기 있다.
let stuckFor = 0;

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

  // 창이 아직 그려지지 않은 채로 로드되면 innerWidth 가 0 이다. 그러면 캔버스가
  // 0×0 으로 잡히고 fitView 의 배율이 음수가 되어, 리사이즈 이벤트가 올 때까지
  // 빈 화면이 남는다. 오류가 아니라 아무것도 안 나오는 것이라 원인도 안 보인다.
  //
  // 재는 것을 미루지는 않는다 — beginRun 이 iso 에 잡힌 크기를 필요로 하므로
  // 지금 한 번은 잡아 두고, 크기가 생기면 다시 잰다. 탭이 숨어 있으면 rAF 가
  // 안 돌지만 그때는 그릴 것도 없고, 보이는 순간 재개되어 저절로 맞는다.
  if (!viewW || !viewH) requestAnimationFrame(resize);
}

// 탭이 뒤로 갔다 오면 프레임 간격이 몇 초로 벌어진다.
// 그대로 쓰면 캐릭터가 경로를 순간이동으로 끝내므로 한 프레임 몫으로 자른다.
let lastTime = 0;

function frame(now) {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;

  updateActor(dt);

  // 도착하면 잠깐 두었다가 도면을 넘긴다. 디렉터는 넘기는 한복판에서 불린다.
  //
  // 넘기기 전에 하던 제스처를 놓는다. 도착 직후 손을 떼지 않고 있는 일은
  // 흔한데(CLEAR_PAUSE 가 0.8초다), 그대로 두면 이전 층에 대고 긋던 획이
  // 새 층에 확정된다. abortGesture 참조.
  if (board.cleared && !flip.on) {
    clearedFor += dt;
    if (clearedFor >= CLEAR_PAUSE) {
      clearedFor = 0;
      abortGesture();
      beginFlip();
    }
  }

  // 더 갈 수 없게 된 도면은 다시 뜬다. 아무 일도 안 일어나는 것이 제일 나쁘다.
  //
  // 손을 놓고 있을 때만 본다. 긋거나 지우는 중에는 아직 판단이 안 끝난 상태라
  // 그때 도면이 넘어가면 플레이어가 하던 일을 뺏긴다.
  const idle = !pointer.mode && !board.actor?.path;
  stuckFor = idle && isStuck() ? stuckFor + dt : 0;

  if (stuckFor >= STUCK_PAUSE) {
    stuckFor = 0;
    abortGesture();
    beginFlip({ redeal: true });
  }

  // 넘기기가 끝나는 순간 커서 아래를 다시 집는다. 손은 안 움직였으므로
  // 가리키는 자리는 맞지만, 그 자리에 있던 판은 이미 없어졌다.
  const wasFlipping = flip.on;
  const shift = updateFlip(dt);
  if (wasFlipping && !flip.on) resyncPointer();

  clear(ctx, viewW, viewH);

  // 바닥은 제도판이라 움직이지 않는다. 넘어가는 것은 그 위에 그린 도면이다.
  drawFloor(ctx);

  const baseY = view.oy;
  if (shift) setView(view.ox, baseY + shift * viewH, view.scale);

  // 발자국은 바닥 다음, 목표 앞. 그 자리에 판이 다시 깔리면 가려지는 것이 맞고,
  // 목표 표식이 발자국에 묻히면 어디로 가야 하는지가 안 보인다.
  drawFootprints(ctx);
  drawGoal(ctx);        // 바닥에 찍힌 표식. 판을 깔면 가려지는 것이 맞다
  drawPlates(ctx);      // 캐릭터는 판을 전부 그린 뒤 여기서 같이 그려진다

  if (shift) setView(view.ox, baseY, view.scale);

  // 넘어가는 동안에는 커서를 그리지 않는다. 도면이 손 밑을 빠져나가는 중이라
  // 무엇을 겨냥하고 있는지가 뜻을 잃는다.
  if (!flip.on) {
    drawStroke(ctx);
    // 긋는 중에는 획 자체가 커서를 대신하므로 하이라이트를 겹쳐 띄우지 않는다.
    if (pointer.mode !== 'draw') drawHoverCell(ctx, pointer);
  }

  // 이 넷은 도면이 아니라 제도판 위의 표시다. 층이 넘어가도 제자리에 있는다.
  //
  // 층 번호만 도면을 따라 바뀐다. session.stages 가 도면이 갈리는 한복판에서
  // 올라가므로, 숫자가 튀는 순간 화면에는 빈 도면만 있다.
  drawInkGauge(ctx, viewW, viewH);
  drawControls(ctx);
  drawSheetNo(ctx, viewW, session.stages + 1);
  drawLogo(ctx, viewW, viewH);

  // 리셋 예고도 같은 띠에 얹힌다.
  //
  // 막혀 있는 동안에만 띄운다 — stuckFor 는 막힘이 풀리는 순간 0 이 되므로
  // 그 자체가 조건이다. 넘어가는 중에도 안 띄운다. 이미 넘어가고 있는데
  // 곧 넘어간다고 말하는 것은 뜻이 없다.
  if (stuckFor > 0 && !flip.on) drawResetNotice(ctx, viewW, STUCK_PAUSE - stuckFor);

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
attachPointer(canvas);

// 창 크기를 먼저 잡는다. 층을 세울 때 iso 가 그 크기를 기억하고 있어야
// 상한이 바뀔 때마다 같은 창에 다시 맞출 수 있다.
resize();
beginRun();
requestAnimationFrame(frame);
