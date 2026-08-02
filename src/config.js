// SETOUT — 전역 상수
//
// BLOCK_H 는 반드시 TILE_H 와 같아야 한다.
// 두 값이 같을 때 "(x+1, y+1) 이동"과 "(z-1) 이동"이 화면상 완전히
// 동일한 픽셀 이동이 되고, 그 지점에서 깊이 정보가 수학적으로 사라진다.
// 이 게임의 착시는 전부 이 한 줄의 등식 위에 서 있다.
export const TILE_W = 64;
export const TILE_H = 32;
export const BLOCK_H = TILE_H;

// 바닥 격자 크기 (칸)
export const GRID_W = 24;
export const GRID_H = 24;

// 판 한 장의 시각적 두께 (px). 논리 높이가 아니라 순수 연출.
export const PLATE_T = 7;

// 뷰 여백 (px), 그리고 판 위로 확보해 둘 높이 여유 (칸).
// 판을 z 만큼 올리면 화면 위쪽으로 z * BLOCK_H 만큼 솟으므로
// 그만큼을 미리 비워 두지 않으면 세운 판의 머리가 잘린다.
export const VIEW_MARGIN = 32;
export const VIEW_HEADROOM = 4;

export const COLOR = {
  // 청사진 바닥
  bg:        '#0E2440',
  gridLine:  '#39679C',
  gridEdge:  '#7FA9D6',

  // 판 — 메탈릭 철판. 윗면이 가장 밝고 좌면이 가장 어둡다.
  plateTop:   '#C4CAD2',
  plateRight: '#98A0AA',
  plateLeft:  '#7C848F',

  // 캐릭터
  actor: '#EDF2F7',

  // 포인트 — 스타일러스 끝, 목표 표식, 잉크 게이지
  amber: '#F2C14E',
};
