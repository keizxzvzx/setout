// 성향 — 플레이어를 읽는다
//
// AI 는 레벨을 만들지 않는다. 플레이어를 읽고, 그 사람이 피하는 것을 만든다.
// 그 "읽는" 쪽이 이 파일이고, "만드는" 쪽이 director.js 다.
//
// 5단계에서 지표를 쌓아 두었지만 게임 안에는 아무 표시도 하지 않는다.
// 알려 주는 순간 플레이어가 자기가 읽히고 있다는 것을 알고 행동이 바뀌며,
// 그러면 읽은 성향이 성향이 아니게 된다.
//
// board 도 stage 도 읽지 않는다. 숫자만 받아 숫자를 낸다.

import { INK_COST, Z_MAX } from './config.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 한 층을 착시로 풀면 이음매를 두 번 건넌다 — 올라탈 때와 내릴 때.
// 그래서 층당 2회를 "착시를 온전히 쓴 것" 으로 놓고 잰다.
const ILLUSION_PER_STAGE = 2;

// 그린 칸의 30% 를 다시 그리면 완전히 망설이는 것으로 본다.
const HESITATION_FULL = 0.3;

// 세 층을 보면 읽은 것을 그대로 믿는다. 한 층만 보고 극단으로 읽지 않는다.
const CONFIDENCE_STAGES = 3;

// 지표를 0~1 로 편다.
//
//   stats     board.stats — 층을 넘어 누적된다
//   granted   지금까지 배급한 잉크의 합. 얼마나 바짝 쓰는가의 분모다
//   stages    지금까지 끝낸 층 수
export function profileOf(stats, context = {}) {
  const { granted = 0, stages = 0 } = context;

  const cells = stats.inkSpent / INK_COST;
  const steps = stats.illusionSteps + stats.realSteps;

  return {
    stages,

    // 배급을 얼마나 바짝 쓰는가. 1 이면 준 만큼 다 썼다.
    pressure: granted > 0 ? clamp01(stats.inkSpent / granted) : 0,

    // 착시를 얼마나 쓰는가. 층당 건넌 횟수로 잰다.
    //
    // 걸음 수 대비 비율로 재지 않는다. 착시로 푼 층에서도 이음매는 두어 번만
    // 건너고 나머지는 전부 진짜 길이라, 비율로는 착시를 온전히 쓴 사람도
    // 10% 대에 머문다. 문턱을 잡을 수가 없다.
    illusion: stages > 0
      ? clamp01(stats.illusionSteps / (stages * ILLUSION_PER_STAGE))
      : 0,

    // 그린 칸 대비 지웠다 다시 그린 칸.
    hesitation: cells > 0
      ? clamp01((stats.redraws / cells) / HESITATION_FULL)
      : 0,

    // 몇 층을 보고 하는 말인가. 맞서는 세기를 여기에 곱한다.
    confidence: clamp01(stages / CONFIDENCE_STAGES),

    // 기록용 원값
    raw: { ...stats, granted, steps },
  };
}

// --- 맞서는 규칙 -----------------------------------------------------------
//
// 확실할 때만 맞서고, 애매하면 물어본다.
//
// 맞서는 층은 그 자체로는 성향을 읽을 수 없다. 착시 강제 층에서는 누구나
// 이음매를 건너고(강제니까), 정직 층에서는 상한이 0 이라 아무도 못 건넌다.
// 디렉터가 만든 층이 다음 판단의 입력이 되는 셈이라, 맞서는 층만 내면
// 4층째부터는 성향이 무엇이든 같은 순서가 나온다. 가상 플레이어로 12층을
// 돌려 확인한 것이다 — 읽었다고 한 것이 사실은 자기가 직전에 낸 층이었다.
//
// 그래서 문턱 사이는 "하던 것을 유지" 가 아니라 **읽는 층**이다. 둘 다 갈 수
// 있는데 착시가 싼 층을 내고, 싼 길을 골랐는지 비싼 길을 골랐는지를 본다.
// 여기서 나온 선택만이 디렉터가 만들지 않은 정보다.
const SWITCH_TO_HONEST = 0.7;
const SWITCH_TO_ILLUSION = 0.3;

// --- 익히는 판 -------------------------------------------------------------
//
// 구조물을 얼마나 얹을 것인가는 **몇 장째인가**가 정한다. 성향이 아니다.
//
// 지금까지는 아무도 이것을 쥐고 있지 않아서 복잡도가 의도에 딸려 왔다.
// 실측하면 이렇게 나왔다.
//
//   illusion / open   구조물 1개 / 5~7칸
//   honest            구조물 6~7개 / 23~30칸
//
// 착시파로 읽히면 두 장째부터 여섯 개짜리 빽빽한 판을 받고, 다리파로 읽히면
// 여섯 장째까지 구조물이 하나뿐이었다. **익히는 판은 누가 플레이하든 익히는
// 판이어야 하고**, 다 자란 판도 마찬가지다. 시트 번호가 눌러야 그것이 성립한다.
//
// stages 는 끝낸 층 수라 시트 번호보다 하나 작다. stages 1 이 시트 2 다.
const LEARNING_STAGES = 1;

// 0 이 익히는 판, 1 이 다 자란 판. 사이 단계를 두지 않는 것은 시트 3부터
// 바로 다 자란 판을 보고 싶다는 요구가 있었기 때문이다 — 완만하게 올리면
// 그 판이 다섯 장째에나 온다.
export const depthOf = (stages) => (stages <= LEARNING_STAGES ? 0 : 1);

export function briefFor(profile, opts = {}) {
  const { zMax = Z_MAX } = opts;

  const depth = depthOf(profile.stages);

  if (!profile.stages) {
    return {
      brief: { intent: 'open', zMax, depth },
      slack: 0.5,
      note: '아직 읽을 것이 없다. 둘 다 갈 수 있는 층을 내고 무엇을 고르는지 본다.',
    };
  }

  // 착시만 노리는 사람 → 정렬이 불가능한 지형
  // 늘 다리로 밀어붙이는 사람 → 그리기로는 못 가는 지형
  // 아직 모르겠는 사람       → 고르게 하고 본다
  let intent;
  if (profile.illusion >= SWITCH_TO_HONEST) intent = 'honest';
  else if (profile.illusion <= SWITCH_TO_ILLUSION) intent = 'illusion';
  else intent = 'open';

  // 배급을 창의 어디에 놓을 것인가. 0 이 바닥(조임), 1 이 천장(여유).
  //
  // 바짝 쓰는 사람과 망설이는 사람에게 여유를 줄인다. 망설임에 맞서는 방법을
  // 배급으로 정한 것은 계획 단계의 결정이다 — 환급률을 낮추는 안도 있었지만
  // 망설이는 사람에게 가장 가혹한 손잡이라 층을 못 풀고 막힐 위험이 있었다.
  //
  // 확신도를 곱한다. 한 층만 보고 바닥까지 조이면 운 나쁜 한 판에 과잉
  // 반응하게 된다.
  // 둘을 평균 내지 않는다. 평균으로 잡으면 배급을 98% 쓴 사람이 망설이지
  // 않는다는 이유로 0.49 가 되어 중립으로 읽힌다 — 강한 신호가 약한 신호에
  // 희석된다. 어느 한쪽만으로도 조일 이유는 충분하다.
  const squeeze = Math.max(profile.pressure, profile.hesitation);
  const slack = clamp01(0.5 + profile.confidence * (0.5 - squeeze));

  const pct = (v) => Math.round(v * 100);

  const crossed = (profile.illusion * ILLUSION_PER_STAGE).toFixed(1);

  const why = {
    honest: `층당 착시를 ${crossed}번 건넜다. 맞출 정렬이 없는 층을 낸다.`,
    illusion: `층당 착시를 ${crossed}번밖에 안 건넜다. 그리기만으로는 못 가는 층을 낸다.`,
    open: `층당 착시가 ${crossed}번이라 어느 쪽인지 모르겠다. ` +
          '둘 다 갈 수 있는 층을 내고 무엇을 고르는지 본다.',
  }[intent];

  const how = squeeze > 0.5
    ? `배급의 ${pct(profile.pressure)}% 를 쓰고 망설임이 ${pct(profile.hesitation)}% 다. 여유를 줄인다.`
    : `배급의 ${pct(profile.pressure)}% 를 썼다. 여유는 남겨 둔다.`;

  return {
    brief: { intent, zMax, depth },
    slack,
    note: `${profile.stages}층째 — ${why} ${how}` +
          (depth ? '' : ' 아직 익히는 판이라 구조물은 적게 둔다.'),
  };
}
