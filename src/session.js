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
import { board, addPlate, resetBoard } from './board.js';
import { placeActor } from './actor.js';
import { refit } from './iso.js';
import { directFor, formatLog } from './director.js';

// 이번 판의 이력. 디렉터가 성향을 읽을 때 분모로 쓴다.
export const session = {
  stages: 0,     // 끝낸 층 수
  granted: 0,    // 지금까지 배급한 잉크의 합
  seed: 0,       // 층마다 하나씩. 같은 시드에 같은 층이 나온다
  last: null,    // 마지막 판단 기록
};

// 명세대로 층을 세운다. 1층이든 디렉터가 낸 층이든 같은 코드를 탄다.
export function buildStage(spec) {
  setStage(spec);
  resetBoard();

  // 시작 발판은 한 칸뿐이다. 판이 없으면 캐릭터가 설 자리가 없어서 하나는
  // 필요하지만, 넓게 깔면 그리기를 배우기 전에 걷기부터 하게 된다.
  addPlate([stage.start]);

  // 고정 구조물은 잉크를 쓰지 않고 미리 깔린다. 획으로 만든 판과 자료 구조가
  // 같으므로 지우기·높이 조절이 그대로 먹는다.
  for (const f of stage.fixtures) addPlate(f.cells, f.z);

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
