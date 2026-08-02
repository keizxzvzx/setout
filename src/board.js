// 판 — 그은 획이 철판이 되는 곳
//
// 상태를 두 겹으로 나눈다.
//   stroke : 지금 긋고 있는 임시 획. 마우스를 누르고 있는 동안만 존재.
//   plates : 손을 뗀 순간 확정된 판들.
//
// 이 분리가 있어야 획 도중 취소가 판을 건드리지 않고,
// 나중에 잉크 게이지도 "쓴 잉크 + 긋는 중인 획"으로 미리보기가 나온다.

import { GRID_W, GRID_H, INK_COST, INK_REFUND, INK_MAX } from './config.js';

export const key = (x, y) => x + ',' + y;

export function parseKey(k) {
  const i = k.indexOf(',');
  return { x: +k.slice(0, i), y: +k.slice(i + 1) };
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

export const board = {
  plates: [],
  stroke: new Set(),      // 긋는 중인 칸들
  occupied: new Set(),    // 바닥(z=0)이 이미 판에 덮인 칸들
  ink: INK_MAX,           // 확정된 잉크. 긋는 중인 획은 아직 여기서 빠지지 않는다
};

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
  if (board.occupied.has(k)) return;   // 이미 판이 깔린 자리
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

  for (const group of components(board.stroke)) {
    const plate = { cells: group, z: 0 };
    board.plates.push(plate);
    made.push(plate);
    for (const c of group) board.occupied.add(key(c.x, c.y));
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

function erase(x, y) {
  const k = key(x, y);
  if (!board.occupied.has(k)) return;
  board.occupied.delete(k);

  // 절반만 돌아온다. 지우기는 즉시 반영이므로 환급도 여기서 바로 한다.
  // 배급량을 넘길 수는 없다 — 나중에 디렉터가 미리 깔아 둔 고정 구조물을
  // 지워 잉크를 벌어들이는 일을 막는다.
  board.ink = Math.min(INK_MAX, board.ink + INK_REFUND);

  for (const p of board.plates) {
    const i = p.cells.findIndex((c) => c.x === x && c.y === y);
    if (i >= 0) {
      p.cells.splice(i, 1);
      return;
    }
  }
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
