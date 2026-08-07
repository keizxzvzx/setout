// 화면 모서리 표시 — 조작 안내와 층 번호
//
// 이 게임은 "튜토리얼 문구 없음" 을 원칙으로 세웠고, 그것을 어긴 자리가 여기다.
// 어긴 이상 **틀린 말을 하지 않는 것**이 조건이 된다. 화면이 "RMB 는 지우기" 라고
// 적어 두었는데 input.js 가 다른 일을 하면, 문구가 없는 것보다 나쁘다.
//
// 그래서 두 가지를 지킨다.
//
//   조작 안내에 적힌 것이 실제 입력 규칙과 같은가
//   두 상자가 같은 크기인가 — 한 쌍으로 읽히려면 크기가 맞아야 한다
//
// 브라우저 없이 돌리려고 캔버스를 흉내 낸다. 폭 계산이 measureText 에 달려
// 있으므로 등폭 글꼴을 글자 수 × 0.6 배로 모사한다. 정확한 픽셀이 아니라
// **두 상자가 같은 값을 쓰는가**를 보는 것이라 이 정도로 충분하다.

import { VIEW_MARGIN } from '../src/config.js';
import { CONTROLS, drawControls, drawSheetNo, drawLogo } from '../src/render.js';
import { board, key, addPlate, resetBoard } from '../src/board.js';
import { stage, setStage } from '../src/stage.js';
import { fitView, worldToScreen, view } from '../src/iso.js';
import { placeActor } from '../src/actor.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

fitView(1489, 863);
const VIEW_W = 1489;

// --- 캔버스 흉내 ------------------------------------------------------------
function recorder() {
  const r = { rects: [], strokeRects: [], texts: [] };
  let font = '10px monospace';
  const size = () => parseFloat(font) || 10;

  return {
    _r: r,
    save() {}, restore() {},
    set font(v) { font = v; }, get font() { return font; },
    set fillStyle(v) {}, set strokeStyle(v) {},
    set globalAlpha(v) {}, set lineWidth(v) {},
    set textAlign(v) {}, set textBaseline(v) {},
    setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, arc() {}, ellipse() {}, clip() {}, fill() {}, stroke() {},
    measureText: (t) => ({ width: t.length * size() * 0.6 }),
    fillRect: (x, y, w, h) => r.rects.push({ x, y, w, h }),
    strokeRect: (x, y, w, h) => r.strokeRects.push({ x, y, w, h }),
    fillText: (t, x, y) => r.texts.push({ t, x, y, px: size() }),
  };
}

const panelOf = (draw) => {
  const ctx = recorder();
  draw(ctx);
  // hudPanel 이 바탕을 한 번 칠하고 테두리를 한 번 두른다
  return { fill: ctx._r.rects[0], border: ctx._r.strokeRects[0], texts: ctx._r.texts };
};

// ---------------------------------------------------------------------------
// 1. 두 상자가 같은 크기인가
// ---------------------------------------------------------------------------
{
  const L = panelOf((c) => drawControls(c));
  const R = panelOf((c) => drawSheetNo(c, VIEW_W, 1));

  check('조작 안내 상자가 하나 그려진다', !!L.fill && !!L.border);
  check('층 번호 상자가 하나 그려진다', !!R.fill && !!R.border);

  // 같은 크기로 두면 담을 것이 두 글자뿐인 쪽이 더 크게 보인다.
  // 층 번호는 계속 눈에 남는 것이라 조작 안내보다 조용해야 한다.
  const ratio = (a, b) => Math.abs(a / b - 2 / 3) < 0.05;
  check('층 번호 상자는 조작 안내의 2/3 폭', ratio(R.fill.w, L.fill.w),
        `${R.fill.w.toFixed(1)} / ${L.fill.w.toFixed(1)}`);
  check('높이도 2/3', ratio(R.fill.h, L.fill.h), `${R.fill.h} / ${L.fill.h}`);
  check('윗변은 같은 높이에 있다', L.fill.y === R.fill.y, `${L.fill.y} / ${R.fill.y}`);

  check('왼쪽 여백이 잉크 게이지와 같다', L.fill.x === VIEW_MARGIN, `${L.fill.x}`);
  check('오른쪽 여백도 같다', VIEW_W - (R.fill.x + R.fill.w) === VIEW_MARGIN,
        `${VIEW_W - (R.fill.x + R.fill.w)}`);

  // 도면명은 우하단. 담을 것이 한 줄뿐이라 층 번호보다 작아야 한다 —
  // 읽을 것이 적은 쪽이 더 크면 눈길이 엉뚱한 데로 간다.
  const VIEW_H = 863;
  const G = panelOf((c) => drawLogo(c, VIEW_W, VIEW_H));

  check('도면명 상자가 하나 그려진다', !!G.fill && !!G.border);
  check('도면명은 층 번호보다 작다', G.fill.w < R.fill.w && G.fill.h < R.fill.h,
        `${G.fill.w.toFixed(1)}×${G.fill.h} / ${R.fill.w.toFixed(1)}×${R.fill.h}`);
  check('오른쪽 여백은 층 번호와 같다',
        VIEW_W - (G.fill.x + G.fill.w) === VIEW_MARGIN,
        `${VIEW_W - (G.fill.x + G.fill.w)}`);
  check('아랫변이 잉크 게이지와 맞는다', VIEW_H - (G.fill.y + G.fill.h) === VIEW_MARGIN,
        `${VIEW_H - (G.fill.y + G.fill.h)}`);
  check('SETOUT 한 줄뿐이다', G.texts.length === 'SETOUT'.length
        && G.texts.map((t) => t.t).join('') === 'SETOUT',
        G.texts.map((t) => t.t).join(''));
}

// ---------------------------------------------------------------------------
// 2. 층 번호
// ---------------------------------------------------------------------------
{
  const numOf = (n) => {
    const p = panelOf((c) => drawSheetNo(c, VIEW_W, n));
    return { num: p.texts.at(-1).t, w: p.fill.w };
  };

  check('한 자리는 0 을 채운다', numOf(1).num === '01', numOf(1).num);
  check('두 자리는 그대로', numOf(12).num === '12', numOf(12).num);
  check('세 자리도 잘리지 않는다', numOf(120).num === '120', numOf(120).num);

  // 번호가 들어가는 한 상자는 그대로 있어야 한다. 층마다 폭이 흔들리면
  // 우상단이 계속 들썩인다. 넘칠 때만 늘어난다 — 잘리는 것보다는 낫다.
  const base = numOf(12).w;
  check('한 자리도 같은 폭 — 0 을 채우므로', numOf(1).w === base, `${numOf(1).w} / ${base}`);
  check('세 자리까지는 상자가 그대로', numOf(120).w === base, `${numOf(120).w} / ${base}`);
  check('넘치면 그때 늘어난다', numOf(1000).w > base, `${numOf(1000).w} > ${base}`);

  // 라벨은 위 칸, 번호는 아래 칸. 표제란이려면 순서가 이래야 한다.
  const p = panelOf((c) => drawSheetNo(c, VIEW_W, 7));
  check('위 칸에 SHEET, 아래 칸에 번호',
        p.texts[0].t === 'SHEET' && p.texts[1].t === '07' && p.texts[1].y > p.texts[0].y,
        `${p.texts[0].t} / ${p.texts[1].t}`);

  // 상자를 2/3 로 줄였을 때 라벨이 7px 이 되어 안 읽힌 적이 있다. 글자 크기를
  // 칸 높이에서 뽑는 이상 비율을 건드리면 또 그럴 수 있으므로 바닥을 못박는다.
  const [label, num] = p.texts;
  check('SHEET 라벨이 읽히는 크기다', label.px >= 9, `${label.px}px`);
  check('번호가 라벨보다 크다 — 표제란에서 눈에 드는 것은 번호다',
        num.px > label.px * 1.8, `${num.px}px / ${label.px}px`);
  check('라벨 칸이 상자의 3분의 1쯤', (() => {
    const gap = num.y - label.y;
    return gap > 0 && gap < p.fill.h;
  })());
}

// ---------------------------------------------------------------------------
// 3. 적어 둔 것이 실제로 그렇게 도는가
//
// 이 검사가 이 묶음의 요점이다. 화면에 적힌 말과 input.js 가 하는 일이
// 갈리면 안내가 거짓말을 한다. 가짜 캔버스에 실제 attachPointer 를 물려
// 이벤트를 직접 쏜다 — wheel.test.mjs 와 같은 방식이다.
// ---------------------------------------------------------------------------
{
  globalThis.window = { addEventListener: () => {} };
  const { pointer, attachPointer } = await import('../src/input.js');

  const L = {};
  attachPointer({
    addEventListener: (t, fn) => { L[t] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  });

  const at = (gx, gy) => {
    const p = worldToScreen(gx + 0.5, gy + 0.5, 0);
    return { clientX: p.x, clientY: p.y, pointerId: 1 };
  };

  const scene = () => {
    setStage({ zMax: 8, inkMax: 999, refund: 1,
               start: { x: 8, y: 8 }, goal: { x: 15, y: 15 }, fixtures: [] });
    resetBoard();
    const plate = addPlate([{ x: 8, y: 8 }], 0);
    addPlate([{ x: 9, y: 8 }], 0);          // 캐릭터가 안 선 판 — 지우기·휠용
    placeActor(8, 8);
    return plate;
  };

  // 적어 둔 라벨을 그대로 꺼내 쓴다. 문구를 고치면 이 검사도 같이 따라온다.
  const label = (k) => CONTROLS.find(([hit]) => hit === k)[1];

  // L — 빈 바닥이면 그리기
  scene();
  L.pointerdown({ ...at(2, 2), button: 0 });
  const drew = pointer.mode === 'draw';
  L.pointerup({ ...at(2, 2), button: 0 });

  // L — 판 위면 걷기
  scene();
  L.pointerdown({ ...at(9, 8), button: 0 });
  const walked = pointer.mode === 'walk';
  L.pointerup({ ...at(9, 8), button: 0 });

  check(`L 에 적힌 "${label('L')}" 가 맞다`,
        drew && walked && /DRAW/.test(label('L')) && /WALK/.test(label('L')),
        `빈 바닥 ${drew ? 'draw' : '아님'} / 판 위 ${walked ? 'walk' : '아님'}`);

  // R — 지우기
  scene();
  L.pointerdown({ ...at(9, 8), button: 2 });
  L.pointerup({ ...at(9, 8), button: 2 });
  const erased = !board.occupied.has(key(9, 8));

  check(`R 에 적힌 "${label('R')}" 가 맞다`, erased && /ERASE/.test(label('R')),
        erased ? '지워졌다' : '안 지워졌다');

  // W — 높이
  const plate = scene();
  const other = board.plates[1];
  L.pointermove(at(9, 8));
  L.wheel({ ...at(9, 8), deltaY: -100, deltaMode: 0, preventDefault: () => {} });
  const lifted = other.z === 1;

  check(`W 에 적힌 "${label('W')}" 가 맞다`, lifted && /LIFT/.test(label('W')),
        `z=${other.z}`);

  // 적어 두지 않은 조작이 없어야 한다. 세 줄이 마우스가 하는 일의 전부다.
  check('안내가 세 줄이다 — 마우스가 하는 일이 그것뿐이다', CONTROLS.length === 3,
        `${CONTROLS.length}줄`);
  check('수식 키를 쓰지 않는다', CONTROLS.every(([, v]) => !/SHIFT|CTRL|ALT/i.test(v)));
}

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
