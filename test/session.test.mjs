// 층 전환 — 무엇을 남기고 무엇을 지우는가
//
// 조용히 깨지는 종류의 코드다. 지워야 할 것을 안 지우거나 남겨야 할 것을
// 지워도 화면에는 한참 뒤에야 증상이 나온다. 특히 stats 를 지우면 디렉터가
// 매 층 백지에서 읽게 되는데, 그래도 게임은 멀쩡히 돌아간다.

import * as C from '../src/config.js';
import { board, key, plateAt } from '../src/board.js';
import { stage } from '../src/stage.js';
import { fitView, worldToScreen, view } from '../src/iso.js';
import { actorCell } from '../src/actor.js';
import { verify, candidateCells } from '../src/director.js';
import { isIllusion } from '../src/path.js';
import { session, beginRun, nextStage, buildStage } from '../src/session.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// 브라우저가 하는 일. 이걸 안 하면 iso 가 기억할 창 크기가 없다.
fitView(1489, 863);

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
// 6. 다시 시작하면 백지인가
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
