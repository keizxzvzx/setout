// 층 — 디렉터가 매 층 쥐는 손잡이
//
// 지금까지 손잡이는 config.js 의 상수였다. 그것으로 충분했던 것은 층이
// 하나뿐이었기 때문이다. 6단계 디렉터는 층마다 다른 값을 내야 하므로
// 상수를 층 파라미터로 옮긴다.
//
//   손잡이  inkMax / refund / zMax / start / goal / fixtures   층마다 다르다
//   파생    zTop                                              구조물에서 나온다
//   상수    INK_COST / INK_REFUND_STEPPED / Z_MIN              계산의 결론이다
//
// zMax 는 한동안 두 가지 일을 겸했다. 플레이어가 판을 올릴 수 있는 상한이면서,
// pickAt 이 후보를 훑는 범위이자 카메라가 위로 비울 여유이기도 했다. 층이
// 하나뿐이거나 구조물이 언제나 상한 아래에 있는 동안에는 둘이 같은 값이라
// 겸해도 표가 나지 않았다.
//
// 정직 층에 뜬 구조물을 하나 놓기로 하면서 둘이 갈렸다. 그 층은 상한이 0 이다 —
// 판을 못 올리면 맞출 정렬이 없고, 그것이 정직 층의 존재 이유다. 그런데 뜬
// 구조물은 0 위에 있어야 한다. 겸한 채로 두면 pickAt 이 0 까지만 훑어
// **화면에는 보이는데 집을 수 없는 판**이 된다 — 렌더·집기·솔버가 보는 것이
// 갈리는, 3·5단계에서 두 번 맞춰 둔 바로 그 자리다.
//
//   zMax   플레이어가 올릴 수 있는 상한        손잡이. 정직 층은 0
//   zTop   그 층에 실제로 존재하는 가장 높은 것  pickAt 과 카메라가 읽는다
//
// 아래 셋을 넘기지 않는 것은 인색해서가 아니라 값이 이미 정해져 있기 때문이다.
// INK_COST 는 잉크 경제의 정수 기반이라 흔들면 "소모 2 / 환급 1" 이 깨져
// 반올림 구멍이 생긴다. INK_REFUND_STEPPED 는 0 이어야만 한다는 것이 2·4단계에서
// 계산으로 나왔다 — 조금이라도 남으면 징검다리가 언제나 싸다. Z_MIN 은 음수 z 가
// 판을 격자선 아래로 내려보내 "바닥에 파묻힘" 을 되살린다. 셋 다 취향이 아니라
// 결론이므로 디렉터에게 쥐어 주면 스스로 게임을 깨뜨릴 수 있게 된다.
//
// 이 파일은 config.js 만 읽는다. board 를 읽으면 board → stage → board 로
// 순환하고, 무엇보다 디렉터가 아직 세우지도 않은 층을 값으로 다룰 수 없게 된다.
// path.js 를 순수하게 둔 것과 같은 규율이다.

import { INK_MAX, INK_REFUND, Z_MAX, START_CELL, GOAL_CELL } from './config.js';

// 층 하나의 명세. 디렉터가 만드는 것도 이 모양이고, 1층 고정값도 이 모양이다.
//
// 생략한 항목은 config.js 의 기본값으로 채운다. 디렉터는 손대는 손잡이만
// 적어 내면 되고, 새 손잡이가 늘어도 기존 층 명세가 깨지지 않는다.
export function makeStage(spec = {}) {
  // 미리 깔린 구조물 [{ cells: [{x,y}], z }]. 잉크를 쓰지 않는다.
  // 착시 이음매는 디렉터가 여기서 이미 맞는 높이로 놓아 준다 — 그래야
  // 솔버가 판 높이 조절을 탐색하지 않고도 "배급량 안에서 풀린다"를 보장한다.
  const fixtures = (spec.fixtures ?? []).map((f) => ({
    cells: f.cells.map((c) => ({ x: c.x, y: c.y })),
    z: f.z ?? 0,
  }));

  const zMax = spec.zMax ?? Z_MAX;

  return {
    inkMax: spec.inkMax ?? INK_MAX,
    refund: spec.refund ?? INK_REFUND,
    zMax,

    // 그 층에 실제로 존재하는 가장 높은 것. zMax 에서 파생된 값이지 손잡이가 아니다.
    zTop: fixtures.reduce((t, f) => Math.max(t, f.z), zMax),

    start: spec.start ? { ...spec.start } : { ...START_CELL },
    goal:  spec.goal  ? { ...spec.goal }  : { ...GOAL_CELL },

    fixtures,
  };
}

// 지금 서 있는 층. board·render·iso 가 상수 대신 이것을 읽는다.
//
// 객체를 통째로 갈아 끼우지 않고 제자리에서 덮어쓴다. 다른 모듈이 import 로
// 붙잡고 있는 참조가 그대로 살아 있어야 층이 바뀔 때 따라온다.
export const stage = makeStage();

export function setStage(spec) {
  Object.assign(stage, makeStage(spec));
  return stage;
}

// 판 위로 비워 둘 높이 여유 (칸).
//
// zTop 에서 파생시킨다. 따로 두면 상한을 올릴 때 판 머리가 조용히 잘리고,
// 잘린 것은 화면 밖이라 잘렸다는 것조차 보이지 않는다. 상수였을 때도 같은
// 이유로 Z_MAX 에서 파생시켰는데, 층마다 값이 달라지므로 이제 함수가 된다.
//
// zMax 가 아니라 zTop 인 것이 요점이다. 정직 층은 상한이 0 인데 그 위에 뜬
// 구조물이 있으므로, 상한으로 여유를 잡으면 그 판의 머리가 잘린다.
// 비워야 할 만큼은 플레이어가 올릴 수 있는 높이가 아니라 실제로 떠 있는 높이다.
//
// +1 은 판 두께(PLATE_T) 몫이다. BLOCK_H 가 32 이므로 7px 은 한 칸 안에 든다.
//
// 주의: 층이 바뀌어 zTop 이 달라지면 fitView 를 다시 불러야 한다.
// 부르지 않으면 이전 층의 여유로 그려 판 머리가 잘린다.
export const headroom = () => stage.zTop + 1;
