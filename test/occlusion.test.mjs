// 가림 — 보이지 않는 것은 건널 수 없다
//
// 이 게임의 태그라인은 "이어져 보인다면, 이어진 것이다" 이고, 그 역도 성립해야
// 한다. 판에 파묻혀 화면에 없는 칸 위로 캐릭터가 지나가면 규칙이 거짓말이 되고,
// 튜토리얼 문구가 없는 게임에서 플레이어는 무슨 일이 일어났는지 알 수 없다.
//
// 무엇이 보이는가는 세 곳이 각자 답한다.
//   render  깊이 정렬로 나중에 그린 것
//   board   pickAt 이 z 큰 것부터 훑어 처음 걸린 것
//   path    화면 자리마다 z 가 가장 큰 것
// 셋이 같은 답을 내야 하고, 어긋나면 "이어져 보이는데 못 건너간다" 가 된다.

import * as P from '../src/path.js';
import * as B from '../src/board.js';
import * as A from '../src/actor.js';
import * as C from '../src/config.js';

const { GRID_W, GRID_H, Z_MIN, Z_MAX, INK_MAX, INK_COST } = C;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const cell = (x, y, z = 0) => ({ x, y, z });
const shape = (p) => (p ?? []).map((c) => `(${c.x},${c.y},${c.z})`).join(' → ');

function reset() {
  B.board.plates = [];
  B.board.stroke.clear();
  B.board.occupied.clear();
  B.board.stepped.clear();
  B.board.erased.clear();
  B.board.ink = INK_MAX;
  B.board.actor = null;
  B.board.goal = null;
  B.board.cleared = false;
  B.board.stats.inkSpent = 0;
  B.board.stats.redraws = 0;
  B.board.stats.illusionSteps = 0;
  B.board.stats.realSteps = 0;
  B.cancelStroke();
}

// --- 1. 가려진 칸은 길이 아니다  ★ 5단계의 이유 -----------------------------
//
// 대각선 위의 판을 그 거리만큼 올리면 화면 자리가 정확히 포개진다.
// A(1..3, 3, z=0) 은 화면 (1..3, 3), B(6..8, 8, z=5) 도 화면 (1..3, 3).
// 4단계까지는 파묻힌 A 위로 캐릭터가 걸어갔다.

{
  const A_CELLS = [cell(1, 3), cell(2, 3), cell(3, 3)];
  const B_CELLS = [cell(6, 8, 5), cell(7, 8, 5), cell(8, 8, 5)];
  const all = [...A_CELLS, ...B_CELLS];

  const hidden = A_CELLS[2];                       // (3,3,0) — B 밑에 깔린다
  const s = P.screenCell(hidden);
  const visible = P.visibleCells(all).find((c) => {
    const t = P.screenCell(c);
    return t.x === s.x && t.y === s.y;
  });

  check('겹친 자리에서 z 가 큰 것이 보인다',
    visible.x === 8 && visible.y === 8 && visible.z === 5, shape([visible]));

  check('가려진 칸으로 가는 길이 없다',
    P.findPath(all, A_CELLS[0], hidden) === null,
    shape(P.findPath(all, A_CELLS[0], hidden)));

  check('보이는 칸으로는 갈 수 있다',
    !!P.findPath(all, B_CELLS[0], B_CELLS[2]),
    shape(P.findPath(all, B_CELLS[0], B_CELLS[2])));
}

// --- 2. 잇는 축은 그대로 살아 있다 ------------------------------------------
//
// 대각선에서 한 칸 벗어난 판을 올리면 나란히 선다. 가림을 넣었다고 이것까지
// 막히면 게임이 사라진다.

{
  const all = [
    cell(1, 3), cell(2, 3), cell(3, 3),              // 화면 (1,3) (2,3) (3,3)
    cell(8, 7, 4), cell(9, 7, 4), cell(10, 7, 4),    // 화면 (4,3) (5,3) (6,3)
  ];
  const p = P.findPath(all, all[0], all[5]);

  check('대각선 옆 판을 올리면 이어진다', p && p.length === 6, shape(p));
  check('그 경로는 착시를 쓴다', P.usesIllusion(p));
}

// --- 3. 그래프와 pickAt 이 같은 답인가  ★ 세 경로의 일치 --------------------
//
// path 는 스냅샷 위에서 z 최대를 고르고, pickAt 은 살아 있는 board 를 z 큰
// 것부터 훑는다. 서로 다른 코드가 같은 규칙을 각자 구현하고 있으므로,
// 어긋나면 "보이는데 못 간다" 나 그 반대가 된다.

{
  let seed = 20260804;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let mismatch = 0;
  let tested = 0;
  let sample = '';

  for (let trial = 0; trial < 40; trial++) {
    reset();
    const used = new Set();

    for (let i = 0; i < 6; i++) {
      const cells = [];
      let cx = Math.floor(rnd() * GRID_W);
      let cy = Math.floor(rnd() * GRID_H);
      for (let j = 0; j < 2 + Math.floor(rnd() * 6); j++) {
        if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) break;
        const k = cx + ',' + cy;
        if (!used.has(k)) { used.add(k); cells.push({ x: cx, y: cy }); }
        if (rnd() < 0.5) cx += rnd() < 0.5 ? 1 : -1; else cy += rnd() < 0.5 ? 1 : -1;
      }
      if (cells.length) B.addPlate(cells, Z_MIN + Math.floor(rnd() * (Z_MAX - Z_MIN + 1)));
    }

    const snapshot = B.cellList();
    if (!snapshot.length) continue;

    for (const c of P.visibleCells(snapshot)) {
      const s = P.screenCell(c);
      const hit = B.pickAt(s.x, s.y);
      tested++;
      if (!hit || hit.x !== c.x || hit.y !== c.y || hit.z !== c.z) {
        mismatch++;
        if (!sample) sample = `path=${shape([c])} pickAt=${hit ? shape([hit]) : 'null'}`;
      }
    }
  }

  check(`그래프가 보이는 칸 = pickAt (배치 40개, ${tested}칸)`, mismatch === 0,
    `${mismatch}건, 예: ${sample}`);
}

// --- 4. 판을 올려 가리면 길이 끊긴다 ----------------------------------------

{
  reset();
  const a = B.addPlate([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], 0);
  const b = B.addPlate([{ x: 6, y: 8 }, { x: 7, y: 8 }, { x: 8, y: 8 }], 0);

  const before = P.findPath(B.cellList(), cell(1, 3), cell(3, 3));
  check('가리기 전에는 길이 있다', before && before.length === 3, shape(before));

  B.movePlate(b, 5);                    // B 가 A 를 정확히 덮는다
  const after = P.findPath(B.cellList(), cell(1, 3), cell(3, 3));
  check('덮은 뒤에는 길이 끊긴다', after === null, shape(after));

  B.movePlate(b, -5);
  const back = P.findPath(B.cellList(), cell(1, 3), cell(3, 3));
  check('내리면 길이 돌아온다', back && back.length === 3, shape(back));
  void a;
}

// --- 5. 캐릭터를 덮는 높이 조절은 되돌린다 ----------------------------------
//
// 덮이면 캐릭터가 화면에서 사라진다. 그 상태를 알려 줄 문구가 이 게임에는 없다.

{
  reset();
  B.addPlate([{ x: 2, y: 3 }], 0);
  A.placeActor(2, 3);
  const b = B.addPlate([{ x: 7, y: 8 }], 0);

  const blocked = B.movePlate(b, 5);     // 화면 (2,3) — 캐릭터 자리
  check('캐릭터를 덮는 높이로는 안 올라감', blocked === false && b.z === 0, `z=${b.z}`);
  check('그 뒤에도 캐릭터는 보인다', B.actorVisible());

  const ok = B.movePlate(b, 4);          // 화면 (3,4) — 비켜간다
  check('덮지 않는 높이는 올라감', ok === true && b.z === 4, `z=${b.z}`);
  check('캐릭터는 여전히 보인다', B.actorVisible());
}

// --- 6. 성향 지표 — 6단계 디렉터의 입력 -------------------------------------

{
  reset();
  B.addPlate([{ x: 1, y: 3 }], 0);
  A.placeActor(1, 3);

  // 정직한 다리 두 칸
  B.beginStroke({ x: 2, y: 3 });
  B.extendStroke({ x: 3, y: 3 });
  B.commitStroke();
  check('잉크 사용량이 쌓인다', B.board.stats.inkSpent === 2 * INK_COST,
    `${B.board.stats.inkSpent}`);

  // 지웠다 다시 그리기 — 망설임 지표
  B.beginErase({ x: 3, y: 3 });
  B.commitErase();
  check('지운 직후에는 다시 그린 것이 없다', B.board.stats.redraws === 0);

  B.beginStroke({ x: 3, y: 3 });
  B.commitStroke();
  check('지웠던 자리에 다시 그리면 센다', B.board.stats.redraws === 1,
    `${B.board.stats.redraws}`);

  // 진짜 길만 걸었을 때
  A.walkTo(3, 3);
  A.updateActor(10);
  check('진짜 길을 세었다', B.board.stats.realSteps === 2 && B.board.stats.illusionSteps === 0,
    `진짜 ${B.board.stats.realSteps} / 착시 ${B.board.stats.illusionSteps}`);

  // 착시 길을 하나 놓고 건넌다. (8,7,z=4) 는 화면 (4,3) 으로 (3,3) 바로 옆이다.
  B.addPlate([{ x: 8, y: 7 }], 4);
  A.walkTo(8, 7);
  A.updateActor(10);
  check('착시 길을 세었다', B.board.stats.illusionSteps === 1,
    `진짜 ${B.board.stats.realSteps} / 착시 ${B.board.stats.illusionSteps}`);
}

// --- 7. 순수성은 유지되는가 -------------------------------------------------

{
  const cells = [cell(0, 0), cell(1, 0), cell(2, 0)];
  const before = JSON.stringify(cells);

  const a = P.visibleCells(cells);
  B.board.plates = [{ cells: [{ x: 5, y: 5 }], z: 7 }];
  const b = P.visibleCells(cells);

  check('visibleCells 가 board 를 안 읽는다', JSON.stringify(a) === JSON.stringify(b));
  check('입력을 변형하지 않는다', JSON.stringify(cells) === before);
}

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
