// 한 판 — 층에서 층으로
//
// 여기까지 만든 디렉터는 전부 게임 밖에 있었다. 순수 함수 더미이고, 실제
// 게임은 1층 고정 배치만 돌았다. 이 파일이 둘을 잇는다.
//
// 층을 세우는 일과 다음 층을 정하는 일을 main.js 에 두지 않은 이유는
// 브라우저 없이 돌려 볼 수 있어야 하기 때문이다. 층 전환은 조용히 깨지는
// 종류의 코드다 — 지워야 할 것을 안 지우거나 남겨야 할 것을 지워도
// 화면에는 한참 뒤에야 증상이 나온다.

import { stage, setStage } from './stage.js';
import { board, key, addPlate, resetBoard, cellList } from './board.js';
import { placeActor, actorCell } from './actor.js';
import { refit } from './iso.js';
import { minInk } from './solver.js';
import { directFor, formatLog } from './director.js';

// 이번 판의 이력. 디렉터가 성향을 읽을 때 분모로 쓴다.
export const session = {
  stages: 0,     // 끝낸 층 수
  granted: 0,    // 지금까지 배급한 잉크의 합
  seed: 0,       // 층마다 하나씩. 같은 시드에 같은 층이 나온다
  redeals: 0,    // 못 쓰게 되어 다시 뜬 도면 수
  last: null,    // 마지막 판단 기록
};

// 명세대로 층을 세운다. 1층이든 디렉터가 낸 층이든 같은 코드를 탄다.
export function buildStage(spec) {
  setStage(spec);
  resetBoard();

  // 시작 발판은 한 칸뿐이다. 판이 없으면 캐릭터가 설 자리가 없어서 하나는
  // 필요하지만, 넓게 깔면 그리기를 배우기 전에 걷기부터 하게 된다.
  addPlate([stage.start], 0, { fixed: true });

  // 고정 구조물은 잉크를 쓰지 않고 미리 깔린다. 그래서 지울 수도 없다 —
  // 낸 적이 없는 잉크를 돌려받을 수는 없고, 솔버가 이 지형을 근거로
  // "배급 안에서 풀린다" 를 보증했기 때문이다.
  for (const f of stage.fixtures) addPlate(f.cells, f.z, { fixed: true });

  placeActor(stage.start.x, stage.start.y);
  board.goal = { ...stage.goal };

  // 층마다 높이 상한이 다르다. 정직 층은 0 이고 착시 층은 8 이다.
  // 다시 안 잡으면 이전 층의 여유로 그려 올린 판의 머리가 잘리는데,
  // 잘린 것은 화면 밖이라 잘렸다는 것조차 보이지 않는다.
  refit();
}

// 판을 처음부터. 1층은 손으로 잡아 둔 고정 배치다.
//
// 성향 지표가 0 인 상태에서는 읽을 것이 없다. 디렉터는 플레이어를 읽고 그
// 사람이 피하는 것을 만드는데, 아무것도 읽지 않고 낸 층은 그냥 무작위 층이다.
export function beginRun() {
  session.stages = 0;
  session.seed = 0;
  session.redeals = 0;
  session.last = null;

  board.stats.inkSpent = 0;
  board.stats.redraws = 0;
  board.stats.illusionSteps = 0;
  board.stats.realSteps = 0;

  buildStage({});               // 명세를 비우면 config 의 1층 배치가 채워진다
  session.granted = stage.inkMax;
}

// 다음 층. 지금까지의 지표를 디렉터에게 넘긴다.
//
// 판단 기록은 콘솔에만 남긴다. 화면에 띄우면 플레이어가 자기가 읽히고 있다는
// 것을 알고 행동이 바뀌며, 그러면 읽은 성향이 성향이 아니게 된다.
export function nextStage({ log = true } = {}) {
  session.stages++;
  session.seed++;

  const result = directFor(
    board.stats,
    { granted: session.granted, stages: session.stages },
    session.seed,
  );

  session.last = result;
  if (log) for (const line of formatLog(result)) console.log(line);

  // 못 냈으면 같은 층을 다시 세운다. 조용히 멈추는 것보다는 낫고,
  // 왜 못 냈는지는 위에 남아 있다.
  buildStage(result.spec ?? { ...stage });
  session.granted += stage.inkMax;

  return result;
}

// --- 못 쓰게 된 도면 ---------------------------------------------------------
//
// 밟은 칸은 환급이 0 이다(2·4단계에서 징검다리를 막으려고 그렇게 정했다).
// 그래서 잘못된 다리를 걸어 본 만큼의 잉크는 영영 안 돌아온다. 배급 바닥에
// 여유를 얹어 두었지만 그것을 넘겨 헛디디면 층을 끝낼 방법이 사라진다.
//
// 그때 아무 일도 안 일어나는 것이 제일 나쁘다. 문구가 없는 게임이라 왜 막혔는지
// 알 방법이 없고, 처음 열어 본 사람에게는 그냥 고장으로 보인다.
//
// **잉크가 떨어진 것과 막힌 것은 다르다.** 이 함수가 지켜야 할 것이 그 줄이다.
//
// 목표를 향해 다리를 긋다 잉크가 바닥나는 것은 막힌 것이 아니다. 지우면
// 절반이 돌아오고, 그것으로 다시 그으면 된다. 실험할 여지를 남겨 두는 것이
// 잉크 경제의 뜻이었다(2단계). 그 사이에 도면을 걷어 가면 플레이어는 자기가
// 무엇을 잘못했는지도 모른 채 판을 뺏긴다.
//
// 그래서 판정을 **가장 너그러운 쪽**으로 잡는다. 지울 수 있는 것을 전부 지워
// 환급을 남김없이 되받았다고 치고, 그래도 최소 해법에 못 미칠 때만 막힌 것이다.
//
//   필요한 잉크 = 지금 판 위에서 잰 최소값
//                 칸을 지우면 그래프에서 빠지므로 이 값은 더 커질 수만 있다 —
//                 어떤 지우기 조합에서도 이보다 싸지지 않는 하한이다
//   가진 잉크   = 남은 잉크 + 되받을 수 있는 환급 전부
//                 실제로 이만큼 다 되받을 수는 없다 — 그리려면 몇 칸은 남겨
//                 두어야 하므로. 어떤 조합에서도 이보다 많아지지 않는 상한이다
//
// 하한이 상한을 넘으면 어떤 순서로 무엇을 지워도 안 된다. 한쪽으로만 틀리고,
// 그 방향이 "덜 막혔다고 본다" 쪽이라 멀쩡한 판을 뺏지 않는다.
//
// 늦게 도는 것은 문제가 아니다. 플레이어가 실제로 판을 다 지우고 나면 되받을
// 환급이 0 이 되어 그 자리에서 걸린다 — "다 지웠는데도 잉크가 모자라면 그때
// 다시 뜬다" 가 판정이 아니라 플레이어의 행동에서 나오는 셈이다.
//
// 되받을 수 있는 칸에서 두 가지를 뺀다.
//
//   고정 구조물   애초에 지울 수 없다(board.erase). 잉크를 낸 적이 없다
//   밟은 칸       한 방울도 안 돌아온다 (2·4단계)
//
// 구조물을 세던 것이 실제로 판정을 죽였던 자리가 있다. 남은 잉크 16 / 필요
// 18 / 세어 준 환급 6 이라 "안 막힘" 이 나왔는데, 그 6 은 전부 구조물이라
// 지울 수가 없었다. 구조물 6칸을 지우는 64가지를 전부 돌려 봐도 풀리는 경우가
// 없었고, 화면은 그대로 멈춰 있었다.
export function isStuck() {
  if (board.cleared || flip.on || !board.goal) return false;

  const from = actorCell();
  if (!from) return false;

  const cells = cellList();
  const need = minInk(cells, from, board.goal);
  if (!need) return true;               // 길 자체가 없다

  let refundable = 0;
  for (const c of cells) {
    if (c.fixed) continue;
    if (board.stepped.has(key(c.x, c.y))) continue;
    refundable += stage.refund;
  }

  return need.cost > board.ink + refundable;
}

// 같은 층을 다시 뜬다. 새로 만들지 않는다 — 플레이어가 풀려던 층이 이것이고,
// 실패했다고 다른 문제를 내밀면 방금까지 읽던 것이 무의미해진다.
export function redealStage({ log = true } = {}) {
  const spec = { ...stage };
  session.redeals++;

  if (log) {
    console.log(`디렉터 — 이 도면으로는 더 갈 수 없다. ` +
                `같은 층을 다시 뜬다 (배급 ${spec.inkMax}, ${session.redeals}번째).`);
  }

  buildStage(spec);

  // 다시 준 배급도 분모에 넣는다. 안 넣으면 두 번 쓴 잉크가 한 번 준 배급에
  // 나뉘어, 디렉터가 이 사람을 실제보다 훨씬 바짝 쓰는 사람으로 읽는다.
  session.granted += stage.inkMax;
}

// --- 층을 넘기는 동안 -------------------------------------------------------
//
// 도면을 넘긴다. 지금 장이 위로 빠지고 다음 장이 아래에서 올라온다.
//
// 바닥 격자는 움직이지 않는다. 매 층 똑같은 16×16 청사진이므로 제도판에
// 해당하고, 움직이는 것은 그 위에 그린 도면이다. 덕분에 두 층을 동시에
// 그릴 필요가 없다 — 한 장이 빠져나간 뒤 다음 장이 들어오는 사이에
// 빈 도면이 한 박자 보이는데, 그것이 글리치가 아니라 뜻이 된다.
//
// 이 게임에는 문구가 없다. 도면을 넘기는 동작 자체가 "이 장은 끝났다" 를
// 설명해야 하고, 판이 그냥 옅어지면 실패해서 되돌아간 것으로도 읽힌다.
export const FLIP_TIME = 0.4;   // 한 방향에 걸리는 시간 (초)

export const flip = { on: false, t: 0, swapped: false, redeal: false };

// redeal 이면 다음 층으로 가지 않고 같은 층을 다시 뜬다.
// 연출은 같다 — 도면이 못 쓰게 된 것이나 다 쓴 것이나 넘기는 동작은 하나다.
export function beginFlip({ redeal = false } = {}) {
  flip.on = true;
  flip.t = 0;
  flip.swapped = false;
  flip.redeal = redeal;
}

// 나가는 쪽은 붙어서 떠나고, 들어오는 쪽은 풀리며 자리를 잡는다.
// 양쪽에 같은 가감속을 걸면 한복판에서 두 번 멈칫하는 것처럼 보인다.
const easeIn = (u) => u * u;
const easeOut = (u) => u * (2 - u);

// dt 를 먹이고 도면이 밀려난 정도를 돌려준다. -1 이면 화면 위로 완전히,
// +1 이면 아래로 완전히 빠진 상태다. 넘기는 중이 아니면 0.
export function updateFlip(dt, opts = {}) {
  if (!flip.on) return 0;

  flip.t += dt / (FLIP_TIME * 2);

  if (flip.t >= 1) {
    flip.on = false;
    flip.t = 0;
    return 0;
  }

  // 한복판에서 층이 갈린다. 그때 화면에는 빈 도면만 있으므로 무엇이
  // 사라지고 무엇이 나타나는지 보이지 않는다.
  if (!flip.swapped && flip.t >= 0.5) {
    flip.swapped = true;
    if (flip.redeal) redealStage(opts);
    else nextStage(opts);
  }

  const u = flip.t < 0.5 ? flip.t * 2 : (flip.t - 0.5) * 2;
  return flip.t < 0.5 ? -easeIn(u) : 1 - easeOut(u);
}
