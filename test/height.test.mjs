// 3단계 검증 — 판 높이가 붙은 뒤의 좌표계·집기·깊이 정렬
//
// 눈으로 확인하지 않는다. z > 0 에서 처음으로 화면상 겹침이 발생하는데,
// 겹침이 틀려도 화면은 그럴듯해 보인다.

const SRC = new URL('../src/', import.meta.url).href;

const { GRID_W, GRID_H, TILE_H, BLOCK_H, PLATE_T, Z_MIN, Z_MAX, INK_MAX } =
  await import(SRC + 'config.js');
const { worldToScreen, screenToPlateGrid, tileDiamond, depthKey, fitView, view } =
  await import(SRC + 'iso.js');
const { board, pickAt, movePlate, key, beginStroke, cancelStroke } =
  await import(SRC + 'board.js');

let pass = 0;
let fail = 0;
const fails = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('  ok    ' + name); return; }
  fail++;
  fails.push(name + (detail ? '  — ' + detail : ''));
  console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
}

const WINDOWS = [
  [1489, 863], [1366, 768], [1920, 1080], [3840, 2160], [900, 600],
];

// 판 하나를 통째로 갈아 끼운다.
function setPlates(plates) {
  board.plates = plates;
  board.occupied = new Set();
  for (const p of plates) {
    for (const c of p.cells) board.occupied.add(key(c.x, c.y));
  }
}

// 칸의 윗면 중심 화면 좌표. 화면에 실제로 보이는 면의 한가운데다.
function topFaceCenter(x, y, z) {
  const c = worldToScreen(x + 0.5, y + 0.5, z);
  return { x: c.x, y: c.y - PLATE_T * view.scale };
}

// ---------------------------------------------------------------------------
// 1. 왕복 — 뜬 판의 윗면을 찍으면 그 칸이 다시 잡히는가
//
// 1단계의 투영↔역투영 왕복 검사에 z 를 얹은 것.
// 화면 좌표 → screenToPlateGrid → pickAt 이라는 실제 경로를 그대로 탄다.
// ---------------------------------------------------------------------------
for (const [w, h] of WINDOWS) {
  fitView(w, h);

  let bad = 0;
  let sample = '';
  for (let z = Z_MIN; z <= Z_MAX; z++) {
    for (let x = 0; x < GRID_W; x++) {
      for (let y = 0; y < GRID_H; y++) {
        setPlates([{ cells: [{ x, y }], z }]);
        const s = topFaceCenter(x, y, z);
        const g = screenToPlateGrid(s.x, s.y);
        const hit = pickAt(g.x, g.y);
        if (!hit || hit.x !== x || hit.y !== y || hit.z !== z) {
          bad++;
          if (!sample) sample = `(${x},${y},z=${z}) → ` + (hit ? `(${hit.x},${hit.y},z=${hit.z})` : 'null');
        }
      }
    }
  }
  check(`왕복 ${w}×${h} (${GRID_W * GRID_H * (Z_MAX + 1)}칸)`, bad === 0, `${bad}건 어긋남, 예: ${sample}`);
}

// ---------------------------------------------------------------------------
// 2. 정렬 타이 — 겹치는 두 칸의 depthKey 가 같아질 수 있는가
//
// 같아지면 정렬 순서가 임의로 정해져, 같은 배치가 프레임마다 다르게 그려진다.
//
// 겹치는 경우는 셋뿐이다. 마름모는 평면을 빈틈없이 덮으므로 서로 다른 바닥
// 자리의 마름모는 넓이가 겹치지 않고, 두께 PLATE_T(7px)만이 화면 위쪽
// 이웃 둘의 영역으로 파고든다. 위쪽 이웃은 (x′−1, y′) 와 (x′, y′−1) 이고,
// 바로 위 (x′−1, y′−1) 은 TILE_H(32px) 떨어져 있어 7px 로는 닿지 않는다.
// ---------------------------------------------------------------------------
{
  const OVERLAP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

  // 바닥 자리 → 그 자리에 나타날 수 있는 칸들
  const atFloor = new Map();
  for (let z = Z_MIN; z <= Z_MAX; z++) {
    for (let x = 0; x < GRID_W; x++) {
      for (let y = 0; y < GRID_H; y++) {
        const fk = (x - z) + ',' + (y - z);
        if (!atFloor.has(fk)) atFloor.set(fk, []);
        atFloor.get(fk).push({ x, y, z });
      }
    }
  }

  let ties = 0;
  let pairs = 0;
  let sample = '';

  for (const [fk, here] of atFloor) {
    const [fx, fy] = fk.split(',').map(Number);
    for (const [dx, dy] of OVERLAP) {
      const there = atFloor.get((fx + dx) + ',' + (fy + dy));
      if (!there) continue;
      for (const a of here) {
        for (const b of there) {
          if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
          pairs++;
          if (depthKey(a.x, a.y, a.z) === depthKey(b.x, b.y, b.z)) {
            ties++;
            if (!sample) sample = `(${a.x},${a.y},${a.z}) = (${b.x},${b.y},${b.z})`;
          }
        }
      }
    }
  }

  check(`겹치는 칸 쌍 ${pairs}개에 정렬 동률 없음`, ties === 0, `${ties}건, 예: ${sample}`);
}

// ---------------------------------------------------------------------------
// 3. 집기 = 렌더  ★ 이 단계의 핵심
//
// pickAt 은 좌표 대수로 답을 내고, 렌더는 depthKey 로 정렬해 덧칠한다.
// 두 경로가 독립적이므로, 같은 화면점에 대해 같은 답을 내는지가 실제로
// 반증력 있는 검사다. 어긋나면 5단계에서 "이어져 보이는데 못 건너간다"가 된다.
//
// 여기서는 화면 다각형 포함 판정으로 "실제로 덮는 칸"을 직접 구한다.
// screenToGrid 를 쓰지 않으므로 pickAt 과 논리를 공유하지 않는다.
// ---------------------------------------------------------------------------
{
  // 볼록 다각형 포함 판정 (외적 부호가 전부 같은가)
  function inside(pt, poly) {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  function topFace(x, y, z) {
    const t = PLATE_T * view.scale;
    return tileDiamond(x, y, z).map((p) => ({ x: p.x, y: p.y - t }));
  }

  // 재현 가능한 난수 (mulberry32)
  let seed = 20260803;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  fitView(1489, 863);

  let mismatches = 0;
  let tested = 0;
  let sample = '';

  for (let trial = 0; trial < 30; trial++) {
    // 무작위 판 배치. 잉크 상한이 60칸이므로 그 범위 안에서 만든다.
    const used = new Set();
    const plates = [];
    const nPlates = 3 + Math.floor(rnd() * 6);

    for (let i = 0; i < nPlates; i++) {
      const cells = [];
      let cx = Math.floor(rnd() * GRID_W);
      let cy = Math.floor(rnd() * GRID_H);
      const len = 2 + Math.floor(rnd() * 8);
      for (let j = 0; j < len; j++) {
        if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) break;
        const k = cx + ',' + cy;
        if (!used.has(k)) { used.add(k); cells.push({ x: cx, y: cy }); }
        if (rnd() < 0.5) cx += rnd() < 0.5 ? 1 : -1;
        else cy += rnd() < 0.5 ? 1 : -1;
      }
      if (cells.length) plates.push({ cells, z: Z_MIN + Math.floor(rnd() * (Z_MAX - Z_MIN + 1)) });
    }
    if (!plates.length) continue;
    setPlates(plates);

    // 모든 칸을 depthKey 로 정렬 — 렌더가 그리는 순서 그대로
    const drawn = [];
    for (const p of plates) for (const c of p.cells) drawn.push({ x: c.x, y: c.y, z: p.z });
    drawn.sort((a, b) => depthKey(a.x, a.y, a.z) - depthKey(b.x, b.y, b.z));

    // 각 칸의 윗면 중심과, 중심에서 살짝 벗어난 점들을 표본으로 찍는다
    for (const c of drawn) {
      const base = topFaceCenter(c.x, c.y, c.z);
      const offsets = [[0, 0], [12, 0], [-12, 0], [0, 5], [0, -5]];

      for (const [ox, oy] of offsets) {
        const pt = { x: base.x + ox * view.scale, y: base.y + oy * view.scale };

        // 렌더 기준 정답: 이 점을 덮는 칸 중 마지막에 그려지는 것
        let expected = null;
        for (const d of drawn) {
          if (inside(pt, topFace(d.x, d.y, d.z))) expected = d;   // 정렬돼 있으므로 마지막이 위
        }
        if (!expected) continue;

        const g = screenToPlateGrid(pt.x, pt.y);
        const got = pickAt(g.x, g.y);
        tested++;

        if (!got || got.x !== expected.x || got.y !== expected.y || got.z !== expected.z) {
          mismatches++;
          if (!sample) {
            sample = `점(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) 렌더=(${expected.x},${expected.y},z=${expected.z}) ` +
                     `집기=` + (got ? `(${got.x},${got.y},z=${got.z})` : 'null');
          }
        }
      }
    }
  }

  check(`집기 = 렌더 (배치 30개, 표본 ${tested}점)`, mismatches === 0, `${mismatches}건, 예: ${sample}`);
}

// ---------------------------------------------------------------------------
// 4. 화면 여유 — Z_MAX 까지 올린 판의 머리가 잘리지 않는가
//
// 화면 밖으로 나간 판은 잘렸다는 것조차 보이지 않는다.
// ---------------------------------------------------------------------------
for (const [w, h] of WINDOWS) {
  fitView(w, h);

  // 가장 높이 솟는 것은 화면상 가장 위인 (0,0) 칸을 Z_MAX 까지 올린 경우
  const t = PLATE_T * view.scale;
  const head = worldToScreen(0, 0, Z_MAX).y - t;

  // 바닥 네 꼭짓점도 여전히 화면 안에 있어야 한다
  const corners = [
    worldToScreen(0, 0), worldToScreen(GRID_W, 0),
    worldToScreen(GRID_W, GRID_H), worldToScreen(0, GRID_H),
  ];
  const cornersOk = corners.every((c) => c.x >= 0 && c.x <= w && c.y >= 0 && c.y <= h);

  check(`여유 ${w}×${h} — z=${Z_MAX} 판 머리 ${head.toFixed(1)}px`, head >= 0 && cornersOk,
        head < 0 ? '화면 위로 잘림' : '바닥 꼭짓점이 화면 밖');
}

// ---------------------------------------------------------------------------
// 5. 착시 등식 — 1단계 검사 재실행
//
// 여기가 깨지면 게임이 조용히 죽는다. 판 높이를 붙이면서 건드리지 않았는지 본다.
// ---------------------------------------------------------------------------
{
  check('BLOCK_H = TILE_H', BLOCK_H === TILE_H, `${BLOCK_H} vs ${TILE_H}`);

  for (const [w, h] of WINDOWS) {
    fitView(w, h);
    const a = worldToScreen(4, 4, 2);
    const b = worldToScreen(3, 3, 1);
    check(`(4,4,z=2) = (3,3,z=1) @ ${w}×${h}`,
          Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9,
          `${a.x},${a.y} vs ${b.x},${b.y}`);
  }

  // z 는 화면 가로 위치를 바꾸지 않는다 — 착시 탐색 공간을 결정하는 성질
  fitView(1489, 863);
  let sxBad = 0;
  for (let z = Z_MIN; z <= Z_MAX; z++) {
    if (Math.abs(worldToScreen(5, 3, z).x - worldToScreen(5, 3, 0).x) > 1e-9) sxBad++;
  }
  check('z 가 sx 를 바꾸지 않음', sxBad === 0, `${sxBad}건`);
}

// ---------------------------------------------------------------------------
// 6. 높이 상·하한
// ---------------------------------------------------------------------------
{
  const p = { cells: [{ x: 5, y: 5 }], z: 0 };
  setPlates([p]);

  movePlate(p, 100);
  check(`상한 ${Z_MAX} 에서 멈춤`, p.z === Z_MAX, `z=${p.z}`);

  movePlate(p, -100);
  check(`하한 ${Z_MIN} 에서 멈춤`, p.z === Z_MIN, `z=${p.z}`);

  check('상한에서 더 올리면 변화 없음', movePlate({ cells: [], z: Z_MAX }, 1) === false);
}

// ---------------------------------------------------------------------------
// 7. 회귀 — 뜬 판을 지울 수 있는가
//
// 3단계가 조용히 깨뜨릴 뻔한 기능. z=0 시절 지우기는 바닥칸으로 조회했다.
// ---------------------------------------------------------------------------
{
  fitView(1489, 863);

  for (const z of [0, 1, 4, Z_MAX]) {
    const p = { cells: [{ x: 9, y: 7 }], z };
    setPlates([p]);

    const s = topFaceCenter(9, 7, z);
    const g = screenToPlateGrid(s.x, s.y);
    const hit = pickAt(g.x, g.y);

    check(`z=${z} 인 판을 커서로 집을 수 있음`, !!hit && hit.x === 9 && hit.y === 7,
          hit ? `(${hit.x},${hit.y},z=${hit.z})` : 'null');
  }

  // 가려진 자리에는 그릴 수 없다 — 뜬 판 밑에 잉크를 흘리지 않는가
  setPlates([{ cells: [{ x: 8, y: 8 }], z: 3 }]);
  check('뜬 판이 덮은 바닥칸은 가려진 것으로 잡힘', !!pickAt(5, 5), 'pickAt(5,5) = null');
  check('그 옆 바닥칸은 비어 있음', pickAt(5, 6) === null);
}

// ---------------------------------------------------------------------------
// 8. 기둥 유일성  ★ "판을 띄워도 그 아래는 계속 막힌다" 의 실제 보장
//
// 판을 올리면 그 판은 화면에서 원래 자리를 떠난다. 그리기를 화면 기준으로만
// 막으면 빈 자리로 보이는 그 기둥에 두 번째 판을 그릴 수 있게 되고,
// 한 (x,y) 에 판이 둘 생기는 순간 지우기가 어느 쪽을 가리키는지 알 수 없어진다.
// ---------------------------------------------------------------------------
{
  const p = { cells: [{ x: 6, y: 6 }], z: 0 };
  setPlates([p]);
  board.ink = INK_MAX;

  movePlate(p, 4);   // 화면상 (2,2) 자리로 물러난다

  beginStroke({ x: 6, y: 6 });
  const blocked = board.stroke.size === 0;
  cancelStroke();
  check('뜬 판의 기둥에는 다시 그릴 수 없음', blocked, `stroke ${board.stroke.size}칸`);

  // 판이 가린 자리에도 그릴 수 없다 — 보이지 않는 잉크를 막는다
  beginStroke({ x: 2, y: 2 });
  const hidden = board.stroke.size === 0;
  cancelStroke();
  check('뜬 판이 가린 바닥칸에도 그릴 수 없음', hidden, `stroke ${board.stroke.size}칸`);

  // 그 밖의 빈 바닥은 여전히 그려진다
  beginStroke({ x: 12, y: 3 });
  const free = board.stroke.size === 1;
  cancelStroke();
  check('나머지 빈 바닥은 그대로 그려짐', free, `stroke ${board.stroke.size}칸`);

  // 한 기둥에 판이 둘 생기지 않는다
  let dup = 0;
  const seen = new Set();
  for (const pl of board.plates) {
    for (const c of pl.cells) {
      const k = key(c.x, c.y);
      if (seen.has(k)) dup++;
      seen.add(k);
    }
  }
  check('한 기둥에 판은 하나뿐', dup === 0, `${dup}건 중복`);
}

// ---------------------------------------------------------------------------

console.log('');
for (const f of fails) console.log('  FAIL  ' + f);
console.log(`\n  ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
