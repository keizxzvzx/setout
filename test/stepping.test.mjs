// 징검다리 이동 — 2단계에서 실측으로 드러난 구멍이 막혔는가
//
// 앞에 그리고 뒤를 지우며 전진하면 칸당 실질 비용이 (소모 − 환급) 으로
// 떨어진다. 2단계에서 재 보니 직접 60칸 대 징검다리 110칸으로 1.8배 유리했고,
// 환급률을 어떻게 잡아도 막히지 않는다는 것이 계산으로 나왔다.
//
//   직접 그리기  2N
//   징검다리     2N − R(N−k)        R = 밟은 칸 환급률
//   징검다리가 싸지 않으려면 R(N−k) ≤ 0, 즉 R ≤ 0
//
// 그래서 4단계에서 "캐릭터가 밟은 칸은 환급하지 않는다" 로 막았다.
// 여기서는 그 전략을 실제 게임 함수로 그대로 돌려 본다. 산수로 확인하면
// 산수가 맞는지만 알 수 있고, 코드가 그 산수대로 도는지는 알 수 없다.

import * as B from '../src/board.js';
import * as A from '../src/actor.js';
import * as C from '../src/config.js';

const { INK_MAX, INK_COST, INK_REFUND, INK_REFUND_STEPPED, GRID_W, GRID_H } = C;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// 한 줄짜리 복도. 일직선은 16칸에서 끝나 60칸을 재 볼 수가 없으므로 접는다.
//
// 짝수 줄만 쓰고 홀수 줄에는 연결 칸 하나만 둔다. 뱀처럼 빽빽하게 접으면
// 위아래 줄이 서로 붙어, 경로상 멀리 떨어진 칸끼리도 사방 인접이 되어 버린다.
// 그러면 BFS 가 복도를 따라가지 않고 질러가고, 질러간 만큼 밟지 않은 칸이
// 생겨 환급을 받는다. 측정하려는 것은 징검다리 전략이지 지름길이 아니다.
//
//   y=0  ■■■■■■■■■■■■■■■■
//   y=1                 ■     ← 연결 칸 하나
//   y=2  ■■■■■■■■■■■■■■■■
//   y=3  ■
//
// 이렇게 두면 경로에서 이웃한 칸만 서로 인접이고 지름길이 존재하지 않는다.
function corridor() {
  const out = [];
  for (let y = 0; y < GRID_H; y += 2) {
    const back = (y / 2) % 2 === 1;
    for (let i = 0; i < GRID_W; i++) out.push({ x: back ? GRID_W - 1 - i : i, y });
    if (y + 2 < GRID_H) out.push({ x: back ? 0 : GRID_W - 1, y: y + 1 });
  }
  return out;
}

const PATH = corridor();

// 측정의 전제 — 복도에 지름길이 없어야 한다.
{
  const idx = new Map(PATH.map((c, i) => [c.x + ',' + c.y, i]));
  let chords = 0;
  for (const [k, i] of idx) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = idx.get((x + dx) + ',' + (y + dy));
      if (j !== undefined && Math.abs(j - i) !== 1) chords++;
    }
  }
  check(`복도 ${PATH.length}칸에 지름길 없음`, chords === 0, `${chords}건`);
}

function reset() {
  B.board.plates = [];
  B.board.stroke.clear();
  B.board.occupied.clear();
  B.board.stepped.clear();
  B.board.ink = INK_MAX;
  B.board.actor = null;
  B.board.goal = null;
  B.board.cleared = false;
  B.cancelStroke();
}

function drawCell(c) {
  B.beginStroke(c);
  const ok = B.board.stroke.size === 1;
  if (ok) B.commitStroke();
  else B.cancelStroke();
  return ok;
}

function eraseCell(c) {
  B.beginErase(c);
  B.commitErase();
}

// 큰 dt 한 번이면 경로가 끝까지 진행된다.
function walk(c) {
  if (!A.walkTo(c.x, c.y)) return false;
  A.updateActor(10);
  return !B.board.actor.path;
}

// --- 직접 그리기 ------------------------------------------------------------
// 다리를 쭉 깔고 끝까지 걸어간다. 지우지 않는다.
function direct() {
  reset();
  B.addPlate([PATH[0]]);          // 시작 발판은 공짜
  A.placeActor(PATH[0].x, PATH[0].y);

  let i = 1;
  while (i < PATH.length && drawCell(PATH[i])) i++;

  const end = PATH[i - 1];
  walk(end);
  return i - 1;                   // 도달한 경로 인덱스
}

// --- 징검다리 ---------------------------------------------------------------
// 앞으로 몇 칸만 깔고, 걸어간 뒤, 지나온 것을 지워 잉크를 회수한다.
//
// keepStepped 를 끄면 밟은 기록이 남지 않아 모든 칸이 환급을 받는다.
// 즉 4단계 이전의 동작이다. 같은 코드로 전후를 비교하기 위한 스위치다.
function stepping(keepStepped, window = 10) {
  reset();
  B.addPlate([PATH[0]]);
  A.placeActor(PATH[0].x, PATH[0].y);

  let head = 1;    // 다음에 그릴 인덱스
  let at = 0;      // 캐릭터가 선 인덱스

  for (let guard = 0; guard < 2000; guard++) {
    let grew = false;
    while (head < PATH.length && head - at <= window) {
      if (!drawCell(PATH[head])) break;
      head++;
      grew = true;
    }

    const target = head - 1;
    if (target <= at) break;              // 더 나아갈 수 없다
    if (!walk(PATH[target])) break;
    at = target;

    if (!keepStepped) B.board.stepped.clear();

    // 지나온 자리를 걷어 잉크를 회수한다. 서 있는 칸은 지워지지 않는다.
    for (let i = 0; i < at; i++) {
      if (B.board.occupied.has(B.key(PATH[i].x, PATH[i].y))) eraseCell(PATH[i]);
    }

    if (at >= PATH.length - 1) break;
    if (!grew) break;
  }

  return at;
}

// --- 측정 -------------------------------------------------------------------

console.log(`설정: 총량 ${INK_MAX} (${INK_MAX / INK_COST}칸), 소모 ${INK_COST}, ` +
            `환급 ${INK_REFUND}, 밟은 칸 환급 ${INK_REFUND_STEPPED}\n`);

const d = direct();
const before = stepping(false);   // 밟은 기록 없음 = 4단계 이전
const after = stepping(true);     // 밟은 칸은 환급 없음 = 지금

console.log(`  직접 그리기            ${d}칸`);
console.log(`  징검다리 (환급 있음)   ${before}칸   ← 2단계에서 실측된 구멍`);
console.log(`  징검다리 (환급 없음)   ${after}칸   ← 지금\n`);

check('직접 그리기가 배급량대로 60칸', d === INK_MAX / INK_COST, `${d}칸`);
check('막기 전에는 징검다리가 실제로 유리했다', before > d, `${before} vs ${d}`);
check('지금은 징검다리가 더 멀리 못 간다', after <= d, `${after} vs ${d}`);

// --- 회수 자체는 막지 않았는가 ----------------------------------------------
//
// 징검다리를 막으면서 지우기 자체를 봉쇄하면 실수 한 번이 스테이지를 막는다.
// 밟지 않은 칸은 여전히 전액 환급을 받아야 한다.

{
  reset();
  B.addPlate([{ x: 0, y: 0 }]);
  A.placeActor(0, 0);

  // 걷지 않은 다리를 다섯 칸 그렸다가 지운다
  for (let x = 1; x <= 5; x++) drawCell({ x, y: 0 });
  const spent = INK_MAX - B.board.ink;
  for (let x = 1; x <= 5; x++) eraseCell({ x, y: 0 });
  const back = B.board.ink - (INK_MAX - spent);

  check('밟지 않은 칸은 절반 환급 그대로', back === 5 * INK_REFUND,
    `${spent} 쓰고 ${back} 회수`);
}

{
  reset();
  B.addPlate([{ x: 0, y: 0 }]);
  A.placeActor(0, 0);

  for (let x = 1; x <= 5; x++) drawCell({ x, y: 0 });
  walk({ x: 5, y: 0 });
  const held = B.board.ink;

  // 서 있는 (5,0) 을 뺀 나머지 밟은 칸을 지운다
  for (let x = 1; x <= 4; x++) eraseCell({ x, y: 0 });

  check('밟은 칸은 한 방울도 안 돌아옴', B.board.ink === held,
    `${held} → ${B.board.ink}`);
}

// --- 발밑은 지워지지 않는가 -------------------------------------------------

{
  reset();
  B.addPlate([{ x: 0, y: 0 }]);
  A.placeActor(0, 0);

  eraseCell({ x: 0, y: 0 });
  check('서 있는 칸은 지워지지 않음',
    B.board.occupied.has(B.key(0, 0)) && !!A.actorCell());
}

// --- 캐릭터를 태운 채 판을 올릴 수 있는가 -----------------------------------

{
  reset();
  const p = B.addPlate([{ x: 4, y: 4 }]);
  A.placeActor(4, 4);

  B.movePlate(p, 5);
  const c = A.actorCell();
  check('밟고 선 판을 올리면 캐릭터도 같이 올라감', c && c.z === 5,
    c ? `z=${c.z}` : 'null');
}

// --- 도착 판정 --------------------------------------------------------------

{
  reset();
  B.addPlate([{ x: 0, y: 0 }]);
  A.placeActor(0, 0);
  B.board.goal = { x: 3, y: 0 };

  for (let x = 1; x <= 3; x++) drawCell({ x, y: 0 });
  check('목표에 닿기 전에는 클리어가 아님', !B.board.cleared);

  walk({ x: 3, y: 0 });
  check('목표 칸에 서면 클리어', B.board.cleared);
}

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
