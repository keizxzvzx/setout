// 렌더 — 청사진 바닥과 그 위에 놓인 철판
//
// 원칙: 아직 그리지 않은 것 = 선, 그린 것 = 면.
// 그래서 바닥은 끝까지 선으로만 남고, 채워지는 것은 판뿐이다.

import {
  GRID_W, GRID_H, PLATE_T, VIEW_MARGIN,
  TILE_W, TILE_H, ACTOR_R, ACTOR_H, ACTOR_W, COLOR,
} from './config.js';
import { stage } from './stage.js';
import { worldToScreen, tileDiamond, depthKey, view } from './iso.js';
import { board, parseKey, inkAvailable, cellList } from './board.js';
import { actorScreenPos, actorDepthCell } from './actor.js';

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
function drawPlateSides(ctx, x, y, z) {
  const t = PLATE_T * view.scale;
  const c = { right: COLOR.plateRight, left: COLOR.plateLeft };
  const base = tileDiamond(x, y, z);
  const top = base.map((p) => ({ x: p.x, y: p.y - t }));

  ctx.fillStyle = c.right;
  polygon(ctx, [top[1], top[2], base[2], base[1]]);
  ctx.fill();

  ctx.fillStyle = c.left;
  polygon(ctx, [top[2], top[3], base[3], base[2]]);
  ctx.fill();
}

// 걷는 면. 두께만큼 올라가 있다.
function drawPlateTop(ctx, x, y, z) {
  const t = PLATE_T * view.scale;
  ctx.fillStyle = COLOR.plateTop;
  polygon(ctx, tileDiamond(x, y, z).map((p) => ({ x: p.x, y: p.y - t })));
  ctx.fill();
}

export function drawPlates(ctx) {
  // 깊이가 소멸하는 투영이라 서로 다른 칸이 같은 픽셀을 점유한다.
  // 무엇이 위에 보이는가는 이 정렬 하나로 정해진다.
  // 착시 이동에서 "겹친 후보 중 실제로 보이는 것"을 고를 때도 같은 키를 쓴다.
  const cells = cellList();
  cells.sort((a, b) => depthKey(a.x, a.y, a.z) - depthKey(b.x, b.y, b.z));

  // 캐릭터는 서 있는 칸 바로 다음에 그린다. 따로 맨 뒤에 그리면 앞칸 판을
  // 뚫고 보이고, 맨 앞에 그리면 자기가 선 판에 가려진다.
  const actorAt = actorDepthCell();

  ctx.save();

  // 옆면을 전부 먼저, 윗면을 전부 나중에. 칸마다 한꺼번에 그리면 이음매가
  // 반쪽만 매끈해진다.
  //
  // 윗면은 바닥 마름모를 두께만큼 올려 그리므로, 화면상 **뒤쪽** 두 칸의
  // 마름모 안으로 그만큼 파고든다. 뒤칸의 옆면이 있어야 할 자리가 바로 거기다.
  // 그래서 앞칸의 윗면이 뒤칸의 옆면을 덮어 주면 두 윗면이 딱 맞물리고,
  // 못 덮으면 그 두께가 단이 되어 화면에 남는다.
  //
  // 누가 나중에 그려지는가는 정렬 키가 정한다.
  //
  //   depthKey = x + y + z = (화면 gx + gy) + 3z
  //
  // 앞칸은 gx+gy 가 1 클 뿐이라, 뒤칸이 한 칸이라도 높으면 3z 가 그 1 을
  // 덮어써 뒤칸이 나중에 그려진다. 그러면 뒤칸의 옆면이 앞칸 윗면 위로
  // 올라서서, 이어져 있는 두 판이 겹쳐 놓인 두 판으로 보인다. 화면 네 방향
  // 중 위쪽 둘에서만 일어나므로 같은 착시가 방향에 따라 달라 보였다.
  //
  // 두 벌로 나누면 윗면끼리는 서로 파고들 일이 없고(마름모는 정확히 맞물린다)
  // 옆면은 앞칸 윗면이 있으면 덮이고 없으면 판의 가장자리로 남는다.
  // "이어져 보인다면 이어진 것이다" 를 화면 쪽에서 지키는 것이 이 두 줄이다.
  for (const c of cells) drawPlateSides(ctx, c.x, c.y, c.z);

  for (const c of cells) {
    drawPlateTop(ctx, c.x, c.y, c.z);
    if (actorAt && c.x === actorAt.x && c.y === actorAt.y) drawActor(ctx);
  }

  ctx.restore();
}

// 올린 판이 원래 있던 자리.
//
// 판을 z 만큼 올리면 화면에서는 (x−z, y−z) 로 물러나지만 기둥 (x, y) 는 계속
// 잡혀 있다. 그 자리는 **비어 보이는데 그릴 수도 설 수도 없다.** 표시가 없으면
// 잉크는 남았는데 선만 안 나오고, 문구가 없는 게임에서 플레이어는 무슨 일이
// 일어났는지 알 방법이 없다.
//
// 3단계부터 있던 구멍인데 그때는 판을 올리는 것이 플레이어 자신이라
// "내가 저기서 올렸지" 로 넘어갔다. 6단계 디렉터가 이음매를 미리 올려 두면서
// 처음 드러났다 — 층당 다섯 칸꼴이었다. 그래서 누가 올렸든 똑같이 그린다.
// 규칙이 층에 따라 달라 보이면 그것도 설명할 수 없다.
//
// 선으로 그린다. "아직 그리지 않은 것 = 선, 그린 것 = 면" 이 화면의 전부이고
// 발자국은 그린 것이 아니다. 옅은 면으로 두면 판이 깔린 자리로 읽힌다.
// 점선이라 실선인 격자와 구분되면서 같은 계열에 머문다.
export function drawFootprints(ctx) {
  ctx.save();
  ctx.strokeStyle = COLOR.plateTop;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  for (const p of board.plates) {
    if (p.z === 0) continue;

    for (const c of p.cells) {
      polygon(ctx, tileDiamond(c.x, c.y));
      ctx.stroke();
    }
  }

  ctx.restore();   // 점선도 여기서 같이 풀린다
}

// 목표 표식. 빈 바닥에 찍힌 앰버 마름모.
//
// 판이 아니라 바닥에 있으므로 그 자리까지 판을 그려야 닿는다.
// 그 위에 판을 깔면 표식이 가려지는데, 그것으로 맞다 — 도달한 자리다.
export function drawGoal(ctx) {
  if (!board.goal) return;

  const pts = tileDiamond(board.goal.x, board.goal.y);

  ctx.save();
  ctx.strokeStyle = COLOR.amber;
  ctx.fillStyle = COLOR.amber;

  ctx.globalAlpha = board.cleared ? 0.55 : 0.18;
  polygon(ctx, pts);
  ctx.fill();

  ctx.globalAlpha = board.cleared ? 1 : 0.8;
  ctx.lineWidth = 1.5;
  polygon(ctx, pts);
  ctx.stroke();

  // 안쪽으로 한 겹 더. 부지 외곽선과 같은 앰버라도 겹선이면 표식으로 읽힌다.
  const c = worldToScreen(board.goal.x + 0.5, board.goal.y + 0.5);
  const inner = pts.map((p) => ({
    x: c.x + (p.x - c.x) * 0.45,
    y: c.y + (p.y - c.y) * 0.45,
  }));
  polygon(ctx, inner);
  ctx.stroke();

  ctx.restore();
}

// 캐릭터 — 흰 구체, 아래로 넓어지는 기둥, 바닥에 얇은 타원.
//
// 다리가 없으므로 걷기 프레임이 필요 없다. 이동은 전부 위치값 계산이라
// 그림 작업이 0 이다.
//
// 발이 닿는 곳은 판의 윗면이지 격자면이 아니다. 두께를 위로 세워 두었으므로
// PLATE_T 만큼 올려 세우지 않으면 캐릭터가 판에 파묻힌다.
function drawActor(ctx) {
  const pos = actorScreenPos();
  if (!pos) return;

  const s = view.scale;
  const foot = { x: pos.x, y: pos.y - PLATE_T * s };

  const head = { x: foot.x, y: foot.y - ACTOR_H * s };
  const r = ACTOR_R * s;
  const wBot = ACTOR_W * s;
  const wTop = wBot * 0.55;

  ctx.save();

  // 그림자. 몸이 판 위에 얹혀 있다는 것을 이것 하나가 말해 준다.
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, (TILE_W / 5) * s, (TILE_H / 5) * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.actor;

  // 몸 — 아래로 살짝 넓어지는 기둥
  ctx.beginPath();
  ctx.moveTo(foot.x - wBot, foot.y);
  ctx.lineTo(foot.x + wBot, foot.y);
  ctx.lineTo(head.x + wTop, head.y);
  ctx.lineTo(head.x - wTop, head.y);
  ctx.closePath();
  ctx.fill();

  // 머리
  ctx.beginPath();
  ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
  ctx.fill();

  // 스타일러스 — 오른쪽 위로, 끝에 앰버 점.
  // 이 게임에서 선을 긋는 것이 무엇인지 알려주는 유일한 표시다.
  const tip = { x: head.x + 11 * s, y: head.y - 9 * s };
  ctx.strokeStyle = COLOR.actor;
  ctx.lineWidth = Math.max(1, 1.6 * s);
  ctx.beginPath();
  ctx.moveTo(head.x + 3 * s, head.y + 5 * s);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  ctx.fillStyle = COLOR.amber;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, Math.max(1, 2 * s), 0, Math.PI * 2);
  ctx.fill();

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

  // 게이지 길이는 그 층의 배급량에 대한 비율이다. 배급이 조여진 층에서는
  // 같은 한 칸이 게이지를 더 크게 깎는다 — 디렉터가 무엇을 했는지 문구 없이
  // 읽히는 유일한 자리다.
  const committed = Math.max(0, board.ink) / stage.inkMax;
  const available = Math.max(0, inkAvailable()) / stage.inkMax;

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
//
// 판이 뜬 뒤로는 검증 대상이 하나 늘었다. 커서 아래 판이 있으면 그 판의
// 윗면을 빛내고, 없으면 바닥칸을 빛낸다. 하이라이트가 뜬 판을 정확히 덮지
// 못하면 pickAt 이 렌더와 어긋난 것이고, 그 어긋남은 5단계에서
// "이어져 보이는데 못 건너간다"로 나타난다.
export function drawHoverCell(ctx, pointer) {
  const hit = pointer.hit;
  const cell = hit || pointer.cell;
  if (!cell) return;

  // 판 위면 두께만큼 올려 윗면에 얹는다. 바닥이면 격자에 그대로 눕는다.
  const t = hit ? PLATE_T * view.scale : 0;
  const pts = tileDiamond(cell.x, cell.y, hit ? hit.z : 0)
    .map((p) => ({ x: p.x, y: p.y - t }));

  ctx.save();
  polygon(ctx, pts);

  ctx.fillStyle = COLOR.amber;
  ctx.globalAlpha = 0.16;
  ctx.fill();

  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = COLOR.amber;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
