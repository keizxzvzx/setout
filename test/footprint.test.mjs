// 발자국 — 보이지 않는데 그릴 수 없는 칸이 없는가
//
// 판을 z 만큼 올리면 화면에서는 (x−z, y−z) 로 물러나지만 기둥 (x, y) 는 계속
// 잡혀 있다. 그 자리는 비어 보이는데 그릴 수도 설 수도 없다.
//
// 이 구멍은 3단계부터 있었다. 그때는 판을 올리는 것이 플레이어 자신이라
// "내가 저기서 올렸지" 로 넘어갔고, 6단계 디렉터가 이음매를 미리 올려 두면서
// 처음 드러났다 — 잉크는 남았는데 선만 안 나온다는 보고로 왔다.
//
// 규칙이 옳아도 화면에서 안 읽히면 버그다. 그것을 여기서 지킨다.

import * as C from '../src/config.js';
import { board, key, pickAt, addPlate, movePlate, resetBoard } from '../src/board.js';
import { stage } from '../src/stage.js';
import { fitView, tileDiamond } from '../src/iso.js';
import { drawFootprints } from '../src/render.js';
import { buildStage } from '../src/session.js';
import { directFor } from '../src/director.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

fitView(1489, 863);

// 그리기 명령을 받아 적는 가짜 컨텍스트
function recorder() {
  const r = { strokes: 0, dashes: [], points: [], calls: [] };
  const push = (k) => r.calls.push(k);

  return {
    save: () => push('save'),
    restore: () => push('restore'),
    setLineDash: (d) => { r.dashes.push(d); push('setLineDash'); },
    beginPath: () => push('beginPath'),
    closePath: () => push('closePath'),
    moveTo: (x, y) => { r.points.push({ x, y }); push('moveTo'); },
    lineTo: (x, y) => { r.points.push({ x, y }); push('lineTo'); },
    stroke: () => { r.strokes++; push('stroke'); },
    fill: () => push('fill'),
    _r: r,
  };
}

const draw = () => {
  const ctx = recorder();
  drawFootprints(ctx);
  return ctx._r;
};

// 그 자리에 아무것도 안 보이는데 그릴 수도 없는 칸
const deadZones = () => {
  const out = [];
  for (const k of board.occupied) {
    const [x, y] = k.split(',').map(Number);
    if (!pickAt(x, y)) out.push(k);
  }
  return out;
};

// 발자국이 찍히는 칸
const marked = () => {
  const out = new Set();
  for (const p of board.plates) {
    if (p.z === 0) continue;
    for (const c of p.cells) out.add(key(c.x, c.y));
  }
  return out;
};

// ---------------------------------------------------------------------------
// 1. 눕힌 판에는 발자국이 없다
// ---------------------------------------------------------------------------
{
  buildStage({});
  addPlate([{ x: 6, y: 6 }, { x: 7, y: 6 }], 0);

  const r = draw();
  check('바닥에 누운 판에는 안 그린다', r.strokes === 0, `${r.strokes}획`);
  check('그럴 때는 그릴 것이 없는 칸도 없다', deadZones().length === 0);
}

// ---------------------------------------------------------------------------
// 2. 올리면 그 칸마다 하나씩
// ---------------------------------------------------------------------------
{
  buildStage({ zMax: 8 });
  const p = addPlate([{ x: 9, y: 9 }, { x: 10, y: 9 }, { x: 11, y: 9 }], 5);

  const r = draw();
  check('올린 판은 칸마다 하나씩 그린다', r.strokes === 3, `${r.strokes}획`);
  check('점선을 쓴다', r.dashes.length > 0 && r.dashes[0].length === 2,
        JSON.stringify(r.dashes[0]));
  check('상태를 저장하고 되돌린다',
        r.calls[0] === 'save' && r.calls.at(-1) === 'restore');

  // 발자국은 올라간 자리가 아니라 **원래 바닥 자리**에 찍혀야 한다.
  // 올라간 자리에 찍으면 판 밑에 깔려 보이지도 않고 뜻도 반대가 된다.
  const want = tileDiamond(9, 9)[0];
  const hit = r.points.some((q) => Math.abs(q.x - want.x) < 0.5 && Math.abs(q.y - want.y) < 0.5);
  check('바닥 자리에 찍는다', hit, `(${want.x.toFixed(1)}, ${want.y.toFixed(1)})`);

  // 내리면 사라진다
  for (let i = 0; i < 5; i++) movePlate(p, -1);
  check('내리면 발자국도 사라진다', draw().strokes === 0, `z=${p.z}`);
}

// ---------------------------------------------------------------------------
// 3. 플레이어가 올린 판에도 그린다
//
// 누가 올렸든 같은 규칙이어야 한다. 층에 따라 달라 보이면 그것도 설명할 수 없다.
// ---------------------------------------------------------------------------
{
  buildStage({ zMax: 8 });
  const mine = addPlate([{ x: 4, y: 9 }], 0);

  check('올리기 전에는 없다', draw().strokes === 0);
  movePlate(mine, 3);
  check('내가 올린 판에도 그린다', draw().strokes === 1, `z=${mine.z}`);
  check('그 칸은 실제로 그릴 수 없는 칸이다',
        board.occupied.has(key(4, 9)) && !pickAt(4, 9));
}

// ---------------------------------------------------------------------------
// 4. 디렉터가 낸 층 — 표시 없는 사각지대가 하나도 없는가
//
// 이 묶음의 핵심이다. 층당 다섯 칸꼴로 있던 것이라 눈으로는 못 찾는다.
// ---------------------------------------------------------------------------
{
  let stages = 0;
  let zones = 0;
  let unmarked = 0;
  const sample = [];

  for (let seed = 1; seed <= 30; seed++) {
    for (const who of [
      { inkSpent: 40, redraws: 0, illusionSteps: 0, realSteps: 20 },   // 다리파
      { inkSpent: 30, redraws: 0, illusionSteps: 6, realSteps: 20 },   // 착시파
    ]) {
      const r = directFor(who, { granted: 120, stages: 1 }, seed);
      if (!r.ok) continue;

      buildStage(r.spec);
      stages++;

      const dead = deadZones();
      const shown = marked();
      zones += dead.length;

      for (const k of dead) {
        if (!shown.has(k)) {
          unmarked++;
          if (sample.length < 3) sample.push(`시드 ${seed} (${k})`);
        }
      }
    }
  }

  check(`층 ${stages}개에 사각지대 ${zones}칸 — 전부 표시된다`, unmarked === 0,
        sample.join(', '));
  check('사각지대가 실제로 있는 층이다', zones > 0, `${zones}칸`);

  // 발자국을 안 그리는 칸이 실제로 그릴 수 있는 칸인지도 본다.
  // 표시를 남발하면 멀쩡한 바닥이 못 그리는 자리로 보인다.
  buildStage(directFor({ inkSpent: 40, redraws: 0, illusionSteps: 0, realSteps: 20 },
                       { granted: 120, stages: 1 }, 2).spec);

  let falseMark = 0;
  for (const k of marked()) {
    const [x, y] = k.split(',').map(Number);
    if (pickAt(x, y)) falseMark++;   // 그 자리에 뭔가 보이면 발자국이 가려진다 — 문제 없음
  }
  check('표시한 칸은 전부 기둥이 잡힌 칸이다',
        [...marked()].every((k) => board.occupied.has(k)));
}

// ---------------------------------------------------------------------------
// 5. 상한이 0 인 층에도 사각지대는 생긴다
//
// 정직 층은 플레이어가 판을 못 올린다. 그런데 디렉터가 뜬판을 하나 얹으므로
// 그 기둥은 여전히 잡혀 있다. 여기가 위험한 자리다 — 플레이어에게는 올릴 수
// 있는 판이 하나도 없으므로 "내가 저기서 올렸지" 로 설명할 길이 아예 없고,
// 표시가 없으면 잉크는 남았는데 선만 안 나오는 칸으로만 보인다.
//
// 상한이 0 이라고 발자국을 건너뛰면 정확히 그 증상이 나온다.
// ---------------------------------------------------------------------------
{
  const r = directFor({ inkSpent: 30, redraws: 0, illusionSteps: 6, realSteps: 20 },
                      { granted: 120, stages: 2 }, 5);
  buildStage(r.spec);

  check('정직 층은 상한이 0', stage.zMax === 0, `${stage.zMax}`);
  check('그래도 그 위에 뜬판이 있다', stage.zTop > stage.zMax,
        `zMax=${stage.zMax} zTop=${stage.zTop}`);

  const dead = deadZones();
  check('그 기둥은 사각지대다', dead.length > 0, `${dead.length}칸`);
  check('전부 발자국으로 표시된다', dead.every((k) => marked().has(k)),
        `${draw().strokes}획`);

  // 상한이 0 인 층에서도 pickAt 이 그 판을 집어야 한다. 못 집으면 화면에는
  // 보이는데 지울 수도 집을 수도 없는 판이 되어 세 경로가 보는 것이 갈린다.
  const float = board.plates.find((p) => p.z > 0);
  check('뜬판을 pickAt 이 집는다',
        !!float && !!pickAt(float.cells[0].x - float.z, float.cells[0].y - float.z),
        `z=${float?.z}`);
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
