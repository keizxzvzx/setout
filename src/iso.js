// 등각 투영 — 착시가 태어나는 곳
//
// 이 파일이 SETOUT의 전부라고 해도 된다.
// 나머지 코드는 여기서 나온 좌표를 칠하거나 이어붙일 뿐이다.

import {
  TILE_W, TILE_H, BLOCK_H, PLATE_T,
  GRID_W, GRID_H, VIEW_MARGIN, VIEW_HEADROOM,
} from './config.js';

// 뷰 상태. 원점은 격자 (0,0) 타일의 위쪽 꼭짓점이 놓일 픽셀,
// scale 은 판 전체가 창에 들어오도록 잡는 균등 배율이다.
//
// 배율을 넣어도 착시는 안전하다.
//   (x+1, y+1) 이동 → sy 변화 = +TILE_H * scale
//   (z-1)      이동 → sy 변화 = +BLOCK_H * scale
// 균등 배율은 양변에 똑같이 곱해지므로 두 이동은 여전히 같은 픽셀이다.
// 가로·세로를 따로 늘리는 비균등 배율만 이 등식을 깬다.
//
// 단, 배율이 투영에 들어간 이상 역투영도 같은 배율로 나눠야 한다.
// 둘이 어긋나면 커서 위치와 칠해지는 칸이 미묘하게 달라진다.
// 그래서 투영과 역투영이 같은 파일에서 하나의 뷰 상태를 공유한다.
export const view = { ox: 0, oy: 0, scale: 1 };

export function setView(ox, oy, scale) {
  view.ox = ox;
  view.oy = oy;
  view.scale = scale;
}

// 판 전체가 창 안에 들어오도록 배율과 원점을 잡는다.
//
// 원점 기준 배율 1 일 때의 경계 상자:
//   왼쪽   worldToScreen(0, GRID_H) → -GRID_H * TILE_W/2
//   오른쪽 worldToScreen(GRID_W, 0) → +GRID_W * TILE_W/2
//   위쪽   판을 올릴 여유(VIEW_HEADROOM)만큼 더 확보
//   아래쪽 worldToScreen(GRID_W, GRID_H)
//
// 이 상자를 여백 안에 넣는 배율을 구하고, 상자 중심을 화면 중심에 맞춘다.
// 배율은 1을 넘기지 않는다 — 큰 모니터에서 선을 억지로 늘려 흐려지는 것보다
// 여백이 넓은 편이 청사진 톤에 맞는다.
//
// 여유를 현재 최고 판 높이에 맞춰 그때그때 다시 잡는 방법도 있지만,
// 판을 올릴 때마다 화면이 확대·축소되면 무엇이 움직인 것인지 알 수 없게 된다.
// 착시는 화면상 정렬을 읽는 게임이므로 프레임은 고정되어 있어야 한다.
export function fitView(viewW, viewH) {
  const left   = -GRID_H * (TILE_W / 2);
  const right  =  GRID_W * (TILE_W / 2);
  const top    = -VIEW_HEADROOM * BLOCK_H;
  const bottom = (GRID_W + GRID_H) * (TILE_H / 2);

  const boxW = right - left;
  const boxH = bottom - top;

  const scale = Math.min(
    1,
    (viewW - VIEW_MARGIN * 2) / boxW,
    (viewH - VIEW_MARGIN * 2) / boxH,
  );

  setView(
    viewW / 2 - ((left + right) / 2) * scale,
    viewH / 2 - ((top + bottom) / 2) * scale,
    scale,
  );
}

// 격자 좌표 → 화면 좌표 (해당 타일의 위쪽 꼭짓점)
//
//   sx = OX + (x - y) * TILE_W/2
//   sy = OY + (x + y) * TILE_H/2 - z * BLOCK_H
//
// z 항의 계수가 TILE_H/2 가 아니라 BLOCK_H(= TILE_H) 인 것에 주의.
// (x+1, y+1) 은 sy 를 +TILE_H 만큼 밀고, (z-1) 도 sy 를 +BLOCK_H 만큼 민다.
// 둘이 같으므로 화면만 봐서는 어느 쪽으로 움직였는지 구분할 수 없다.
export function worldToScreen(x, y, z = 0) {
  return {
    x: view.ox + (x - y) * (TILE_W / 2) * view.scale,
    y: view.oy + ((x + y) * (TILE_H / 2) - z * BLOCK_H) * view.scale,
  };
}

// 화면 좌표 → 바닥 격자 좌표 (z = 0 평면 한정)
//
// 투영식을 뒤집으면 두 식의 합과 차만으로 풀린다.
//   u = (sx - OX) / (TILE_W/2) = x - y
//   v = (sy - OY) / (TILE_H/2) = x + y
//   x = (u + v) / 2,  y = (v - u) / 2
//
// z 를 0 으로 고정했기 때문에 해가 하나로 확정된다.
// 임의의 z 를 허용했다면 화면의 한 점이 무한히 많은 (x,y,z) 에 대응하므로
// 이 역변환은 성립하지 않는다. 그리기를 바닥으로 못 박은 이유가 이것.
//
// 판이 뜬 뒤에도 이 함수 하나로 충분하다. 두 투영식을 같다고 놓고 풀면
//
//   sx 일치:  x − y = x′ − y′
//   sy 일치:  (x + y) − 2z = x′ + y′        (BLOCK_H = TILE_H 이므로)
//   ───────────────────────────────────
//             x′ = x − z ,  y′ = y − z
//
// 즉 (x, y, z) 는 바닥의 (x−z, y−z) 자리에 나타난다. 뒤집으면 이 함수가 준
// 바닥칸 (gx, gy) 위에 있을 수 있는 판 칸은 (gx+z, gy+z, z) 뿐이므로,
// z 가 유한하면 후보를 열거할 수 있다. board.js 의 pickAt 이 그것이다.
//
// 여기서 z 가 sx 를 전혀 건드리지 않는다는 것도 같이 나온다.
// 판을 아무리 올려도 화면 가로 위치는 고정이므로, 착시로 이을 수 있는 판은
// 처음부터 화면상 같은 세로줄 위에 있는 것뿐이다. 5단계의 탐색 공간이
// 이 한 줄에서 결정된다.
export function screenToGrid(sx, sy) {
  const u = (sx - view.ox) / ((TILE_W / 2) * view.scale);
  const v = (sy - view.oy) / ((TILE_H / 2) * view.scale);
  return {
    x: Math.floor((u + v) / 2),
    y: Math.floor((v - u) / 2),
  };
}

// 판을 겨냥할 때 쓰는 바닥칸.
//
// 화면에 보이는 것은 판의 윗면인데, 두께를 위로 세운 탓에 윗면은 격자와 맞는
// 아랫면보다 PLATE_T 만큼 위에 그려져 있다. 보정하지 않으면 커서와 판이
// 그만큼 어긋나, 판의 위쪽 가장자리를 눌렀는데 뒤 칸이 잡힌다.
//
// 두께는 순수 연출값이고 좌표계와 무관하지만, 겨냥은 논리가 아니라
// 눈에 보이는 것을 맞히는 일이므로 여기서 되돌려 준다.
export function screenToPlateGrid(sx, sy) {
  return screenToGrid(sx, sy + PLATE_T * view.scale);
}

// 타일 하나의 마름모 꼭짓점 4개 (위 → 오른쪽 → 아래 → 왼쪽)
//
// 픽셀 오프셋을 직접 더하지 않고 격자 모서리 네 점을 각각 투영한다.
// 배율이 바뀌어도 따로 손댈 곳이 없다.
export function tileDiamond(x, y, z = 0) {
  return [
    worldToScreen(x,     y,     z),
    worldToScreen(x + 1, y,     z),
    worldToScreen(x + 1, y + 1, z),
    worldToScreen(x,     y + 1, z),
  ];
}

// 렌더 정렬 키. 값이 클수록 카메라에 가깝다 = 나중에(위에) 그린다.
//
// 깊이가 소멸하는 투영이라 서로 다른 타일이 같은 픽셀을 점유한다.
// 무엇이 위에 보이는가는 이 키 하나로 정해지며,
// 나중에 착시 이동 판정에서 "겹친 후보 중 실제로 보이는 것"을
// 고를 때도 같은 키를 그대로 쓴다.
export function depthKey(x, y, z = 0) {
  return x + y + z;
}
