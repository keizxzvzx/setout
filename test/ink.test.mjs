import * as B from '../src/board.js';
import * as C from '../src/config.js';
import { stage } from '../src/stage.js';

// 배급량과 환급률은 층이 쥔다. 게임이 읽는 값과 검사가 읽는 값이 갈리면
// 층을 조인 뒤에도 검사만 옛 값으로 돌아 통과해 버린다.
const { INK_COST } = C;
const { inkMax: INK_MAX, refund: INK_REFUND } = stage;
const { GRID_H } = C;
const GRIDY_SAFE = GRID_H;
const reset = () => { B.board.plates.length = 0; B.board.stroke.clear(); B.board.occupied.clear(); B.board.ink = INK_MAX; B.cancelStroke(); };
const cell = (x, y) => ({ x, y });
let fail = 0;
const check = (name, cond, extra = '') => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

console.log(`설정: 총량 ${INK_MAX} (${INK_MAX / INK_COST}칸), 소모 ${INK_COST}, 환급 ${INK_REFUND}\n`);

// 1) 긋는 동안 board.ink 는 그대로, inkAvailable 만 줄어드는가
reset();
B.beginStroke(cell(0, 0));
B.extendStroke(cell(4, 0));                       // 5칸
check('긋는 중 확정 잉크는 그대로', B.board.ink === INK_MAX, `ink=${B.board.ink}`);
check('긋는 중 가용 잉크만 줄어듦', B.inkAvailable() === INK_MAX - 5 * INK_COST,
  `available=${B.inkAvailable()}`);
B.commitStroke();
check('확정 시 잉크가 깎임', B.board.ink === INK_MAX - 5 * INK_COST, `ink=${B.board.ink}`);

// 2) Esc 취소는 잉크를 건드리지 않는가
reset();
B.beginStroke(cell(0, 0));
B.extendStroke(cell(9, 0));                       // 10칸
B.cancelStroke();
check('취소는 잉크를 안 먹음', B.board.ink === INK_MAX && B.inkAvailable() === INK_MAX,
  `ink=${B.board.ink}`);

// 3) 잉크가 다하면 그 지점에서 획이 멈추는가
reset();
B.board.ink = 6;                                  // 3칸치
B.beginStroke(cell(0, 0));
B.extendStroke(cell(23, 0));                      // 24칸을 시도
check('잉크만큼만 그어짐', B.board.stroke.size === 3, `그어진 칸=${B.board.stroke.size}`);
B.commitStroke();
check('잉크를 정확히 다 씀', B.board.ink === 0, `ink=${B.board.ink}`);

// 4) 잉크 0에서는 한 칸도 안 그어지는가
B.beginStroke(cell(0, 5));
B.extendStroke(cell(3, 5));
check('잉크 0이면 못 그림', B.board.stroke.size === 0, `그어진 칸=${B.board.stroke.size}`);
B.commitStroke();

// 5) 지우면 절반만 돌아오는가
reset();
B.beginStroke(cell(0, 0));
B.extendStroke(cell(9, 0));                       // 10칸 = 20 소모
B.commitStroke();
const afterDraw = B.board.ink;
B.beginErase(cell(0, 0));
B.extendErase(cell(9, 0));                        // 10칸 전부 지움
B.commitErase();
check('절반 환급', B.board.ink === afterDraw + 10 * INK_REFUND,
  `${afterDraw} → ${B.board.ink} (총량 ${INK_MAX})`);
check('그렸다 지우면 순손실 발생', B.board.ink === INK_MAX - 10 * (INK_COST - INK_REFUND),
  `순손실 ${INK_MAX - B.board.ink}`);

// 6) 징검다리 이동이 얼마나 유리한가 — 10칸 다리를 앞으로 옮겨가며 전진
//    환급이 0보다 크면 칸당 실질 비용이 (소모 - 환급) 으로 떨어지므로
//    환급률로는 막을 수 없다. 실제 배수를 측정해 둔다.
reset();
let advanced = 0;
for (let round = 0; round < 100; round++) {
  const y = round % GRIDY_SAFE;
  B.beginStroke(cell(0, y));
  B.extendStroke(cell(9, y));
  if (B.board.stroke.size < 10) { B.cancelStroke(); break; }
  B.commitStroke();
  advanced += 10;
  B.beginErase(cell(0, y));
  B.extendErase(cell(9, y));
  B.commitErase();
}
const direct = INK_MAX / INK_COST;
check('징검다리가 직접 그리기보다 유리함 (환급률로 못 막음)', advanced > direct,
  `직접 ${direct}칸 vs 징검다리 ${advanced}칸 = ${(advanced / direct).toFixed(1)}배`);

// 7) 환급이 배급량을 넘지 않는가 (미리 깔린 판을 지워 잉크를 벌 수 없는가)
reset();
B.beginStroke(cell(2, 2));
B.extendStroke(cell(6, 2));
B.commitStroke();
B.board.ink = INK_MAX;                            // 디렉터가 공짜로 깔아준 상황을 가정
B.beginErase(cell(2, 2));
B.extendErase(cell(6, 2));
B.commitErase();
check('환급은 배급량을 못 넘음', B.board.ink === INK_MAX, `ink=${B.board.ink}`);

// 8) 같은 칸을 여러 번 지나도 한 번만 계산되는가
reset();
B.beginStroke(cell(3, 3));
B.extendStroke(cell(5, 3));
B.extendStroke(cell(3, 3));                       // 되돌아옴
B.extendStroke(cell(5, 3));                       // 다시 감
check('같은 칸 왕복은 한 번만 계산', B.board.stroke.size === 3,
  `칸=${B.board.stroke.size}, available=${B.inkAvailable()}`);

// 9) 이미 판이 깔린 칸을 덧그어도 잉크가 안 드는가
reset();
B.beginStroke(cell(1, 1));
B.extendStroke(cell(4, 1));
B.commitStroke();
const before = B.board.ink;
B.beginStroke(cell(1, 1));
B.extendStroke(cell(4, 1));                       // 같은 자리를 덧그음
B.commitStroke();
check('점유 칸 덧긋기는 공짜', B.board.ink === before, `${before} → ${B.board.ink}`);

// ---------------------------------------------------------------------------
// 게이지가 되받을 수 있는 잉크를 보여 주는가
//
// 이 묶음에서 제일 중요한 항목이다. 밟은 칸은 환급이 0 이라(2·4단계) 잘못 그은
// 다리를 걸어서 확인해 본 순간 되받을 잉크가 사라지는데, 잉크도 안 줄고 판도
// 그대로여서 **화면에서 아무 일도 일어나지 않았다.** 나중에 지웠을 때 게이지가
// 안 차는 것으로만 알 수 있고, 그때는 이미 층이 끝나 있다.
//
// 그래서 게이지에 겹을 하나 더 얹었다. 여기가 안 움직이면 그 신호가 없는 것이고,
// 없으면 도면 교체가 규칙이 아니라 고장으로 읽힌다.
{
  const A = await import('../src/actor.js');
  const { drawInkGauge } = await import('../src/render.js');
  const { fitView } = await import('../src/iso.js');
  const { buildStage } = await import('../src/session.js');

  fitView(1489, 863);

  // 채워진 가로 막대만 걷어 낸다. 게이지는 fillRect 로만 그린다.
  const bars = () => {
    const out = [];
    const ctx = {
      save: () => {}, restore: () => {},
      set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
      set globalAlpha(v) { out.alpha = v; },
      strokeRect: () => {},
      fillRect: (x, y, w) => out.push(Math.round(w * 10) / 10),
    };
    drawInkGauge(ctx, 1489, 863);
    return out;
  };

  buildStage({ start: { x: 3, y: 8 }, goal: { x: 12, y: 8 }, inkMax: 40, zMax: 8, fixtures: [] });

  const flat = bars();
  check('아무것도 안 그렸으면 되받을 것도 없다', flat[0] === flat[1],
        `${flat[0]} / ${flat[1]}`);

  // 다리를 넷 긋는다 — 아직 안 밟았으므로 전부 되받을 수 있다
  B.beginStroke(cell(4, 8));
  B.extendStroke(cell(7, 8));
  B.commitStroke();

  const drawn = bars();
  check('그은 만큼 게이지가 줄었다', drawn[1] < flat[1], `${flat[1]} → ${drawn[1]}`);
  check('되받을 수 있는 겹이 그 위에 남는다', drawn[0] > drawn[1],
        `바깥 ${drawn[0]} / 확정 ${drawn[1]}`);

  // 그 위를 걸어간다. 잉크는 한 방울도 안 줄어든다.
  const inkBefore = B.board.ink;
  A.walkTo(7, 8);
  A.updateActor(10);

  const walked = bars();
  check('걸어도 확정 잉크는 그대로', B.board.ink === inkBefore, `${B.board.ink}`);
  check('확정 겹도 그대로다', walked[1] === drawn[1], `${drawn[1]} → ${walked[1]}`);
  check('**바깥 겹만 짧아진다** — 이것이 없던 신호다', walked[0] < drawn[0],
        `${drawn[0]} → ${walked[0]}`);

  // 지워 보면 게이지가 말한 만큼만 돌아온다. 화면과 회계가 갈리면 안 된다.
  const recoverable = B.inkRecoverable();
  const before = B.board.ink;
  for (let x = 4; x <= 7; x++) B.beginErase(cell(x, 8));
  B.commitErase();
  check('게이지가 말한 만큼 실제로 돌아온다', B.board.ink === before + recoverable,
        `${before} + ${recoverable} → ${B.board.ink}`);

  B.board.actor = null;
}

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
