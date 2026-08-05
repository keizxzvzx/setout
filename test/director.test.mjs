// 디렉터 — 낸 층이 지켜야 할 것
//
// 이 묶음은 아직 "좋은 층인가" 를 묻지 않는다. 그것은 솔버가 판정할 일이고
// 다음 커밋의 몫이다. 여기서 지키는 것은 판정이 의미를 갖기 위한 전제다.
//
// 특히 고정 구조물의 z ≥ 1. 이것이 깨지면 "정직하게만 가면 얼마인가" 가
// 거짓말을 하고, 착시를 강제하는 판정이 통째로 무너진다.

import * as C from '../src/config.js';
import * as B from '../src/board.js';
import { screenCell, skey, isIllusion } from '../src/path.js';
import { minInk } from '../src/solver.js';
import {
  makeRng, design, fixtureOk, seamOk, toStageSpec, candidateCells,
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
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
