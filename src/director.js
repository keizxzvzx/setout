// 디렉터 — 층을 낸다
//
// AI 는 레벨을 만들지 않는다. 플레이어를 읽고, 그 사람이 피하는 것을 만든다.
//
// 이 파일은 후보를 **내기만** 한다. 풀리는지, 배급량 안에 드는지, 착시가
// 필요한지는 솔버가 따로 판정한다. 생성과 검증을 한 곳에 섞으면 층이 나쁠 때
// 지형이 나쁜 것인지 판정이 틀린 것인지 가릴 수 없다.
//
// path.js·solver.js 와 같은 규율을 지킨다: board 도 stage 도 읽지 않는다.
// 아직 세우지 않은 층을 값으로 다루는 것이 이 파일의 존재 이유다.

import { GRID_W, GRID_H, Z_MAX, INK_COST } from './config.js';
import { screenCell, skey } from './path.js';
import { minInk } from './solver.js';
import { profileOf, briefFor } from './profile.js';

// 시드 고정 난수 (mulberry32).
//
// Math.random 을 쓰면 두 가지가 무너진다. 검증이 재현되지 않아 "100개 다
// 통과했다" 가 확인할 수 없는 주장이 되고, 디렉터가 왜 그 층을 냈는지도
// "그때 그랬다" 로만 남는다. 같은 시드에 같은 층이 나와야 판단을 따라갈 수 있다.
//
// 외부 라이브러리를 쓰지 않는다는 원칙은 검증에도 그대로 적용된다.
// 32비트 상태 하나짜리라 직접 두는 편이 의존성을 들이는 것보다 싸다.
export function makeRng(seed) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const inBounds = (x, y, w, h) => x >= 0 && y >= 0 && x < w && y < h;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 곧게 가던 방향에 실어 주는 가중치.
//
// 네 방향을 고르게 뽑으면 매번 구불구불한 것만 나온다. 직선이 안 나오는 것도
// 다양한 것이 아니다. 3 이면 곧게 가던 방향이 나머지 셋을 합친 것과 비슷해져
// 곧은 판과 꺾인 판이 섞여 나온다.
const STRAIGHT_BIAS = 3;

// 자기 회피 보행 — 구조물의 모양
//
// 한 축으로만 k 를 더하던 것을 한 칸씩 걷는 것으로 바꾼다. 직선은 그중 한
// 결과로 남고 ㄱ·ㄷ·계단·S 가 같이 나온다. 획을 그어 만든 판과 같은 모양이라
// 미리 깔린 것과 내가 그은 것이 형태로는 구분되지 않는다 — 색으로만 갈린다.
//
// 한 줄로 이어져 있다는 것이 모양 문제만은 아니다. 셋이 여기서 나온다.
//
//   같은 z 위의 4방향 인접이라 전부 **진짜 길**이다 → 걸어서 건너는 이음매다
//   z 가 하나뿐이라 화면 자리 (x−z, y−z) 가 일대일이다 → 자기끼리 안 겹친다
//   양 끝이 남는다 → 목표와 시작을 이음매 끝에 붙이는 규칙이 그대로 산다
//
// lo 는 좌표의 하한이다. 화면 자리가 (x−z, y−z) 이므로 여기에 z 를 넣으면
// 격자 안이라는 조건과 화면 안이라는 조건이 한꺼번에 걸린다. 직선일 때는
// 시작 좌표에서 한 번 보면 끝났지만, 보행은 어디로 갈지 모르므로 한 칸
// 놓을 때마다 본다.
function walk(rng, len, lo, gridW, gridH) {
  if (lo > gridW - 1 || lo > gridH - 1) return [];

  const head = { x: pick(rng, lo, gridW - 1), y: pick(rng, lo, gridH - 1) };
  const cells = [head];
  const taken = new Set([skey(head.x, head.y)]);

  let dir = null;

  for (let k = 1; k < len; k++) {
    const last = cells[k - 1];
    const open = [];

    for (const d of DIRS) {
      const x = last.x + d[0];
      const y = last.y + d[1];
      if (x < lo || y < lo || x >= gridW || y >= gridH) continue;
      if (taken.has(skey(x, y))) continue;

      const weight = dir && d[0] === dir[0] && d[1] === dir[1] ? STRAIGHT_BIAS : 1;
      for (let i = 0; i < weight; i++) open.push({ x, y, d });
    }

    // 막히면 거기서 끝낸다. 되짚어 가며 길이를 채우지 않는다 — 짧게 나온 것은
    // 짧은 대로 구조물이고, 물려서 채우면 같은 자리를 맴도는 모양만 는다.
    // 모자란 길이는 부르는 쪽이 보고 버린다.
    if (!open.length) break;

    const next = open[pick(rng, 0, open.length - 1)];
    dir = next.d;
    cells.push({ x: next.x, y: next.y });
    taken.add(skey(next.x, next.y));
  }

  return cells;
}

// 몇 번 꺾였는가. 판단 기록에 모양을 남기려고 센다 — 무엇을 낸 층인지
// 로그만 보고 알 수 있어야 제출물 4번의 증거가 된다.
function turnsIn(cells) {
  let turns = 0;
  for (let i = 2; i < cells.length; i++) {
    const a = cells[i - 1];
    const b = cells[i - 2];
    const c = cells[i];
    if (c.x - a.x !== a.x - b.x || c.y - a.y !== a.y - b.y) turns++;
  }
  return turns;
}

const shapeOf = (cells) =>
  turnsIn(cells) === 0 ? '곧은' : `${turnsIn(cells)}번 꺾인`;

// 고정 구조물이 어느 층에서나 지켜야 하는 것.
//
// 한동안은 그 층의 zMax 이하여야 했다. pickAt 이 거기까지만 훑었으므로 넘겨
// 놓으면 화면에는 보이고 솔버는 길로 세는데 플레이어는 집을 수 없는 판이
// 되었다. 이제 pickAt 은 stage.zTop — 그 층에 실제로 있는 가장 높은 것 —
// 까지 훑으므로 구조물은 플레이어 상한 위에 있어도 된다.
// 정직 층(zMax=0)의 뜬판이 그 자리에 선다.
//
// 남는 상한은 Z_MAX 하나다. 카메라 여유와 깊이 정렬이 거기까지만 확인돼 있고,
// 넘기면 판 머리가 화면 밖으로 나가는데 잘린 것은 보이지도 않는다.
export const fixtureOk = (f, ceiling = Z_MAX) => f.z >= 0 && f.z <= ceiling;

// 착시 층의 구조물이 더 지켜야 하는 것.
//
// z 는 1 이상이어야 한다. 정직한 간선은 z 가 같아야 성립하는데(isIllusion 은
// a.z !== b.z 한 줄이다) 그릴 수 있는 칸은 언제나 z=0 이므로, z ≥ 1 인
// 구조물은 그린 판과 절대 정직하게 붙지 않는다. 이것이 보장되어야
// "정직하게만 가면 얼마인가" 가 거짓말을 하지 않는다.
//
// 정직 층에는 이 규칙을 걸지 않는다. 거기서는 구조물이 이음매가 아니라
// 바닥에 눕힌 공짜 길이고, 정직하게 이어지는 것이 목적이기 때문이다.
export const seamOk = (f, ceiling = Z_MAX) => f.z >= 1 && f.z <= ceiling;

// ---------------------------------------------------------------------------
// 착시를 요구하는 층
//
// 판 한 줄을 z 만큼 올려 둔다. 화면에서는 (x−z, y−z) 로 당겨지므로, 3D 에서는
// 저 멀리 비스듬히 있던 판이 목표 옆에 와서 선다. 거기 붙어 서면 목표 앞까지
// 공짜로 실려 가고, 그리기만으로 가려면 그 거리를 전부 잉크로 물어야 한다.
//
// 올려 둔 줄은 자기 기둥을 계속 잡고 있으므로 원래 자리에는 그릴 수도 설 수도
// 없다. 이음매를 놓는 것이 동시에 벽을 놓는 것이기도 하다.
// ---------------------------------------------------------------------------
// 이음매가 화면에서 벌려 놓아야 하는 최소 거리 (칸).
const SEAM_SPAN = 4;

// 층이 얹는 구조물의 양. 익히는 판(depth 0)과 다 자란 판(depth 1).
//
// 예전에는 이 숫자가 의도에 딸려 있었다. 착시 층은 이음매 하나로 끝이라 화면이
// 휑했고, 정직 층은 처음부터 여섯 개였다. 그래서 같은 두 장째가 사람에 따라
// 1개/5칸이기도 6개/23칸이기도 했다. 이제 시트 번호가 쥔다(profile.depthOf).
//
// 뜬판은 어느 쪽이든 **둘 이상**이다. 하나뿐이면 그것이 곧 이 층의 정답이라
// 고를 것이 없고, 둘부터 어느 쪽을 쓸지가 플레이어의 판단이 된다.
const GROWTH = [
  // 0 — 익히는 판
  { extras: [1, 2], extraLen: [2, 4], bridges: [2, 3], floats: [2, 2] },
  // 1 — 다 자란 판
  { extras: [5, 8], extraLen: [2, 5], bridges: [5, 8], floats: [2, 3] },
];

// 자리를 못 잡았을 때 같은 조각을 다시 뽑아 보는 횟수 (조각 하나당).
const PLACE_TRIES = 8;

// 뜬판을 흩뿌린다. 이음매처럼 길 노릇을 하라고 놓는 것이 아니라 화면을 채우고
// 고를 거리를 만드는 것이라, 자리를 못 잡으면 그 조각만 포기하고 넘어간다.
//
// 여기 놓이는 것도 전부 z ≥ 1 이다. 정직한 간선은 z 가 같아야 성립하는데
// 그릴 수 있는 칸은 언제나 z=0 이므로, 하나라도 바닥에 눕히는 순간
// "그리기만으로 가면 얼마인가" 가 거짓말이 된다 — seamOk 가 지키는 그 규칙이다.
//
// taken 을 제자리에서 불린다. 기둥과 화면 자리를 한 집합에 같이 넣는 것은
// 둘 다 "여기는 이미 누가 쓴다" 라는 같은 뜻이기 때문이다.
function scatter(rng, count, lifts, lens, gridW, gridH, taken) {
  const out = [];

  for (let i = 0; i < count * PLACE_TRIES && out.length < count; i++) {
    const lift = pick(rng, ...lifts);
    const cells = walk(rng, pick(rng, ...lens), lift, gridW, gridH);
    if (!cells.length) continue;

    const span = cells.map((c) => ({ x: c.x - lift, y: c.y - lift }));
    const keys = [...cells, ...span].map((c) => skey(c.x, c.y));

    // 자기 기둥과 자기 화면 자리가 겹치는 것도 막는다. lift 만큼 대각으로
    // 뻗은 보행에서 실제로 일어난다.
    if (new Set(keys).size !== keys.length) continue;
    if (keys.some((k) => taken.has(k))) continue;

    for (const k of keys) taken.add(k);
    out.push({ cells, z: lift, span });
  }

  return out;
}

function illusionLayout(rng, gridW, gridH, zMax, minCells, depth) {
  if (zMax < 1) return null;

  const lift = pick(rng, 1, zMax);

  // 격자와 화면 양쪽에서 부지 안이어야 한다. 화면 자리가 (x−lift, y−lift) 이므로
  // 보행의 하한에 lift 를 넣으면 양쪽이 한꺼번에 만족된다.
  const cells = walk(rng, pick(rng, 4, 8), lift, gridW, gridH);

  // 짧게 끝난 보행은 버린다. 이음매의 값은 화면에서 벌어 주는 거리라
  // 서너 칸으로는 실어 나를 것이 없다.
  if (cells.length < 4) return null;

  // 끝에서 끝까지도 그만큼 벌어져 있어야 한다.
  //
  // 칸 수가 아니라 **두 끝 사이의 거리**가 이음매의 값이다. 목표는 한쪽 끝에
  // 붙고 시작은 반대쪽 끝에서 떨어뜨리므로, 접혀서 제자리로 돌아오는 보행은
  // 여덟 칸을 써도 두 칸짜리 이음매다. 그러면 그리기 값이 안 커져 착시와의
  // 사이에 배급을 끼울 자리가 없어진다 — 실측하니 시도 100번 중 36번이
  // NO_BUDGET_WINDOW 였고, 걸린 것이 전부 이 부류였다.
  //
  // 같은 z 위에 있으므로 격자 거리가 그대로 화면 거리다.
  if (dist(cells[0], cells.at(-1)) < SEAM_SPAN) return null;

  const strip = { cells, z: lift };
  const columns = new Set(cells.map((c) => skey(c.x, c.y)));
  const span = new Set(cells.map((c) => {
    const s = screenCell({ ...c, z: lift });
    return skey(s.x, s.y);
  }));

  // 그릴 수 있는 자리인가. 기둥이 잡혀 있으면 못 그리고, 화면이 덮여 있으면
  // 그어 봐야 보이지 않는다. solver 의 세 갈래와 같은 규칙이다.
  const free = (x, y) =>
    inBounds(x, y, gridW, gridH) && !columns.has(skey(x, y)) && !span.has(skey(x, y));

  const endOf = (i) => screenCell({ ...cells[i], z: lift });
  const goalEnd = rng() < 0.5 ? 0 : cells.length - 1;
  const farEnd = goalEnd === 0 ? cells.length - 1 : 0;

  // 목표는 이음매 한쪽 끝의 화면 이웃이다. 빈 바닥이라 그려야 닿는다.
  const g = endOf(goalEnd);
  const goals = [
    { x: g.x + 1, y: g.y }, { x: g.x - 1, y: g.y },
    { x: g.x, y: g.y + 1 }, { x: g.x, y: g.y - 1 },
  ].filter((c) => free(c.x, c.y));
  if (!goals.length) return null;
  const goal = goals[pick(rng, 0, goals.length - 1)];

  // 시작점은 이음매 반대쪽 끝에서 이만큼 떨어뜨린다.
  //
  // 처음에는 1~3칸으로 두었다. 이음매가 공짜로 실어 주는 것이 요점이니 가까울수록
  // 좋다고 본 것인데, 루프를 돌려 재 보니 층의 절반이 배급 10(5칸) 이하로 나왔다.
  // 판 하나 긋고 끝나는 것은 층이 아니다.
  //
  // 떨어뜨리면 둘 다 늘어난다. 이음매까지 가는 다리를 실제로 놓아야 하고,
  // 그리기만으로 가는 값은 더 크게 늘어난다 — 이음매가 화면에서 벌어 주는
  // 거리가 그대로 차이로 남기 때문이다.
  const START_NEAR = 5;
  const START_FAR = 9;

  const f = endOf(farEnd);
  const starts = [];

  for (let dx = -START_FAR; dx <= START_FAR; dx++) {
    for (let dy = -START_FAR; dy <= START_FAR; dy++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < START_NEAR || d > START_FAR) continue;

      const x = f.x + dx;
      const y = f.y + dy;
      if (!free(x, y)) continue;
      if (x === goal.x && y === goal.y) continue;

      // 그리기만으로 가는 값은 사실상 시작에서 목표까지의 맨해튼 거리다 —
      // 이 층에서 공짜로 밟을 수 있는 것은 올려 둔 이음매뿐인데, 거기에는
      // 정직하게 발을 디딜 수 없기 때문이다. 그래서 얕은 층인지를 솔버에게
      // 묻지 않고 여기서 안다. 판정에 맡기면 후보의 절반 이상이 그 자리에서
      // 떨어져 루프가 헛돈다 — 실측하니 재설계율이 62% 였다.
      if (Math.abs(x - goal.x) + Math.abs(y - goal.y) < minCells) continue;

      starts.push({ x, y });
    }
  }
  if (!starts.length) return null;

  const start = starts[pick(rng, 0, starts.length - 1)];

  // 이음매 말고 더 얹는 뜬판. 시작과 목표가 정해진 뒤에 놓는다 — 먼저 흩뿌리면
  // 목표를 붙일 자리와 시작을 세울 자리를 자기가 먹어 버린다.
  const taken = new Set([
    ...columns, ...span,
    skey(goal.x, goal.y), skey(start.x, start.y),
  ]);
  const extras = scatter(rng, pick(rng, ...GROWTH[depth].extras),
                         [1, zMax], GROWTH[depth].extraLen, gridW, gridH, taken);

  // 뜬판 둘은 지켜야 한다. 하나도 못 놓았으면 부지가 이미 빡빡한 것이라
  // 이 후보는 버린다.
  if (!extras.length) return null;

  const fixtures = [strip, ...extras.map((f) => ({ cells: f.cells, z: f.z }))];

  return {
    intent: 'illusion',
    start,
    goal,
    zMax,
    fixtures,
    note: `${shapeOf(cells)} 판 ${cells.length}칸을 z=${lift} 로 올려 목표 옆에 세웠다. ` +
          `3D 에서는 ${lift}칸 떨어져 있고 아무것도 닿아 있지 않다. ` +
          `곁에 뜬판 ${extras.length}개를 더 놓아 고를 것을 만들었다.`,
  };
}

// ---------------------------------------------------------------------------
// 정직하게 짓게 하는 층
//
// 착시만 노리는 사람에게 낸다. 높이 상한을 0 으로 조이면 판을 올릴 수 없고,
// 모든 칸이 z=0 이라 착시 간선이 아예 생기지 않는다. 도구를 어렵게 만드는 것이
// 아니라 도구 자체를 뺏는다.
//
// 처음에는 상한을 1 로 두고 한 칸짜리 판을 올려 벽으로 쓰려 했다. 올린 판은
// 자기 기둥을 계속 잡으므로 통로가 좁아진다는 계산이었는데, 실측해 보니
// 200층 중 198층에서 착시가 더 쌌다. 올려 둔 한 칸은 벽이면서 동시에
// **공짜 징검다리**다 — 딛고 올라섰다 내려오면 한 칸을 안 그리고 넘어간다.
// 착시를 뺏으려던 층이 착시를 나눠 주고 있었다.
//
// 그래서 길 노릇을 하는 구조물은 바닥에 눕힌다. z=0 이면 그린 판과 정직하게
// 이어지는 공짜 길이 되어 벽이 아니라 지름길이 되고, 배급이 조인 층에서는 그
// 지름길을 찾아 꿰는 것이 그대로 퍼즐이 된다.
//
// 그 위에 **길이 아닌 뜬판을 하나** 얹는다. 판이 전부 바닥에 누워 있으면 그
// 장에서만 화면이 평평하고, 무엇보다 이 게임이 무엇을 하는 게임인지가 사라진다.
// 상한이 0 이라 플레이어는 그것을 못 올리고 못 따라 만든다 — 정렬을 뺏는다는
// 정직 층의 뜻은 그대로다.
// ---------------------------------------------------------------------------

// 띄워 둘 판. 짧고 낮게 둔다.
//
// 길수록 딛고 아낄 수 있는 칸이 늘어 경로에서 더 멀리 떨어뜨려야 하고,
// 높을수록 카메라가 위를 더 비워 도면이 작아진다. 정직 층은 원래 상한이 0 이라
// 여유가 1 이면 됐던 층이므로, 여기서 8 까지 띄우면 그 장만 눈에 띄게 쪼그라든다.
const FLOAT_LEN = [1, 3];
const FLOAT_LIFT = [2, 4];

function honestLayout(rng, gridW, gridH, minCells, depth) {
  const lid = 0;

  const bridges = [];
  const columns = new Set();
  const count = pick(rng, ...GROWTH[depth].bridges);

  for (let i = 0; i < count; i++) {
    const cells = walk(rng, pick(rng, 3, 6), 0, gridW, gridH);

    // 한 칸이라도 겹치면 통째로 버린다. 겹친 칸만 빼면 남은 것이 두 동강 나
    // "한 줄로 이어진 다리" 라는 성질이 조용히 깨진다.
    if (cells.length < 3) continue;
    if (cells.some((c) => columns.has(skey(c.x, c.y)))) continue;

    for (const c of cells) columns.add(skey(c.x, c.y));
    bridges.push({ cells, z: lid });
  }
  if (!bridges.length) return null;

  // 기둥도 화면 자리도 미리 깔린 다리를 침범하면 안 된다. 화면 자리가 겹치면
  // 뜬판이 그 다리를 덮어 공짜 길이 하나 사라지고, 기둥이 겹치면 한 (x,y) 에
  // 판이 둘이 되어 3단계에서 막아 둔 조회 유일성이 깨진다. scatter 가 taken
  // 하나로 둘 다 본다.
  const taken = new Set(columns);
  const floats = scatter(rng, pick(rng, ...GROWTH[depth].floats),
                         FLOAT_LIFT, FLOAT_LEN, gridW, gridH, taken);
  if (floats.length < 2) return null;

  // 뜬판이 있으므로 이제 가림이 있다. 기둥과 화면 자리를 둘 다 피해야 그릴 수 있다.
  const free = (x, y) => inBounds(x, y, gridW, gridH) && !taken.has(skey(x, y));

  // 시작과 목표는 서로 멀어야 배급량이 난이도가 된다.
  const spots = [];
  for (let i = 0; i < 40; i++) {
    const x = pick(rng, 0, gridW - 1);
    const y = pick(rng, 0, gridH - 1);
    if (free(x, y)) spots.push({ x, y });
  }
  if (spots.length < 2) return null;

  // 뜬판이 지름길이 될 만한 쌍을 먼저 쳐낸다.
  //
  // 판을 a 로 올라타 b 로 내려온다고 하면 그렇게 가는 값은
  // d(start,a) + d(b,goal) − 1 이다 — 판 위는 공짜라 몇 칸을 밟든 값이 같고,
  // 아끼는 것은 올라탄 칸 하나뿐이다. 직행이 k = d(start,goal) 이므로
  //
  //   아끼는 양 ≤ d(a,b) − detour(a) + 1,   detour(s) = d(start,s) + d(s,goal) − k
  //
  // 이고 한 줄 보행이라 d(a,b) ≤ N−1 이다. 그러므로 모든 칸의 detour 가 N 이상
  // 이면 어떻게 올라타도 한 칸도 못 아낀다. N=1 에 detour 0 이면 딱 한 칸을
  // 아끼는데, 3단계에서 상한 1 로 실측했을 때 층을 죽인 것이 그 한 칸이었다.
  //
  // **다만 이 계산은 미리 깔린 다리가 없을 때의 것이다.** 다리는 공짜라 실제
  // 값이 맨해튼 거리가 아니게 되고, 그 틈으로 지름길이 되는 층이 100개 중 6개
  // 새어 나갔다. 그래서 여기서 끝내지 않고 아래에서 솔버에게 직접 묻는다.
  // 판마다 N 이 다르므로 자기 길이로 잰다. 긴 판일수록 더 멀리 비켜 있어야 한다.
  const detourOf = (a, b) => {
    const k = dist(a, b);
    return floats.reduce((worst, f) => Math.min(worst,
      f.span.reduce((m, s) => Math.min(m, dist(a, s) + dist(s, b) - k - f.cells.length),
                    Infinity)), Infinity);
  };

  const pairs = [];
  for (const a of spots) {
    for (const b of spots) {
      // 여기 미리 깔린 다리는 z=0 이라 정직하게 밟힌다. 그만큼 그리기 값이
      // 맨해튼 거리보다 싸지므로 여유를 얹어 잡는다.
      const d = dist(a, b);
      if (d < minCells + 6) continue;
      if (detourOf(a, b) < 0) continue;

      pairs.push({ start: a, goal: b, d });
    }
  }
  if (!pairs.length) return null;

  // 먼 쌍부터 본다. 멀수록 배급량이 난이도로 일한다.
  pairs.sort((p, q) => q.d - p.d);

  // 솔버에게 직접 묻는다.
  //
  // 판정을 여기로 끌어온 것이 아니라 **배치를 정하는 것**이다. 층이 좋은지가
  // 아니라 이 자리에 시작과 목표를 놓아도 뜬판이 놀고 있는지를 묻고, 아니라고
  // 하면 다음 쌍으로 넘어간다. 층의 좋고 나쁨은 verify 가 따로 판정한다.
  //
  // 맨해튼으로만 거르고 판정에 맡기면 걸릴 때마다 지형을 통째로 버리게 되어
  // 루프가 길어진다. 착시 층에서 minCells 를 미리 보는 것과 같은 이유다.
  const laidCells = [
    ...bridges.flatMap((f) => f.cells.map((c) => ({ x: c.x, y: c.y, z: lid }))),
    ...floats.flatMap((f) => f.cells.map((c) => ({ x: c.x, y: c.y, z: f.z }))),
  ];

  let best = null;

  for (const p of pairs.slice(0, PLACE_TRIES)) {
    const from = { x: p.start.x, y: p.start.y, z: 0 };
    const cells = [from, ...laidCells];

    const honest = minInk(cells, from, p.goal, { allowIllusion: false });
    if (!honest) continue;

    // 그리기만으로 가는 값이 너무 짧으면 층이라고 할 것이 없다. 맨해튼 거리로는
    // 멀어도 미리 깔린 다리를 꿰면 짧아지므로, 여기서 실제 값으로 다시 본다.
    if (honest.cost / INK_COST < minCells) continue;

    // 뜬판이 한 방울이라도 값을 깎으면 그 쌍은 못 쓴다. verify 의
    // ILLUSION_CHEAPER 와 같은 조건이고, 걸리기 전에 여기서 피한다.
    const any = minInk(cells, from, p.goal);
    if (!any || any.cost < honest.cost) continue;

    best = { ...p, detour: detourOf(p.start, p.goal) };
    break;
  }
  if (!best) return null;

  const laid = bridges.reduce((n, f) => n + f.cells.length, 0);
  const up = floats.reduce((n, f) => n + f.cells.length, 0);

  return {
    intent: 'honest',
    start: best.start,
    goal: best.goal,
    zMax: lid,
    fixtures: [...bridges, ...floats.map((f) => ({ cells: f.cells, z: f.z }))],
    note: `높이 상한을 0 으로 조였다. 올릴 수 있는 판이 없으니 맞출 정렬도 ` +
          `없다. 바닥에 ${laid}칸을 미리 깔고, 뜬판 ${floats.length}개 ${up}칸을 ` +
          `z=${floats.map((f) => f.z).join('·')} 로 띄웠다 — 경로에서 ` +
          `${best.detour}칸 더 비켜 있어 딛고 돌아도 한 칸을 못 아낀다.`,
  };
}

// ---------------------------------------------------------------------------

// 층 후보 하나. 판정은 하지 않는다.
//
// brief 는 "무엇을 요구하는 층인가" 다. 6단계 뒤쪽에서 플레이어 성향이
// 이것을 정하게 되지만, 지금은 부르는 쪽이 직접 적어 낸다.
//
// 자리를 못 잡으면 null 을 돌려준다. 이것은 재설계가 아니라 배치 실패다 —
// 판정에서 떨어지는 것과 구분해야 실패 이유가 흐려지지 않는다.
export function design(brief = {}, rng = makeRng(1)) {
  const {
    intent = 'illusion',
    gridW = GRID_W,
    gridH = GRID_H,
    zMax = Z_MAX,
    minCells = MIN_CELLS,
    // 얼마나 얹을 것인가. 부르는 쪽이 안 적어 내면 다 자란 판으로 본다 —
    // 익히는 판은 판단해서 내주는 것이지 기본값이 아니다.
    depth = 1,
    tries = 40,
  } = brief;

  for (let i = 0; i < tries; i++) {
    const c = intent === 'honest'
      ? honestLayout(rng, gridW, gridH, minCells, depth)
      : illusionLayout(rng, gridW, gridH, zMax, minCells, depth);

    if (!c) continue;
    // 상한은 그 층의 zMax 가 아니라 Z_MAX 다. 정직 층의 뜬판은 플레이어 상한
    // 위에 있고, 그래도 되는 이유는 pickAt 이 zTop 까지 훑기 때문이다(stage.js).
    if (!c.fixtures.every((f) => fixtureOk(f, Z_MAX))) continue;

    // 이음매를 쓰는 층은 그것이 정직하게 붙지 않는 것까지 지켜야 한다.
    // 착시를 강제하는 층과 고르게 하는 층 둘 다 여기 걸린다 — 어느 쪽이든
    // "그리기만으로 가면 얼마인가" 가 정확해야 판정이 성립한다.
    if (intent !== 'honest' && !c.fixtures.every((f) => seamOk(f, Z_MAX))) continue;

    // 지형은 같아도 무엇을 묻는 층인지는 지시가 정한다.
    // illusionLayout 이 붙여 둔 이름을 그대로 두면 고르게 하려고 낸 층이
    // 착시를 강제하는 층으로 판정된다.
    return { ...c, intent };
  }

  return null;
}

// 후보 + 배급량 → stage 명세.
//
// 배급량은 후보에 들어 있지 않다. 얼마를 줘야 하는지는 지형을 보고 정하는
// 것이 아니라 솔버가 낸 최소 잉크에서 나오기 때문이다. 지형과 배급을 한
// 곳에서 정하면 "착시를 강제하려면 얼마" 라는 계산을 넣을 자리가 없어진다.
export function toStageSpec(candidate, inkMax) {
  return {
    start: candidate.start,
    goal: candidate.goal,
    zMax: candidate.zMax,
    fixtures: candidate.fixtures,
    inkMax,
  };
}

// 후보를 솔버가 받는 칸 목록으로 편다. 시작 발판도 판이므로 같이 넣는다 —
// 캐릭터가 설 자리가 없으면 층이 성립하지 않는다.
export function candidateCells(candidate) {
  const cells = [{ x: candidate.start.x, y: candidate.start.y, z: 0 }];

  for (const f of candidate.fixtures) {
    for (const c of f.cells) cells.push({ x: c.x, y: c.y, z: f.z });
  }

  return cells;
}

// ---------------------------------------------------------------------------
// 판정
//
// 계획서의 검증 3항목이 전부 두 숫자의 부등식으로 떨어진다.
//
//   풀리는가                    illusionCost 가 있는가
//   배급량 안에서 풀리는가      illusionCost ≤ inkMax
//   최소 해법이 착시를 요구하는가  honestCost > inkMax
//
// 세 번째가 이 판정의 중심이다. 착시를 강제한다는 것은 결국 **배급량을
// illusionCost 와 honestCost 사이에 끼우는 것**이고, 그 구간이 비면 어떤
// 배급량으로도 안 되므로 지형을 다시 설계하라는 신호가 된다.
//
// honestCost 는 "판을 하나도 건드리지 않고 그리기만으로 가는 값" 이다.
// 플레이어가 판을 올려 더 싸게 푸는 경우까지는 세지 않는다 — 솔버가 높이
// 조절을 탐색하지 않기로 한 결정이 여기까지 이어진다. 그래도 판정의 뜻은
// 남는다. 이 값이 배급을 넘으면 **그리기만으로는 갈 수 없다**는 것이 보장되고,
// 그 순간 플레이어는 높이라는 도구를 꺼낼 수밖에 없다.
//
// 판정만 하고 고치지는 않는다. fix 는 다음에 무엇을 바꿀지 적어 낼 뿐이고,
// 그것을 실제로 돌리는 것은 재설계 루프의 몫이다. 판정과 대응을 섞으면
// 층이 안 나올 때 판정이 틀린 것인지 대응이 틀린 것인지 가릴 수 없다.
// ---------------------------------------------------------------------------

// 최소 해법에 얹어 주는 여유 (칸).
//
// 배급을 최소 해법에 딱 맞추면 한 칸도 헛디딜 수 없다. 그런데 헛디딘 다리를
// 걸어 본 순간 그 잉크는 영영 안 돌아온다 — 밟은 칸은 환급이 0 이기 때문이다
// (2·4단계에서 징검다리를 막으려고 그렇게 정했다).
//
// 1층에서는 배급이 120(60칸)이라 드러나지 않았다. 디렉터 층은 16~30 이라
// 실측하니 실제 여유가 중앙값 2칸, 최소 0칸이었다. 잘못된 다리를 한 번
// 걸어 보면 층을 못 끝내고, 왜 막혔는지 알 방법도 없다.
//
// 2칸을 얹으면 200층 중 182층이 살아남고 나머지는 루프가 다시 뽑는다.
// 착시를 강제하는 성질은 그대로다 — 여유를 얹고도 그리기 값보다 낮으면 된다.
export const WASTE_MARGIN = 2;   // 칸

// 고르게 하는 층에서 두 길의 값 차이가 이보다 작으면 고를 이유가 없다.
// 어느 쪽을 골라도 같으면 그 선택은 성향이 아니라 그날의 기분이다.
export const CHOICE_GAP = 3;   // 칸

// 그리기만으로 가는 값이 이보다 짧으면 층이라고 할 것이 없다.
//
// 6 에서 10 으로 올렸다. 루프를 200번 돌려 재 보니 6 에서는 층의 일부가 배급
// 10(5칸) 이하로 나왔는데, 판 하나 긋고 끝나는 것은 층이 아니다. 10 으로 올리니
// 그런 층이 0 개가 되고 배급 중앙값이 18(9칸)로 올라갔다. 12 도 재 봤지만
// 시도 횟수가 최대 20회까지 늘어 값에 비해 비쌌다.
export const MIN_CELLS = 10;

const budgetFix = (inkMax, note) => ({ action: 'budget', inkMax, note });
const redesignFix = (note) => ({ action: 'redesign', note });

export function verify(candidate, inkMax, opts = {}) {
  const { minCells = MIN_CELLS, margin = WASTE_MARGIN * INK_COST } = opts;

  const cells = candidateCells(candidate);
  const from = { x: candidate.start.x, y: candidate.start.y, z: 0 };

  const illusion = minInk(cells, from, candidate.goal);
  const honest = minInk(cells, from, candidate.goal, { allowIllusion: false });

  const i = illusion ? illusion.cost : null;
  const h = honest ? honest.cost : null;

  const out = (code, reason, fix = null) => ({
    ok: code === 'OK',
    code,
    reason,
    fix,
    intent: candidate.intent,
    inkMax,
    illusionCost: i,
    honestCost: h,
    illusion,
    honest,
  });

  if (!illusion) {
    return out('UNSOLVABLE',
      '착시를 써도 목표에 닿는 길이 없다.',
      redesignFix('목표를 당기거나 구조물을 하나 더 놓는다.'));
  }

  // 정직 의도인데 정직한 길이 아예 없으면 배급으로는 어쩔 수 없다.
  if (candidate.intent === 'honest' && !honest) {
    return out('ILLUSION_FORCED',
      '정직하게 지으라고 낸 층인데, 그리기만으로 가는 길이 아예 없다.',
      redesignFix('길을 막고 있는 구조물을 치운다.'));
  }

  // 깊이는 **그리기만으로 가는 값**으로 잰다.
  //
  // 착시 층은 설계상 그리는 칸이 적다 — 이음매가 공짜로 실어 주는 것이 요점이라
  // 서너 칸만 그으면 닿는다. 그것을 얕다고 떨어뜨리면 잘 만든 착시 층이 전부
  // 걸린다. 처음에 의도한 해법의 길이로 쟀다가 100층 중 97층이 여기서 걸렸다.
  //
  // 층이 시시한 것은 그리는 칸이 적어서가 아니라 **그냥 그려서 가도 싸서**다.
  // 그 값이 작으면 배급을 어떻게 조여도 착시를 쓸 이유가 생기지 않는다.
  // 그리기로 아예 못 가는 층은 그 자체로 얕지 않으므로 착시 값으로 대신 잰다.
  const floor = honest ? honest.cost : illusion.cost;
  const floorCells = floor / INK_COST;

  if (floorCells < minCells) {
    // 무엇으로 쟀는지를 문구가 말해야 한다. 그리기로 못 가는 층에서도 "그냥
    // 그려도 7칸" 이라고 적고 있었는데, 그 7칸은 착시로 갈 때의 값이다.
    // 판정은 맞고 설명만 뒤처진 것이라 화면에는 증상이 없지만, 이 기록이
    // 제출물 4번의 증거라서 읽는 사람이 값과 문구를 대조하면 어긋난다.
    return out('TOO_SHALLOW',
      honest
        ? `그냥 그려도 ${floorCells}칸이면 닿는다. 층이라고 할 것이 없다.`
        : `그리기로는 못 가지만 착시로 ${floorCells}칸이면 닿는다. ` +
          `층이라고 할 것이 없다.`,
      redesignFix(`목표를 밀어낸다 — 그리기로 최소 ${minCells}칸.`));
  }

  // --- 고르게 하는 층 ---
  //
  // 맞서기만 해서는 성향을 읽을 수 없다. 착시를 강제하면 누구나 이음매를
  // 건너고, 정렬을 없애면 아무도 못 건넌다. 둘 다 갈 수 있는데 착시가 싼 층을
  // 내야 무엇을 고르는지가 그 사람의 것이 된다.
  if (candidate.intent === 'open') {
    if (h === null) {
      return out('NO_CHOICE',
        '그리기만으로 가는 길이 없다. 고를 것이 없으면 읽을 것도 없다.',
        redesignFix('길을 막고 있는 구조물을 치운다.'));
    }

    const gap = (h - i) / INK_COST;

    if (gap < CHOICE_GAP) {
      return out('NO_CHOICE',
        `착시 ${i} 와 그리기 ${h} 의 차이가 ${gap}칸뿐이다. ` +
        '어느 쪽을 골라도 비슷하면 그 선택은 성향이 아니다.',
        redesignFix(`이음매를 목표에서 더 먼 자리로 옮겨 차이를 ${CHOICE_GAP}칸 이상으로 벌린다.`));
    }

    if (h + margin > inkMax) {
      return out('OVER_BUDGET',
        `비싼 쪽(그리기 ${h})에 여유 ${margin} 을 얹으면 배급 ${inkMax} 밖이다. ` +
        '고를 수 없으면 물어본 것이 아니다.',
        budgetFix(h + margin, `배급을 ${h + margin} 로 올려 둘 다 갈 수 있게 한다.`));
    }

    return out('OK',
      `착시로 ${i}, 그리기로 ${h}. 배급 ${inkMax} 안에서 둘 다 갈 수 있고 ${gap}칸이 갈린다.`);
  }

  if (candidate.intent === 'honest') {
    // 착시가 더 싸면 착시만 노리는 사람에게 그대로 질러갈 구멍을 주는 셈이다.
    if (i < h) {
      if (i <= inkMax && inkMax < h) {
        return out('ILLUSION_FORCED',
          `정직한 길이 ${h} 인데 배급이 ${inkMax} 다. ` +
          '정직하게 지으라고 낸 층이 착시를 강요하고 있다.',
          budgetFix(h, `배급을 ${h} 로 올려 정직한 길을 열어 준다.`));
      }
      return out('ILLUSION_CHEAPER',
        `착시가 ${i} 로 정직한 ${h} 보다 싸다. 배급을 조여도 착시 쪽이 먼저 열린다.`,
        redesignFix('정렬이 성립하지 않도록 상한을 조이거나 구조물을 눕힌다.'));
    }

    if (h + margin > inkMax) {
      return out('OVER_BUDGET',
        `정직한 최소 해법 ${h} 에 여유 ${margin} 을 얹으면 배급 ${inkMax} 를 넘는다.`,
        budgetFix(h + margin, `배급을 ${h + margin} 로 올린다.`));
    }

    return out('OK', `그리기만으로 ${h} 에 풀린다. 맞출 정렬은 없다.`);
  }

  // --- 착시 의도 ---

  if (i + margin > inkMax) {
    return out('OVER_BUDGET',
      `최소 해법 ${i} 에 여유 ${margin} 을 얹으면 배급 ${inkMax} 를 넘는다. ` +
      '딱 맞추면 한 칸도 헛디딜 수 없다.',
      budgetFix(i + margin, `배급을 ${i + margin} 로 올린다.`));
  }

  // 정직한 길이 없으면 착시가 유일한 길이다 — 원하던 것보다 더 확실하다.
  if (h === null) return out('OK', `그리기만으로는 갈 수 없고, 착시로 ${i} 에 풀린다.`);

  if (h > inkMax) {
    return out('OK',
      `착시로 ${i}, 그리기만으로는 ${h}. 배급 ${inkMax} 안에서는 착시뿐이다.`);
  }

  // 정직한 길이 배급 안에 있다. 조일 자리가 남았는가?
  //
  // 배급 b 는 i ≤ b < h 를 만족해야 한다. 값이 전부 INK_COST 의 배수이므로
  // 조일 수 있는 최대값은 h − INK_COST 이고, 그것이 i 보다 작으면 구간이 비었다.
  const tightest = h - INK_COST;

  if (tightest < i + margin) {
    return out('NO_BUDGET_WINDOW',
      `착시 ${i} 에 여유 ${margin} 을 얹으면 그리기 ${h} 아래에 끼울 자리가 없다. ` +
      '착시를 강제하면서 헛디딜 여유까지 주는 배급량이 없다.',
      redesignFix('이음매를 목표에서 더 먼 자리로 옮겨 그리기 값을 키운다.'));
  }

  return out('ILLUSION_UNUSED',
    `그리기만으로 ${h} 라 배급 ${inkMax} 안에 들어온다. 착시를 쓸 이유가 없다.`,
    budgetFix(tightest, `배급을 ${tightest} 로 조인다 — 착시 ${i} 와 그리기 ${h} 사이.`));
}

// ---------------------------------------------------------------------------
// 배급을 놓을 창
//
// 판정을 통과했다는 것은 지금 배급이 창 안에 있다는 뜻이지 그 값이 좋다는
// 뜻은 아니다. 창의 바닥은 여유가 0 이라 한 칸도 헛디딜 수 없고, 천장은
// 실험할 자리가 넉넉하다. 어디를 고를지는 층의 성격이 아니라 **플레이어의
// 성향**이 정할 일이라, 여기서는 창만 돌려주고 고르는 것은 밖에 맡긴다.
//
// 망설이는 사람에게 바닥값을 주는 대응이 여기에 걸린다.
// ---------------------------------------------------------------------------
const snap = (x) => Math.max(INK_COST, Math.round(x / INK_COST) * INK_COST);

export function budgetWindow(v, opts = {}) {
  const { margin = WASTE_MARGIN * INK_COST } = opts;

  // 어느 층이든 바닥은 "최소 해법 + 헛디딜 여유" 다. 딱 맞추면 잘못된 다리를
  // 한 번 걸어 보는 것만으로 층을 못 끝낸다.
  if (v.intent === 'open' || v.intent === 'honest') {
    // 두 층 다 비싼 쪽(그리기)까지 닿아야 성립한다. 위쪽 제약은 없지만
    // 무한정 주면 퍼즐이 아니게 되므로 실험할 만큼만 얹는다.
    const min = v.honestCost + margin;
    return { min, max: min + snap(min * 0.3) };
  }

  const min = v.illusionCost + margin;

  // 그리기로 아예 못 가는 층은 천장이 없다. 조일 이유도 없으므로 여유를 준다.
  if (v.honestCost === null) return { min, max: min + snap(min * 0.5) };

  return { min, max: Math.max(min, v.honestCost - INK_COST) };
}

// 창 안에서 배급 하나를 고른다. slack 0 이면 바닥(조임), 1 이면 천장(여유).
export function pickBudget(window, slack = 0.5) {
  const t = Math.min(1, Math.max(0, slack));
  const raw = window.min + t * (window.max - window.min);
  return Math.min(window.max, Math.max(window.min, snap(raw)));
}

// ---------------------------------------------------------------------------
// 생성 → 검증 → 재설계
//
// 이 루프가 6단계의 형태 그 자체다. 실패 이유가 다음 수를 정한다 —
// 배급 문제면 같은 지형에 배급만 바꿔 다시 묻고, 지형 문제면 새로 뽑는다.
// 무작위로 다시 뽑기만 하면 절차적 생성이지 에이전트가 아니다.
//
// 배급을 0 에서 출발시킨다. 첫 판정은 반드시 실패하고, 그 fix 가 최소값을
// 짚어 준다. 얼마를 줘야 하는지를 미리 정해 두지 않고 솔버에게 물어서 아는
// 구조라, 지형이 바뀌면 배급도 저절로 따라온다.
//
// 시도 기록을 남긴다. 이것이 AI_LOG 6단계의 증거이고, 제출물 4번이 요구하는
// "AI 활용에 대한 기술적 설명" 의 중심이다. 결과만 있고 과정이 없으면
// 생성-검증-재설계 에이전트라는 주장을 확인할 방법이 없다.
// ---------------------------------------------------------------------------
export const MAX_ATTEMPTS = 24;

export function direct(brief = {}, seed = 1, opts = {}) {
  const { maxAttempts = MAX_ATTEMPTS, slack = 0.5, ...judge } = opts;

  const rng = makeRng(seed);
  const attempts = [];

  let candidate = design(brief, rng);
  let inkMax = 0;
  let fallback = null;

  const record = (a) => { attempts.push({ n: attempts.length + 1, ...a }); };

  while (attempts.length < maxAttempts) {
    if (!candidate) {
      record({
        code: 'NO_LAYOUT',
        reason: '부지 안에 자리를 못 잡았다.',
        next: '다시 뽑는다.',
      });
      candidate = design(brief, rng);
      inkMax = 0;
      continue;
    }

    const v = verify(candidate, inkMax, judge);

    record({
      code: v.code,
      reason: v.reason,
      inkMax,
      illusionCost: v.illusionCost,
      honestCost: v.honestCost,
      next: v.fix ? v.fix.note : null,
    });

    // 풀리기만 하면 최소한 낼 수는 있다. 끝까지 못 낼 때를 대비해 잡아 둔다.
    if (v.illusionCost !== null) fallback = { candidate, inkMax: v.illusionCost };

    if (v.ok) {
      const window = budgetWindow(v);
      const chosen = pickBudget(window, slack);

      // 창 안의 값은 반드시 통과한다. 그래도 확인하고 넘어간다 — 창 계산이
      // 틀리면 "통과했다고 하고 못 푸는 층" 이 나가는데, 그 증상은 플레이어가
      // 한참 그어 본 뒤에야 드러난다.
      const again = verify(candidate, chosen, judge);

      record({
        code: again.code,
        reason: again.reason,
        inkMax: chosen,
        illusionCost: again.illusionCost,
        honestCost: again.honestCost,
        next: `창 ${window.min}~${window.max} 에서 ${chosen} 을 골랐다.`,
      });

      const budget = again.ok ? chosen : window.min;

      return {
        ok: true,
        seed,
        candidate,
        window,
        inkMax: budget,
        spec: toStageSpec(candidate, budget),
        attempts,
        reason: v.reason,
      };
    }

    if (v.fix.action === 'budget') {
      inkMax = v.fix.inkMax;
      continue;
    }

    candidate = design(brief, rng);
    inkMax = 0;
  }

  // 상한까지 못 냈다. 조용히 실패하면 게임이 멈추므로 이유를 남기고,
  // 적어도 풀리는 것이 있으면 그것을 낸다.
  if (fallback) {
    return {
      ok: false,
      seed,
      candidate: fallback.candidate,
      window: { min: fallback.inkMax, max: fallback.inkMax },
      inkMax: fallback.inkMax,
      spec: toStageSpec(fallback.candidate, fallback.inkMax),
      attempts,
      reason: `${maxAttempts}번 안에 조건을 다 만족하는 층을 못 냈다. ` +
              '풀리기는 하는 마지막 층을 낸다.',
    };
  }

  return {
    ok: false,
    seed,
    candidate: null,
    window: null,
    inkMax: null,
    spec: null,
    attempts,
    reason: `${maxAttempts}번 안에 풀리는 층조차 못 냈다.`,
  };
}

// 플레이어를 읽고 그 사람이 피하는 것을 낸다.
//
// 6단계의 한 문장이 이 함수다. 지금까지는 무엇을 요구하는 층인지 부르는 쪽이
// 적어 냈지만, 여기서부터는 플레이어가 정한다.
export function directFor(stats, context = {}, seed = 1, opts = {}) {
  const { zMax, ...rest } = opts;

  const profile = profileOf(stats, context);
  const read = briefFor(profile, { zMax });
  const result = direct(read.brief, seed, { ...rest, slack: read.slack });

  return {
    ...result,
    profile,
    intent: read.brief.intent,
    slack: read.slack,
    read: read.note,
  };
}

// 판단 기록을 사람이 읽는 줄로 편다.
//
// 게임 화면에는 아무것도 띄우지 않는다. 플레이어가 자기가 읽히고 있다는 것을
// 알면 행동이 바뀌고, 그러면 읽은 성향이 성향이 아니게 된다.
export function formatLog(result) {
  const lines = [
    `디렉터 — 시드 ${result.seed}, ${result.attempts.length}번 시도, ` +
    (result.ok ? '냈다' : '못 냈다'),
  ];

  if (result.read) lines.push(`  읽음: ${result.read}`);

  for (const a of result.attempts) {
    const costs = a.illusionCost === undefined ? ''
      : `  (착시 ${a.illusionCost ?? '—'} / 그리기 ${a.honestCost ?? '—'}` +
        `, 배급 ${a.inkMax})`;

    lines.push(`  ${a.n}. [${a.code}] ${a.reason}${costs}`);
    if (a.next) lines.push(`       → ${a.next}`);
  }

  if (result.spec) {
    lines.push(`  낸 층: 배급 ${result.inkMax}, 상한 ${result.spec.zMax}, ` +
               `시작 (${result.spec.start.x},${result.spec.start.y}) → ` +
               `목표 (${result.spec.goal.x},${result.spec.goal.y})`);
    lines.push(`       ${result.candidate.note}`);
  }

  if (!result.ok) lines.push(`  ${result.reason}`);

  return lines;
}
