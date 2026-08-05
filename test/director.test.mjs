// 디렉터 — 낸 층이 지켜야 할 것
//
// 이 묶음은 아직 "좋은 층인가" 를 묻지 않는다. 그것은 솔버가 판정할 일이고
// 다음 커밋의 몫이다. 여기서 지키는 것은 판정이 의미를 갖기 위한 전제다.
//
// 특히 고정 구조물의 z ≥ 1. 이것이 깨지면 "정직하게만 가면 얼마인가" 가
// 거짓말을 하고, 착시를 강제하는 판정이 통째로 무너진다.

import * as C from '../src/config.js';
import * as B from '../src/board.js';
import { screenCell, skey, isIllusion, usesIllusion } from '../src/path.js';
import { minInk } from '../src/solver.js';
import {
  makeRng, design, fixtureOk, seamOk, toStageSpec, candidateCells,
  verify, MIN_CELLS,
} from '../src/director.js';
import { makeStage } from '../src/stage.js';

const { GRID_W, GRID_H } = C;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const inBounds = (c) => c.x >= 0 && c.y >= 0 && c.x < GRID_W && c.y < GRID_H;

// 여러 시드로 후보를 뽑아 둔다. 한 배치가 우연히 통과하는 것과
// 규칙이 지켜지는 것은 다르다.
const batch = (intent, n = 100, zMax = 8) => {
  const out = [];
  for (let seed = 1; seed <= n; seed++) {
    const c = design({ intent, zMax }, makeRng(seed));
    if (c) out.push({ seed, c });
  }
  return out;
};

const ILLUSION = batch('illusion');
const HONEST = batch('honest');

// ---------------------------------------------------------------------------
// 1. 자리를 잡는가
// ---------------------------------------------------------------------------
{
  check('착시 층을 100개 시드에서 다 낸다', ILLUSION.length === 100,
        `${ILLUSION.length}/100`);
  check('정직 층을 100개 시드에서 다 낸다', HONEST.length === 100,
        `${HONEST.length}/100`);
  check('상한이 0 이면 착시 층은 못 낸다',
        design({ intent: 'illusion', zMax: 0 }, makeRng(7)) === null);
}

// ---------------------------------------------------------------------------
// 2. 재현성 — 같은 시드면 같은 층
//
// 이것이 없으면 "100개 다 통과했다" 가 확인할 수 없는 주장이 되고,
// 디렉터가 왜 그 층을 냈는지도 따라갈 수 없다.
// ---------------------------------------------------------------------------
{
  const a = design({ intent: 'illusion' }, makeRng(42));
  const b = design({ intent: 'illusion' }, makeRng(42));
  const c = design({ intent: 'illusion' }, makeRng(43));

  check('같은 시드는 같은 층', JSON.stringify(a) === JSON.stringify(b));
  check('다른 시드는 다른 층', JSON.stringify(a) !== JSON.stringify(c));

  // 난수 자체도 확인해 둔다. 갈라지지 않으면 층도 갈라지지 않는다.
  const r1 = makeRng(5);
  const r2 = makeRng(5);
  const seq1 = [r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2()];
  check('난수가 시드에 대해 재현된다', JSON.stringify(seq1) === JSON.stringify(seq2));
  check('난수가 0 이상 1 미만', seq1.every((v) => v >= 0 && v < 1), seq1.join(', '));
}

// ---------------------------------------------------------------------------
// 3. 불변식 — 고정 구조물의 높이
// ---------------------------------------------------------------------------
{
  const all = [...ILLUSION, ...HONEST];

  const overCap = all.filter(({ c }) => c.fixtures.some((f) => !fixtureOk(f, c.zMax)));
  check('구조물이 그 층의 상한 안에 있다', overCap.length === 0,
        overCap.length ? `시드 ${overCap[0].seed}` : `${all.length}층 확인`);
  check('상한 위에 놓인 구조물이 없다',
        !all.some(({ c }) => c.fixtures.some((f) => f.z > c.zMax)),
        '있으면 pickAt 은 못 집는데 솔버는 길로 센다');

  // 착시 층에만 걸리는 규칙. 이음매가 z=0 이면 그린 판과 정직하게 붙어
  // "정직하게만 가면 얼마인가" 가 거짓말이 된다.
  const flatSeam = ILLUSION.filter(({ c }) => !c.fixtures.every((f) => seamOk(f, c.zMax)));
  check('착시 층의 이음매는 바닥에 눕지 않는다', flatSeam.length === 0,
        flatSeam.length ? `시드 ${flatSeam[0].seed}` : `${ILLUSION.length}층 확인`);

  // 정직 층은 반대다. 구조물이 공짜 길이어야 하므로 바닥에 눕는다.
  const lifted = HONEST.filter(({ c }) => c.fixtures.some((f) => f.z !== 0));
  check('정직 층의 구조물은 전부 바닥에 눕는다', lifted.length === 0,
        '올리면 벽이 아니라 공짜 징검다리가 된다');
}

// ---------------------------------------------------------------------------
// 4. 놓인 자리 — 부지 안이고, 시작·목표는 그릴 수 있는 자리인가
// ---------------------------------------------------------------------------
{
  const all = [...ILLUSION, ...HONEST];
  let outOfBounds = 0;
  let offScreen = 0;
  let blocked = 0;
  let same = 0;

  for (const { c } of all) {
    if (!inBounds(c.start) || !inBounds(c.goal)) outOfBounds++;
    if (c.start.x === c.goal.x && c.start.y === c.goal.y) same++;

    const columns = new Set();
    const span = new Set();

    for (const f of c.fixtures) {
      for (const cell of f.cells) {
        if (!inBounds(cell)) outOfBounds++;

        const s = screenCell({ ...cell, z: f.z });
        if (!inBounds(s)) offScreen++;

        columns.add(skey(cell.x, cell.y));
        span.add(skey(s.x, s.y));
      }
    }

    for (const p of [c.start, c.goal]) {
      if (columns.has(skey(p.x, p.y)) || span.has(skey(p.x, p.y))) blocked++;
    }
  }

  check('모든 칸이 부지 안', outOfBounds === 0, `${outOfBounds}건`);
  check('구조물이 화면에서도 부지 안에 선다', offScreen === 0, `${offScreen}건`);
  check('시작·목표는 기둥에도 가림에도 걸리지 않는다', blocked === 0, `${blocked}건`);
  check('시작과 목표가 다르다', same === 0, `${same}건`);
}

// ---------------------------------------------------------------------------
// 5. 불변식이 실제로 일하는가 — 정직한 답은 구조물을 밟지 않는다
//
// z ≥ 1 이라는 규칙이 무엇을 위한 것이었는지를 솔버로 되짚는다.
// 정직한 간선은 z 가 같아야 성립하고 그릴 수 있는 칸은 언제나 z=0 이므로,
// 올려 둔 구조물에는 정직하게 발을 디딜 방법이 없어야 한다.
// ---------------------------------------------------------------------------
{
  let stepped = 0;
  let checked = 0;

  for (const { c } of ILLUSION) {
    const cells = candidateCells(c);
    const from = { x: c.start.x, y: c.start.y, z: 0 };
    const honest = minInk(cells, from, c.goal, { allowIllusion: false });
    if (!honest) continue;

    checked++;
    if (honest.path.some((cell) => cell.z !== 0)) stepped++;
  }

  check(`정직한 답은 이음매를 밟지 않는다 (${checked}층)`, stepped === 0,
        `${stepped}건`);
}

// ---------------------------------------------------------------------------
// 6. 착시 층은 이음매를 실제로 놓았는가
//
// 아직 "그 이음매가 값을 깎는가" 는 묻지 않는다. 그것이 다음 커밋의 판정이다.
// 여기서는 붙을 자리가 있는지, 즉 목표가 이음매의 화면 이웃인지만 본다.
// ---------------------------------------------------------------------------
{
  let noSeam = 0;
  let goalNotAdjacent = 0;

  for (const { c } of ILLUSION) {
    if (!c.fixtures.length) { noSeam++; continue; }

    const span = c.fixtures.flatMap((f) =>
      f.cells.map((cell) => screenCell({ ...cell, z: f.z })));

    const near = span.some((s) =>
      Math.abs(s.x - c.goal.x) + Math.abs(s.y - c.goal.y) === 1);

    if (!near) goalNotAdjacent++;
  }

  check('착시 층에는 이음매가 있다', noSeam === 0, `${noSeam}건`);
  check('목표가 이음매의 화면 이웃이다', goalNotAdjacent === 0, `${goalNotAdjacent}건`);

  // 이음매에 발을 디디는 간선은 반드시 착시다 — z 가 다르므로
  const one = ILLUSION[0].c;
  const seam = { ...one.fixtures[0].cells[0], z: one.fixtures[0].z };
  check('이음매에 오르는 간선은 착시다', isIllusion({ x: 0, y: 0, z: 0 }, seam),
        `z=${seam.z}`);
}

// ---------------------------------------------------------------------------
// 7. 정직 층은 정렬을 막았는가
// ---------------------------------------------------------------------------
//
// 처음에는 상한을 1 로 두고 한 칸짜리 판을 올려 벽으로 썼다. 실측하니 200층
// 중 198층에서 착시가 더 쌌다 — 올려 둔 한 칸은 벽이면서 동시에 공짜
// 징검다리였고, 착시를 뺏으려던 층이 착시를 나눠 주고 있었다.
// 상한을 0 으로 조여 도구 자체를 없앴다. 그 결과를 여기서 지킨다.
{
  const loose = HONEST.filter(({ c }) => c.zMax !== 0);
  check('정직 층은 상한이 0', loose.length === 0, `${loose.length}건`);

  const far = HONEST.filter(({ c }) =>
    Math.abs(c.start.x - c.goal.x) + Math.abs(c.start.y - c.goal.y) < 10);
  check('시작과 목표가 10칸 이상 떨어져 있다', far.length === 0, `${far.length}건`);

  // 모든 칸이 z=0 이면 isIllusion 이 참이 될 수 없다. 어렵게 만든 것이 아니라
  // 구조적으로 불가능하게 만든 것이라, 값을 재 봐도 두 답이 같아야 한다.
  let cheaper = 0;
  let sameCost = 0;

  for (const { c } of HONEST) {
    const cells = candidateCells(c);
    const from = { x: c.start.x, y: c.start.y, z: 0 };
    const a = minInk(cells, from, c.goal);
    const h = minInk(cells, from, c.goal, { allowIllusion: false });
    if (!a || !h) continue;

    if (a.cost < h.cost) cheaper++;
    else sameCost++;
  }

  check(`착시로 질러갈 수 있는 층이 없다 (${sameCost}층)`, cheaper === 0, `${cheaper}건`);

  const anyLifted = HONEST.some(({ c }) =>
    candidateCells(c).some((cell) => cell.z !== 0));
  check('정직 층에는 z 가 0 이 아닌 칸이 아예 없다', !anyLifted);
}

// ---------------------------------------------------------------------------
// 8. 층 명세로 넘어가는가
// ---------------------------------------------------------------------------
{
  const c = ILLUSION[0].c;
  const spec = toStageSpec(c, 64);
  const s = makeStage(spec);

  check('명세가 stage 로 들어간다',
        s.inkMax === 64 && s.zMax === c.zMax && s.fixtures.length === c.fixtures.length);
  check('시작·목표가 그대로 넘어간다',
        s.start.x === c.start.x && s.goal.y === c.goal.y);

  const cells = candidateCells(c);
  check('시작 발판이 칸 목록에 들어 있다',
        cells.some((cell) => cell.x === c.start.x && cell.y === c.start.y && cell.z === 0));
  check('구조물 칸이 전부 들어 있다',
        cells.length === 1 + c.fixtures.reduce((n, f) => n + f.cells.length, 0));
}

// ---------------------------------------------------------------------------
// 9. 순수성 — board 를 읽지 않는가
// ---------------------------------------------------------------------------
{
  B.board.plates.length = 0;
  B.board.occupied.clear();

  const c = design({ intent: 'illusion' }, makeRng(9));
  check('빈 board 에서도 층이 나온다', !!c);
  check('층을 내도 board 는 그대로 비어 있다', B.board.plates.length === 0);

  // 같은 시드를 board 가 채워진 상태에서 다시 — 결과가 같아야 한다
  B.addPlate([{ x: 1, y: 1 }, { x: 2, y: 1 }], 0);
  const c2 = design({ intent: 'illusion' }, makeRng(9));
  check('board 상태가 층을 바꾸지 않는다', JSON.stringify(c) === JSON.stringify(c2));
}

// ---------------------------------------------------------------------------
// 10. 판정 — 두 숫자의 부등식이 전부다
//
// 손으로 만든 배치로 각 실패를 하나씩 불러낸다. 생성기가 우연히 그 상황을
// 내주기를 기다리면 어떤 실패는 영영 안 밟아 보게 된다.
//
// 기준 배치는 solver 묶음이 쓰던 것과 같다. 착시로 22, 그리기만으로 34.
// ---------------------------------------------------------------------------
const seam = [];
for (let x = 6; x <= 13; x++) seam.push({ x, y: 13 });

const scene = (intent) => ({
  intent,
  start: { x: 3, y: 3 },
  goal: { x: 12, y: 11 },
  zMax: 8,
  fixtures: [{ cells: seam, z: 1 }],
  note: '검사용',
});

{
  const base = verify(scene('illusion'), 30);
  check('두 값을 다 잰다', base.illusionCost === 22 && base.honestCost === 34,
        `착시 ${base.illusionCost} / 그리기 ${base.honestCost}`);

  check('배급이 그 사이면 통과', base.ok && base.code === 'OK', base.code);
  check('통과한 층에는 고칠 것이 없다', base.fix === null);

  const loose = verify(scene('illusion'), 40);
  check('배급이 헐거우면 착시를 안 쓴다', loose.code === 'ILLUSION_UNUSED', loose.code);
  check('조일 자리를 짚어 준다',
        loose.fix.action === 'budget' && loose.fix.inkMax === 32,
        `→ ${loose.fix.inkMax}`);

  const poor = verify(scene('illusion'), 10);
  check('배급이 모자라면 아예 못 푼다', poor.code === 'OVER_BUDGET', poor.code);
  check('얼마가 필요한지 짚어 준다',
        poor.fix.action === 'budget' && poor.fix.inkMax === 22, `→ ${poor.fix.inkMax}`);

  // 같은 지형을 정직 의도로 내면 정반대 판정이 나온다
  const forced = verify(scene('honest'), 25);
  check('정직 의도인데 배급이 조이면 착시를 강요한다',
        forced.code === 'ILLUSION_FORCED', forced.code);
  check('배급을 열어 주라고 한다',
        forced.fix.action === 'budget' && forced.fix.inkMax === 34, `→ ${forced.fix.inkMax}`);

  const leaky = verify(scene('honest'), 40);
  check('정직 의도인데 착시가 더 싸면 지형을 다시 짜라고 한다',
        leaky.code === 'ILLUSION_CHEAPER', leaky.code);
  check('배급으로는 못 고친다고 한다', leaky.fix.action === 'redesign', leaky.fix.action);
}

{
  // 너무 짧은 층
  const shallow = verify({
    intent: 'illusion', start: { x: 3, y: 3 }, goal: { x: 3, y: 6 },
    zMax: 8, fixtures: [], note: '',
  }, 60);
  check('세 칸짜리 해법은 층이 아니다', shallow.code === 'TOO_SHALLOW', shallow.code);
  check('목표를 밀어내라고 한다', shallow.fix.action === 'redesign');

  // 아예 못 가는 층 — 목표를 기둥으로 둘러싼다
  const walled = verify({
    intent: 'illusion', start: { x: 0, y: 0 }, goal: { x: 5, y: 5 }, zMax: 8,
    fixtures: [
      { cells: [{ x: 4, y: 5 }], z: 7 }, { cells: [{ x: 6, y: 5 }], z: 7 },
      { cells: [{ x: 5, y: 4 }], z: 7 }, { cells: [{ x: 5, y: 6 }], z: 7 },
    ],
    note: '',
  }, 200);
  check('닿을 길이 없으면 못 푼다고 한다', walled.code === 'UNSOLVABLE', walled.code);
  check('두 값 다 없다', walled.illusionCost === null && walled.honestCost === null);

  // 이음매가 값을 못 깎으면 끼울 자리가 없다
  const useless = verify({
    intent: 'illusion', start: { x: 3, y: 3 }, goal: { x: 3, y: 12 }, zMax: 8,
    fixtures: [{ cells: [{ x: 15, y: 15 }], z: 1 }], note: '',
  }, 20);
  check('두 값이 같으면 조일 자리가 없다', useless.code === 'NO_BUDGET_WINDOW',
        `${useless.code} — 착시 ${useless.illusionCost} / 그리기 ${useless.honestCost}`);
  check('지형을 다시 짜라고 한다', useless.fix.action === 'redesign');
}

// ---------------------------------------------------------------------------
// 11. 짚어 준 대로 고치면 그 실패는 다시 안 난다
//
// 판정이 이유만 대고 방향을 안 주면 재설계는 무작위 재추첨이 된다.
// fix 가 실제로 다음 수정을 지시하는지 확인한다.
// ---------------------------------------------------------------------------
{
  let stuck = 0;
  let byBudget = 0;
  let byRedesign = 0;

  for (const { c } of ILLUSION) {
    // 배급 0 에서 출발한다. 통과할 수는 없다.
    const first = verify(c, 0);
    if (first.ok) { stuck++; continue; }

    // 지형이 문제라고 하면 배급으로 고칠 것이 아니다. 이것도 정당한 답이다 —
    // 처음에는 배급 0 이면 무조건 OVER_BUDGET 이 난다고 보고 재설계 신호를
    // 제자리로 세었다. 판정이 아니라 검사 쪽이 틀렸다.
    if (first.fix.action === 'redesign') { byRedesign++; continue; }

    const second = verify(c, first.fix.inkMax);
    if (second.code === first.code) { stuck++; continue; }

    byBudget++;
  }

  check(`짚어 준 배급으로 고치면 같은 실패가 안 난다 (${ILLUSION.length}층)`,
        stuck === 0, `${stuck}건 제자리`);
  check('배급 하나로 풀리는 층이 대부분', byBudget > byRedesign,
        `배급 ${byBudget} / 재설계 ${byRedesign}`);
  check('재설계가 필요한 층이 3분의 1 미만', byRedesign / ILLUSION.length < 0.34,
        `${byRedesign}/${ILLUSION.length}`);
}

// ---------------------------------------------------------------------------
// 12. 통과한 착시 층은 정말 착시를 요구하는가
//
// 판정은 honestCost > inkMax 라는 부등식으로만 말한다. 그것이 곧 "최소 해법이
// 착시를 쓴다" 인지를 경로의 간선으로 되짚는다.
// ---------------------------------------------------------------------------
{
  let passed = 0;
  let withoutIllusion = 0;

  for (const { c } of ILLUSION) {
    const r = verify(c, 0);
    if (r.code !== 'OVER_BUDGET') continue;

    // 착시로 딱 풀리는 만큼만 배급한다 — 가장 조인 상태
    const v = verify(c, r.fix.inkMax);
    if (!v.ok) continue;

    passed++;
    if (!usesIllusion(v.illusion.path)) withoutIllusion++;
  }

  check(`통과한 층의 최소 해법은 착시를 쓴다 (${passed}층)`, withoutIllusion === 0,
        `${withoutIllusion}건`);
  check('통과한 층이 있다', passed > 0, `${passed}층`);
}

// ---------------------------------------------------------------------------
// 13. 정직 층도 판정을 통과하는가
// ---------------------------------------------------------------------------
{
  let ok = 0;
  const codes = new Map();

  for (const { c } of HONEST) {
    const first = verify(c, 0);
    const v = first.fix?.action === 'budget' ? verify(c, first.fix.inkMax) : first;

    codes.set(v.code, (codes.get(v.code) ?? 0) + 1);
    if (v.ok) ok++;
  }

  check(`정직 층은 배급만 맞추면 통과한다 (${HONEST.length}층)`, ok === HONEST.length,
        [...codes].map(([k, n]) => `${k} ${n}`).join(', '));
}

// ---------------------------------------------------------------------------
// 14. 판정도 board 를 읽지 않는가
// ---------------------------------------------------------------------------
{
  B.board.plates.length = 0;
  B.board.occupied.clear();
  const empty = verify(scene('illusion'), 30);

  B.addPlate([{ x: 12, y: 11 }, { x: 11, y: 11 }], 0);   // 목표 자리를 실제로 메운다
  const filled = verify(scene('illusion'), 30);

  check('board 를 채워도 판정이 안 바뀐다',
        empty.code === filled.code && empty.illusionCost === filled.illusionCost,
        `${empty.code}/${empty.illusionCost} vs ${filled.code}/${filled.illusionCost}`);
  check('최소 칸수 기준을 밖에서 바꿀 수 있다',
        verify(scene('illusion'), 30, { minCells: 99 }).code === 'TOO_SHALLOW',
        `기본 ${MIN_CELLS}`);
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
