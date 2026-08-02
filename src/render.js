// 렌더 — 청사진 바닥
//
// 원칙: 아직 그리지 않은 것 = 선, 그린 것 = 면.
// 그래서 바닥은 끝까지 선으로만 남고, 채워지는 것은 판뿐이다.

import { GRID_W, GRID_H, COLOR } from './config.js';
import { worldToScreen, tileDiamond } from './iso.js';

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

// 커서가 가리키는 칸. 스타일러스 끝이 닿은 자리라는 뜻으로 앰버.
//
// 이 하이라이트는 연출이기 이전에 좌표계 검증 도구다.
// 커서가 마름모 경계를 넘는 순간 하이라이트도 같이 넘어가지 않으면
// 투영과 역투영이 어긋난 것이고, 그 상태로 그리기를 얹으면
// 그은 곳과 칠해지는 곳이 다른 게임이 된다.
export function drawHoverCell(ctx, cell) {
  if (!cell) return;

  const d = tileDiamond(cell.x, cell.y);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d[0].x, d[0].y);
  for (let i = 1; i < d.length; i++) ctx.lineTo(d[i].x, d[i].y);
  ctx.closePath();

  ctx.fillStyle = COLOR.amber;
  ctx.globalAlpha = 0.16;
  ctx.fill();

  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = COLOR.amber;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
