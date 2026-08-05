// 성향 — 플레이어를 읽고 그 사람이 피하는 것을 내는가
//
// 지표를 정규화하는 산수와, 그 값이 실제로 반대 방향의 층을 불러내는지를
// 같이 본다. 앞의 것만 맞으면 "숫자는 잘 나오는데 층은 그대로" 가 된다.

import * as C from '../src/config.js';
import * as B from '../src/board.js';
import { isIllusion } from '../src/path.js';
import { profileOf, briefFor } from '../src/profile.js';
import { directFor, verify, candidateCells } from '../src/director.js';

const { INK_COST } = C;

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const stats = (o = {}) => ({
  inkSpent: 0, redraws: 0, illusionSteps: 0, realSteps: 0, ...o,
});

// ---------------------------------------------------------------------------
// 1. 지표를 0~1 로 펴는가
// ---------------------------------------------------------------------------
{
  const blank = profileOf(stats(), {});
  check('아무것도 안 했으면 전부 0',
        blank.pressure === 0 && blank.illusion === 0 && blank.hesitation === 0
        && blank.confidence === 0);

  const half = profileOf(stats({ inkSpent: 60 }), { granted: 120, stages: 1 });
  check('배급의 절반을 쓰면 0.5', near(half.pressure, 0.5), `${half.pressure}`);

  const over = profileOf(stats({ inkSpent: 300 }), { granted: 120, stages: 1 });
  check('환급으로 배급을 넘겨 써도 1 을 안 넘는다', over.pressure === 1, `${over.pressure}`);

  // 착시는 층당 건넌 횟수로 잰다. 걸음 수 대비 비율이 아니다 —
  // 착시로 푼 층에서도 이음매는 두어 번뿐이고 나머지는 전부 진짜 길이다.
  const rode = profileOf(stats({ illusionSteps: 2, realSteps: 40 }), { stages: 1 });
  check('층당 두 번 건너면 착시를 온전히 쓴 것', rode.illusion === 1,
        `착시 ${rode.illusion} (걸음 비율로 쟀다면 ${(2 / 42).toFixed(2)})`);

  const once = profileOf(stats({ illusionSteps: 2, realSteps: 20 }), { stages: 2 });
  check('두 층에서 두 번이면 절반', near(once.illusion, 0.5), `${once.illusion}`);

  const never = profileOf(stats({ realSteps: 60 }), { stages: 3 });
  check('한 번도 안 건넜으면 0', never.illusion === 0);

  // 30칸 그리고 9칸을 다시 그렸다 = 30%
  const jittery = profileOf(stats({ inkSpent: 30 * INK_COST, redraws: 9 }), { stages: 1 });
  check('그린 칸의 30% 를 다시 그리면 완전히 망설이는 것', jittery.hesitation === 1,
        `${jittery.hesitation}`);

  const steady = profileOf(stats({ inkSpent: 30 * INK_COST, redraws: 0 }), { stages: 1 });
  check('다시 그린 적 없으면 0', steady.hesitation === 0);

  check('확신도는 층이 쌓이며 오른다',
        near(profileOf(stats(), { stages: 1 }).confidence, 0.33)
        && profileOf(stats(), { stages: 3 }).confidence === 1
        && profileOf(stats(), { stages: 9 }).confidence === 1);
}

// ---------------------------------------------------------------------------
// 2. 방향 — 그 사람이 피하는 것을 내는가
// ---------------------------------------------------------------------------
const SEEKER = stats({ inkSpent: 30, illusionSteps: 6, realSteps: 20, redraws: 0 });
const PUSHER = stats({ inkSpent: 118, illusionSteps: 0, realSteps: 40, redraws: 0 });

{
  const first = briefFor(profileOf(stats(), {}), {});
  check('읽을 것이 없으면 물어본다', first.brief.intent === 'open', first.note);

  const seeker = briefFor(profileOf(SEEKER, { granted: 120, stages: 2 }), {});
  check('착시만 노리면 정렬이 불가능한 층', seeker.brief.intent === 'honest',
        seeker.note);

  const pusher = briefFor(profileOf(PUSHER, { granted: 120, stages: 2 }), {});
  check('다리로만 밀면 그리기로는 못 가는 층', pusher.brief.intent === 'illusion',
        pusher.note);

  // 애매하면 물어본다.
  //
  // 맞서는 층은 그 자체로 성향을 읽을 수 없다 — 착시 강제 층에서는 누구나
  // 이음매를 건너고, 정직 층에서는 상한이 0 이라 아무도 못 건넌다.
  // 문턱 사이를 "하던 것 유지" 로 두면 디렉터가 자기가 낸 층을 다시 읽게 된다.
  // 둘 다 갈 수 있는 층에서 나온 선택만이 디렉터가 만들지 않은 정보다.
  const mid = profileOf(stats({ illusionSteps: 2, realSteps: 20 }), { stages: 2 });
  check('애매한 지표는 문턱 사이에 있다', mid.illusion > 0.3 && mid.illusion < 0.7,
        `${mid.illusion}`);
  check('애매하면 물어본다', briefFor(mid, {}).brief.intent === 'open',
        briefFor(mid, {}).note);
  check('확실하면 물어보지 않고 맞선다',
        briefFor(profileOf(SEEKER, { stages: 2 }), {}).brief.intent === 'honest'
        && briefFor(profileOf(PUSHER, { stages: 2 }), {}).brief.intent === 'illusion');
}

// ---------------------------------------------------------------------------
// 3. 세기 — 배급을 창의 어디에 놓는가
// ---------------------------------------------------------------------------
{
  const pusher = briefFor(profileOf(PUSHER, { granted: 120, stages: 3 }), {});
  const relaxed = briefFor(profileOf(
    stats({ inkSpent: 20, illusionSteps: 0, realSteps: 20 }), { granted: 120, stages: 3 }), {});

  check('배급을 바짝 쓰면 여유를 줄인다', pusher.slack < 0.3, `${pusher.slack.toFixed(2)}`);
  check('여유롭게 쓰면 여유를 남긴다', relaxed.slack > 0.7, `${relaxed.slack.toFixed(2)}`);

  // 망설임에 맞서는 방법으로 배급을 고른 것은 계획 단계의 결정이다.
  // 환급률을 낮추는 안도 있었지만 망설이는 사람에게 가장 가혹해 층을 못 풀고
  // 막힐 위험이 있었다.
  const jittery = briefFor(profileOf(
    stats({ inkSpent: 60, redraws: 9, illusionSteps: 0, realSteps: 20 }),
    { granted: 120, stages: 3 }), {});
  const same = briefFor(profileOf(
    stats({ inkSpent: 60, redraws: 0, illusionSteps: 0, realSteps: 20 }),
    { granted: 120, stages: 3 }), {});

  check('망설이면 실험할 여지를 줄인다', jittery.slack < same.slack,
        `망설임 ${jittery.slack.toFixed(2)} vs 안정 ${same.slack.toFixed(2)}`);

  // 확신도 — 한 층만 보고 극단으로 가지 않는다.
  // 같은 성향을 층 수만 달리해 넣는다. 배급도 같이 늘려야 압박 비율이 같다.
  const one = briefFor(profileOf(PUSHER, { granted: 120, stages: 1 }), {});
  const three = briefFor(profileOf(
    { ...PUSHER, inkSpent: PUSHER.inkSpent * 3 }, { granted: 360, stages: 3 }), {});
  check('한 층만 봤으면 덜 조인다', one.slack > three.slack,
        `1층 ${one.slack.toFixed(2)} vs 3층 ${three.slack.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// 4. 읽은 대로 층이 나오는가
//
// 숫자만 맞고 층은 그대로면 아무 일도 안 일어난 것이다.
// ---------------------------------------------------------------------------
{
  const seeker = directFor(SEEKER, { granted: 120, stages: 2 }, 4);
  check('착시만 노리는 사람에게 낸 층은 상한이 0', seeker.spec.zMax === 0,
        `zMax=${seeker.spec.zMax}`);

  const v = verify(seeker.candidate, seeker.inkMax);
  check('그 층에서는 착시가 값을 못 깎는다', v.illusionCost === v.honestCost,
        `착시 ${v.illusionCost} / 그리기 ${v.honestCost}`);
  check('올려 둔 판이 하나도 없다',
        candidateCells(seeker.candidate).every((c) => c.z === 0));

  const pusher = directFor(PUSHER, { granted: 120, stages: 2 }, 4);
  const w = verify(pusher.candidate, pusher.inkMax);
  check('다리로 미는 사람에게 낸 층은 그리기로 못 간다', w.honestCost > pusher.inkMax,
        `그리기 ${w.honestCost} > 배급 ${pusher.inkMax}`);
  check('착시로는 배급 안에 든다', w.illusionCost <= pusher.inkMax,
        `착시 ${w.illusionCost} ≤ ${pusher.inkMax}`);
  check('배급이 창의 바닥 쪽이다',
        pusher.inkMax - pusher.window.min <= (pusher.window.max - pusher.window.min) / 2,
        `${pusher.inkMax} (창 ${pusher.window.min}~${pusher.window.max})`);

  check('읽은 근거가 기록에 남는다', !!pusher.read && pusher.read.length > 10, pusher.read);
}

// ---------------------------------------------------------------------------
// 5. 읽은 것이 정말 플레이어의 것인가 — 가상 플레이어로 여러 층을 돌린다
//
// 이 절이 6단계의 주장을 지킨다. 맞서는 층만 내면 디렉터가 만든 층이 다음
// 판단의 입력이 되어, 4층째부터는 성향이 무엇이든 같은 순서가 나온다.
// 읽었다고 한 것이 사실은 자기가 직전에 낸 층이다.
//
// 그래서 **선택 말고는 아무것도 다르지 않은 두 사람**을 돌린다.
// 둘이 다른 층을 받으면 읽은 것이 그 사람의 것이다.
// ---------------------------------------------------------------------------
function playThrough(prefersIllusion, count, seed0, style = {}) {
  const s = stats(style.start);
  let granted = style.granted ?? 0;
  let stages = style.stages ?? 0;
  const trail = [];

  for (let n = 0; n < count; n++) {
    const r = directFor(s, { granted, stages }, seed0 + n);
    if (!r.ok) break;

    granted += r.inkMax;

    // 고를 수 있으면 성향대로 고르고, 아니면 갈 수 있는 쪽으로 간다
    const v = verify(r.candidate, r.inkMax);
    const canHonest = !!v.honest && v.honestCost <= r.inkMax;
    const p = (prefersIllusion || !canHonest) ? v.illusion : v.honest;

    s.inkSpent += p.cost;
    for (let i = 1; i < p.path.length; i++) {
      if (isIllusion(p.path[i - 1], p.path[i])) s.illusionSteps++;
      else s.realSteps++;
    }
    if (style.hesitant) s.redraws += Math.round(p.drawn.length * 0.4);

    stages++;
    trail.push({ intent: r.intent, inkMax: r.inkMax, slack: r.slack, chose: canHonest });
  }

  return { trail, stats: s };
}

{
  const rides = playThrough(true, 10, 30);    // 고를 수 있으면 착시를 고르는 사람
  const draws = playThrough(false, 10, 30);   // 고를 수 있으면 그려서 가는 사람

  const kinds = (t) => t.map((x) => x.intent);

  check('열 층을 다 낸다', rides.trail.length === 10 && draws.trail.length === 10,
        `${rides.trail.length} / ${draws.trail.length}`);

  // 이것이 이 묶음의 핵심이다. 두 사람은 고르는 것 말고 다른 점이 없다.
  check('선택만 다른 두 사람이 다른 층을 받는다',
        JSON.stringify(kinds(rides.trail)) !== JSON.stringify(kinds(draws.trail)));

  check('착시를 고르는 사람에게는 정렬을 없앤 층이 온다',
        kinds(rides.trail).includes('honest') && !kinds(rides.trail).includes('illusion'),
        kinds(rides.trail).join(' '));
  check('그려서 가는 사람에게는 그리기를 막은 층이 온다',
        kinds(draws.trail).includes('illusion') && !kinds(draws.trail).includes('honest'),
        kinds(draws.trail).join(' '));

  check('둘 다 물어보는 층을 받는다',
        kinds(rides.trail).includes('open') && kinds(draws.trail).includes('open'));
  check('첫 층은 물어보는 층이다 — 아직 읽을 것이 없다',
        rides.trail[0].intent === 'open' && draws.trail[0].intent === 'open');

  // 물어보는 층에서는 둘 다 갈 수 있어야 한다. 못 고르면 물어본 것이 아니다.
  const asked = rides.trail.filter((x) => x.intent === 'open');
  check(`물어보는 층에서는 정말 고를 수 있다 (${asked.length}층)`,
        asked.every((x) => x.chose));

  // 망설임 대응은 압박이 이미 꽉 찬 사람에게는 확인할 수 없다.
  // 조일 자리가 남아 있지 않기 때문이다.
  const jittery = playThrough(false, 6, 30, { hesitant: true });
  const steady = playThrough(false, 6, 30);
  const avg = (t) => t.reduce((a, x) => a + x.slack, 0) / t.length;
  check('망설이는 사람은 계속 조인 배급을 받는다',
        avg(jittery.trail) < avg(steady.trail),
        `망설임 ${avg(jittery.trail).toFixed(2)} vs 안정 ${avg(steady.trail).toFixed(2)}`);

  const label = { illusion: '착시강제', honest: '정직강제', open: '물어봄' };
  console.log(`\n      착시를 고르는 사람 : ${kinds(rides.trail).map((k) => label[k]).join(' ')}`);
  console.log(`      그려서 가는 사람   : ${kinds(draws.trail).map((k) => label[k]).join(' ')}\n`);
}

// ---------------------------------------------------------------------------
// 6. 순수성
// ---------------------------------------------------------------------------
{
  B.board.plates.length = 0;
  B.board.occupied.clear();

  const input = stats({ inkSpent: 40, illusionSteps: 2, realSteps: 10 });
  const snap = JSON.stringify(input);
  const a = directFor(input, { granted: 120, stages: 2 }, 8);

  check('지표를 변형하지 않는다', JSON.stringify(input) === snap);
  check('층을 내도 board 는 그대로다', B.board.plates.length === 0);

  const b = directFor(input, { granted: 120, stages: 2 }, 8);
  check('같은 지표·같은 시드면 같은 층',
        JSON.stringify(a.spec) === JSON.stringify(b.spec));
}

// ---------------------------------------------------------------------------
console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
