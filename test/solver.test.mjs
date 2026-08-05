// 솔버 — 최소 잉크가 맞는가, 그리고 그 잉크로 실제로 풀리는가
//
// 이 묶음의 무게중심은 마지막 절이다. 산수로 확인하면 산수가 맞는지만 알 수
// 있고 코드가 그 산수대로 도는지는 알 수 없다. 4단계에서 징검다리를 실제
// beginStroke / walkTo 로 돌려 본 것과 같은 이유로, 솔버가 낸 답을 그대로
// 그어 보고 걸어 본다.

import * as B from '../src/board.js';
import * as A from '../src/actor.js';
import * as C from '../src/config.js';
import * as P from '../src/path.js';
import { minInk } from '../src/solver.js';
import { stage, setStage } from '../src/stage.js';

const { INK_COST } = C;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const reset = () => {
  B.board.plates.length = 0;
  B.board.stroke.clear();
  B.board.occupied.clear();
  B.board.stepped.clear();
  B.board.erased.clear();
  B.board.actor = null;
  B.board.goal = null;
  B.board.cleared = false;
  B.board.ink = stage.inkMax;
  B.cancelStroke();
};

const cell = (x, y, z = 0) => ({ x, y, z });

// 모든 답이 지켜야 하는 것. 비용은 그린 칸 수 곱하기 칸값 이상도 이하도 아니다.
const costMatchesDrawn = (r) => r && r.cost === r.drawn.length * INK_COST;

// ---------------------------------------------------------------------------
// 1. 빈 바닥 — 그린 칸 수가 그대로 값이다
// ---------------------------------------------------------------------------
{
  const cells = [cell(3, 3)];
  const r = minInk(cells, cell(3, 3), { x: 3, y: 7 });

  check('빈 바닥 직선 4칸', r && r.cost === 4 * INK_COST, r ? `${r.cost}` : 'null');
  check('그린 칸 수와 값이 맞는다', costMatchesDrawn(r),
        r ? `${r.cost} vs ${r.drawn.length}칸` : 'null');
  check('출발 칸은 그리지 않는다',
        r && !r.drawn.some((c) => c.x === 3 && c.y === 3));
  check('경로가 목표에서 끝난다',
        r && r.path.at(-1).x === 3 && r.path.at(-1).y === 7);
}

// ---------------------------------------------------------------------------
// 2. 이미 깔린 판은 공짜다
// ---------------------------------------------------------------------------
{
  const cells = [cell(3, 3), cell(3, 4), cell(3, 5), cell(3, 6)];
  const r = minInk(cells, cell(3, 3), { x: 3, y: 7 });

  check('깔린 길 위는 값을 안 먹는다', r && r.cost === 1 * INK_COST,
        r ? `${r.cost}` : 'null');
  check('그려야 하는 것은 목표 칸 하나뿐', r && r.drawn.length === 1);
}

// ---------------------------------------------------------------------------
// 3. 올린 판이 남긴 구멍 — 이 게임의 벽
//
// 판을 z 만큼 올리면 화면에서는 (x−z, y−z) 로 물러나지만 기둥 (x, y) 는
// 계속 잡혀 있다. 그 자리는 비어 보이는데 그릴 수도 없고 설 수도 없다.
// 5단계에서 벽을 넣지 않기로 확정했는데 지형 도구는 이미 있었다.
// ---------------------------------------------------------------------------
{
  const open = minInk([cell(0, 0)], cell(0, 0), { x: 0, y: 2 });
  check('막히기 전에는 직선 2칸', open && open.cost === 2 * INK_COST,
        open ? `${open.cost}` : 'null');

  // (0,1) 을 z=5 로 올려 둔다. 화면에는 (−5,−4) 에 나타나므로 자리는 비지만
  // 기둥은 그대로 잡혀 있다.
  const walled = [cell(0, 0), cell(0, 1, 5)];
  const s = P.screenCell(cell(0, 1, 5));
  check('올린 판은 화면에서 다른 자리로 간다', s.x === -5 && s.y === -4,
        `(${s.x},${s.y})`);

  const r = minInk(walled, cell(0, 0), { x: 0, y: 2 });
  check('구멍을 피해 돌아간다', r && r.cost === 4 * INK_COST,
        r ? `${r.cost}` : 'null');
  check('구멍 자리는 밟지 않는다',
        r && !r.path.some((c) => c.x === 0 && c.y === 1 && c.z === 0));
  check('돌아간 값도 그린 칸 수와 맞는다', costMatchesDrawn(r));
}

// ---------------------------------------------------------------------------
// 4. 도달 불가 — 목표를 기둥으로 둘러싼다
// ---------------------------------------------------------------------------
{
  const cells = [
    cell(0, 0),
    cell(4, 5, 7), cell(6, 5, 7), cell(5, 4, 7), cell(5, 6, 7),
  ];
  const r = minInk(cells, cell(0, 0), { x: 5, y: 5 });
  check('사방이 기둥이면 못 간다', r === null, r ? `cost=${r.cost}` : '');
}

// ---------------------------------------------------------------------------
// 5. 착시가 값을 깎는다
//
// F 는 z=1 로 놓인 가로 판이다. 화면에서는 한 칸씩 당겨져 (5,12)..(12,12) 에
// 나타나므로, 거기 붙어 서면 목표 옆까지 공짜로 실려 간다.
// 정직하게만 가면 그 판에 올라탈 방법이 없다 — 올라타는 간선이 곧 착시다.
// ---------------------------------------------------------------------------
const F = [];
for (let x = 6; x <= 13; x++) F.push(cell(x, 13, 1));

const SCENE = [cell(3, 3), ...F];
const START = cell(3, 3);
const GOAL = { x: 12, y: 11 };

{
  const withIllusion = minInk(SCENE, START, GOAL);
  const honest = minInk(SCENE, START, GOAL, { allowIllusion: false });

  check('착시를 쓰면 22', withIllusion && withIllusion.cost === 22,
        withIllusion ? `${withIllusion.cost}` : 'null');
  check('정직하게 가면 34', honest && honest.cost === 34,
        honest ? `${honest.cost}` : 'null');
  check('착시가 더 싸다', withIllusion && honest && withIllusion.cost < honest.cost,
        `${withIllusion?.cost} < ${honest?.cost}`);

  check('싼 쪽은 착시를 쓴다', P.usesIllusion(withIllusion.path));
  check('정직한 쪽은 착시를 안 쓴다', !P.usesIllusion(honest.path));
  check('정직한 쪽은 올려 둔 판을 밟지 않는다',
        !honest.path.some((c) => c.z !== 0));

  check('두 답 다 그린 칸 수와 맞는다',
        costMatchesDrawn(withIllusion) && costMatchesDrawn(honest));
}

// ---------------------------------------------------------------------------
// 6. 실측 — 솔버가 낸 잉크로 실제로 그어 보고 걸어 본다
//
// 이 묶음에서 유일하게 게임 함수를 그대로 부르는 절이다. 앞의 검사들은
// 솔버가 자기 산수를 지키는지만 보지만, 여기서는 그 산수가 게임과 같은지를
// 본다. 어긋나면 "솔버는 풀린다는데 실제로는 못 간다" 가 된다.
// ---------------------------------------------------------------------------
{
  setStage({ inkMax: 120, zMax: 8 });
  reset();

  B.addPlate([{ x: START.x, y: START.y }], 0);
  for (const f of F) B.addPlate([{ x: f.x, y: f.y }], f.z);
  B.board.goal = { ...GOAL };
  A.placeActor(START.x, START.y);

  // 솔버는 살아 있는 board 가 아니라 스냅샷을 본다
  const snapshot = B.cellList();
  const r = minInk(snapshot, START, GOAL);

  const before = B.board.ink;

  // 솔버가 그리라고 한 칸만 그린다. 한 칸씩 확정해 획 보간이 여분의 칸을
  // 채우지 않게 한다 — 재려는 것은 솔버의 답이지 획의 편의가 아니다.
  for (const c of r.drawn) {
    B.beginStroke({ x: c.x, y: c.y });
    B.commitStroke();
  }

  check('실제로 쓴 잉크가 솔버의 값과 같다', before - B.board.ink === r.cost,
        `쓴 ${before - B.board.ink} / 낸 답 ${r.cost}`);

  const walked = A.walkTo(GOAL.x, GOAL.y);
  A.updateActor(10);

  check('그 길로 실제로 걸어간다', walked);
  check('목표에 닿아 클리어된다', B.board.cleared,
        `actor=(${B.board.actor.x},${B.board.actor.y})`);
  check('배급량 안에서 끝난다', B.board.ink >= 0, `남은 ${B.board.ink}`);

  // 게임이 실제로 건넌 간선도 착시였는가
  check('걸어간 길이 착시를 쓴다', B.board.stats.illusionSteps > 0,
        `착시 ${B.board.stats.illusionSteps} / 진짜 ${B.board.stats.realSteps}`);
}

// ---------------------------------------------------------------------------
// 7. 기둥 집합을 유도해도 board 와 같은가
//
// 솔버는 occupied 를 인자로 받지 않고 cells 에서 유도한다. 같은 사실이 두
// 곳에 적히면 어긋나도 아무도 모르기 때문인데, 유도한 것이 board 가 들고
// 있는 것과 다르면 그 절약이 그대로 버그가 된다.
// ---------------------------------------------------------------------------
{
  setStage({ inkMax: 120, zMax: 8 });
  reset();

  // 실제 조작으로 판을 만든다 — 긋고, 올리고, 지운다
  B.beginStroke({ x: 2, y: 2 });
  B.extendStroke({ x: 8, y: 2 });
  B.commitStroke();

  B.beginStroke({ x: 4, y: 6 });
  B.extendStroke({ x: 4, y: 10 });
  const made = B.commitStroke();
  for (let i = 0; i < 3; i++) B.movePlate(made[0], 1);

  B.beginErase({ x: 5, y: 2 });
  B.commitErase();

  const derived = new Set(B.cellList().map((c) => B.key(c.x, c.y)));
  const held = B.board.occupied;

  const missing = [...held].filter((k) => !derived.has(k));
  const extra = [...derived].filter((k) => !held.has(k));

  check('유도한 기둥 = board 가 잡고 있는 기둥',
        missing.length === 0 && extra.length === 0,
        `빠짐 ${missing.length} / 남음 ${extra.length}`);
  check('지운 칸은 기둥도 놓였다', !held.has(B.key(5, 2)));
  check('올린 판도 기둥을 계속 잡는다', held.has(B.key(4, 6)));
}

// ---------------------------------------------------------------------------
// 8. 순수성 — 디렉터가 아직 놓지 않은 배치를 물을 수 있는가
// ---------------------------------------------------------------------------
{
  reset();   // board 를 비운다. 아래 배치는 게임 어디에도 존재하지 않는다

  const virtual = [cell(1, 1), cell(1, 2), cell(1, 3)];
  const r = minInk(virtual, cell(1, 1), { x: 1, y: 5 });

  check('빈 board 에서도 가상 배치가 풀린다', r && r.cost === 2 * INK_COST,
        r ? `${r.cost}` : 'null');
  check('그 사이 board 는 그대로 비어 있다', B.board.plates.length === 0);

  const input = [cell(2, 2), cell(5, 5, 3)];
  const snap = JSON.stringify(input);
  minInk(input, cell(2, 2), { x: 9, y: 9 });
  check('입력을 변형하지 않는다', JSON.stringify(input) === snap);
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
