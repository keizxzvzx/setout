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

import { GRID_W, GRID_H, Z_MAX } from './config.js';
import { screenCell, skey } from './path.js';

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
function illusionLayout(rng, gridW, gridH, zMax) {
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

  // 시작점은 반대쪽 끝 가까이 둔다. 이음매까지 몇 칸만 그으면 올라탈 수 있고,
  // 목표까지 정직하게 가려면 화면 전체를 가로질러야 하는 배치가 된다.
  const f = endOf(farEnd);
  const starts = [];

  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < 1 || d > 3) continue;

      const x = f.x + dx;
      const y = f.y + dy;
      if (!free(x, y)) continue;
      if (x === goal.x && y === goal.y) continue;
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
function honestLayout(rng, gridW, gridH) {
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
  if (!best || best.d < 10) return null;

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
    tries = 40,
  } = brief;

  for (let i = 0; i < tries; i++) {
    const c = intent === 'honest'
      ? honestLayout(rng, gridW, gridH)
      : illusionLayout(rng, gridW, gridH, zMax);

    if (!c) continue;
    if (!c.fixtures.every((f) => fixtureOk(f, c.zMax))) continue;

    // 착시 층은 이음매가 정직하게 붙지 않는 것까지 지켜야 한다.
    if (c.intent === 'illusion' && !c.fixtures.every((f) => seamOk(f, c.zMax))) continue;

    return c;
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
