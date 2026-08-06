// 캐릭터 — 이어져 보이는 길을 건너는 주체
//
// 착시는 "이어져 보이면 건널 수 있다"는 규칙이다. 건널 주체가 없으면
// 착시가 성립하는지 확인할 방법 자체가 없다.
//
// 상태는 board.actor 에 두고 여기서는 그것을 움직인다.
// board.stroke 를 input.js 가 몰고 다니는 것과 같은 모양이다.

import { MOVE_TIME } from './config.js';
import { board, key, plateAt, cellList } from './board.js';
import { findPath, isIllusion } from './path.js';
import { worldToScreen, depthKey } from './iso.js';

// 캐릭터가 서 있는 칸. 높이는 그 자리의 판에서 끌어온다.
// 밟고 선 판을 휠로 올리면 캐릭터도 같이 올라간다 — 따로 갱신할 것이 없다.
export function actorCell() {
  const a = board.actor;
  if (!a) return null;

  const p = plateAt(a.x, a.y);
  if (!p) return null;

  return { x: a.x, y: a.y, z: p.z };
}

export function placeActor(x, y) {
  board.actor = { x, y, path: null, leg: 0, t: 0 };
  board.stepped.add(key(x, y));
}

// 목적지로 걸어간다. 길이 없으면 아무 일도 없다.
//
// 이동 중에는 새 명령을 받지 않는다. 받아들이면 지금 건너는 중인 간선을
// 어떻게 끊을지, 밟은 칸 기록을 어디까지 남길지가 전부 경우의 수가 된다.
// 한 칸이 0.16초라 기다림이 길지 않다.
export function walkTo(x, y) {
  const from = actorCell();
  if (!from || board.actor.path) return false;

  const cells = cellList();
  const to = cells.find((c) => c.x === x && c.y === y);
  if (!to) return false;

  const path = findPath(cells, from, to);
  if (!path || path.length < 2) return false;

  board.actor.path = path;
  board.actor.leg = 0;
  board.actor.t = 0;
  return true;
}

// 가감속. 시작에서 붙고 끝에서 풀린다.
// 제도 도구를 미끄러뜨리는 느낌이라 경로 전체에 한 번 건다.
// 칸마다 걸면 한 칸씩 끊어 찍는 걸음이 되어 활주가 아니게 된다.
const ease = (u) => u * u * (3 - 2 * u);

export function updateActor(dt) {
  const a = board.actor;
  if (!a || !a.path) return;

  const legs = a.path.length - 1;
  a.t += dt / (MOVE_TIME * legs);

  if (a.t >= 1) {
    // 도착. 지나온 칸을 전부 밟은 것으로 기록한다.
    const end = a.path[legs];
    for (const c of a.path) board.stepped.add(key(c.x, c.y));

    // 건넌 간선을 성향 지표로 센다. 6단계 디렉터가 읽는다.
    // 게임 안에는 아무 표시도 하지 않는다 — 플레이어는 자기가 착시를 썼는지
    // 알 필요가 없고, 알려 주는 순간 그냥 이어져 보이기만 하는 것이 아니게 된다.
    for (let i = 1; i < a.path.length; i++) {
      if (isIllusion(a.path[i - 1], a.path[i])) board.stats.illusionSteps++;
      else board.stats.realSteps++;
    }

    a.x = end.x;
    a.y = end.y;
    a.path = null;
    a.t = 0;

    if (board.goal && a.x === board.goal.x && a.y === board.goal.y) {
      board.cleared = true;
    }
    return;
  }

  // 이동 중에도 현재 칸을 갱신해 둔다. 발밑 판을 지우지 못하게 막는 검사와
  // 지금 어느 칸에 속해 있는지가 어긋나면 안 된다.
  const u = ease(a.t) * legs;
  a.leg = Math.min(legs - 1, Math.floor(u));
  const here = a.path[a.leg];
  a.x = here.x;
  a.y = here.y;
}

// 화면상 위치. 발이 닿는 지점(판 윗면의 중심)을 돌려준다.
//
// 보간을 반드시 화면 좌표에서 한다. 착시 길은 화면에서 한 칸 옆이지만
// 3D 에서는 최대 Z_MAX 칸 떨어져 있어서, 격자 좌표로 보간하면 캐릭터가
// 판을 벗어나 허공을 가로질러 날아간다.
// 이어져 보이니까 건너간 것이므로 이동도 이어져 보이는 그대로여야 한다.
export function actorScreenPos() {
  const a = board.actor;
  if (!a) return null;

  if (!a.path) {
    const c = actorCell();
    return c ? worldToScreen(c.x + 0.5, c.y + 0.5, c.z) : null;
  }

  const legs = a.path.length - 1;
  const u = ease(a.t) * legs;
  const i = Math.min(legs - 1, Math.floor(u));
  const f = u - i;

  const p = a.path[i];
  const q = a.path[i + 1];
  const sp = worldToScreen(p.x + 0.5, p.y + 0.5, p.z);
  const sq = worldToScreen(q.x + 0.5, q.y + 0.5, q.z);

  return {
    x: sp.x + (sq.x - sp.x) * f,
    y: sp.y + (sq.y - sp.y) * f,
  };
}

// 깊이 정렬에 끼워 넣을 칸.
//
// 이동 중에는 건너는 두 칸 중 **정렬에서 나중에 오는** 쪽을 쓴다.
//
// 떠나는 칸에 얹으면 도착할 칸이 캐릭터보다 나중에 그려지고, 그 윗면이
// 캐릭터를 덮는다. 카메라 쪽(화면 아래)으로 걷는 절반의 걸음마다 일어나는데,
// 진짜 길에서는 두 칸의 depthKey 차이가 1 이라 발치가 조금 잘리는 정도로
// 넘어갔다. 착시 간선에서는 z 가 한꺼번에 벌어져 그 차이가 3z 만큼 커지고,
// 그때는 캐릭터가 머리만 남기고 판 속으로 들어간다.
//
// 앞의 칸에 얹으면 그 걸음 동안 두 칸 다 캐릭터를 못 덮는다. 건너는 동안
// 발은 두 칸의 이음매 위에 있으므로 어느 쪽을 골라도 자리는 맞다.
//
// 대가는 있다. 두 칸의 정렬 키 사이에 들어오는 제3의 판은 그 걸음 동안
// 캐릭터를 못 가린다. 착시 간선에서는 그 구간이 3z 만큼 넓다. 다만 그쪽은
// 판 두께 7px 이 겹치는 정도이고, 이쪽은 캐릭터가 통째로 사라지는 것이라
// 바꿀 만하다 — 자기 말이 어디 있는지 못 보면 게임이 성립하지 않는다.
export function actorDepthCell() {
  const a = board.actor;
  if (!a) return null;
  if (!a.path) return actorCell();

  const last = a.path.length - 1;
  const i = Math.min(last, a.leg);
  const p = a.path[i];
  const q = a.path[Math.min(last, i + 1)];

  return depthKey(q.x, q.y, q.z) >= depthKey(p.x, p.y, p.z) ? q : p;
}
