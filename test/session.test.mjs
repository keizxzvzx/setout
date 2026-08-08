// 층 전환 — 무엇을 남기고 무엇을 지우는가
//
// 조용히 깨지는 종류의 코드다. 지워야 할 것을 안 지우거나 남겨야 할 것을
// 지워도 화면에는 한참 뒤에야 증상이 나온다. 특히 stats 를 지우면 디렉터가
// 매 층 백지에서 읽게 되는데, 그래도 게임은 멀쩡히 돌아간다.

import * as C from '../src/config.js';
import * as Board from '../src/board.js';
import { board, key, plateAt } from '../src/board.js';
import { stage } from '../src/stage.js';
import { fitView, worldToScreen, view } from '../src/iso.js';
import { actorCell } from '../src/actor.js';
import { verify, candidateCells } from '../src/director.js';
import { isIllusion } from '../src/path.js';
import {
  session, beginRun, nextStage, buildStage, beginFlip, updateFlip, flip, FLIP_TIME,
  isStuck, stuckReason, redealStage,
} from '../src/session.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// 브라우저가 하는 일. 이걸 안 하면 iso 가 기억할 창 크기가 없다.
fitView(1489, 863);

// 획 하나를 긋는다
const B_draw = (cells) => {
  Board.beginStroke(cells[0]);
  for (const c of cells.slice(1)) Board.extendStroke(c);
  return Board.commitStroke();
};

// ---------------------------------------------------------------------------
// 1. 판을 시작한다 — 1층은 손으로 잡아 둔 고정 배치
// ---------------------------------------------------------------------------
{
  beginRun();

  check('1층은 config 의 고정 배치',
        stage.start.x === C.START_CELL.x && stage.goal.y === C.GOAL_CELL.y,
        `(${stage.start.x},${stage.start.y}) → (${stage.goal.x},${stage.goal.y})`);
  check('1층 배급은 기본값', stage.inkMax === C.INK_MAX, `${stage.inkMax}`);
  check('시작 발판이 한 칸 놓였다', board.plates.length === 1);
  check('캐릭터가 시작점에 섰다',
        board.actor.x === stage.start.x && board.actor.y === stage.start.y);
  check('잉크가 찼다', board.ink === stage.inkMax, `${board.ink}`);
  check('배급 이력이 1층 몫으로 잡혔다', session.granted === stage.inkMax,
        `${session.granted}`);
  check('아직 끝낸 층이 없다', session.stages === 0);
}

// ---------------------------------------------------------------------------
// 2. 넘어갈 때 무엇이 남는가
// ---------------------------------------------------------------------------
{
  // 1층을 치른 흔적을 만든다
  board.stats.inkSpent = 84;
  board.stats.redraws = 3;
  board.stats.illusionSteps = 2;
  board.stats.realSteps = 21;
  board.stepped.add(key(3, 3));
  board.erased.add(key(9, 9));
  board.cleared = true;

  const before = { ...board.stats };
  const firstGoal = { ...board.goal };

  const r = nextStage({ log: false });

  check('디렉터가 층을 냈다', r.ok, r.reason);
  check('지표는 살아남는다',
        board.stats.inkSpent === before.inkSpent
        && board.stats.redraws === before.redraws
        && board.stats.illusionSteps === before.illusionSteps
        && board.stats.realSteps === before.realSteps,
        `잉크 ${board.stats.inkSpent} / 다시그림 ${board.stats.redraws}`);

  check('밟은 자국은 지운다', board.stepped.size === 1
        && board.stepped.has(key(stage.start.x, stage.start.y)),
        `${board.stepped.size}칸 — 새 시작점만`);
  check('지운 자국은 지운다', board.erased.size === 0);
  check('클리어 표시가 내려간다', board.cleared === false);
  check('긋던 획이 없다', board.stroke.size === 0);

  check('목표가 새 자리로 간다',
        board.goal.x !== firstGoal.x || board.goal.y !== firstGoal.y,
        `(${firstGoal.x},${firstGoal.y}) → (${board.goal.x},${board.goal.y})`);
  check('잉크가 새 층의 배급으로 찬다', board.ink === stage.inkMax, `${board.ink}`);
  check('배급 이력이 누적된다', session.granted === C.INK_MAX + stage.inkMax,
        `${session.granted}`);
  check('끝낸 층이 하나로 센다', session.stages === 1);
}

// ---------------------------------------------------------------------------
// 3. 이전 층의 판이 남지 않는가
//
// occupied 에 옛 기둥이 남으면 새 층에서 아무 이유 없이 못 그리는 칸이 생긴다.
// 화면에는 아무것도 없는데 선이 안 그어진다 — 설명할 방법이 없는 증상이다.
// ---------------------------------------------------------------------------
{
  const cells = [];
  for (const p of board.plates) for (const c of p.cells) cells.push(key(c.x, c.y));

  const held = [...board.occupied];
  const missing = held.filter((k) => !cells.includes(k));
  const extra = cells.filter((k) => !held.includes(k));

  check('기둥과 판이 정확히 맞는다', missing.length === 0 && extra.length === 0,
        `유령 ${missing.length} / 누락 ${extra.length}`);

  const expected = 1 + stage.fixtures.reduce((n, f) => n + f.cells.length, 0);
  check('놓인 판이 명세와 같다', cells.length === expected,
        `${cells.length} / ${expected}`);
  check('캐릭터가 딛고 선 판이 있다', !!plateAt(board.actor.x, board.actor.y));
  check('캐릭터 높이를 끌어올 수 있다', actorCell() !== null);
}

// ---------------------------------------------------------------------------
// 4. 높이 상한이 바뀌어도 판 머리가 안 잘리는가
//
// 3단계에 적어 둔 사고를 층마다 다시 만들지 않기 위한 검사다.
// 정직 층은 상한이 0 이고 착시 층은 8 이다. 다시 안 잡으면 이전 층의 여유로
// 그리고, 잘린 것은 화면 밖이라 잘렸다는 것조차 보이지 않는다.
// ---------------------------------------------------------------------------
{
  let clipped = 0;
  const seen = new Set();

  for (const zMax of [0, 1, 4, 8]) {
    buildStage({ zMax, start: { x: 2, y: 2 }, goal: { x: 10, y: 10 }, inkMax: 60 });
    seen.add(zMax);

    const t = C.PLATE_T * view.scale;
    const head = worldToScreen(0, 0, zMax).y - t;
    if (head < 0) clipped++;
  }

  check(`층마다 상한이 달라도 머리가 안 잘린다 (${[...seen].join(', ')})`,
        clipped === 0, `${clipped}건`);

  // 창이 바뀐 적이 없는데 배율이 달라졌다면 상한을 따라 다시 잡은 것이다
  buildStage({ zMax: 0, start: { x: 2, y: 2 }, goal: { x: 10, y: 10 }, inkMax: 60 });
  const flat = view.scale;
  buildStage({ zMax: 8, start: { x: 2, y: 2 }, goal: { x: 10, y: 10 }, inkMax: 60 });
  const tall = view.scale;

  check('상한이 낮은 층은 화면을 더 크게 쓴다', flat > tall,
        `zMax 0 → ${flat.toFixed(3)} / zMax 8 → ${tall.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 5. 여러 층을 이어서 — 실제로 풀면서 넘어간다
//
// 층을 세우는 것과 그 층이 풀리는 것은 별개다. 넘어가는 길에 board 가
// 어긋나면 두세 층 뒤에 "왜 못 그리지" 로 나타난다.
// ---------------------------------------------------------------------------
{
  beginRun();

  const trail = [];
  let broken = 0;

  for (let n = 0; n < 8; n++) {
    // 지금 층을 최소 해법대로 푼 것으로 친다
    const cells = candidateCells({
      start: board.goal ? { x: board.actor.x, y: board.actor.y } : stage.start,
      fixtures: stage.fixtures,
    });
    const v = verify(
      { intent: 'open', start: { x: board.actor.x, y: board.actor.y },
        goal: board.goal, zMax: stage.zMax, fixtures: stage.fixtures },
      stage.inkMax,
    );

    if (!v.illusion) { broken++; break; }

    const p = v.illusion;
    board.stats.inkSpent += p.cost;
    for (let i = 1; i < p.path.length; i++) {
      if (isIllusion(p.path[i - 1], p.path[i])) board.stats.illusionSteps++;
      else board.stats.realSteps++;
    }
    board.cleared = true;

    const r = nextStage({ log: false });
    if (!r.ok) broken++;

    trail.push({ intent: r.intent, ink: stage.inkMax, zMax: stage.zMax });

    // 새 층이 성립하는지 매번 확인한다
    if (board.ink !== stage.inkMax) broken++;
    if (!plateAt(board.actor.x, board.actor.y)) broken++;
    if (board.cleared) broken++;
    if (cells.length < 1) broken++;
  }

  check('여덟 층을 이어서 넘어간다', trail.length === 8 && broken === 0,
        `${trail.length}층 / 어긋남 ${broken}`);
  check('층마다 배급이 다시 잡힌다', new Set(trail.map((t) => t.ink)).size > 1,
        trail.map((t) => t.ink).join(' '));
  check('지표가 층을 넘어 쌓인다', board.stats.inkSpent > 0 && session.stages === 8,
        `잉크 ${board.stats.inkSpent} / ${session.stages}층`);
  check('배급 이력도 쌓인다', session.granted > C.INK_MAX, `${session.granted}`);

  console.log(`\n      낸 층: ${trail.map((t) => t.intent).join(' → ')}`);
  console.log(`      배급  : ${trail.map((t) => t.ink).join(' ')}\n`);
}

// ---------------------------------------------------------------------------
// 6. 도면을 넘긴다
//
// 지금 장이 위로 빠지고 다음 장이 아래에서 올라온다. 바닥 격자는 안 움직인다 —
// 매 층 똑같은 청사진이라 제도판에 해당하고, 넘어가는 것은 그 위에 그린
// 도면이다. 덕분에 두 층을 동시에 그릴 필요가 없다.
// ---------------------------------------------------------------------------
{
  beginRun();
  const goalBefore = { ...board.goal };
  const stageBefore = session.stages;

  check('평소에는 밀려나 있지 않다', updateFlip(0.1, { log: false }) === 0);
  check('넘기는 중이 아니다', flip.on === false);

  beginFlip();
  check('넘기기 시작한다', flip.on === true && flip.t === 0);

  // 프레임을 흘려보내며 밀려난 정도와, 그 프레임에 표제란이 보일 번호를 모은다
  const step = 1 / 60;
  const shifts = [];
  const sheets = [];
  let swapAt = -1;
  let frames = 0;

  while (flip.on && frames < 600) {
    const s = updateFlip(step, { log: false });
    shifts.push(s);
    sheets.push(session.stages + 1);     // main.js 가 drawSheetNo 에 넘기는 값
    if (swapAt < 0 && flip.swapped) swapAt = frames;
    frames++;
  }

  const secs = frames * step;
  check('두 방향을 합쳐 정해진 시간에 끝난다',
        Math.abs(secs - FLIP_TIME * 2) < 0.05, `${secs.toFixed(2)}초`);
  check('끝나면 제자리로 돌아온다', flip.on === false && updateFlip(step) === 0);

  const out = shifts.slice(0, swapAt);
  const back = shifts.slice(swapAt);

  check('앞부분은 위로 빠진다', out.every((s) => s <= 0) && Math.min(...out) < -0.9,
        `최대 ${Math.min(...out).toFixed(2)}`);
  check('뒷부분은 아래에서 올라온다', back.every((s) => s >= 0) && Math.max(...back) > 0.9,
        `최대 ${Math.max(...back).toFixed(2)}`);
  check('한 방향으로만 간다 — 도로 돌아오지 않는다',
        out.every((s, i) => i === 0 || s <= out[i - 1])
        && back.every((s, i) => i === 0 || s <= back[i - 1]));

  // 층이 갈리는 순간 화면에는 빈 도면만 있어야 한다.
  // 그래야 무엇이 사라지고 무엇이 나타나는지 보이지 않는다.
  check('한복판에서 층이 갈린다', Math.abs(swapAt / frames - 0.5) < 0.05,
        `${(swapAt / frames * 100).toFixed(0)}% 지점`);
  check('갈리는 순간 도면은 화면 밖에 있다', Math.abs(shifts[swapAt - 1]) > 0.95,
        `${shifts[swapAt - 1].toFixed(2)}`);

  check('층이 실제로 넘어갔다', session.stages === stageBefore + 1
        && (board.goal.x !== goalBefore.x || board.goal.y !== goalBefore.y),
        `(${goalBefore.x},${goalBefore.y}) → (${board.goal.x},${board.goal.y})`);
  check('넘긴 뒤에는 클리어가 내려가 있다', board.cleared === false);

  // 우상단 표제란이 읽는 값이 이것이다. 도면이 갈리는 그 프레임에서 넘어가야
  // 숫자가 튀는 순간 화면에 빈 도면만 있다. 한 프레임이라도 이르거나 늦으면
  // 판이 남아 있는 채로 번호가 바뀐다.
  check('층 번호도 갈리는 그 프레임에서 넘어간다',
        sheets[swapAt - 1] === stageBefore + 1 && sheets[swapAt] === stageBefore + 2,
        `${sheets[swapAt - 1]} → ${sheets[swapAt]}`);
}

// ---------------------------------------------------------------------------
// 7. 못 쓰게 된 도면을 다시 뜬다
//
// 밟은 칸은 환급이 0 이라 잘못 걸어 본 만큼의 잉크는 영영 안 돌아온다.
// 여유를 넘겨 헛디디면 층을 끝낼 방법이 사라지는데, 그때 아무 일도 안
// 일어나는 것이 제일 나쁘다 — 문구가 없는 게임이라 그냥 고장으로 보인다.
// ---------------------------------------------------------------------------
{
  beginRun();

  check('막 시작한 층은 막히지 않았다', isStuck() === false);

  // 잉크를 다 태우고 아무 데도 못 가게 만든다
  board.ink = 0;
  check('잉크가 없고 길도 없으면 막힌 것', isStuck() === true, `잉크 ${board.ink}`);

  // 지워서 되받을 수 있는 잉크가 있으면 아직 막힌 것이 아니다.
  // 판정은 한쪽으로만 틀려야 한다 — 멀쩡한 층을 막혔다고 하면 안 된다.
  //
  // 목표는 두 칸 앞(4 필요), 엉뚱한 데 여섯 칸을 그어 두었다(6 회수 가능).
  // 잉크를 다 태워도 그 여섯 칸을 지우면 닿는다.
  buildStage({ start: { x: 3, y: 3 }, goal: { x: 3, y: 5 }, inkMax: 20, zMax: 8 });

  const spur = [];
  for (let y = 10; y <= 15; y++) spur.push({ x: 10, y });
  B_draw(spur);
  board.ink = 0;   // 그은 **뒤에** 태운다

  check('되받을 잉크가 남아 있으면 막힌 것이 아니다', isStuck() === false,
        `밟지 않은 칸 ${spur.length}개, 필요 4`);

  // 밟아 버리면 그 잉크는 안 돌아온다
  for (const c of spur) board.stepped.add(key(c.x, c.y));
  check('밟은 칸뿐이면 막힌 것', isStuck() === true);

  // 원인이 갈린다. 리셋 예고가 이유를 말하는 유일한 자리라(render),
  // 잉크가 모자란 것을 길이 없다고 적으면 그 자리가 거짓말을 한다.
  check('원인은 잉크다 — 길은 있는데 되받을 것이 없다',
        stuckReason() === 'OUT_OF_INK', `${stuckReason()}`);

  check('클리어한 층은 막혔다고 하지 않는다',
        (board.cleared = true, isStuck() === false));
  board.cleared = false;

  // 길 자체가 없는 것은 다른 원인이다. 목표의 화면 자리를 뜬판이 덮으면
  // 그리기는 언제나 z=0 이라(1단계) 도착할 방법 자체가 사라진다.
  // (7,5) 를 z=2 로 띄우면 화면에서 (5,3) — 목표 자리에 선다.
  buildStage({
    start: { x: 3, y: 3 }, goal: { x: 5, y: 3 }, inkMax: 20, zMax: 8,
    fixtures: [{ cells: [{ x: 7, y: 5 }], z: 2 }],
  });
  check('목표가 덮이면 길 자체가 없는 것',
        stuckReason() === 'NO_ROUTE', `${stuckReason()}`);
  check('막힌 것이기도 하다 — 원인만 다르다', isStuck() === true);
  check('안 막힌 판에는 원인이 없다',
        (buildStage({ start: { x: 3, y: 3 }, goal: { x: 5, y: 3 }, inkMax: 20, zMax: 8 }),
         stuckReason() === null), `${stuckReason()}`);
}

// ---------------------------------------------------------------------------
// 8. 다시 뜬 도면은 같은 층인가
//
// 새로 만들지 않는다. 플레이어가 풀려던 층이 이것이고, 실패했다고 다른 문제를
// 내밀면 방금까지 읽던 것이 무의미해진다.
// ---------------------------------------------------------------------------
{
  beginRun();
  board.cleared = true;
  const r = nextStage({ log: false });

  const spec = {
    inkMax: stage.inkMax, zMax: stage.zMax,
    start: { ...stage.start }, goal: { ...stage.goal },
    cells: stage.fixtures.reduce((n, f) => n + f.cells.length, 0),
  };
  const stagesBefore = session.stages;
  const grantedBefore = session.granted;

  // 헛디뎌서 못 쓰게 만든다
  board.ink = 0;
  board.stats.inkSpent += 40;
  const statsBefore = { ...board.stats };

  redealStage({ log: false });

  check('같은 배급·같은 상한', stage.inkMax === spec.inkMax && stage.zMax === spec.zMax,
        `${stage.inkMax} / ${stage.zMax}`);
  check('같은 시작·같은 목표',
        stage.start.x === spec.start.x && stage.start.y === spec.start.y
        && stage.goal.x === spec.goal.x && stage.goal.y === spec.goal.y);
  check('같은 구조물',
        stage.fixtures.reduce((n, f) => n + f.cells.length, 0) === spec.cells);
  check('잉크가 다시 찬다', board.ink === stage.inkMax, `${board.ink}`);
  check('층 수는 안 올라간다 — 넘어간 것이 아니다', session.stages === stagesBefore);
  check('다시 뜬 횟수가 센다', session.redeals === 1);

  // 두 번 쓴 잉크가 한 번 준 배급에 나뉘면, 디렉터가 이 사람을 실제보다
  // 훨씬 바짝 쓰는 사람으로 읽는다.
  check('다시 준 배급도 분모에 들어간다',
        session.granted === grantedBefore + stage.inkMax,
        `${grantedBefore} → ${session.granted}`);
  check('지표는 그대로 남는다', board.stats.inkSpent === statsBefore.inkSpent);
  check('다시 뜬 층은 막히지 않았다', isStuck() === false);
}

// ---------------------------------------------------------------------------
// 9. 넘기기 연출은 하나를 같이 쓴다
// ---------------------------------------------------------------------------
{
  beginRun();
  const stagesBefore = session.stages;

  beginFlip({ redeal: true });
  check('다시 뜨는 넘기기로 표시된다', flip.redeal === true);

  let n = 0;
  while (flip.on && n < 600) { updateFlip(1 / 60, { log: false }); n++; }

  check('연출은 같은 시간이 걸린다', Math.abs(n / 60 - FLIP_TIME * 2) < 0.05,
        `${(n / 60).toFixed(2)}초`);
  check('다시 뜨는 넘기기는 층을 안 올린다', session.stages === stagesBefore,
        `${session.stages}`);
  check('1층 그대로다', stage.start.x === C.START_CELL.x);

  beginFlip();
  check('그냥 넘기기는 표시가 없다', flip.redeal === false);
  n = 0;
  while (flip.on && n < 600) { updateFlip(1 / 60, { log: false }); n++; }
  check('그때는 층이 올라간다', session.stages === stagesBefore + 1);
}

// ---------------------------------------------------------------------------
// 10. 다시 시작하면 백지인가
// ---------------------------------------------------------------------------
{
  beginRun();

  check('지표가 비워진다',
        board.stats.inkSpent === 0 && board.stats.redraws === 0
        && board.stats.illusionSteps === 0 && board.stats.realSteps === 0);
  check('이력이 비워진다', session.stages === 0 && session.seed === 0);
  check('1층으로 돌아온다',
        stage.start.x === C.START_CELL.x && stage.inkMax === C.INK_MAX);
}

// ---------------------------------------------------------------------------
// 11. 미리 깔린 판은 지울 수 없다
//
// 잉크를 낸 적이 없는 판이다. 돌려줄 것이 없다.
//
// board.erase 의 Math.min(inkMax, ...) 만으로는 못 막혔다. 상한은 배급을 넘지
// 못하게 할 뿐이라, 한 번이라도 잉크를 쓰고 나면 구조물을 지우는 것이 언제나
// 벌이가 된다. 실측한 자리는 구조물 6칸에서 잉크 16 → 22 였다.
//
// 잉크만의 문제도 아니다. 솔버가 "배급 안에서 풀린다" 를 보증한 근거가 이
// 지형인데, 그것을 공짜로 걷어내면 판정이 보증한 층과 실제로 푸는 층이 갈린다.
// ---------------------------------------------------------------------------
{
  buildStage({
    start: { x: 3, y: 3 }, goal: { x: 12, y: 10 }, inkMax: 40, zMax: 8,
    fixtures: [{ cells: [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 10, y: 8 }], z: 3 }],
  });

  // 잉크를 좀 써 둔다. 가득 차 있으면 상한에 걸려 구멍이 안 보인다.
  B_draw([{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }]);

  const cellsBefore = Board.cellList().length;
  const inkBefore = board.ink;

  // 구조물의 화면 자리는 (8−3, 8−3) 부터. 커서는 화면 자리로 훑는다.
  Board.beginErase({ x: 5, y: 5 });
  Board.extendErase({ x: 6, y: 5 });
  Board.extendErase({ x: 7, y: 5 });
  Board.commitErase();

  check('고정 구조물은 한 칸도 안 지워진다',
        Board.cellList().length === cellsBefore, `${Board.cellList().length}/${cellsBefore}`);
  check('그래서 잉크도 안 돌아온다', board.ink === inkBefore, `${board.ink}/${inkBefore}`);

  // 시작 발판도 같다 — 역시 잉크를 낸 적이 없다.
  // 캐릭터가 비켜서야 "밟고 선 칸" 규칙과 헷갈리지 않는다.
  board.actor = { x: 3, y: 6, path: null };
  Board.beginErase({ x: 3, y: 3 });
  Board.commitErase();
  check('시작 발판도 안 지워진다', !!plateAt(3, 3));
  check('그래도 잉크는 그대로', board.ink === inkBefore, `${board.ink}`);

  // 내가 그은 판은 그대로 지워져야 한다. 막다가 같이 막으면 게임이 죽는다.
  Board.beginErase({ x: 3, y: 4 });
  Board.commitErase();
  check('내가 그은 판은 지워진다', !plateAt(3, 4));
  check('그건 환급도 된다', board.ink === inkBefore + stage.refund, `${board.ink}`);
}

// ---------------------------------------------------------------------------
// 12. 잉크가 떨어진 것과 막힌 것은 다르다
//
// 목표를 향해 다리를 긋다 잉크가 바닥나는 것은 막힌 것이 아니다. 지우면
// 절반이 돌아오고 그것으로 다시 그으면 된다 — 실험할 여지를 남겨 두는 것이
// 잉크 경제의 뜻이었다. 그 사이에 도면을 걷어 가면 플레이어는 자기가 무엇을
// 잘못했는지도 모른 채 판을 뺏긴다.
//
// 한때 이 판정이 "최소 해법이 딛고 가는 칸" 을 환급에서 뺐다. 그런데 목표로
// 긋다 잉크가 떨어지면 방금 그린 칸이 **전부 그 경로 위**라 되받을 것이 0 이
// 되고, 지우기를 해 볼 새도 없이 다시 떴다.
// ---------------------------------------------------------------------------
{
  // (가) 긋다가 잉크를 다 써도 막힌 것이 아니다.
  //      배급 20(10칸) 중 10칸을 쓰되 절반을 엉뚱한 데 썼다. 곁가지를 지우면
  //      목표까지 갈 잉크가 나온다.
  buildStage({ start: { x: 3, y: 3 }, goal: { x: 3, y: 9 }, inkMax: 20, zMax: 8 });
  B_draw([{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }]);
  B_draw([{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 },
          { x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }]);

  check('잉크를 다 썼다', board.ink === 0, `${board.ink}`);
  check('그래도 막힌 것이 아니다 — 지우면 되돌릴 수 있다', isStuck() === false);

  // (나) 실제로 다 지우고 나서야 막힌 것이 된다.
  //      판정이 "다 지웠는지" 를 세는 것이 아니라, 지우고 나면 되받을 환급이
  //      0 이 되어 저절로 걸린다.
  for (const c of Board.cellList()) {
    if (c.fixed) continue;
    Board.beginErase({ x: c.x, y: c.y });
    Board.commitErase();
  }
  const mine = Board.cellList().filter((c) => !c.fixed).length;
  check('내가 그은 판이 하나도 안 남았다', mine === 0, `${mine}칸`);
  check('되받은 잉크는 절반뿐이다', board.ink === 10, `${board.ink}`);
  check('그때는 막힌 것 — 6칸(12) 이 필요한데 10 뿐이다', isStuck() === true);

  // (다) 고정 구조물은 지울 수 없으므로 환급으로 못 센다.
  //      목표까지 3칸(6) 이 필요한데 잉크는 4 다. 구조물 3칸을 세면 4+3=7 이라
  //      "안 막혔다" 가 되지만, 그 3칸은 애초에 지울 수가 없다.
  buildStage({
    start: { x: 3, y: 3 }, goal: { x: 3, y: 6 }, inkMax: 20, zMax: 8,
    fixtures: [{ cells: [{ x: 12, y: 12 }, { x: 13, y: 12 }, { x: 14, y: 12 }], z: 4 }],
  });
  board.ink = 4;
  check('구조물 환급은 세지 않는다 — 막힌 것으로 본다', isStuck() === true,
        `잉크 ${board.ink}, 필요 6, 구조물 3칸`);
}

// ---------------------------------------------------------------------------
// 13. 층을 넘길 때 손에 든 것을 놓는다
//
// pointerdown 은 flip.on 으로 막고 있었지만, **넘기기 직전에 이미 시작된**
// 제스처는 손이 아직 붙어 있어 move / up 으로 계속 들어온다. 그대로 두면
// 이전 층에 대고 긋던 획이 새 층에 확정된다 — 실측하니 새 층 배급 22 중 8을
// 먹었고, 지우개 쪽은 새 층의 고정 구조물을 지웠다.
//
// 도착하고 0.8초 뒤에 넘어가므로 손이 붙어 있는 것은 드문 일이 아니다.
// ---------------------------------------------------------------------------
{
  globalThis.window = { addEventListener: () => {} };
  const { pointer, attachPointer, abortGesture, resyncPointer } =
    await import('../src/input.js');

  const L = {};
  attachPointer({
    addEventListener: (t, fn) => { L[t] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  });

  // 격자 칸의 화면 좌표. 바닥 평면 기준이면 뜬 판도 pickAt 이 알아서 찾는다.
  const at = (gx, gy) => {
    const p = worldToScreen(gx + 0.5, gy + 0.5, 0);
    return { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 };
  };
  const runFlip = () => { let n = 0; while (flip.on && n < 600) { updateFlip(1 / 60, { log: false }); n++; } };

  // --- 긋던 획 ---
  beginRun();
  L.pointerdown(at(8, 8));
  L.pointermove(at(9, 8));
  check('획을 긋는 중이다', pointer.mode === 'draw' && board.stroke.size === 2,
        `${pointer.mode} / ${board.stroke.size}`);

  abortGesture();                     // main.js 가 beginFlip 직전에 하는 일
  check('제스처를 놓았다', pointer.mode === null);
  check('긋던 획은 버린다 — 어느 층 것인지 정해지지 않았다', board.stroke.size === 0);

  beginFlip();
  runFlip();

  const cellsAfter = Board.cellList().length;
  const inkAfter = board.ink;

  // 손은 아직 붙어 있다
  L.pointermove(at(10, 8));
  L.pointermove(at(11, 8));
  L.pointerup(at(11, 8));

  check('이전 층에서 시작한 획이 새 층에 안 그어진다',
        Board.cellList().length === cellsAfter && board.ink === inkAfter,
        `칸 ${Board.cellList().length}/${cellsAfter}, 잉크 ${board.ink}/${inkAfter}`);

  // --- 지우던 손 ---
  buildStage({
    start: { x: 3, y: 3 }, goal: { x: 12, y: 10 }, inkMax: 40, zMax: 8,
    fixtures: [{ cells: [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 10, y: 8 }], z: 3 }],
  });
  L.pointerdown({ ...at(15, 15), button: 2 });
  check('지우는 중이다', pointer.mode === 'erase');

  abortGesture();
  beginFlip();
  runFlip();

  const fixCells = Board.cellList().length;
  L.pointermove({ ...at(5, 5), button: 2 });
  L.pointermove({ ...at(6, 5), button: 2 });
  L.pointerup({ ...at(6, 5), button: 2 });
  check('지우던 손이 새 층을 갉지 않는다', Board.cellList().length === fixCells,
        `${Board.cellList().length}/${fixCells}`);

  // --- 사라진 판의 하이라이트 ---
  //
  // pointer.hit 은 판 칸을 통째로 들고 있어서, 층이 바뀌면 이미 없어진 판을
  // 가리킨 채 남는다. 하이라이트가 그것을 **옛 z 로** 그리므로 새 층의 허공에
  // 앰버 마름모가 뜨고, 목표 표식과 구분되지 않는다.
  buildStage({
    start: { x: 3, y: 3 }, goal: { x: 12, y: 10 }, inkMax: 40, zMax: 8,
    fixtures: [{ cells: [{ x: 9, y: 9 }], z: 5 }],      // 화면 자리 (4,4)
  });
  L.pointermove(at(4, 4));
  check('올려 둔 판을 집었다', !!pointer.hit && pointer.hit.z === 5,
        pointer.hit ? `z=${pointer.hit.z}` : 'null');

  const ghost = pointer.hit.plate;
  beginFlip();
  runFlip();
  resyncPointer();                    // main.js 가 넘기기가 끝날 때 하는 일

  check('없어진 판을 계속 가리키지 않는다',
        !pointer.hit || board.plates.includes(pointer.hit.plate),
        pointer.hit ? `z=${pointer.hit.z}` : 'null');
  check('그 판은 실제로 없어졌다', !board.plates.includes(ghost));
  check('커서가 가리키던 자리는 그대로다', pointer.at.x === 4 && pointer.at.y === 4,
        `${pointer.at.x},${pointer.at.y}`);

  // 새 층에 그 자리에 판이 있으면 다시 집어야 한다 — 그냥 비우기만 하면
  // 커서를 흔들기 전까지 하이라이트가 없다.
  buildStage({
    start: { x: 3, y: 3 }, goal: { x: 12, y: 10 }, inkMax: 40, zMax: 8,
    fixtures: [{ cells: [{ x: 7, y: 7 }], z: 3 }],      // 역시 화면 자리 (4,4)
  });
  resyncPointer();
  check('새 층에 판이 있으면 다시 집는다', !!pointer.hit && pointer.hit.z === 3,
        pointer.hit ? `z=${pointer.hit.z}` : 'null');
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
