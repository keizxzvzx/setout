import * as B from '../src/board.js';

const reset = () => { B.board.plates.length = 0; B.board.stroke.clear(); B.board.occupied.clear(); };
const cell = (x, y) => ({ x, y });
const shape = (p) => p.cells.map(c => `${c.x},${c.y}`).sort().join(' ');
const shapes = (ps) => ps.map(p => `{${shape(p)}}`).sort().join(' ');
let fail = 0;
const check = (name, cond, extra = '') => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

// 판을 하나 그려두는 도우미 (칸 목록을 직접 지정)
function drawCells(cells) {
  B.beginStroke(cells[0]);
  for (const c of cells.slice(1)) B.extendStroke(c);
  return B.commitStroke();
}

// 1) ㄷ자 판의 가운데를 지우면 판 둘로 갈라지는가
//    (2,0)(1,0)(0,0)(0,1)(0,2)(1,2)(2,2) — 세로로 열린 ㄷ자
reset();
B.beginStroke(cell(2, 0));
B.extendStroke(cell(0, 0));
B.extendStroke(cell(0, 2));
B.extendStroke(cell(2, 2));
check('ㄷ자 준비 = 판 1장', B.commitStroke().length === 1, shapes(B.board.plates));
B.beginErase(cell(0, 1));      // 등쪽 가운데 한 칸을 지움
B.commitErase();
check('ㄷ자 가운데를 지우면 판 2장', B.board.plates.length === 2, shapes(B.board.plates));

// 2) 판을 전부 지우면 판 목록에서 사라지는가
reset();
drawCells([cell(5, 5), cell(8, 5)]);
B.beginErase(cell(5, 5));
B.extendErase(cell(8, 5));
B.commitErase();
check('전부 지우면 판이 사라짐', B.board.plates.length === 0 && B.board.occupied.size === 0);

// 3) 지운 자리에 다시 그릴 수 있는가 (occupied 가 제대로 비워졌는가)
reset();
drawCells([cell(3, 3), cell(6, 3)]);
B.beginErase(cell(4, 3));
B.commitErase();
B.beginStroke(cell(4, 3));
const redraw = B.commitStroke();
check('지운 자리에 다시 그려짐', redraw.length === 1 && redraw[0].cells.length === 1,
  shapes(B.board.plates));

// 4) 빠른 지우개 드래그도 사이 칸을 메우는가
reset();
drawCells([cell(0, 7), cell(9, 7)]);   // 가로 10칸
B.beginErase(cell(2, 7));
B.extendErase(cell(7, 7));             // 6칸 점프
B.commitErase();
const left = B.board.plates.flatMap(p => p.cells).map(c => c.x).sort((a, b) => a - b);
check('지우개 드래그 보간', left.join(' ') === '0 1 8 9', `남은 x=[${left.join(' ')}]`);
check('지우고 남은 것이 판 2장', B.board.plates.length === 2, shapes(B.board.plates));

// 5) 빈 바닥을 문질러도 아무 일이 없는가
reset();
drawCells([cell(1, 1)]);
B.beginErase(cell(15, 15));
B.extendErase(cell(18, 18));
B.commitErase();
check('빈 바닥 지우기는 무해', B.board.plates.length === 1 && B.board.occupied.size === 1);

// 6) 부지 밖을 지나온 지우개는 그 구간을 지우지 않는가
reset();
drawCells([cell(0, 0), cell(0, 5)]);
B.beginErase(cell(0, 0));
B.extendErase(null);                   // 밖으로 나감
B.extendErase(cell(0, 5));             // 반대쪽 끝으로 다시 들어옴
B.commitErase();
const ys = B.board.plates.flatMap(p => p.cells).map(c => c.y).sort((a, b) => a - b);
check('밖을 지나온 구간은 안 지워짐', ys.join(' ') === '1 2 3 4', `남은 y=[${ys.join(' ')}]`);

// 7) 뜬 판을 지울 수 있고, z 가 재분해 후에도 보존되는가
//
// 지우개 인자는 "지울 칸" 이 아니라 "커서가 훑은 바닥칸" 이다.
// 판을 z 만큼 올리면 그 판은 화면에서 (x−z, y−z) 자리에 나타나므로,
// (4,8,z=3) 인 칸을 지우려면 바닥칸 (1,5) 를 문질러야 한다.
// 판 좌표를 그대로 넘기면 아무 일도 일어나지 않는 것이 정상이다.
reset();
B.beginStroke(cell(2, 8));
B.extendStroke(cell(6, 8));
B.commitStroke();
B.board.plates[0].z = 3;

B.beginErase(cell(4, 8));              // 판 좌표 — 그 자리에는 아무것도 안 보인다
B.commitErase();
check('뜬 판은 판 좌표로 지워지지 않음', B.board.plates.length === 1,
  B.board.plates.map(p => `{${shape(p)}}`).join(' '));

B.beginErase(cell(1, 5));              // 화면에 실제로 보이는 자리
B.commitErase();
check('뜬 판을 화면 자리로 지우면 갈라짐', B.board.plates.length === 2,
  shapes(B.board.plates));
check('재분해 후 z 보존', B.board.plates.every(p => p.z === 3),
  B.board.plates.map(p => `z=${p.z}`).join(' '));

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
