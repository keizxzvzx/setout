// 렌더 — 청사진 바닥과 그 위에 놓인 철판
//
// 원칙: 아직 그리지 않은 것 = 선, 그린 것 = 면.
// 그래서 바닥은 끝까지 선으로만 남고, 채워지는 것은 판뿐이다.

import { GRID_W, GRID_H, PLATE_T, INK_MAX, VIEW_MARGIN, COLOR } from './config.js';
import { worldToScreen, tileDiamond, depthKey, view } from './iso.js';
import { board, parseKey, inkAvailable } from './board.js';

export function clear(ctx, w, h) {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, w, h);
}

// 격자선을 마름모 격자로 긋는다.
// x 고정선 GRID_H 방향, y 고정선 GRID_W 방향 — 두 다발이 교차하며 마름모를 만든다.
export function drawFloor(ctx) {
  ctx.save();
  ctx.lineWidth = 1;

  ctx.strokeStyle = COLOR.gridLine;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (let x = 0; x <= GRID_W; x++) {
    const a = worldToScreen(x, 0);
    const b = worldToScreen(x, GRID_H);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let y = 0; y <= GRID_H; y++) {
    const a = worldToScreen(0, y);
    const b = worldToScreen(GRID_W, y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // 부지 외곽. 여기까지가 그릴 수 있는 땅이라는 유일한 안내.
  ctx.strokeStyle = COLOR.gridEdge;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  const corners = [
    worldToScreen(0, 0),
    worldToScreen(GRID_W, 0),
    worldToScreen(GRID_W, GRID_H),
    worldToScreen(0, GRID_H),
  ];
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

function polygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// 칸 하나를 두께 있는 철판으로 그린다.
//
// 두께는 바닥 평면에서 위로 세운다. 아래로 뻗으면 등각 화면에서 아래쪽이
// 카메라에 가까운 방향이므로 앞칸의 바닥을 덮어 격자선을 넘어간다.
// 바닥에 놓인 철판은 바닥 위에 얹혀야지 파묻히면 안 된다.
//
// 그래서 격자와 정확히 맞는 것은 판의 아랫면이고, 윗면(걷는 면)은
// 두께만큼 올라가 있다. 모든 판이 똑같이 올라가므로 판끼리의 상대 정렬은
// 그대로이고 착시에는 영향이 없다.
//
// 마름모 꼭짓점은 위 → 오른쪽 → 아래 → 왼쪽 순.
// 화면에서 보이는 옆면은 아래쪽 두 변뿐이라 두 장만 그린다.
// 뒤쪽 면은 어차피 자기 윗면에 가려진다.
function drawPlateCell(ctx, x, y, z) {
  const t = PLATE_T * view.scale;
  const base = tileDiamond(x, y, z);
  const top = base.map((p) => ({ x: p.x, y: p.y - t }));

  ctx.fillStyle = COLOR.plateRight;
  polygon(ctx, [top[1], top[2], base[2], base[1]]);
  ctx.fill();

  ctx.fillStyle = COLOR.plateLeft;
  polygon(ctx, [top[2], top[3], base[3], base[2]]);
  ctx.fill();

  ctx.fillStyle = COLOR.plateTop;
  polygon(ctx, top);
  ctx.fill();
}

export function drawPlates(ctx) {
  // 깊이가 소멸하는 투영이라 서로 다른 칸이 같은 픽셀을 점유한다.
  // 무엇이 위에 보이는가는 이 정렬 하나로 정해진다.
  // 나중에 착시 이동에서 "겹친 후보 중 실제로 보이는 것"을 고를 때도
  // 같은 키를 쓴다.
  const cells = [];
  for (const p of board.plates) {
    for (const c of p.cells) cells.push({ x: c.x, y: c.y, z: p.z });
  }
  cells.sort((a, b) => depthKey(a.x, a.y, a.z) - depthKey(b.x, b.y, b.z));

  ctx.save();
  for (const c of cells) drawPlateCell(ctx, c.x, c.y, c.z);
  ctx.restore();
}

// 긋는 중인 획. 아직 철판이 아니라 바닥에 얹힌 잉크다.
// 손을 떼는 순간 이 앰버가 철판으로 굳는다.
export function drawStroke(ctx) {
  if (!board.stroke.size) return;

  ctx.save();
  ctx.fillStyle = COLOR.amber;
  ctx.globalAlpha = 0.55;
  for (const k of board.stroke) {
    const c = parseKey(k);
    polygon(ctx, tileDiamond(c.x, c.y));
    ctx.fill();
  }
  ctx.restore();
}

// 잉크 게이지.
//
// 두 단계로 그린다. 옅은 앰버가 확정된 잉크, 진한 앰버가 지금 실제로 쓸 수
// 있는 양이다. 획을 긋는 동안 그 차이만큼이 "이번 획이 먹을 몫"으로 보인다.
// 손을 떼면 옅은 부분이 사라지며 확정된다.
//
// 숫자를 쓰지 않는다. 대사도 문구도 없는 게임이므로 남은 양은 길이로만 읽힌다.
//
// 좌측 하단. 판은 화면 중앙에 놓이므로 모서리로 밀어 두어야 시선을 뺏지 않고,
// 여백도 판을 담고 남은 자리라 겹칠 일이 없다.
export function drawInkGauge(ctx, viewW, viewH) {
  const w = Math.min(320, viewW * 0.4);
  const h = 6;
  const x = VIEW_MARGIN;
  const y = viewH - VIEW_MARGIN - h;

  const committed = Math.max(0, board.ink) / INK_MAX;
  const available = Math.max(0, inkAvailable()) / INK_MAX;

  ctx.save();

  ctx.strokeStyle = COLOR.gridEdge;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

  ctx.fillStyle = COLOR.amber;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(x, y, w * committed, h);

  ctx.globalAlpha = 1;
  ctx.fillRect(x, y, w * available, h);

  ctx.restore();
}

// 커서가 가리키는 칸. 스타일러스 끝이 닿은 자리라는 뜻으로 앰버.
//
// 이 하이라이트는 연출이기 이전에 좌표계 검증 도구다.
// 커서가 마름모 경계를 넘는 순간 하이라이트도 같이 넘어가지 않으면
// 투영과 역투영이 어긋난 것이고, 그 상태로 그리기를 얹으면
// 그은 곳과 칠해지는 곳이 다른 게임이 된다.
export function drawHoverCell(ctx, cell) {
  if (!cell) return;

  ctx.save();
  polygon(ctx, tileDiamond(cell.x, cell.y));

  ctx.fillStyle = COLOR.amber;
  ctx.globalAlpha = 0.16;
  ctx.fill();

  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = COLOR.amber;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
