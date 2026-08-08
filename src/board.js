// 판 — 그은 획이 철판이 되는 곳
//
// 상태를 두 겹으로 나눈다.
//   stroke : 지금 긋고 있는 임시 획. 마우스를 누르고 있는 동안만 존재.
//   plates : 손을 뗀 순간 확정된 판들.
//
// 이 분리가 있어야 획 도중 취소가 판을 건드리지 않고,
// 나중에 잉크 게이지도 "쓴 잉크 + 긋는 중인 획"으로 미리보기가 나온다.

import { GRID_W, GRID_H, INK_COST, INK_REFUND_STEPPED, Z_MIN } from './config.js';
import { stage } from './stage.js';

export const key = (x, y) => x + ',' + y;

export function parseKey(k) {
  const i = k.indexOf(',');
  return { x: +k.slice(0, i), y: +k.slice(i + 1) };
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

// occupied 는 "그 (x,y) 기둥이 어느 판에 잡혀 있다"는 뜻이다.
// 판을 위로 올려도 그 자리는 계속 잡혀 있다 — 뜬 판 아래로 다른 판을
// 통과시키는 2층 구조는 만들 수 없다.
//
// 비워 주는 쪽이 표현력은 넓지만, 한 (x,y) 에 여러 판이 겹칠 수 있게 되어
// (x,y) → 판 조회가 1:1 이 아니게 된다. 지우기·잉크 회계·연결 성분 분해가
// 전부 그 조회 위에 서 있으므로 셋 다 다시 짜야 한다.
// 착시는 화면상 정렬로 성립하지 층 쌓기로 성립하지 않으므로 얻는 것도 없다.
//
// actor 는 격자 칸만 들고 z 는 갖지 않는다. 서 있는 칸의 판에서 끌어오면
// 캐릭터를 태운 채 판을 올려도 둘이 어긋나지 않는다. 따로 저장하면 휠로
// 판을 올리는 순간 캐릭터만 공중에 남는다. 판을 태워 올리는 것은 먼 판과
// 높이를 맞추는 조작이므로 막을 이유도 없다.
//
// stepped 는 캐릭터가 지나간 칸이다. 환급을 갈라야 해서 따로 센다.
export const board = {
  plates: [],
  stroke: new Set(),      // 긋는 중인 칸들
  occupied: new Set(),    // 판에 잡힌 (x,y) 기둥들
  ink: stage.inkMax,      // 확정된 잉크. 긋는 중인 획은 아직 여기서 빠지지 않는다
  actor: null,            // { x, y, path, leg, t } — 높이는 밟고 선 판에서 온다
  stepped: new Set(),     // 캐릭터가 지나간 칸. 환급받지 못한다
  goal: null,             // { x, y } 빈 바닥 칸
  cleared: false,
  erased: new Set(),      // 지운 적 있는 칸. 다시 그리면 지표로 센다

  // 6단계 AI 디렉터가 읽을 플레이어 지표.
  //
  // 디렉터는 레벨을 만드는 것이 아니라 플레이어를 읽고 그 사람이 피하는 것을
  // 만든다. 그러려면 성향이 숫자로 남아 있어야 한다.
  //   늘 다리로 밀어붙이는 사람 → inkSpent 가 높고 illusionSteps 가 0에 가깝다
  //   착시만 노리는 사람        → 그 반대
  //   망설이는 사람             → redraws 가 높다
  stats: {
    inkSpent: 0,        // 지금까지 쓴 잉크 총량 (환급과 무관한 누적)
    redraws: 0,         // 지웠다 다시 그린 칸 수
    illusionSteps: 0,   // 착시 간선을 건넌 횟수
    realSteps: 0,       // 진짜 길을 건넌 횟수
  },
};

// 캐릭터가 서 있는 칸이 화면에 실제로 보이는가.
//
// 판을 올리다 보면 다른 판이 캐릭터를 정확히 덮을 수 있다. 대각선 위에 있는
// 판을 그 거리만큼 올리면 화면 자리가 정확히 포개지기 때문이다.
// 덮이면 캐릭터가 화면에서 사라지고, 자기 말이 어디 있는지 볼 수 없으면
// 게임이 성립하지 않는다.
export function actorVisible() {
  const a = board.actor;
  if (!a) return true;

  const p = plateAt(a.x, a.y);
  if (!p) return true;

  const hit = pickAt(a.x - p.z, a.y - p.z);
  return !!hit && hit.x === a.x && hit.y === a.y;
}

// 그 칸을 품고 있는 판. 없으면 null.
// 잉크 상한이 60칸이라 판 전체를 훑어도 60칸을 넘지 않는다.
export function plateAt(x, y) {
  for (const p of board.plates) {
    for (const c of p.cells) {
      if (c.x === x && c.y === y) return p;
    }
  }
  return null;
}

// 바닥칸 (gx, gy) 자리에 실제로 보이는 판 칸을 고른다.
//
// (x, y, z) 는 바닥의 (x−z, y−z) 자리에 나타나므로, 이 자리에 올 수 있는
// 판 칸은 (gx+z, gy+z, z) 뿐이다. z 에 상한이 있으니 후보를 전부 세어 볼 수 있다.
//
// 위에서부터 훑어 처음 걸리는 것이 답이다. 후보들의 정렬 키를 펴 보면
//   depthKey = x + y + z = (gx+z) + (gy+z) + z = gx + gy + 3z
// 로 z 에 대해 단조증가하므로, z 가 큰 후보가 언제나 위에 그려진다.
// 렌더가 쓰는 정렬과 같은 식이라 둘이 어긋날 수 없다.
//
// 휠·지우기·하이라이트가 전부 이 함수를 쓰고, 5단계의
// "겹친 후보 중 실제로 보이는 것" 도 같은 함수다.
// zTop 까지 훑는다. 플레이어 상한(zMax)이 아니다 — 정직 층은 상한이 0 인데
// 그 위에 뜬 구조물이 있고, 상한까지만 훑으면 그 판은 화면에 보이는데 집을
// 수도 지울 수도 없는 것이 된다. 렌더와 솔버는 zTop 을 보므로 여기만 낮으면
// 세 경로가 보는 것이 갈린다.
export function pickAt(gx, gy) {
  for (let z = stage.zTop; z >= Z_MIN; z--) {
    const x = gx + z;
    const y = gy + z;
    if (!inBounds(x, y)) continue;

    const p = plateAt(x, y);
    if (p && p.z === z) return { plate: p, x, y, z };
  }
  return null;
}

// 층 하나를 걷어낸다.
//
// 무엇을 남기는가가 이 함수의 전부다. stats 는 남긴다 — 지우면 디렉터가 매 층
// 백지에서 읽게 되고, 그러면 플레이어를 읽는다는 말이 성립하지 않는다.
// 나머지는 전부 그 층의 것이라 지운다.
export function resetBoard() {
  board.plates = [];
  board.occupied.clear();
  board.stepped.clear();
  board.erased.clear();
  board.actor = null;
  board.goal = null;
  board.cleared = false;
  board.ink = stage.inkMax;

  cancelStroke();   // 긋던 획과 lastCell 까지 같이 턴다
}

// 미리 깔아 두는 판. 잉크를 쓰지 않는다.
//
// 시작 발판과, 디렉터가 놓는 고정 구조물이 이것으로 들어온다.
// 획을 그어 만든 판과 자료 구조가 같으므로 높이 조절은 그대로 먹는다.
//
// fixed 는 "플레이어가 잉크를 낸 적이 없는 판" 이라는 표시다. 지우기가
// 이것을 보고 물러난다(erase 참조). 높이 조절은 막지 않는다 — 올려 둔 판을
// 플레이어가 다시 맞춰 더 싸게 푸는 것은 영리한 것이므로 막을 이유가 없다는
// 결정이 6단계 계획에 있다.
export function addPlate(cells, z = 0, { fixed = false } = {}) {
  const plate = { cells: cells.map((c) => ({ x: c.x, y: c.y })), z, fixed };
  board.plates.push(plate);
  for (const c of plate.cells) board.occupied.add(key(c.x, c.y));
  return plate;
}

// 지금 놓인 판 칸 전부를 { x, y, z } 목록으로 펴낸다.
//
// 이동 그래프와 길찾기는 이 스냅샷만 받는다. 그래야 같은 함수로 6단계
// 디렉터가 아직 놓지도 않은 가상의 배치를 물어볼 수 있다.
export function cellList() {
  const out = [];
  for (const p of board.plates) {
    // fixed 를 같이 실어 낸다. 막힘 판정이 "되받을 수 있는 잉크" 를 셀 때
    // 플레이어가 그린 칸과 미리 깔린 칸을 갈라야 한다(session.isStuck).
    for (const c of p.cells) out.push({ x: c.x, y: c.y, z: p.z, fixed: p.fixed });
  }
  return out;
}

// 판 한 장을 통째로 올리고 내린다. 잉크를 쓰지 않는다.
//
// 캐릭터를 덮게 되는 이동은 되돌린다. 막지 않으면 판 하나를 올리는 것만으로
// 캐릭터가 화면에서 사라지고, 그 상태를 알려 줄 문구가 이 게임에는 없다.
// 자기 말이 안 보이면 무엇을 눌러야 할지도 알 수 없다.
// 천장은 그 판이 무엇인가에 따라 갈린다.
//
//   미리 깔린 판   stage.zTop   그 층에 놓인 가장 높은 것까지
//   내가 그은 판   stage.zMax   플레이어 상한까지
//
// 갈라야 하는 이유는 정직 층이다. 상한이 0 인데 디렉터가 뜬 구조물을 하나
// 얹으므로, 천장을 상한 하나로 잡으면 그 판에 휠을 굴리는 순간 바닥까지
// 내리꽂힌다 — 올리려고 굴렸는데 떨어지는 것은 설명할 방법이 없다.
//
// **지금** 높이를 천장으로 삼는 것도 안 된다. 천장이 판을 따라 내려가 한 칸
// 내린 순간 다시 못 올라가고, 바닥까지 내리면 영영 거기 있는다. 내려놓고 보니
// 아니어서 되돌리는 것이 휠을 굴리는 이유의 절반인데 그 절반이 조용히 막힌다.
// 문구가 없는 게임에서 이것은 규칙이 아니라 고장으로 읽힌다 — 시트 5에서
// 그렇게 보고가 왔다.
//
// fixed 와 zTop 은 둘 다 이미 있는 것이고 뜻도 정확히 이것이다. 판에 "놓였던
// 높이" 를 따로 기억시키는 방법도 되지만, 그러면 같은 사실이 두 군데 적히고
// 판을 만드는 자리가 둘이라 한쪽이 빠지면 천장이 조용히 어긋난다.
export function movePlate(plate, dz) {
  const ceiling = plate.fixed ? stage.zTop : stage.zMax;
  const next = Math.min(ceiling, Math.max(Z_MIN, plate.z + dz));
  if (next === plate.z) return false;

  const before = plate.z;
  plate.z = next;

  if (!actorVisible()) {
    plate.z = before;
    return false;
  }
  return true;
}

// 지금 실제로 쓸 수 있는 잉크.
//
// 긋는 중인 획은 board.ink 를 건드리지 않고 여기서만 빠진다.
// 덕분에 Esc 취소가 되돌릴 것이 없고(깎은 적이 없으므로),
// 게이지는 확정 잉크와 이번 획이 먹을 몫을 따로 그릴 수 있다.
export function inkAvailable() {
  return board.ink - board.stroke.size * INK_COST;
}

// 획을 잇는 기준. 대각을 포함한다.
//
// 주의: 이것은 "한 장의 철판인가"를 정하는 기준이지
// "그 위를 걸을 수 있는가"가 아니다. 이동은 화면상 인접으로 판정하므로
// 사방 인접만 길이 된다. 대각선 판은 한 장으로 집어 옮길 수 있지만
// 그 위를 대각으로 건널 수는 없다 — 일부러 다르게 둔 규칙이다.
const NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

let lastCell = null;

export function beginStroke(cell) {
  board.stroke.clear();
  lastCell = null;
  extendStroke(cell);
}

// 커서가 부지 밖이면 cell 이 null 로 들어온다.
// 이때 획을 끝내지 않고 이어받을 지점만 놓는다.
// 손이 미끄러져 가장자리를 스쳐도 획 전체가 날아가지 않고,
// 대신 밖을 지나온 구간은 이어붙지 않아 덩어리가 갈라진다.
export function extendStroke(cell) {
  if (!cell) {
    lastCell = null;
    return;
  }

  if (lastCell) {
    // pointermove 는 프레임 단위로 오므로 빠르게 그으면 칸이 통째로
    // 건너뛴다. 사이를 격자 직선으로 메우지 않으면 구멍 뚫린 획이 되고
    // 잉크 계산과 길 연결이 전부 어긋난다.
    for (const c of lineCells(lastCell, cell)) paint(c.x, c.y);
  } else {
    paint(cell.x, cell.y);
  }

  lastCell = cell;
}

function paint(x, y) {
  if (!inBounds(x, y)) return;

  const k = key(x, y);

  // 두 가지 이유로 그릴 수 없다. 둘은 판이 뜨는 순간 서로 다른 칸을 가리킨다.
  //
  // 하나, 그 기둥을 이미 판이 잡고 있다. 판을 올려도 기둥은 놓지 않으므로
  // (x, y, z) 인 판은 z 와 무관하게 (x, y) 를 계속 막는다. 이 검사가 있어야
  // 한 기둥에 판이 둘 생기는 일이 없고, (x,y) → 판 조회가 유일하게 유지된다.
  // 이것을 pickAt 으로 대신하면 판을 올린 순간 원래 기둥이 풀려, 같은 자리에
  // 두 번째 판을 그릴 수 있게 되고 지우기가 어느 쪽을 가리키는지 알 수 없어진다.
  //
  // 둘, 눈에 보이는 판이 그 자리를 덮고 있다. 뜬 판은 (x−z, y−z) 자리를
  // 가리므로 그 밑에 그으면 잉크만 먹고 아무것도 보이지 않는다.
  // 보이는 바닥에만 그린다 — 튜토리얼 없이 이해되는 유일한 규칙이다.
  if (board.occupied.has(k)) return;
  if (pickAt(x, y)) return;
  if (board.stroke.has(k)) return;     // 이번 획에 이미 포함된 칸은 공짜

  // 잉크가 다하면 그 지점에서 획이 멈춘다. 획 전체를 거부하면 왜 안 되는지
  // 보이지 않아 답답하지만, 긋다가 선이 안 나오는 것은 펜에서 잉크가
  // 떨어지는 현상 그대로라 설명 없이 이해된다.
  if (inkAvailable() < INK_COST) return;

  board.stroke.add(k);
}

export function cancelStroke() {
  board.stroke.clear();
  lastCell = null;
}

// 손을 뗀 순간. 획을 연결 덩어리별로 쪼개 각각 판 하나로 확정한다.
//
// 덩어리를 나누지 않으면 멀리 떨어진 조각이 한 판으로 묶여,
// 판 하나를 집어 올렸을 때 화면 반대편 조각이 같이 떠오른다.
export function commitStroke() {
  const made = [];

  // 잉크는 여기서 처음 깎인다. 긋는 동안에는 inkAvailable() 로만 빠져 있었다.
  board.ink -= board.stroke.size * INK_COST;
  board.stats.inkSpent += board.stroke.size * INK_COST;

  for (const group of components(board.stroke)) {
    const plate = { cells: group, z: 0 };
    board.plates.push(plate);
    made.push(plate);

    for (const c of group) {
      const k = key(c.x, c.y);
      board.occupied.add(k);
      // 지웠던 자리에 다시 그렸다. 망설임의 지표라 디렉터가 읽는다.
      if (board.erased.delete(k)) board.stats.redraws++;
    }
  }

  board.stroke.clear();
  lastCell = null;
  return made;
}

// --- 지우기 ---------------------------------------------------------------
//
// 그리기와 달리 즉시 반영한다. 획은 전체가 모여야 판 하나가 되지만
// 지우기는 칸 하나하나가 독립적이라 확정을 미룰 이유가 없고,
// 지우개는 문지르는 즉시 지워져야 지우개답다.
//
// 다만 덩어리 재분해는 손을 뗄 때 한 번만 한다. 지우기는 칸을 빼기만
// 하므로 한 번 갈라진 판이 도로 붙는 일이 없다.

export function beginErase(cell) {
  lastCell = null;
  extendErase(cell);
}

export function extendErase(cell) {
  if (!cell) {
    lastCell = null;
    return;
  }

  if (lastCell) {
    for (const c of lineCells(lastCell, cell)) erase(c.x, c.y);
  } else {
    erase(cell.x, cell.y);
  }

  lastCell = cell;
}

// 인자는 커서가 훑은 바닥칸이지 지울 칸이 아니다.
// 판이 뜨면 둘이 (x−z, y−z) 만큼 어긋나므로 pickAt 으로 옮겨 잡는다.
// 보간도 바닥칸 위에서 한다. 뜬 판과 눕힌 판을 오갈 때 잡히는 칸은 격자상
// 멀리 뛰지만 커서가 실제로 지나간 화면 경로는 이어져 있기 때문이다.
function erase(gx, gy) {
  const hit = pickAt(gx, gy);
  if (!hit) return;

  // 밟고 선 칸은 지울 수 없다. 발밑을 빼면 캐릭터가 허공에 남고, 떨어지는
  // 처리를 새로 만들어야 한다. 서 있는 자리를 못 지우는 것은 설명이 필요 없다.
  const a = board.actor;
  if (a && a.x === hit.x && a.y === hit.y) return;

  // 미리 깔린 판은 지울 수 없다. 밟고 선 칸을 못 지우는 것과 같은 종류의
  // 규칙이라 문구 없이 이해된다 — 지우개를 문질러도 안 지워진다.
  //
  // 아래의 상한만으로는 못 막는다. Math.min 은 배급을 넘지 못하게 할 뿐이라,
  // 한 번이라도 잉크를 쓰고 나면 구조물을 지우는 것이 언제나 벌이가 된다.
  // 실측하니 구조물 6칸에서 잉크 16 → 22 였다.
  //
  // 잉크만의 문제도 아니다. 솔버가 "이 층은 배급 안에서 풀린다" 를 보증한
  // 근거가 이 지형인데, 그것을 플레이어가 공짜로 걷어내면 판정이 보증한 층과
  // 실제로 푸는 층이 달라진다.
  if (hit.plate.fixed) return;

  board.occupied.delete(key(hit.x, hit.y));
  board.erased.add(key(hit.x, hit.y));

  // 절반만 돌아온다. 지우기는 즉시 반영이므로 환급도 여기서 바로 한다.
  // 배급량을 넘길 수는 없다 — 나중에 디렉터가 미리 깔아 둔 고정 구조물을
  // 지워 잉크를 벌어들이는 일을 막는다.
  //
  // 캐릭터가 지나간 칸은 한 방울도 돌려주지 않는다. 이것이 징검다리 이동을
  // 막는 유일한 방법이다 — 환급이 조금이라도 남으면 앞에 그리고 뒤를 지우는
  // 쪽이 언제나 싸다는 것이 2단계에서 계산으로 나왔다.
  const refund = board.stepped.has(key(hit.x, hit.y)) ? INK_REFUND_STEPPED : stage.refund;
  board.ink = Math.min(stage.inkMax, board.ink + refund);

  const i = hit.plate.cells.findIndex((c) => c.x === hit.x && c.y === hit.y);
  if (i >= 0) hit.plate.cells.splice(i, 1);
}

// 손을 뗀 순간. 텅 빈 판을 걷어내고, 갈라진 판을 다시 덩어리로 쪼갠다.
//
// ㄷ자 판의 가운데를 지우면 남은 것은 판 둘이다. 여기서 쪼개 두지 않으면
// 서로 떨어진 두 조각이 한 판으로 남아, 한쪽을 집어 올릴 때 다른 쪽이
// 같이 떠오른다. 획을 확정할 때 쓰는 연결 성분 분해를 그대로 재사용한다.
export function commitErase() {
  const next = [];

  for (const p of board.plates) {
    if (!p.cells.length) continue;

    const groups = components(new Set(p.cells.map((c) => key(c.x, c.y))));
    if (groups.length === 1) {
      next.push(p);
      continue;
    }
    for (const g of groups) next.push({ ...p, cells: g });
  }

  board.plates = next;
  lastCell = null;
}

// 연결 성분 분해. 칠해진 칸 집합을 서로 붙은 덩어리들로 가른다.
function components(cellKeys) {
  const left = new Set(cellKeys);
  const groups = [];

  while (left.size) {
    const seed = left.values().next().value;
    left.delete(seed);

    const group = [];
    const stack = [parseKey(seed)];

    while (stack.length) {
      const c = stack.pop();
      group.push(c);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        const k = key(nx, ny);
        if (left.has(k)) {
          left.delete(k);
          stack.push({ x: nx, y: ny });
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

// 격자 직선 (Bresenham). 두 칸 사이를 빈틈없이 잇는다.
function* lineCells(a, b) {
  let x = a.x;
  let y = a.y;

  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    yield { x, y };
    if (x === b.x && y === b.y) return;

    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
