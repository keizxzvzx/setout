// 이동 그래프와 길찾기
//
// 이 묶음이 지키는 것은 두 가지다. 화면상 인접이라는 길 판정이 옳은가,
// 그리고 그 위의 BFS 가 6단계 솔버로 재사용될 만큼 순수한가.

import * as P from '../src/path.js';
import * as C from '../src/config.js';

const { GRID_W, GRID_H, Z_MIN, Z_MAX } = C;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const cell = (x, y, z = 0) => ({ x, y, z });
const shape = (path) => (path ?? []).map((c) => `(${c.x},${c.y},${c.z})`).join(' → ');

// 검사 배치가 의도치 않게 겹치지 않았는가.
//
// 같은 화면 자리에 칸이 둘 있으면 위의 것만 보이고 아래는 길에서 빠진다.
// 그것을 시험하려는 배치가 아니라면 겹침은 시나리오의 실수다.
const overlaps = (cells) => {
  const seen = new Map();
  const dup = [];
  for (const c of cells) {
    const s = P.screenCell(c);
    const k = `${s.x},${s.y}`;
    if (seen.has(k)) dup.push(`${shape([seen.get(k)])} 와 ${shape([c])} 가 화면 (${k})`);
    else seen.set(k, c);
  }
  return dup;
};
const noOverlap = (cells) => overlaps(cells).length === 0;
const overlapNote = (cells) => overlaps(cells).join(', ');

// --- 1. 인접 판정 -----------------------------------------------------------

{
  // 같은 높이의 사방 이웃은 진짜 길
  check('사방 인접 = 길', P.isAdjacent(cell(4, 4), cell(5, 4)) && P.isAdjacent(cell(4, 4), cell(4, 5)));
  check('사방 인접은 착시가 아님', !P.isIllusion(cell(4, 4), cell(5, 4)));

  // 대각은 화면에서 한 칸 옆이 아니다. 판을 한 장으로 묶는 기준과 일부러 다르다.
  check('대각은 길이 아님', !P.isAdjacent(cell(4, 4), cell(5, 5)));

  // 자기 자신
  check('자기 자신과는 안 이어짐', !P.isAdjacent(cell(4, 4), cell(4, 4)));

  // 착시 — 3D 로는 멀지만 화면에서는 한 칸 옆
  // (2,2,z=0) 은 바닥 (2,2), (6,5,z=3) 은 바닥 (3,2). 한 칸 옆이다.
  check('3D 로 멀어도 화면에서 한 칸 옆이면 길',
    P.isAdjacent(cell(2, 2, 0), cell(6, 5, 3)),
    `${JSON.stringify(P.screenCell(cell(6, 5, 3)))}`);
  check('그 길은 착시로 기록됨', P.isIllusion(cell(2, 2, 0), cell(6, 5, 3)));

  // 대칭
  let asym = 0;
  for (let i = 0; i < 400; i++) {
    const a = cell(i % GRID_W, (i * 7) % GRID_H, i % (Z_MAX + 1));
    const b = cell((i * 3) % GRID_W, (i * 5) % GRID_H, (i * 2) % (Z_MAX + 1));
    if (P.isAdjacent(a, b) !== P.isAdjacent(b, a)) asym++;
  }
  check('인접 판정이 대칭', asym === 0, `${asym}건`);
}

// --- 2. 진짜 인접 ⊂ 화면 인접  ★ 계획서의 4·5단계 중복을 푸는 근거 ----------
//
// z 가 같으면 (x−z, y−z) 의 차가 그대로 (x, y) 의 차다. 그래서 3D 인접은
// 화면 인접의 부분집합이고, 화면 인접 하나만 구현하면 진짜 길이 공짜로 따라온다.

{
  let pairs = 0;
  let missing = 0;
  let sample = '';

  for (let z = Z_MIN; z <= Z_MAX; z++) {
    for (let x = 0; x < GRID_W; x++) {
      for (let y = 0; y < GRID_H; y++) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const a = cell(x, y, z);
          const b = cell(x + dx, y + dy, z);
          if (b.x >= GRID_W || b.y >= GRID_H) continue;
          pairs++;
          if (!P.isAdjacent(a, b)) {
            missing++;
            if (!sample) sample = shape([a, b]);
          }
        }
      }
    }
  }
  check(`진짜 인접 ${pairs}쌍이 전부 화면 인접`, missing === 0, `${missing}건 누락, 예: ${sample}`);

  // 반대는 성립하지 않아야 한다 — 성립하면 착시가 존재하지 않는다는 뜻이다
  check('화면 인접이지만 진짜가 아닌 쌍이 존재', P.isAdjacent(cell(2, 2, 0), cell(6, 5, 3)));
}

// --- 3. BFS -----------------------------------------------------------------

{
  // 일직선 다섯 칸
  const line = [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0), cell(4, 0)];
  const p1 = P.findPath(line, line[0], line[4]);
  check('일직선 최단 경로 길이', p1 && p1.length === 5, shape(p1));
  check('경로가 착시를 안 씀', !P.usesIllusion(p1));

  // 제자리
  const p0 = P.findPath(line, line[2], line[2]);
  check('제자리는 길이 1', p0 && p0.length === 1, shape(p0));

  // 끊긴 길
  const gap = [cell(0, 0), cell(1, 0), cell(3, 0), cell(4, 0)];
  check('끊긴 길은 null', P.findPath(gap, gap[0], gap[3]) === null);

  // ㄷ자 우회 — 최단이 우회로여야 한다
  const detour = [
    cell(0, 0), cell(1, 0), cell(2, 0),
    cell(0, 1), cell(2, 1),
    cell(0, 2), cell(1, 2), cell(2, 2),
  ];
  const p2 = P.findPath(detour, cell(0, 0), cell(2, 2));
  check('우회로 최단 길이 5', p2 && p2.length === 5, shape(p2));

  // 착시로만 이어지는 길
  //   (0,0,z=0) 바닥 (0,0)
  //   (4,3,z=3) 바닥 (1,0)   ← 화면에서 (0,0) 바로 옆
  //   (5,3,z=3) 바닥 (2,0)
  const illus = [cell(0, 0, 0), cell(4, 3, 3), cell(5, 3, 3)];
  const p3 = P.findPath(illus, illus[0], illus[2]);
  check('착시로만 이어진 길을 찾음', p3 && p3.length === 3, shape(p3));
  check('그 경로는 착시를 씀', P.usesIllusion(p3));

  // 최단이 착시를 요구하는가 — 6단계 솔버의 검증 조건 그대로
  //
  // 처음 쓴 배치는 정직한 다리의 (1,0,z=0) 과 곁가지 (4,3,z=3) 이 둘 다 화면
  // 자리 (1,0) 에 왔다. 5단계에서 가림을 반영하자 z 가 큰 쪽이 이겨 정직한
  // 칸이 가려졌고, 이 검사가 뒤집혔다. 코드가 아니라 시나리오가 틀린 경우다.
  // 그래서 겹침이 없다는 것을 먼저 확인한 뒤에 묻는다.
  const both = [
    cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(3, 0, 0),   // 정직한 다리
    cell(4, 4, 3),                                                 // 화면 (1,1) — 곁가지
  ];
  check('배치에 겹치는 화면 자리가 없음', noOverlap(both), overlapNote(both));

  const p4 = P.findPath(both, cell(0, 0, 0), cell(3, 0, 0));
  check('정직한 길이 있으면 그쪽이 최단', p4 && p4.length === 4 && !P.usesIllusion(p4), shape(p4));
}

// --- 4. 순수성  ★ 6단계 솔버 재사용의 전제 ----------------------------------
//
// findPath 가 살아 있는 board 를 한 줄이라도 읽으면, 아직 놓지도 않은 가상의
// 배치를 물어볼 수 없게 되어 솔버로 못 쓴다.

{
  const cells = [cell(0, 0), cell(1, 0), cell(2, 0)];

  const a = P.findPath(cells, cells[0], cells[2]);
  const b = P.findPath(cells, cells[0], cells[2]);
  check('같은 입력에 같은 출력', shape(a) === shape(b));

  // 게임 상태를 채워 놓고 물어도 답이 달라지지 않아야 한다
  const B = await import('../src/board.js');
  B.board.plates = [{ cells: [{ x: 9, y: 9 }], z: 5 }];
  B.board.occupied = new Set(['9,9']);
  const c = P.findPath(cells, cells[0], cells[2]);
  check('board 를 채워도 답이 그대로', shape(a) === shape(c), shape(c));

  // 입력을 건드리지 않는가
  const before = JSON.stringify(cells);
  P.findPath(cells, cells[0], cells[2]);
  check('입력 배열을 변형하지 않음', JSON.stringify(cells) === before);
}

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
