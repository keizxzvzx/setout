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
  verify, MIN_CELLS, WASTE_MARGIN, direct, budgetWindow, pickBudget, formatLog,
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

  const overCap = all.filter(({ c }) => c.fixtures.some((f) => !fixtureOk(f, C.Z_MAX)));
  check('구조물이 Z_MAX 안에 있다', overCap.length === 0,
        overCap.length ? `시드 ${overCap[0].seed}` : `${all.length}층 확인`);

  // 예전에는 "구조물의 z 가 그 층의 zMax 이하" 를 지켰다. pickAt 이 zMax 까지만
  // 훑었으므로 넘기면 화면에는 보이는데 못 집는 판이 됐기 때문이다.
  //
  // 정직 층에 뜬판을 놓으면서 그 규칙을 버렸다. 대신 stage 가 zTop 을 파생시켜
  // pickAt 과 카메라가 그것을 읽는다. 지켜야 할 것은 처음부터 z 의 크기가 아니라
  // **놓은 것을 전부 집을 수 있는가** 였으므로, 이제 그것을 직접 본다.
  let unreachable = 0;
  let cropped = 0;

  for (const { c } of all) {
    const s = makeStage(toStageSpec(c, 60));
    for (const f of c.fixtures) {
      if (f.z > s.zTop) unreachable++;
      if (f.z + 1 > s.zTop + 1) cropped++;
    }
  }

  check('구조물이 전부 zTop 안에 든다 — pickAt 이 훑는 범위다', unreachable === 0,
        `${unreachable}건`);
  check('카메라 여유가 가장 높은 구조물을 덮는다', cropped === 0, `${cropped}건`);

  // 착시 층에만 걸리는 규칙. 이음매가 z=0 이면 그린 판과 정직하게 붙어
  // "정직하게만 가면 얼마인가" 가 거짓말이 된다.
  const flatSeam = ILLUSION.filter(({ c }) => !c.fixtures.every((f) => seamOk(f, c.zMax)));
  check('착시 층의 이음매는 바닥에 눕지 않는다', flatSeam.length === 0,
        flatSeam.length ? `시드 ${flatSeam[0].seed}` : `${ILLUSION.length}층 확인`);

  // 정직 층은 길 노릇을 하는 것만 바닥에 눕는다. 공짜 길이어야 하기 때문이다.
  // 그 위에 길이 아닌 뜬판이 둘 이상 얹힌다 — 판이 전부 누워 있으면 그 장에서만
  // 화면이 평평하고, 하나뿐이면 그것이 곧 정답이라 고를 것이 없다.
  // 값을 깎지 않는다는 것은 7번에서 따로 잰다.
  const floats = HONEST.map(({ c }) => c.fixtures.filter((f) => f.z > 0).length);
  check('정직 층에 뜬판이 둘 이상 있다', floats.every((n) => n >= 2),
        `가장 적은 층 ${Math.min(...floats)}개`);

  const walkable = HONEST.filter(({ c }) =>
    c.fixtures.filter((f) => f.z === 0).length < 1);
  check('길 노릇을 하는 구조물은 여전히 바닥에 눕는다', walkable.length === 0,
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

  // 뜬판은 있지만 착시 간선을 쓸 이유를 주지 않는다. 위의 두 값이 같다는 것이
  // 그 증거이고(착시로 질러갈 수 있는 층이 없다), 여기서는 그 판이 실제로 떠
  // 있는지를 확인한다 — 없으면 위의 등식은 그냥 z 가 전부 0 이라 성립한 것이다.
  const lifted = HONEST.filter(({ c }) =>
    candidateCells(c).some((cell) => cell.z > 0));
  check('그 등식이 뜬판이 있는 채로 성립한다', lifted.length === HONEST.length,
        `${lifted.length}/${HONEST.length}층에 뜬판이 있다`);

  // 플레이어는 그것을 따라 만들 수 없다. 상한이 0 이라 자기 판을 못 올린다.
  const reachable = HONEST.filter(({ c }) =>
    c.fixtures.some((f) => f.z > 0 && f.z <= c.zMax));
  check('플레이어가 맞출 수 있는 높이가 아니다', reachable.length === 0,
        `${reachable.length}건`);
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
  // 최소 해법 22 에 헛디딜 여유 4 를 얹은 값이다. 딱 22 만 주면 잘못된 다리를
  // 한 번 걸어 보는 것만으로 층을 못 끝낸다 — 밟은 칸은 환급이 0 이다.
  check('최소 해법에 여유를 얹어 짚어 준다',
        poor.fix.action === 'budget' && poor.fix.inkMax === 22 + WASTE_MARGIN * 2,
        `→ ${poor.fix.inkMax}`);

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
    intent: 'illusion', start: { x: 3, y: 3 }, goal: { x: 3, y: 14 }, zMax: 8,
    fixtures: [{ cells: [{ x: 15, y: 15 }], z: 1 }], note: '',
  }, 30);
  check('두 값이 같으면 조일 자리가 없다', useless.code === 'NO_BUDGET_WINDOW',
        `${useless.code} — 착시 ${useless.illusionCost} / 그리기 ${useless.honestCost}`);
  check('지형을 다시 짜라고 한다', useless.fix.action === 'redesign');
}

// ---------------------------------------------------------------------------
// 10-b. 고르게 하는 층 — 둘 다 갈 수 있어야 물어본 것이다
//
// 맞서기만 해서는 성향을 읽을 수 없다. 착시를 강제하면 누구나 이음매를
// 건너고, 정렬을 없애면 아무도 못 건넌다. 디렉터가 만든 층이 다음 판단의
// 입력이 되어, 읽었다고 한 것이 자기가 낸 것이 된다.
// ---------------------------------------------------------------------------
{
  const tight = verify(scene('open'), 30);
  check('비싼 쪽이 배급 밖이면 고를 수 없다', tight.code === 'OVER_BUDGET', tight.code);
  check('비싼 쪽에 여유까지 얹어 올리라고 한다',
        tight.fix.action === 'budget' && tight.fix.inkMax === 34 + WASTE_MARGIN * 2,
        `→ ${tight.fix.inkMax}`);

  // 배급은 창 바닥으로 준다. 40 을 박아 두었더니 WASTE_MARGIN 을 올리는 순간
  // 문턱이 그 위로 올라가 검사만 떨어졌다 — 층이 나빠진 것이 아니라 검사가
  // 상수를 안 따라간 것이다. 바로 아래에서 창 바닥이 이 값임을 따로 확인한다.
  const asked = verify(scene('open'), 34 + WASTE_MARGIN * 2);
  check('둘 다 배급 안이면 통과', asked.ok, asked.code);
  check('통과 이유에 갈리는 값이 적힌다', /갈린다/.test(asked.reason), asked.reason);

  const w = budgetWindow(asked);
  check('창의 바닥은 그리기 값에 여유를 얹은 값이다', w.min === 34 + WASTE_MARGIN * 2,
        `${w.min}~${w.max}`);
  check('창 안의 값은 둘 다 갈 수 있다',
        [0, 0.5, 1].every((s) => {
          const v = verify(scene('open'), pickBudget(w, s));
          return v.ok && v.honestCost <= pickBudget(w, s);
        }));

  // 두 길의 값이 같으면 고르는 것이 성향이 아니라 그날의 기분이다
  const flat = verify({
    intent: 'open', start: { x: 3, y: 3 }, goal: { x: 3, y: 14 }, zMax: 8,
    fixtures: [{ cells: [{ x: 15, y: 15 }], z: 1 }], note: '',
  }, 60);
  check('두 길이 비슷하면 물어볼 것이 없다', flat.code === 'NO_CHOICE',
        `${flat.code} — 착시 ${flat.illusionCost} / 그리기 ${flat.honestCost}`);
  check('차이를 벌리라고 한다', flat.fix.action === 'redesign', flat.fix.note);

  // 그리기로 아예 못 가면 고를 것이 없다.
  // 시작 칸의 사방을 막되 한쪽만 이음매로 열어 둔다.
  const forced = verify({
    intent: 'open', start: { x: 0, y: 0 }, goal: { x: 3, y: 12 }, zMax: 8,
    fixtures: [
      { cells: [{ x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }], z: 3 },
      { cells: [{ x: 0, y: 1 }], z: 1 },
    ],
    note: '',
  }, 200);
  check('그리기로 못 가면 물어본 것이 아니다', forced.code === 'NO_CHOICE',
        `${forced.code} — 착시 ${forced.illusionCost} / 그리기 ${forced.honestCost}`);
  check('그 층은 착시로는 풀린다', forced.illusionCost !== null && forced.honestCost === null);
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
// 15. 재설계 루프 — 실패 이유가 다음 수를 정한다
// ---------------------------------------------------------------------------
const RUNS = [];
for (let seed = 1; seed <= 100; seed++) RUNS.push(direct({ intent: 'illusion' }, seed));
const HRUNS = [];
for (let seed = 1; seed <= 100; seed++) HRUNS.push(direct({ intent: 'honest' }, seed));

{
  const failed = RUNS.filter((r) => !r.ok);
  check('착시 층을 100개 시드에서 다 낸다', failed.length === 0,
        failed.length ? failed[0].reason : '');
  check('정직 층을 100개 시드에서 다 낸다', HRUNS.every((r) => r.ok));

  // 낸 층은 자기가 정한 배급으로 다시 물어도 통과해야 한다.
  // 이것이 어긋나면 통과했다고 하고 못 푸는 층이 나간다.
  const bad = [...RUNS, ...HRUNS].filter((r) => !verify(r.candidate, r.inkMax).ok);
  check('낸 층은 전부 자기 배급으로 다시 물어도 통과한다', bad.length === 0,
        `${bad.length}건`);

  const shortRun = RUNS.filter((r) => r.attempts.length < 2);
  check('한 번에 통과한 층은 없다 — 배급 0 에서 출발한다', shortRun.length === 0,
        `${shortRun.length}건`);
  check('첫 시도는 반드시 실패다', RUNS.every((r) => r.attempts[0].code !== 'OK'),
        RUNS[0].attempts[0].code);
  check('마지막 시도는 통과다', RUNS.every((r) => r.attempts.at(-1).code === 'OK'));

  const tries = RUNS.map((r) => r.attempts.length);
  check('평범한 요구에는 헛돌지 않는다', Math.max(...tries) <= 8,
        `최대 ${Math.max(...tries)}회`);
  console.log(`      시도 횟수  최소 ${Math.min(...tries)} / ` +
              `최대 ${Math.max(...tries)} / ` +
              `평균 ${(tries.reduce((a, b) => a + b, 0) / tries.length).toFixed(1)}`);

  // 재설계 경로가 실제로 도는가.
  //
  // 생성기가 얕은 층을 스스로 걸러내게 한 뒤로 기본 요구에서는 재설계가
  // 거의 안 난다(200층 중 2층). 좋은 일이지만, 그래서 기본 배치로는 이 길을
  // 밟아 볼 수 없다. 요구를 조여 일부러 밟는다.
  const hard = [];
  for (let seed = 1; seed <= 40; seed++) {
    hard.push(direct({ intent: 'illusion' }, seed, { minCells: 14 }));
  }

  const redesigned = hard.filter((r) =>
    r.attempts.some((a) => a.code === 'TOO_SHALLOW'));

  check('요구를 조이면 재설계를 거친다', redesigned.length > hard.length / 2,
        `${redesigned.length}/${hard.length} 층이 지형을 다시 뽑았다`);
  check('재설계를 거쳐도 결국 낸다', hard.every((r) => r.ok),
        `${hard.filter((r) => !r.ok).length}건 실패`);
  check('재설계한 층도 조인 요구를 만족한다',
        hard.every((r) => verify(r.candidate, r.inkMax, { minCells: 14 }).ok));
}

// ---------------------------------------------------------------------------
// 16. 재현성 — 같은 시드면 같은 층, 같은 판단
// ---------------------------------------------------------------------------
{
  const a = direct({ intent: 'illusion' }, 17);
  const b = direct({ intent: 'illusion' }, 17);
  const c = direct({ intent: 'illusion' }, 18);

  check('같은 시드는 같은 층', JSON.stringify(a.spec) === JSON.stringify(b.spec));
  check('같은 시드는 같은 판단 기록',
        JSON.stringify(a.attempts) === JSON.stringify(b.attempts));
  check('다른 시드는 다른 층', JSON.stringify(a.spec) !== JSON.stringify(c.spec));
}

// ---------------------------------------------------------------------------
// 17. 배급의 창 — 조일 수도 있고 열어 줄 수도 있는가
//
// 창의 바닥은 여유가 0 이라 한 칸도 헛디딜 수 없고, 천장은 실험할 자리가
// 넉넉하다. 망설이는 사람에게 바닥값을 주는 대응이 여기에 걸린다.
// ---------------------------------------------------------------------------
{
  const tight = direct({ intent: 'illusion' }, 3, { slack: 0 });
  const loose = direct({ intent: 'illusion' }, 3, { slack: 1 });

  check('같은 시드에서 창은 같다',
        JSON.stringify(tight.window) === JSON.stringify(loose.window),
        `${tight.window.min}~${tight.window.max}`);
  check('조이면 창의 바닥', tight.inkMax === tight.window.min, `${tight.inkMax}`);
  check('열면 창의 천장', loose.inkMax === loose.window.max, `${loose.inkMax}`);
  check('바닥이 천장보다 작거나 같다', tight.inkMax <= loose.inkMax);
  check('둘 다 판정을 통과한다',
        verify(tight.candidate, tight.inkMax).ok && verify(loose.candidate, loose.inkMax).ok);

  // 창의 어디를 잡아도 통과해야 한다
  let offWindow = 0;
  for (const r of RUNS) {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const b = pickBudget(r.window, s);
      if (b < r.window.min || b > r.window.max) { offWindow++; continue; }
      if (!verify(r.candidate, b).ok) offWindow++;
    }
  }
  check(`창 안의 어떤 값으로도 통과한다 (${RUNS.length}층 × 5)`, offWindow === 0,
        `${offWindow}건`);

  // 창 밖은 통과하면 안 된다 — 천장 바로 위는 그리기가 열리는 자리다
  const w = RUNS[0];
  const over = verify(w.candidate, w.window.max + 2);
  check('창 천장을 넘기면 착시를 안 쓴다', !over.ok,
        `${w.window.max + 2} → ${over.code}`);
}

// ---------------------------------------------------------------------------
// 18. 못 낼 때 조용히 실패하지 않는가
//
// 게임이 멈추는 것보다 나쁜 것은 왜 멈췄는지 모르는 것이다.
// ---------------------------------------------------------------------------
{
  const giveUp = direct({ intent: 'illusion' }, 5, { maxAttempts: 1 });

  check('시도 상한에 걸리면 못 냈다고 한다', !giveUp.ok, `ok=${giveUp.ok}`);
  check('이유를 남긴다', /못 냈다/.test(giveUp.reason), giveUp.reason);
  check('그래도 낼 것은 낸다', !!giveUp.spec);
  check('낸 것은 적어도 풀린다',
        !!minInk(candidateCells(giveUp.candidate),
                { x: giveUp.candidate.start.x, y: giveUp.candidate.start.y, z: 0 },
                giveUp.candidate.goal));

  // 아무리 조여도 조건을 못 맞추는 요구 — 최소 칸수를 부지보다 크게 잡는다
  const never = direct({ intent: 'illusion' }, 5, { maxAttempts: 6, minCells: 999 });
  check('맞출 수 없는 요구에는 끝까지 못 낸다고 한다', !never.ok);
  check('그 시도 기록도 남는다', never.attempts.length === 6, `${never.attempts.length}회`);
  check('전부 같은 이유로 떨어졌다',
        never.attempts.every((a) => a.code === 'TOO_SHALLOW'),
        [...new Set(never.attempts.map((a) => a.code))].join(', '));
}

// ---------------------------------------------------------------------------
// 19. 판단 기록이 읽히는가
// ---------------------------------------------------------------------------
{
  const r = direct({ intent: 'illusion' }, 2);
  const lines = formatLog(r);

  check('기록이 줄로 나온다', lines.length >= r.attempts.length + 1, `${lines.length}줄`);
  check('시도마다 코드와 이유가 있다',
        r.attempts.every((a) => a.code && a.reason && a.reason.length > 4));
  check('고칠 것이 있는 시도에는 다음 수가 적혀 있다',
        r.attempts.filter((a) => a.code !== 'OK').every((a) => !!a.next));
  check('낸 층의 근거가 마지막에 붙는다', /낸 층/.test(lines.join('\n')));

  console.log('\n      ── 판단 기록 (시드 2) ' + '─'.repeat(38));
  for (const l of lines) console.log('      ' + l);
  console.log('      ' + '─'.repeat(60) + '\n');
}

// ---------------------------------------------------------------------------
// 20. 루프도 board 를 읽지 않는가
// ---------------------------------------------------------------------------
{
  B.board.plates.length = 0;
  B.board.occupied.clear();
  const clean = direct({ intent: 'illusion' }, 11);

  B.addPlate([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }], 3);
  const dirty = direct({ intent: 'illusion' }, 11);

  check('board 를 채워도 같은 층이 나온다',
        JSON.stringify(clean.spec) === JSON.stringify(dirty.spec));
  check('층을 내도 board 는 그대로다', B.board.plates.length === 1);
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
