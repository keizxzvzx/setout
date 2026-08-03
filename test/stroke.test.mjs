import * as B from '../src/board.js';

const reset = () => { B.board.plates.length = 0; B.board.stroke.clear(); B.board.occupied.clear(); B.cancelStroke(); };
const cell = (x, y) => ({ x, y });
const shape = (p) => p.cells.map(c => `${c.x},${c.y}`).sort().join(' ');
let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// 1) 칸을 건너뛴 드래그를 격자 직선으로 메우는가
reset();
B.beginStroke(cell(3, 3));
B.extendStroke(cell(7, 3));           // 가로로 4칸 점프
check('가로 점프 보간', B.board.stroke.size === 5, `[${[...B.board.stroke].join(' ')}]`);

reset();
B.beginStroke(cell(0, 0));
B.extendStroke(cell(4, 4));           // 대각 점프
check('대각 점프 보간', B.board.stroke.size === 5, `[${[...B.board.stroke].join(' ')}]`);

// 2) 부지 밖으로 나갔다 돌아오면 이어서 그리되 다리는 놓지 않는가
reset();
B.beginStroke(cell(1, 1));
B.extendStroke(cell(2, 1));
B.extendStroke(null);                 // 밖으로 나감
B.extendStroke(cell(10, 10));         // 멀리서 다시 들어옴
check('밖을 지나온 구간은 안 이어짐', B.board.stroke.size === 3,
  `[${[...B.board.stroke].join(' ')}]`);
const parts = B.commitStroke();
check('끊긴 획은 판 2장', parts.length === 2,
  parts.map(shape).map(s => `{${s}}`).join(' '));

// 3) 대각선 획은 판 1장 (8-way 덩어리)
reset();
B.beginStroke(cell(0, 0));
B.extendStroke(cell(3, 3));
const diag = B.commitStroke();
check('대각선 획 = 판 1장', diag.length === 1, `cells=${diag[0].cells.length}`);

// 4) 이미 판이 깔린 칸은 다시 칠하지 않고, 그 자리에서 획이 갈라지는가
reset();
B.beginStroke(cell(5, 5));            // (5,5)~(5,5) 한 칸짜리 판
B.commitStroke();
B.beginStroke(cell(5, 3));
B.extendStroke(cell(5, 7));           // 기존 판을 관통하는 세로 획
const split = B.commitStroke();
check('점유 칸 건너뜀', !split.some(p => p.cells.some(c => c.x === 5 && c.y === 5)));
check('점유 칸에서 획이 갈라짐', split.length === 2,
  split.map(shape).map(s => `{${s}}`).join(' '));

// 5) 부지 밖 좌표는 아예 칠하지 않는가
reset();
B.beginStroke(cell(0, 0));
B.extendStroke(cell(-5, 0));          // 왼쪽 밖으로 직선
check('부지 밖은 안 칠함', [...B.board.stroke].every(k => {
  const c = B.parseKey(k);
  return B.inBounds(c.x, c.y);
}), `[${[...B.board.stroke].join(' ')}]`);

// 6) Esc 취소가 확정된 판을 건드리지 않는가
reset();
B.beginStroke(cell(1, 1));
B.extendStroke(cell(4, 1));
B.commitStroke();
B.beginStroke(cell(8, 8));
B.extendStroke(cell(9, 9));
B.cancelStroke();
check('취소는 확정 판을 안 건드림',
  B.board.plates.length === 1 && B.board.stroke.size === 0);

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
