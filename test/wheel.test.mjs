// 휠 재현 — 가짜 캔버스에 실제 attachPointer 를 붙이고 이벤트를 직접 쏜다.
// 브라우저 없이 입력 경로 전체(좌표 → 집기 → 높이)를 그대로 탄다.

const SRC = new URL('../src/', import.meta.url).href;
const { PLATE_T } = await import(SRC + 'config.js');
const { worldToScreen, fitView, view } = await import(SRC + 'iso.js');
const { board, key } = await import(SRC + 'board.js');

// input.js 는 attachPointer 안에서 window 를 쓴다.
globalThis.window = { addEventListener: () => {} };
const { pointer, attachPointer } = await import(SRC + 'input.js');

const L = {};
const canvas = {
  addEventListener: (type, fn) => { L[type] = fn; },
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
  setPointerCapture: () => {},
};
attachPointer(canvas);

console.log('등록된 리스너:', Object.keys(L).join(', '));

fitView(1489, 863);

const plate = { cells: [{ x: 8, y: 8 }], z: 0 };
board.plates = [plate];
board.occupied = new Set([key(8, 8)]);

// 판 윗면 한가운데를 겨냥한다
const c = worldToScreen(8.5, 8.5, plate.z);
const pt = { clientX: c.x, clientY: c.y - PLATE_T * view.scale };

console.log(`커서 (${pt.clientX.toFixed(1)}, ${pt.clientY.toFixed(1)})  scale=${view.scale}`);

// 커서를 그 위로 옮긴다 (브라우저에서도 휠 전에 반드시 일어나는 일)
L.pointermove({ ...pt });
console.log('pointermove 후 hit =', pointer.hit
  ? `(${pointer.hit.x},${pointer.hit.y},z=${pointer.hit.z})` : 'null');

// 휠을 위로 다섯 노치
for (let i = 0; i < 5; i++) {
  L.wheel({ ...pt, deltaY: -100, deltaMode: 0, preventDefault: () => {} });
  console.log(`  노치 ${i + 1} → z=${plate.z}`);
}

console.log('\n다섯 노치 뒤 z =', plate.z, plate.z === 5 ? '  OK' : '  ← 어긋남');

// 아래로 두 노치
for (let i = 0; i < 2; i++) {
  L.wheel({ ...pt, deltaY: 100, deltaMode: 0, preventDefault: () => {} });
}
console.log('아래로 두 노치 뒤 z =', plate.z, plate.z === 3 ? '  OK' : '  ← 어긋남');

// --- 장치별 --------------------------------------------------------------
// 같은 "한 번 굴림"이 장치마다 전혀 다른 값으로 온다.
// 어느 하나에 문턱을 맞추면 나머지가 죽거나 폭주한다.

function device(name, events, perGesture, expect) {
  plate.z = 0;
  L.pointermove({ ...pt });                    // 제스처 시작 전 커서 이동
  for (let i = 0; i < events; i++) {
    L.wheel({ ...pt, ...perGesture, preventDefault: () => {} });
  }
  const ok = plate.z === expect;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} z=${plate.z} (기대 ${expect})`);
  return ok;
}

console.log('\n장치별 — 위로 세 번 굴린 셈:');
let all = true;
all &= device('휠 마우스 Chrome (100px × 3)',   3,  { deltaY: -100, deltaMode: 0 }, 3);
all &= device('휠 마우스 Firefox (3줄 × 3)',    3,  { deltaY: -3,   deltaMode: 1 }, 3);
all &= device('고해상도 휠 (53px × 3)',         3,  { deltaY: -53,  deltaMode: 0 }, 3);
all &= device('트랙패드 (4px × 24)',           24, { deltaY: -4,   deltaMode: 0 }, 3);
all &= device('페이지 단위 (1page × 3)',        3,  { deltaY: -1,   deltaMode: 2 }, 3);

// 트랙패드가 조금만 움직였을 때 판이 튀지 않아야 한다
plate.z = 0;
L.pointermove({ ...pt });
for (let i = 0; i < 3; i++) L.wheel({ ...pt, deltaY: -4, deltaMode: 0, preventDefault: () => {} });
const still = plate.z === 0;
console.log(`  ${still ? 'ok  ' : 'FAIL'} 트랙패드 살짝(4px × 3)             z=${plate.z} (기대 0)`);
all &= still;

console.log(all ? '\n  장치별 전부 통과\n' : '\n  ← 실패 있음\n');
process.exit(all ? 0 : 1);
