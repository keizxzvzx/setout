// 도착 점화 — 층을 끝낸 순간이 보이는가
//
// 도착하고 도면이 넘어가기까지 CLEAR_PAUSE 가 있는데, 그 사이가 비어 있었다.
// 층을 끝낸 순간이 이 게임의 유일한 보상인데 그것을 도면이 넘어가는 것으로야
// 알았다(플레이 테스트). 그래서 목표 표식이 찍히듯 앰버 링이 퍼진다.
//
// 연출은 눈으로 확인하면 안 되는 쪽이 따로 있다 — 색이 앰버 문법을 지키는가,
// 시작과 끝에서 정말 아무것도 안 그리는가(넘어가는 도면에 빛이 남으면 안
// 된다), 링이 목표 칸에서 나는가. 전부 코드로 확인한다.

import { COLOR, PLATE_T } from '../src/config.js';
import { board, addPlate, resetBoard } from '../src/board.js';
import { setStage } from '../src/stage.js';
import { fitView, worldToScreen, view } from '../src/iso.js';
import { drawClearBurst } from '../src/render.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

fitView(1489, 863);

// 그리기 명령을 받아 적는 가짜 컨텍스트. 획마다 그 순간의 색·투명도·점을 남긴다.
function recorder() {
  const r = { strokes: [] };
  let path = [];
  const ctx = {
    globalAlpha: 1, strokeStyle: '', lineWidth: 0, lineCap: '',
    shadowColor: '', shadowBlur: 0,
    save() {}, restore() {},
    beginPath() { path = []; },
    closePath() {},
    moveTo(x, y) { path.push({ x, y }); },
    lineTo(x, y) { path.push({ x, y }); },
    stroke() {
      r.strokes.push({ color: ctx.strokeStyle, alpha: ctx.globalAlpha, pts: [...path] });
    },
    fill() {},
    _r: r,
  };
  return ctx;
}

const burstAt = (t) => {
  const ctx = recorder();
  drawClearBurst(ctx, board.goal, t);
  return ctx._r.strokes;
};

const GOAL = { x: 5, y: 3 };
setStage({ zMax: 8, inkMax: 99, start: { x: 3, y: 3 }, goal: GOAL, fixtures: [] });
resetBoard();
addPlate([GOAL], 0);
board.goal = { ...GOAL };

// 시작과 끝. 도면이 넘어가는 순간(t=1)에 빛이 남아 있으면, 링이 다음 층
// 위로 넘어간다.
check('시작 전에는 아무것도 없다', burstAt(0).length === 0);
check('끝난 뒤에도 아무것도 없다', burstAt(1).length === 0);
check('음수 진행도에도 없다', burstAt(-0.5).length === 0);

// 한복판. 링이 나고, 색은 앰버뿐이다 — 도착은 목표 표식의 일이다.
const mid = burstAt(0.5);
check('한복판에는 링이 있다', mid.length >= 2, `${mid.length}개`);
check('전부 앰버다', mid.every((s) => s.color === COLOR.amber),
      mid.map((s) => s.color).join(' '));

// 링의 중심이 목표 칸이다.
const gc = worldToScreen(GOAL.x + 0.5, GOAL.y + 0.5, 0);
gc.y -= PLATE_T * view.scale;
const centerOf = (s) => ({
  x: s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length,
  y: s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length,
});
check('링이 목표 칸에서 난다',
      mid.every((s) => {
        const c = centerOf(s);
        return Math.abs(c.x - gc.x) < 1 && Math.abs(c.y - gc.y) < 1;
      }));

// 퍼진다 — 나중일수록 첫 링이 크다.
const spread = (t) => {
  const s = burstAt(t)[0];
  return Math.max(...s.pts.map((p) => Math.abs(p.x - gc.x)));
};
check('링이 퍼져 나간다', spread(0.55) > spread(0.15),
      `${spread(0.15).toFixed(1)} → ${spread(0.55).toFixed(1)}`);

// 잦아든다 — 끝으로 갈수록 옅다.
const brightest = (t) => Math.max(...burstAt(t).map((s) => s.alpha), 0);
check('끝으로 갈수록 옅어진다', brightest(0.95) < brightest(0.35),
      `${brightest(0.35).toFixed(2)} → ${brightest(0.95).toFixed(2)}`);
check('다 잦아들며 끝난다', brightest(0.98) < 0.2, brightest(0.98).toFixed(2));

// 목표 칸의 판이 올라가 있으면 링도 따라 올라간다. 도착 판정이 격자 좌표라
// 뜬 판 위 도착도 있다 — 링이 바닥에서 나면 엉뚱한 데가 찍힌 것으로 보인다.
resetBoard();
addPlate([GOAL], 2);
board.goal = { ...GOAL };            // resetBoard 가 목표도 지운다
const raised = burstAt(0.5);
check('올라간 판 위에서는 링도 올라간다',
      raised.length > 0 && centerOf(raised[0]).y < gc.y - 1,
      `${centerOf(raised[0]).y.toFixed(1)} < ${gc.y.toFixed(1)}`);

// 목표가 없으면(층 사이) 아무것도 안 그린다.
board.goal = null;
check('목표가 없으면 그리지 않는다', burstAt(0.5).length === 0);

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
