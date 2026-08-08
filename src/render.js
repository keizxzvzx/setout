// 렌더 — 청사진 바닥과 그 위에 놓인 철판
//
// 원칙: 아직 그리지 않은 것 = 선, 그린 것 = 면.
// 그래서 바닥은 끝까지 선으로만 남고, 채워지는 것은 판뿐이다.

import {
  GRID_W, GRID_H, PLATE_T, VIEW_MARGIN,
  TILE_W, TILE_H, ACTOR_R, ACTOR_H, ACTOR_W, COLOR, GAUGE,
} from './config.js';
import { stage } from './stage.js';
import { worldToScreen, tileDiamond, depthKey, view } from './iso.js';
import { board, parseKey, inkAvailable, inkRecoverable, cellList } from './board.js';
import { actorScreenPos } from './actor.js';

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

// 미리 깔린 판은 색이 다르다. 지울 수 없다는 것을 문구 없이 알리는 유일한
// 표시다 — 지우개를 문질러 아무 일도 안 일어나는 것으로 배우게 두면
// 그건 규칙이 아니라 고장으로 읽힌다. config 의 fixed* 참조.
//
// 밟은 판도 색이 다르다. 지울 수는 있지만 잉크가 한 방울도 안 돌아온다
// (INK_REFUND_STEPPED). 같은 이유다 — 지워 보고 게이지가 안 차는 것으로
// 배우게 두면 규칙이 아니라 고장으로 읽힌다.
//
// 미리 깔린 판보다 우선한다. 시작 발판은 둘 다 해당하는데, 거기서 알아야 할
// 것은 "지워지지 않는다" 쪽이므로 fixed 를 먼저 본다.
const skin = (fixed, stepped) => {
  if (fixed) return { top: COLOR.fixedTop, right: COLOR.fixedRight, left: COLOR.fixedLeft };
  if (stepped) return { top: COLOR.steppedTop, right: COLOR.steppedRight, left: COLOR.steppedLeft };
  return { top: COLOR.plateTop, right: COLOR.plateRight, left: COLOR.plateLeft };
};

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
function drawPlateSides(ctx, x, y, z, fixed, stepped) {
  const t = PLATE_T * view.scale;
  const c = skin(fixed, stepped);
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
function drawPlateTop(ctx, x, y, z, fixed, stepped) {
  const t = PLATE_T * view.scale;
  ctx.fillStyle = skin(fixed, stepped).top;
  polygon(ctx, tileDiamond(x, y, z).map((p) => ({ x: p.x, y: p.y - t })));
  ctx.fill();
}

export function drawPlates(ctx) {
  // 깊이가 소멸하는 투영이라 서로 다른 칸이 같은 픽셀을 점유한다.
  // 무엇이 위에 보이는가는 이 정렬 하나로 정해진다.
  // 착시 이동에서 "겹친 후보 중 실제로 보이는 것"을 고를 때도 같은 키를 쓴다.
  const cells = cellList();
  cells.sort((a, b) => depthKey(a.x, a.y, a.z) - depthKey(b.x, b.y, b.z));

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
  for (const c of cells) drawPlateSides(ctx, c.x, c.y, c.z, c.fixed, c.stepped);
  for (const c of cells) drawPlateTop(ctx, c.x, c.y, c.z, c.fixed, c.stepped);

  // 캐릭터는 판을 전부 그린 뒤에 그린다.
  //
  // 서 있는 칸 바로 다음에 그리고 있었다. 그러면 정렬에서 그 뒤에 오는 판이
  // 캐릭터 위로 올라오는데, 올려 둔 판은 3z 만큼 뒤로 밀려 있어 웬만한 칸보다
  // 늦게 그려진다. 그 판이 화면상 캐릭터 **위쪽** 자리에 있으면 — 캐릭터의
  // 몸은 발끝에서 위로 뻗으므로 바로 그 자리를 지난다 — 몸통이 잘린다.
  // 이음매 한 줄(6칸)을 올려 두고 재면 바닥 13칸에서 가려지고 그중 6칸은
  // 머리까지 묻혔다. 최악이 80% 였다.
  //
  // 맨 뒤로 미뤄도 판을 뚫고 보이지 않는다. 캐릭터의 실루엣은 자기 칸의
  // 한가운데에서 위로 솟은 좁은 기둥이라, 겹칠 수 있는 것은 화면상 위쪽 칸뿐이고
  // 그것들은 캐릭터보다 뒤에 있는 판이다. 화면상 아래쪽(카메라 쪽) 판의 윗면은
  // 캐릭터 발끝보다 아래에 있어 애초에 닿지 않는다.
  //
  // 같은 화면 자리에 더 높은 판이 겹치는 경우만 다르다. 그때는 캐릭터가 판
  // 속에 들어가야 맞는데, 높이 조절은 actorVisible() 로 되돌리고 디렉터는
  // 이음매의 화면 자리에 시작점을 두지 않으므로 그 상태 자체가 생기지 않는다.
  drawActor(ctx);

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
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  for (const p of board.plates) {
    if (p.z === 0) continue;

    // 발자국도 그 판의 색을 따른다. 미리 깔린 판이 남긴 구멍과 내가 올린 판이
    // 남긴 구멍은 둘 다 못 그리는 자리지만, 무엇이 남긴 것인지는 보여야 한다.
    ctx.strokeStyle = p.fixed ? COLOR.fixedTop : COLOR.plateTop;

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

  // 가장 바깥 겹. 지금 지울 수 있는 것을 전부 지웠다고 쳤을 때의 잉크다.
  // 걸어서 확인해 본 다리는 환급이 0 이라, 걸어간 순간 이 끝이 짧아진다.
  const recoverable = committed + Math.max(0, inkRecoverable()) / stage.inkMax;

  ctx.save();

  ctx.strokeStyle = COLOR.gridEdge;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

  ctx.fillStyle = COLOR.amber;

  // 바깥에서 안으로. 뒤에 그린 것이 앞의 것을 덮으므로 진해지는 순서다.
  ctx.globalAlpha = GAUGE.recoverable;
  ctx.fillRect(x, y, w * recoverable, h);

  ctx.globalAlpha = GAUGE.committed;
  ctx.fillRect(x, y, w * committed, h);

  ctx.globalAlpha = GAUGE.available;
  ctx.fillRect(x, y, w * available, h);

  ctx.restore();
}

// 조작 표시. 좌측 상단.
//
// 계획서의 "튜토리얼 문구 없음, 대사 없음" 과 부딪치는 유일한 자리다.
// 그 원칙은 **플레이어가 스스로 배우게 두는 것**이 목적이었고, 바닥을 문지르면
// 선이 나오는 것까지는 지금도 그대로 성립한다. 그런데 판 위와 빈 바닥에서
// 같은 좌클릭이 다른 일을 하는 것, 그리고 휠이 높이를 바꾼다는 것은 눌러 보기
// 전에는 알 방법이 없다. 심사자가 링크를 열어 한 번 보고 판단하는 상황에서
// 그것을 발견에 맡길 수는 없다.
//
// 대신 화면을 뺏지 않게 잡았다. 청사진 팔레트 안에서만 쓰고, 투명도를 낮춰
// 바닥보다 조금 진한 정도에 둔다. 앰버는 쓰지 않는다 — 잉크 게이지와 목표
// 표식의 색이라 여기 쓰면 "이것이 자원이다" 가 흐려진다. 4단계에서 캐릭터
// 색을 고를 때 세운 규율 그대로다.
//
// 자리는 좌측 상단, 여백은 잉크 게이지와 같은 VIEW_MARGIN. 게이지가 좌하단
// 이므로 둘이 대각으로 마주 보고, 판은 화면 중앙에 놓이므로 겹치지 않는다.

// 표시할 조작. 검사가 이것을 실제 입력 규칙과 대조한다 — 화면이 하는 말과
// input.js 가 하는 일이 갈리면 문구가 없는 것보다 나쁘다.
export const CONTROLS = [
  ['L', 'DRAW · WALK'],
  ['R', 'ERASE'],
  ['W', 'LIFT'],
];

// 화면 모서리 표시가 같이 쓰는 값. 조작 표시와 층 번호가 한 쌍으로 읽히려면
// 상자 크기와 재질이 같아야 한다.
const HUD = {
  fontPx: 11,
  pad: 11,          // 상자 안쪽 여백
  mouseW: 15,
  mouseH: 22,
  rowGap: 9,        // 마우스 줄 사이
  labelGap: 11,     // 마우스와 글자 사이
};

// 층 번호 상자는 조작 안내의 이만큼이다.
//
// 같은 크기로 맞춰 봤더니 번호 쪽이 너무 컸다. 담을 것이 두 글자뿐인데
// 세 줄짜리 상자와 같은 자리를 차지하면, 읽을 것이 적은 쪽이 더 크게 보인다.
// 조작 안내는 처음 한 번 읽고 마는 것이고 층 번호는 계속 눈에 남으므로
// 이쪽이 더 조용해야 맞다.
const SHEET_SCALE = 2 / 3;

const hudFont = (px = HUD.fontPx) =>
  `${px}px ui-monospace, "DejaVu Sans Mono", monospace`;

// 상자 크기는 조작 표시가 정한다. 그쪽이 담을 것이 가장 많고, 글자 폭을 재서
// 구하므로 문구를 바꾸면 두 상자가 같이 따라온다.
function hudBox(ctx) {
  ctx.save();
  ctx.font = hudFont();
  let labelW = 0;
  for (const [, label] of CONTROLS) labelW = Math.max(labelW, ctx.measureText(label).width);
  ctx.restore();

  return {
    w: HUD.pad + HUD.mouseW + HUD.labelGap + labelW + HUD.pad,
    h: HUD.pad * 2 + CONTROLS.length * HUD.mouseH + (CONTROLS.length - 1) * HUD.rowGap,
  };
}

// 글자 사이를 벌려 찍는다.
//
// ctx.letterSpacing 은 최신 브라우저에만 있다. 마우스 윤곽을 roundRect 대신
// 호로 짠 것과 같은 이유로 쓰지 않는다 — 심사자가 무엇을 열지 알 수 없다.
function trackedText(ctx, text, x, y, track) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
}

function trackedWidth(ctx, text, track) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
  return w - track;
}

// 상자 바탕과 테두리. 잉크 게이지와 같은 값이라 셋이 같은 재질로 읽힌다.
function hudPanel(ctx, x, y, w, h) {
  // 바닥을 한 겹 덮는다. 격자선이 글자 뒤로 지나가면 읽기가 나빠진다.
  ctx.fillStyle = COLOR.bg;
  ctx.globalAlpha = 0.72;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = COLOR.gridEdge;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}

// 마우스 실루엣의 윤곽. 그리는 데도 쓰고, 버튼 강조를 가둘 때도 쓴다.
//
// roundRect 를 쓰지 않고 호와 선으로 짠다. 이 게임은 라이브러리를 하나도
// 쓰지 않는데 캔버스 최신 API 에 기대면 구형 브라우저에서 조용히 죽는다.
// 심사자가 무엇을 쓸지는 알 수 없다 — 3단계 휠 사고와 같은 종류의 대비다.
function mouseOutline(ctx, x, y, w, h) {
  const rt = w / 2;                       // 위는 반원
  const rb = Math.min(5, w / 3);          // 아래는 살짝만

  ctx.beginPath();
  ctx.moveTo(x, y + rt);
  ctx.arc(x + rt, y + rt, rt, Math.PI, 0);
  ctx.lineTo(x + w, y + h - rb);
  ctx.arc(x + w - rb, y + h - rb, rb, 0, Math.PI / 2);
  ctx.lineTo(x + rb, y + h);
  ctx.arc(x + rb, y + h - rb, rb, Math.PI / 2, Math.PI);
  ctx.closePath();
}

// 마우스 하나. hit 이 'L' | 'R' | 'W' 면 그 자리를 채운다.
function drawMouse(ctx, x, y, w, h, hit) {
  const split = h * 0.42;                 // 버튼과 몸통이 갈리는 높이
  const cx = x + w / 2;

  // 강조는 윤곽 안쪽에만. 사각형을 그대로 칠하면 위쪽 반원을 뚫고 나온다.
  //
  // 자르는 길과 그리는 길이 같아야 한다. 반 픽셀이라도 어긋나면 둥근 머리
  // 언저리에 실오라기가 남는데, 그런 것은 확대해 보기 전까지 안 보인다.
  ctx.save();
  mouseOutline(ctx, x + 0.5, y + 0.5, w, h);
  ctx.clip();

  ctx.fillStyle = COLOR.plateTop;
  ctx.globalAlpha = 0.85;
  if (hit === 'L') ctx.fillRect(x, y, w / 2, split);
  if (hit === 'R') ctx.fillRect(cx, y, w / 2, split);
  if (hit === 'W') {
    // 휠도 마우스 크기를 따라간다. 고정값으로 두면 상자를 줄였을 때
    // 알약이 버튼 칸보다 길어져 위아래가 뒤집힌다.
    const ww = Math.max(2, w * 0.22);
    const top = y + ww;
    const bot = Math.max(top + ww, y + split - ww * 0.5);
    ctx.beginPath();
    ctx.arc(cx, top + ww / 2, ww / 2, Math.PI, 0);
    ctx.lineTo(cx + ww / 2, bot - ww / 2);
    ctx.arc(cx, bot - ww / 2, ww / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = COLOR.gridEdge;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;

  mouseOutline(ctx, x + 0.5, y + 0.5, w, h);
  ctx.stroke();

  // 버튼 경계. 가로선은 split 이 반원보다 아래라 몸통 폭을 그대로 가로지른다.
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + split + 0.5);
  ctx.lineTo(x + w + 0.5, y + split + 0.5);
  ctx.moveTo(cx + 0.5, y + 0.5);
  ctx.lineTo(cx + 0.5, y + split + 0.5);
  ctx.stroke();
}

export function drawControls(ctx) {
  ctx.save();
  ctx.font = hudFont();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const { w: bw, h: bh } = hudBox(ctx);
  const bx = VIEW_MARGIN;
  const by = VIEW_MARGIN;

  hudPanel(ctx, bx, by, bw, bh);

  CONTROLS.forEach(([hit, label], i) => {
    const y = by + HUD.pad + i * (HUD.mouseH + HUD.rowGap);
    drawMouse(ctx, bx + HUD.pad, y, HUD.mouseW, HUD.mouseH, hit);

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = COLOR.plateTop;
    ctx.fillText(label, bx + HUD.pad + HUD.mouseW + HUD.labelGap, y + HUD.mouseH / 2 + 0.5);
  });

  ctx.restore();
}

// 층 번호. 우측 상단.
//
// 실제 도면 모서리의 표제란(title block) 모양이다. 위 칸에 무엇을 세는지,
// 아래 칸에 번호. SETOUT 이 제도 용어이고 층 전환도 "도면을 넘긴다" 로 잡았으니
// 도면 모서리에 표제란이 있는 것은 설명이 필요 없다. STAGE 나 LEVEL 로 두면
// 뜻은 분명해도 청사진 톤에서 튀고, LEVEL 은 높이(z)와 헷갈린다.
//
// 번호는 부르는 쪽이 넘겨준다. 여기서 session 을 읽으면 렌더가 판 상태를
// 넘어 판의 이력까지 알게 되고, 그 순간 이 파일만 따로 시험할 수 없게 된다.
//
// 숫자가 바뀌는 시점은 따로 맞출 것이 없다. session.stages 는 도면이 갈리는
// 한복판(flip.t = 0.5)에서 올라가는데, 그때 화면에는 빈 도면만 있으므로
// 숫자가 튀는 것이 보이지 않는다.
export function drawSheetNo(ctx, viewW, n) {
  const LABEL = 'SHEET';

  ctx.save();
  ctx.textBaseline = 'middle';

  // 크기는 조작 안내에서 끌어온다. 저쪽 문구가 바뀌어 상자가 커지면 이쪽도
  // 같은 비율로 따라간다 — 두 모서리의 관계가 값 하나로 유지된다.
  const box = hudBox(ctx);
  const bh = Math.round(box.h * SHEET_SCALE);
  const pad = Math.round(HUD.pad * SHEET_SCALE);

  // 두 칸의 비율. 처음에는 라벨 칸을 마우스 한 줄 높이로 잡았는데, 상자를
  // 2/3 으로 줄이자 글자가 7px 이 되어 읽히지 않았다. 번호 칸을 조금 내주고
  // 라벨 칸을 키운다 — 안 읽히는 라벨은 없느니만 못하다.
  const row = Math.round(bh * 0.34);                  // 라벨 칸
  const bot = bh - row;                               // 번호 칸

  // 글자는 각자 자기 칸에서 나온다. 상자 비율을 바꾸면 둘 다 따라온다.
  const labelFont = Math.max(9, Math.round(row * 0.45));
  const numFont = Math.round(bot * 0.62);
  ctx.font = hudFont(numFont);

  const num = String(n).padStart(2, '0');
  const bw = Math.max(Math.round(box.w * SHEET_SCALE),
                      ctx.measureText(num).width + pad * 2);

  const bx = viewW - VIEW_MARGIN - bw;
  const by = VIEW_MARGIN;

  hudPanel(ctx, bx, by, bw, bh);

  // 두 칸을 가르는 선. 조작 안내에는 없는 것이라 표제란으로 읽힌다.
  ctx.beginPath();
  ctx.moveTo(bx, by + row + 0.5);
  ctx.lineTo(bx + bw, by + row + 0.5);
  ctx.stroke();

  ctx.font = hudFont(labelFont);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = COLOR.gridEdge;
  ctx.fillText(LABEL, bx + pad, by + row / 2 + 0.5);

  ctx.font = hudFont(numFont);
  ctx.textAlign = 'right';
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = COLOR.plateTop;
  ctx.fillText(num, bx + bw - pad, by + row + bot / 2 + 1);

  ctx.restore();
}

// 도면명. 우측 하단.
//
// 제도 규격에서 표제란은 도면 우하단에 있고 거기에 도면명과 도면번호가 함께
// 들어간다. 이 게임은 화면 전체가 한 장의 도면이므로 이름이 그 자리에 있는
// 것이 장식이 아니라 도면의 일부가 된다.
//
// 층 번호와 한 상자로 묶지 않은 이유는 번호가 매 층 바뀌기 때문이다. 이름은
// 안 바뀌는 것이고 번호는 바뀌는 것이라, 한 칸에 두면 안 바뀌는 쪽까지
// 눈길을 끈다.
//
// 시트 상자보다 작다. 담을 것이 한 줄뿐인데 크게 두면 읽을 것이 없는 쪽이
// 더 크게 보인다 — SHEET_SCALE 을 정할 때와 같은 이유다.
export function drawLogo(ctx, viewW, viewH) {
  const TITLE = 'SETOUT';

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const pad = Math.round(HUD.pad * SHEET_SCALE);
  const track = 3;                          // 제도 라벨처럼 자간을 벌린다

  ctx.font = hudFont();
  const bw = trackedWidth(ctx, TITLE, track) + pad * 2;
  const bh = HUD.fontPx + pad * 2;

  const bx = viewW - VIEW_MARGIN - bw;
  const by = viewH - VIEW_MARGIN - bh;      // 잉크 게이지와 아랫변이 맞는다

  hudPanel(ctx, bx, by, bw, bh);

  ctx.globalAlpha = 0.55;
  ctx.fillStyle = COLOR.plateTop;
  trackedText(ctx, TITLE, bx + pad, by + bh / 2 + 0.5, track);

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
