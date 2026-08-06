// 이음매 — 이어져 있는 두 판이 이어져 보이는가
//
// 5단계까지 지킨 것은 태그라인의 한쪽뿐이었다. "보이지 않는 것은 건널 수
// 없다" 는 넣었는데, **이어져 있는데 이어져 보이지 않는** 자리가 남아 있었다.
//
// 판은 바닥 마름모를 두께만큼 올려 그린다. 그래서 윗면은 화면상 뒤쪽 두 칸의
// 마름모 안으로 그만큼 파고들고, 뒤칸의 옆면이 있어야 할 자리가 바로 거기다.
// 칸마다 옆면과 윗면을 한꺼번에 그리면 누가 나중에 그려지는가를 정렬 키가
// 정하는데,
//
//   depthKey = x + y + z = (화면 gx + gy) + 3z
//
// 앞칸은 gx+gy 가 1 클 뿐이라 뒤칸이 한 칸이라도 높으면 뒤칸이 나중에 그려져,
// 그 옆면이 앞칸 윗면 위로 단이 되어 올라섰다. 화면 네 방향 중 위쪽 둘에서만
// 일어나므로 같은 착시가 방향에 따라 달라 보였다.
//
// 눈으로 잡을 수 없는 종류다 — 두께가 7px 이라 "좀 이상한데" 로 넘어간다.
// 그래서 실제 drawPlates 를 부르고 칠해진 순서를 그대로 받아 적어,
// 이음매 위의 색을 하나하나 확인한다.

import {
  PLATE_T, COLOR, GRID_W, GRID_H, Z_MAX,
  TILE_W as C_TILE_W, TILE_H as C_TILE_H,
} from '../src/config.js';
import { board, key, addPlate, resetBoard } from '../src/board.js';
import { stage, setStage } from '../src/stage.js';
import { fitView, worldToScreen, view } from '../src/iso.js';
import { drawPlates } from '../src/render.js';
import { screenCell, visibleCells, isAdjacent } from '../src/path.js';

let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

fitView(1489, 863);

// ---------------------------------------------------------------------------
// 칠한 순서를 그대로 받아 적는 가짜 컨텍스트.
//
// 픽셀을 만들지 않는다. 칠해진 다각형을 순서대로 쌓아 두었다가, 어떤 점의
// 색을 물으면 그 점을 품은 것 중 **마지막** 것을 돌려준다. 캔버스가 하는 일이
// 정확히 그것이므로(화가 알고리즘) 결과가 같고, 외부 라이브러리도 필요 없다.
// ---------------------------------------------------------------------------
function painter() {
  const shapes = [];
  let pts = [];
  let style = null;

  const ctx = {
    save: () => {}, restore: () => {},
    set fillStyle(v) { style = v; },
    get fillStyle() { return style; },
    set strokeStyle(v) {}, set globalAlpha(v) {}, set lineWidth(v) {},
    setLineDash: () => {},
    beginPath: () => { pts = []; },
    moveTo: (x, y) => pts.push({ x, y }),
    lineTo: (x, y) => pts.push({ x, y }),
    closePath: () => {},
    arc: () => {}, ellipse: () => {},
    stroke: () => {},
    fill: () => { shapes.push({ style, pts: pts.slice() }); },
  };

  // 다각형 포함 판정 — 광선 쏘기. 마름모뿐이라 볼록/오목을 가릴 필요가 없다.
  const inside = (p, poly) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y)
          && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };

  ctx.colorAt = (x, y) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (shapes[i].pts.length >= 3 && inside({ x, y }, shapes[i].pts)) return shapes[i].style;
    }
    return null;   // 아무것도 안 칠해진 자리 = 청사진 바닥
  };
  ctx.count = () => shapes.length;
  return ctx;
}

const T = () => PLATE_T * view.scale;

// 화면상 어느 쪽이 앞(카메라에 가까운 쪽)인가. gx+gy 가 큰 쪽이다.
//
// 검사 안에만 둔다. src 는 이 기준을 함수로 갖고 있지 않고 정렬 키
// (depthKey = x+y+z) 하나로만 쓰는데, 여기서 다시 세우는 이유는 "어떤 쌍이
// 위험한 쌍이었는가" 를 세어 보고하기 위해서다. 판정 자체는 픽셀이 한다.
const frontOf = (a, b) => {
  const p = screenCell(a);
  const q = screenCell(b);
  return (p.x + p.y) > (q.x + q.y) ? a : b;
};

// 칸의 윗면 한가운데
const topCenter = (c) => {
  const p = worldToScreen(c.x + 0.5, c.y + 0.5, c.z);
  return { x: p.x, y: p.y - T() };
};

// 두 칸의 윗면 중심을 이은 선분 위를 훑는다. 두 칸이 화면상 한 칸 옆이면
// 이 선분은 이음매를 가로지르므로, 위에 옆면 색이 하나라도 있으면 단이 진 것이다.
function seamColors(ctx, a, b, samples = 41) {
  const p = topCenter(a);
  const q = topCenter(b);
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    out.push(ctx.colorAt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
  }
  return out;
}

const SIDES = [COLOR.plateLeft, COLOR.plateRight];
const stepIn = (colors) => colors.some((c) => SIDES.includes(c));
const gapIn = (colors) => colors.some((c) => c === null);

// 판을 손으로 세운다. buildStage 를 안 쓰는 이유는 이 검사가 디렉터와 무관하게
// 좌표만으로 성립해야 하기 때문이다.
function lay(cells) {
  setStage({ zMax: Z_MAX, inkMax: 999, start: { x: 0, y: 0 }, goal: { x: 15, y: 15 }, fixtures: [] });
  resetBoard();
  board.actor = null;                       // 캐릭터가 이음매를 가리지 않게
  for (const g of cells) addPlate([{ x: g.x, y: g.y }], g.z);
  const ctx = painter();
  drawPlates(ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// 1. 네 방향 × 모든 높이차 — 여기서 버그가 왔다
//
// 화면상 한 칸 옆인 두 칸을 z 를 벌려 가며 놓는다. 어느 조합에서도 두 윗면
// 사이에 옆면이 끼면 안 된다. 고치기 전에는 위쪽 두 방향(왼위·오른위)에서
// z 가 1 만 달라도 전부 단이 졌다.
// ---------------------------------------------------------------------------
{
  const DIRS = {
    '오른아래': [1, 0], '왼위': [-1, 0], '왼아래': [0, 1], '오른위': [0, -1],
  };

  let stepped = 0;
  let gapped = 0;
  let tried = 0;
  const worst = [];

  for (const [name, [dx, dy]] of Object.entries(DIRS)) {
    for (let z = 0; z <= Z_MAX; z++) {
      // A 는 바닥, B 는 화면상 한 칸 옆에 오도록 z 만큼 밀어 놓는다
      const a = { x: 8, y: 8, z: 0 };
      const b = { x: 8 + dx + z, y: 8 + dy + z, z };

      const sa = screenCell(a);
      const sb = screenCell(b);
      if (Math.abs(sa.x - sb.x) + Math.abs(sa.y - sb.y) !== 1) continue;   // 세운 배치가 틀렸다
      tried++;

      const ctx = lay([a, b]);
      const colors = seamColors(ctx, a, b);
      if (stepIn(colors)) { stepped++; if (worst.length < 3) worst.push(`${name} z=${z}`); }
      if (gapIn(colors)) gapped++;
    }
  }

  check('네 방향 × 모든 높이차를 다 세웠다', tried === 4 * (Z_MAX + 1), `${tried}쌍`);
  check('이음매에 단이 지지 않는다', stepped === 0, worst.length ? worst.join(', ') : '');
  check('이음매에 구멍도 없다', gapped === 0);
}

// ---------------------------------------------------------------------------
// 2. 두께는 그대로 남아 있다
//
// 이음매를 매끈하게 만든다고 옆면을 지워 버리면 판이 종잇장이 된다.
// 판 바깥쪽 가장자리에는 옆면이 그대로 보여야 한다.
// ---------------------------------------------------------------------------
{
  const ctx = lay([{ x: 8, y: 8, z: 0 }]);
  const c = topCenter({ x: 8, y: 8, z: 0 });

  // 윗면 한가운데는 윗면 색
  check('한 칸짜리 판의 윗면은 윗면 색', ctx.colorAt(c.x, c.y) === COLOR.plateTop);

  // 아래쪽 두 변은 옆면. 변의 한복판에서 두께의 절반만큼 아래를 찍는다.
  //
  //   윗면 중심 c 에서 바닥 마름모 중심은 t 아래,
  //   거기서 왼아래 변의 한복판은 (−TILE_W/4, +TILE_H/4),
  //   옆면은 그 변에서 위로 t 만큼이므로 절반인 t/2 를 올린다.
  const t = T();
  const s = view.scale;
  const lx = c.x - (C_TILE_W / 4) * s;
  const rx = c.x + (C_TILE_W / 4) * s;
  const ey = c.y + (C_TILE_H / 4) * s + t / 2;

  check('왼아래 가장자리에 옆면이 남는다', ctx.colorAt(lx, ey) === COLOR.plateLeft,
        `${ctx.colorAt(lx, ey)}`);
  check('오른아래 가장자리에 옆면이 남는다', ctx.colorAt(rx, ey) === COLOR.plateRight,
        `${ctx.colorAt(rx, ey)}`);
}

// ---------------------------------------------------------------------------
// 3. 겹친 자리는 여전히 z 큰 것이 보인다
//
// 두 벌로 나눠 그리면서 정렬이 깨졌으면 여기서 나온다. 5단계에서 세운
// "겹친 후보 중 z 가 가장 큰 것이 위" 가 그대로 지켜져야 이동 판정과 안 갈린다.
// ---------------------------------------------------------------------------
{
  const low = { x: 4, y: 4, z: 0 };
  const high = { x: 9, y: 9, z: 5 };            // 화면 자리가 (4,4) 로 정확히 포개진다
  check('두 칸이 같은 화면 자리다',
        screenCell(low).x === screenCell(high).x && screenCell(low).y === screenCell(high).y);

  const ctx = lay([low, high]);
  const c = topCenter(high);
  check('겹친 자리에는 z 큰 것의 윗면이 보인다', ctx.colorAt(c.x, c.y) === COLOR.plateTop);

  // 가려진 칸을 아예 안 그리면 겹침 판정이 렌더에서 사라져, 정렬이 틀려도
  // 아무 증상이 없어진다. 칸마다 옆면 둘 + 윗면 하나가 그대로 나와야 한다.
  check('가려진 칸도 그리기는 한다 (칸 2개 × 3장)', ctx.count() === 6, `${ctx.count()}`);
}

// ---------------------------------------------------------------------------
// 4. 무작위 배치에서 전수로
//
// 손으로 고른 배치만 보면 고른 사람이 생각한 경우만 지켜진다.
// 시드를 고정해 배치를 여럿 뽑고, 그 안의 **모든** 이웃 쌍을 확인한다.
// ---------------------------------------------------------------------------
{
  let seed = 20260807;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  let pairs = 0;
  let stepped = 0;
  let gapped = 0;
  let backHigher = 0;      // 뒤칸이 더 높은 쌍 — 고치기 전이면 전부 단이 졌다

  for (let n = 0; n < 40; n++) {
    const cells = [];
    const taken = new Set();
    for (let i = 0; i < 14; i++) {
      const z = pick(0, 6);
      const x = pick(z, GRID_W - 1);
      const y = pick(z, GRID_H - 1);
      if (taken.has(key(x, y))) continue;
      taken.add(key(x, y));
      cells.push({ x, y, z });
    }
    if (cells.length < 2) continue;

    const ctx = lay(cells);
    const vis = visibleCells(cells);

    for (let i = 0; i < vis.length; i++) {
      for (let j = i + 1; j < vis.length; j++) {
        if (!isAdjacent(vis[i], vis[j])) continue;
        pairs++;

        const front = frontOf(vis[i], vis[j]);
        const back = front === vis[i] ? vis[j] : vis[i];
        if (back.z > front.z) backHigher++;

        const colors = seamColors(ctx, vis[i], vis[j]);
        if (stepIn(colors)) stepped++;
        if (gapIn(colors)) gapped++;
      }
    }
  }

  console.log(`      배치 40개 · 이웃 쌍 ${pairs}개 (뒤칸이 더 높은 쌍 ${backHigher}개)`);
  check('시험할 만큼 뽑혔다', pairs >= 50 && backHigher >= 10, `${pairs} / ${backHigher}`);
  check('모든 이웃 쌍의 이음매가 매끈하다', stepped === 0, `단이 진 쌍 ${stepped}개`);
  check('모든 이웃 쌍에 구멍이 없다', gapped === 0, `구멍 난 쌍 ${gapped}개`);
}

// ---------------------------------------------------------------------------
// 5. 걸을 수 있는 것과 이어져 보이는 것이 같다
//
// 이 검사의 요점. 이동 규칙(isAdjacent)은 화면상 한 칸 옆이면 길이라고 하는데,
// 화면이 그것을 배신하면 플레이어는 규칙을 배울 방법이 없다. 문구가 없는
// 게임이라 더 그렇다. 위의 1·4번이 그 둘이 어긋나지 않는 것을 지킨다.
// ---------------------------------------------------------------------------
{
  // 신고가 들어온 그 배치 그대로 — z=0 길이 왼아래에서 올라와 오른위로 z=5 이음매
  const cells = [
    { x: 5, y: 8, z: 0 }, { x: 5, y: 7, z: 0 }, { x: 5, y: 6, z: 0 },
    { x: 10, y: 10, z: 5 }, { x: 9, y: 10, z: 5 }, { x: 8, y: 10, z: 5 },
  ];
  const a = cells[2];                 // (5,6,z=0) → 화면 (5,6)
  const b = cells[3];                 // (10,10,z=5) → 화면 (5,5)
  check('신고 배치의 두 칸은 화면상 한 칸 옆', isAdjacent(a, b),
        `${screenCell(a).x},${screenCell(a).y} ↔ ${screenCell(b).x},${screenCell(b).y}`);
  check('그리고 뒤칸이 더 높다 — 고치기 전 단이 지던 조건',
        (() => { const f = frontOf(a, b); const k = f === a ? b : a; return k.z > f.z; })());

  const ctx = lay(cells);
  const colors = seamColors(ctx, a, b);
  check('그 이음매가 이제 매끈하다', !stepIn(colors) && !gapIn(colors),
        [...new Set(colors)].join(' '));
}

console.log(fail ? `\n  ${fail}건 실패\n` : '\n전부 통과\n');
process.exit(fail ? 1 : 0);
