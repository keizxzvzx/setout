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

// 고정 구조물이 어느 층에서나 지켜야 하는 것.
//
// z 가 그 층의 zMax 를 넘으면 안 된다. pickAt 은 zMax 까지만 훑지만 렌더와
// 솔버는 안 훑는다. 넘겨 놓으면 화면에는 보이고 솔버는 길로 세는데 플레이어는
// 집을 수 없는 판이 되어, 세 경로가 보는 것이 갈린다.
export const fixtureOk = (f, zMax) => f.z >= 0 && f.z <= zMax;

// 착시 층의 구조물이 더 지켜야 하는 것.
//
// z 는 1 이상이어야 한다. 정직한 간선은 z 가 같아야 성립하는데(isIllusion 은
// a.z !== b.z 한 줄이다) 그릴 수 있는 칸은 언제나 z=0 이므로, z ≥ 1 인
// 구조물은 그린 판과 절대 정직하게 붙지 않는다. 이것이 보장되어야
// "정직하게만 가면 얼마인가" 가 거짓말을 하지 않는다.
//
// 정직 층에는 이 규칙을 걸지 않는다. 거기서는 구조물이 이음매가 아니라
// 바닥에 눕힌 공짜 길이고, 정직하게 이어지는 것이 목적이기 때문이다.
export const seamOk = (f, zMax) => f.z >= 1 && f.z <= zMax;

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
function illusionLayout(rng, gridW, gridH, zMax, minCells) {
  if (zMax < 1) return null;

  const lift = pick(rng, 1, zMax);
  const len = pick(rng, 4, 8);
  const horizontal = rng() < 0.5;

  // 격자와 화면 양쪽에서 부지 안이어야 한다. 화면 자리가 (x−lift, y−lift) 이므로
  // 시작 좌표에 lift 만큼 여유를 두면 양쪽이 한꺼번에 만족된다.
  const cells = [];

  if (horizontal) {
    if (gridW - len < lift) return null;
    const x0 = pick(rng, lift, gridW - len);
    const y0 = pick(rng, lift, gridH - 1);
    for (let k = 0; k < len; k++) cells.push({ x: x0 + k, y: y0 });
  } else {
    if (gridH - len < lift) return null;
    const x0 = pick(rng, lift, gridW - 1);
    const y0 = pick(rng, lift, gridH - len);
    for (let k = 0; k < len; k++) cells.push({ x: x0, y: y0 + k });
  }

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

  return {
    intent: 'illusion',
    start,
    goal,
    zMax,
    fixtures: [strip],
    note: `판 ${len}칸을 z=${lift} 로 올려 목표 옆에 세웠다. ` +
          `3D 에서는 ${lift}칸 떨어져 있고 아무것도 닿아 있지 않다.`,
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
// 그래서 구조물은 바닥에 눕힌다. z=0 이면 그린 판과 정직하게 이어지는 공짜
// 길이 되어 벽이 아니라 지름길이 되고, 배급이 조인 층에서는 그 지름길을
// 찾아 꿰는 것이 그대로 퍼즐이 된다.
// ---------------------------------------------------------------------------
function honestLayout(rng, gridW, gridH, minCells) {
  const lid = 0;

  const bridges = [];
  const columns = new Set();
  const count = pick(rng, 3, 6);

  for (let i = 0; i < count; i++) {
    const len = pick(rng, 3, 6);
    const horizontal = rng() < 0.5;

    const x0 = pick(rng, 0, gridW - (horizontal ? len : 1));
    const y0 = pick(rng, 0, gridH - (horizontal ? 1 : len));

    const cells = [];
    for (let k = 0; k < len; k++) {
      const x = horizontal ? x0 + k : x0;
      const y = horizontal ? y0 : y0 + k;
      if (columns.has(skey(x, y))) { cells.length = 0; break; }
      cells.push({ x, y });
    }
    if (!cells.length) continue;

    for (const c of cells) columns.add(skey(c.x, c.y));
    bridges.push({ cells, z: lid });
  }

  // z=0 뿐이라 가림이 없다. 기둥만 피하면 그릴 수 있다.
  const free = (x, y) => inBounds(x, y, gridW, gridH) && !columns.has(skey(x, y));

  // 시작과 목표는 서로 멀어야 배급량이 난이도가 된다.
  const spots = [];
  for (let i = 0; i < 40; i++) {
    const x = pick(rng, 0, gridW - 1);
    const y = pick(rng, 0, gridH - 1);
    if (free(x, y)) spots.push({ x, y });
  }
  if (spots.length < 2) return null;

  let best = null;
  for (const a of spots) {
    for (const b of spots) {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (!best || d > best.d) best = { start: a, goal: b, d };
    }
  }
  // 여기 미리 깔린 다리는 z=0 이라 정직하게 밟힌다. 그만큼 그리기 값이
  // 맨해튼 거리보다 싸지므로 여유를 얹어 잡는다.
  if (!best || best.d < minCells + 6) return null;

  const laid = bridges.reduce((n, f) => n + f.cells.length, 0);

  return {
    intent: 'honest',
    start: best.start,
    goal: best.goal,
    zMax: lid,
    fixtures: bridges,
    note: `높이 상한을 0 으로 조였다. 올릴 수 있는 판이 없으니 맞출 정렬도 ` +
          `없다. 대신 바닥에 ${laid}칸을 미리 깔아 두었다.`,
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
    tries = 40,
  } = brief;

  for (let i = 0; i < tries; i++) {
    const c = intent === 'honest'
      ? honestLayout(rng, gridW, gridH, minCells)
      : illusionLayout(rng, gridW, gridH, zMax, minCells);

    if (!c) continue;
    if (!c.fixtures.every((f) => fixtureOk(f, c.zMax))) continue;

    // 이음매를 쓰는 층은 그것이 정직하게 붙지 않는 것까지 지켜야 한다.
    // 착시를 강제하는 층과 고르게 하는 층 둘 다 여기 걸린다 — 어느 쪽이든
    // "그리기만으로 가면 얼마인가" 가 정확해야 판정이 성립한다.
    if (intent !== 'honest' && !c.fixtures.every((f) => seamOk(f, c.zMax))) continue;

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
  const { minCells = MIN_CELLS } = opts;

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
    return out('TOO_SHALLOW',
      `그냥 그려도 ${floorCells}칸이면 닿는다. 층이라고 할 것이 없다.`,
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

    if (h > inkMax) {
      return out('OVER_BUDGET',
        `비싼 쪽(그리기 ${h})이 배급 ${inkMax} 밖이다. 고를 수 없으면 물어본 것이 아니다.`,
        budgetFix(h, `배급을 ${h} 로 올려 둘 다 갈 수 있게 한다.`));
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

    if (h > inkMax) {
      return out('OVER_BUDGET',
        `정직한 최소 해법이 ${h} 인데 배급이 ${inkMax} 다.`,
        budgetFix(h, `배급을 ${h} 로 올린다.`));
    }

    return out('OK', `그리기만으로 ${h} 에 풀린다. 맞출 정렬은 없다.`);
  }

  // --- 착시 의도 ---

  if (i > inkMax) {
    return out('OVER_BUDGET',
      `최소 해법이 ${i} 인데 배급이 ${inkMax} 다. 아예 못 푼다.`,
      budgetFix(i, `배급을 ${i} 로 올린다.`));
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

  if (tightest < i) {
    return out('NO_BUDGET_WINDOW',
      `착시 ${i} 와 그리기 ${h} 사이에 끼울 자리가 없다. ` +
      '어떤 배급량으로도 착시를 강제할 수 없다.',
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

export function budgetWindow(v) {
  // 고르게 하는 층은 비싼 쪽까지 닿아야 선택이 성립한다. 바닥이 딱 그리기
  // 값이면 정직한 길을 고르는 순간 여유가 0 이라, 고를 수는 있어도 고르고
  // 싶지는 않은 층이 된다. 그래서 위로만 연다.
  if (v.intent === 'open') {
    const min = v.honestCost;
    return { min, max: min + snap(min * 0.3) };
  }

  if (v.intent === 'honest') {
    // 정직 층에는 위쪽 제약이 없다. 그래도 무한정 주면 퍼즐이 아니게 되므로
    // 실험할 만큼만 얹는다.
    const min = v.honestCost;
    return { min, max: min + snap(min * 0.3) };
  }

  const min = v.illusionCost;

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
