// 층 파라미터 — 손잡이를 돌리면 게임이 정말 따라오는가
//
// 1번 커밋의 전부가 이것이다. 상수를 stage 로 옮긴 것 자체는 화면에 아무
// 변화도 없고, 옮겼는데 아무도 안 읽으면 조용히 옛 상수대로 돈다.
// 3단계에서 occupied 가 "쓰기만 하고 읽지 않는 상태" 였던 것과 같은 종류의
// 사고이며, 그때도 증상은 없었다.
//
// 그래서 여기서는 손잡이를 실제로 돌려 놓고 게임 함수를 부른다.

import * as B from '../src/board.js';
import * as C from '../src/config.js';
import { stage, setStage, makeStage, headroom } from '../src/stage.js';
import { fitView, view, worldToScreen } from '../src/iso.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const reset = () => {
  B.board.plates.length = 0;
  B.board.stroke.clear();
  B.board.occupied.clear();
  B.board.stepped.clear();
  B.board.erased.clear();
  B.board.actor = null;
  B.board.ink = stage.inkMax;
  B.cancelStroke();
};

// ---------------------------------------------------------------------------
// 1. 기본값 — 1층은 지금까지와 똑같이 돈다
//
// 손잡이를 옮기면서 기본 동작이 달라지면 리팩터링이 아니라 변경이다.
// ---------------------------------------------------------------------------
{
  const s = makeStage();
  check('기본 배급량이 config 와 같다', s.inkMax === C.INK_MAX, `${s.inkMax}`);
  check('기본 환급률이 config 와 같다', s.refund === C.INK_REFUND, `${s.refund}`);
  check('기본 상한이 config 와 같다', s.zMax === C.Z_MAX, `${s.zMax}`);
  check('기본 시작점이 1층 배치와 같다',
        s.start.x === C.START_CELL.x && s.start.y === C.START_CELL.y);
  check('기본 목표가 1층 배치와 같다',
        s.goal.x === C.GOAL_CELL.x && s.goal.y === C.GOAL_CELL.y);
  check('고정 구조물은 기본이 없음', s.fixtures.length === 0);

  // 명세를 넘겨 준 쪽이 나중에 그것을 고쳐도 층이 흔들리면 안 된다.
  const spec = { start: { x: 1, y: 1 }, fixtures: [{ cells: [{ x: 9, y: 9 }], z: 3 }] };
  const t = makeStage(spec);
  spec.start.x = 99;
  spec.fixtures[0].cells[0].x = 99;
  spec.fixtures[0].z = 99;
  check('명세를 복사해 들고 있다',
        t.start.x === 1 && t.fixtures[0].cells[0].x === 9 && t.fixtures[0].z === 3,
        `start=${t.start.x} cell=${t.fixtures[0].cells[0].x} z=${t.fixtures[0].z}`);

  const u = makeStage({ zMax: 3 });
  check('적어 내지 않은 손잡이는 기본값으로 채워진다',
        u.zMax === 3 && u.inkMax === C.INK_MAX && u.refund === C.INK_REFUND);
}

// ---------------------------------------------------------------------------
// 2. 층을 갈아 끼워도 다른 모듈이 붙잡은 참조가 살아 있는가
//
// 이것이 어긋나면 board 는 영원히 1층을 본다. 새 객체를 만들어 export 를
// 바꿔 치울 수 없으므로(import 는 이미 끝났다) 제자리에서 덮어쓴다.
// ---------------------------------------------------------------------------
{
  const held = stage;                     // 다른 모듈이 import 로 붙잡은 것과 같은 참조
  setStage({ inkMax: 40, zMax: 3, refund: 0 });

  check('setStage 가 같은 객체를 갱신한다', held === stage);
  check('붙잡은 참조로도 새 값이 보인다',
        held.inkMax === 40 && held.zMax === 3 && held.refund === 0,
        `ink=${held.inkMax} zMax=${held.zMax} refund=${held.refund}`);
}

// ---------------------------------------------------------------------------
// 3. 높이 상한 — pickAt 과 movePlate 가 층을 읽는가
// ---------------------------------------------------------------------------
{
  setStage({ zMax: 3 });
  reset();

  const p = B.addPlate([{ x: 5, y: 5 }], 5);   // 상한(3)보다 높이 놓아 둔 판

  check('상한 위의 판은 집히지 않는다', B.pickAt(0, 0) === null,
        `pickAt(0,0)=${JSON.stringify(B.pickAt(0, 0))}`);

  setStage({ zMax: 8 });
  const hit = B.pickAt(0, 0);
  check('상한을 올리면 같은 판이 집힌다',
        !!hit && hit.x === 5 && hit.y === 5 && hit.z === 5,
        hit ? `(${hit.x},${hit.y},z=${hit.z})` : 'null');

  // 올리기는 층의 상한에서 멈춘다
  setStage({ zMax: 3 });
  reset();
  const q = B.addPlate([{ x: 2, y: 2 }], 0);
  for (let i = 0; i < 20; i++) B.movePlate(q, 1);
  check('상한 3 에서 멈춘다', q.z === 3, `z=${q.z}`);
  check('상한에서 더 올리면 변화 없음', B.movePlate(q, 1) === false);

  setStage({ zMax: 8 });
  for (let i = 0; i < 20; i++) B.movePlate(q, 1);
  check('상한을 8 로 올리면 거기까지 올라간다', q.z === 8, `z=${q.z}`);

  for (let i = 0; i < 20; i++) B.movePlate(q, -1);
  check('하한은 층과 무관하게 0', q.z === C.Z_MIN, `z=${q.z}`);
}

// ---------------------------------------------------------------------------
// 4. 카메라 여유가 상한을 따라오는가
//
// 3단계 주석이 경고한 바로 그 사고다. 상한과 여유를 따로 두면 상한을 올린
// 층에서 판 머리가 조용히 잘리고, 잘린 것은 화면 밖이라 보이지도 않는다.
// ---------------------------------------------------------------------------
{
  for (const z of [0, 2, 4, 8]) {
    setStage({ zMax: z });
    check(`여유가 상한 ${z} 에 붙어 있다`, headroom() === z + 1, `headroom=${headroom()}`);
  }

  const WINDOWS = [[1489, 863], [1366, 768], [1920, 1080], [900, 600]];

  for (const z of [2, 5, 8]) {
    setStage({ zMax: z });

    for (const [w, h] of WINDOWS) {
      fitView(w, h);

      // 가장 높이 솟는 것은 화면상 가장 위인 (0,0) 칸을 상한까지 올린 경우
      const t = C.PLATE_T * view.scale;
      const head = worldToScreen(0, 0, z).y - t;

      check(`zMax=${z} ${w}×${h} — 판 머리 ${head.toFixed(1)}px`, head >= 0);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. 잉크 — 배급량과 환급률이 층을 읽는가
//
// 밟은 칸 환급 0 만은 층이 못 건드린다. 조금이라도 남으면 징검다리가 언제나
// 싸다는 것이 2·4단계에서 계산으로 나왔기 때문이다.
// ---------------------------------------------------------------------------
{
  setStage({ zMax: 8, inkMax: 40, refund: 1 });
  reset();
  check('배급량이 층을 따라온다', B.board.ink === 40, `ink=${B.board.ink}`);

  // 환급률 1 — 지우면 절반이 돌아온다
  B.beginStroke({ x: 4, y: 4 });
  B.extendStroke({ x: 8, y: 4 });
  B.commitStroke();
  const afterDraw = B.board.ink;

  B.beginErase({ x: 4, y: 4 });
  B.extendErase({ x: 8, y: 4 });
  B.commitErase();
  check('환급률 1 이면 칸당 1 씩 돌아온다', B.board.ink === afterDraw + 5 * 1,
        `${afterDraw} → ${B.board.ink}`);

  // 환급률 0 인 층 — 같은 조작이 한 방울도 안 돌려준다
  setStage({ zMax: 8, inkMax: 40, refund: 0 });
  reset();
  B.beginStroke({ x: 4, y: 4 });
  B.extendStroke({ x: 8, y: 4 });
  B.commitStroke();
  const afterDraw0 = B.board.ink;

  B.beginErase({ x: 4, y: 4 });
  B.extendErase({ x: 8, y: 4 });
  B.commitErase();
  check('환급률 0 인 층은 돌려주지 않는다', B.board.ink === afterDraw0,
        `${afterDraw0} → ${B.board.ink}`);

  // 환급은 그 층의 배급량을 넘지 못한다.
  // 디렉터가 공짜로 깔아 준 고정 구조물을 지워 잉크를 벌어들이는 길을 막는다.
  setStage({ zMax: 8, inkMax: 40, refund: 1 });
  reset();
  B.addPlate([{ x: 10, y: 10 }, { x: 11, y: 10 }], 0);
  B.board.ink = 40;
  B.beginErase({ x: 10, y: 10 });
  B.extendErase({ x: 11, y: 10 });
  B.commitErase();
  check('환급은 그 층의 배급량을 못 넘는다', B.board.ink === 40, `ink=${B.board.ink}`);

  // 밟은 칸은 층과 무관하게 0
  setStage({ zMax: 8, inkMax: 120, refund: 1 });
  reset();
  B.addPlate([{ x: 6, y: 6 }], 0);
  B.board.stepped.add(B.key(6, 6));
  B.board.ink = 10;
  B.beginErase({ x: 6, y: 6 });
  B.commitErase();
  check('밟은 칸은 어느 층에서도 환급 없음', B.board.ink === 10, `ink=${B.board.ink}`);
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
