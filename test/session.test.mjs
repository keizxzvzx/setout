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
  isStuck, redealStage,
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

  // 프레임을 흘려보내며 밀려난 정도를 모은다
  const step = 1 / 60;
  const shifts = [];
  let swapAt = -1;
  let frames = 0;

  while (flip.on && frames < 600) {
    const s = updateFlip(step, { log: false });
    shifts.push(s);
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

  check('클리어한 층은 막혔다고 하지 않는다',
        (board.cleared = true, isStuck() === false));
  board.cleared = false;
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
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
