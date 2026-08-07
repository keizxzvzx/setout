// 검증 전체 실행 —  node test/run.mjs
//
// 이 게임에서 눈으로 확인하면 안 되는 것들이 모여 있다. 좌표 변환은 틀려도
// 그럴듯해 보이고, 깊이 정렬은 겹치기 전까지 증상이 없으며, 잉크 회계는
// 한참 플레이해 봐야 어긋난 것이 드러난다. 전부 코드로 확인한다.
//
// 외부 테스트 프레임워크를 쓰지 않는다. 게임이 라이브러리를 하나도 쓰지 않으므로
// 검증만 의존성을 들이면 "설치 없이 실행" 이라는 전제가 흐려진다.
// 각 파일은 통과 여부를 종료 코드로 돌려주고, 이 파일은 그것을 모은다.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['iso',    '좌표계 — 등각 투영과 자동 축척 카메라'],
  ['stroke', '획과 판 — 보간, 연결 성분, 부지 경계'],
  ['erase',  '지우기 — 재분해, 환급, 뜬 판'],
  ['ink',    '잉크 — 소모와 절반 환급'],
  ['plate',  '판 두께 — 바닥 격자를 넘지 않는가'],
  ['height', '판 높이 — 집기, 깊이 정렬, 기둥 유일성'],
  ['wheel',  '휠 입력 — 장치별 delta 흡수'],
  ['move',   '이동 그래프 — 화면상 인접, BFS, 솔버 재사용 조건'],
  ['stepping', '징검다리 — 2단계 구멍이 막혔는가'],
  ['occlusion', '가림 — 보이지 않는 것은 건널 수 없다'],
  ['seam',   '이음매 — 이어져 있는 두 판이 이어져 보이는가'],
  ['stage',  '층 파라미터 — 손잡이를 돌리면 게임이 따라오는가'],
  ['solver', '솔버 — 최소 잉크, 그리고 그 잉크로 실제로 풀리는가'],
  ['director', '디렉터 — 낸 층이 판정의 전제를 지키는가'],
  ['profile', '성향 — 플레이어를 읽고 그 사람이 피하는 것을 내는가'],
  ['session', '층 전환 — 무엇을 남기고 무엇을 지우는가'],
  ['footprint', '발자국 — 보이지 않는데 그릴 수 없는 칸이 없는가'],
  ['hud',    '모서리 표시 — 적어 둔 조작이 실제로 그렇게 도는가'],
];

let failed = 0;

for (const [name, desc] of SUITES) {
  console.log(`\n${'─'.repeat(64)}\n  ${name}  —  ${desc}\n${'─'.repeat(64)}`);

  const r = spawnSync(process.execPath, [join(here, `${name}.test.mjs`)], {
    stdio: 'inherit',
  });

  if (r.status !== 0) failed++;
}

console.log(`\n${'═'.repeat(64)}`);
console.log(failed ? `  ${failed}개 묶음 실패` : `  ${SUITES.length}개 묶음 전부 통과`);
console.log('═'.repeat(64));

process.exit(failed ? 1 : 0);
