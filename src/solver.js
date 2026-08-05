// 솔버 — 이 배치를 얼마의 잉크로 풀 수 있는가
//
// 6단계 디렉터가 "이 층이 풀리는가" 를 물을 때 쓰는 함수다.
// path.js 와 같은 규율을 지킨다: board 도 stage 도 읽지 않고 스냅샷만 받는다.
// 아직 놓지도 않은 배치를 물어야 하므로 살아 있는 상태를 한 줄이라도 읽으면
// 그 순간 솔버로 쓸 수 없게 된다.
//
// 왜 findPath 로는 안 되는가.
//
// findPath 는 **이미 놓인 판** 위에서 길을 찾는다. 그런데 목표는 빈 바닥
// 칸이고 플레이어는 판을 **그려서** 간다. 물어야 하는 것은 "길이 있는가" 가
// 아니라 "배급량 이하의 칸을 그려서 닿는 방법이 있는가" 다.
//
// 그래프는 그대로 쓰고 간선에 비용만 붙인다.

import { GRID_W, GRID_H, INK_COST } from './config.js';
import { screenCell, isIllusion, visibleByScreen, NEIGHBORS, skey } from './path.js';

// 화면 자리 하나가 노드 하나다. 그 자리에 설 수 있는가, 얼마가 드는가가
// 세 갈래로 갈린다.
//
//   보이는 판 칸이 있다               → 그 칸, 비용 0        (이미 있는 길)
//   비었고 기둥이 안 잡혔고 부지 안    → (gx, gy, 0), INK_COST (그려야 한다)
//   그 외                             → 노드가 아니다
//
// 세 번째가 이 게임의 벽이다. 판을 z 만큼 올리면 화면에서는 (x−z, y−z) 로
// 물러나지만 occupied 는 원래 기둥 (x, y) 를 계속 잡고 있다. 그래서 그 자리는
// **비어 보이는데 그릴 수도 없고 설 수도 없다.** 5단계에서 벽을 넣지 않기로
// 확정했는데, 판을 올리는 것만으로 통과 불가 구멍이 생기고 있었다.
//
// 기둥 집합을 인자로 받지 않고 cells 에서 유도한다. board.occupied 를 따로
// 받으면 같은 사실이 두 곳에 적히고, 어긋나도 아무도 모른다.
function makeNodeAt(cells, gridW, gridH) {
  const visible = visibleByScreen(cells);
  const occupied = new Set(cells.map((c) => skey(c.x, c.y)));

  return (gx, gy) => {
    // 뜬 판은 부지 밖 화면 자리에 나타날 수 있다(z 가 클 때 (x−z, y−z) 가
    // 음수가 된다). 이미 존재하는 칸이므로 부지 검사를 걸지 않는다.
    const seen = visible.get(skey(gx, gy));
    if (seen) return { cell: seen, cost: 0 };

    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return null;
    if (occupied.has(skey(gx, gy))) return null;

    // 그리기는 언제나 z=0 이다. 1단계에서 그리기 평면을 바닥으로 못 박았다.
    return { cell: { x: gx, y: gy, z: 0 }, cost: INK_COST };
  };
}

// 최소 잉크로 목표에 닿는 길. 없으면 null.
//
//   from  캐릭터가 선 판 칸 { x, y, z }
//   goal  목표 격자 칸 { x, y } — 빈 바닥이라 그려야 닿는다
//
// allowIllusion: false 로 한 번 더 돌리면 "정직하게만 가면 얼마인가" 가
// 나온다. 이 두 값의 차이가 6단계 검증 3항목의 전부다.
//
// 0-1 BFS. 가중치가 0 과 INK_COST 둘뿐이라 우선순위 큐가 필요 없다.
// 공짜 간선으로 닿는 칸은 **같은 층에 계속 얹고**, 잉크를 먹는 간선만 다음
// 층으로 넘긴다. path.js 의 frontier/next 와 같은 모양이 된다.
//
// 환급으로 이 값을 더 내릴 수는 없다. 밟은 칸은 한 방울도 돌아오지 않고
// (2·4단계), 밟지 않은 칸은 애초에 최소 해법에 들어 있지 않다.
// 그래서 이 값이 진짜 하한이다.
export function minInk(cells, from, goal, opts = {}) {
  const {
    allowIllusion = true,
    gridW = GRID_W,
    gridH = GRID_H,
  } = opts;

  const nodeAt = makeNodeAt(cells, gridW, gridH);

  // 도착 판정을 게임과 똑같이 맞춘다. actor.js 는 캐릭터가 선 **칸의 격자
  // 좌표**가 목표와 같은지를 보지 화면 자리를 보지 않는다. 여기서 화면
  // 자리로 비교하면 "솔버는 닿았다는데 클리어가 안 되는" 층이 나온다.
  const reached = (c) => c.x === goal.x && c.y === goal.y;

  const at = (c) => {
    const s = screenCell(c);
    return skey(s.x, s.y);
  };

  const prev = new Map([[at(from), null]]);
  const cellOf = new Map([[at(from), from]]);

  const finish = (cell, cost) => {
    const path = [];
    for (let k = at(cell); ; ) {
      path.push(cellOf.get(k));
      const parent = prev.get(k);
      if (!parent) break;
      k = at(parent);
    }
    path.reverse();

    // 그려야 하는 칸 = 원래 아무것도 보이지 않던 자리를 밟은 것.
    // 디렉터의 검증과 실측 검사가 이것을 그대로 그어 본다.
    const drawn = path.filter((c) => {
      const s = screenCell(c);
      const n = nodeAt(s.x, s.y);
      return !!n && n.cost > 0;
    });
    return { cost, path, drawn };
  };

  if (reached(from)) return finish(from, 0);

  let cost = 0;
  let frontier = [from];

  while (frontier.length) {
    const next = [];

    // frontier 가 도는 도중 자란다(공짜 간선). 인덱스로 돌아 새로 얹힌 것도
    // 같은 층에서 마저 펼친다.
    for (let i = 0; i < frontier.length; i++) {
      const c = frontier[i];
      const p = screenCell(c);

      for (const [dx, dy] of NEIGHBORS) {
        const gx = p.x + dx;
        const gy = p.y + dy;
        const k = skey(gx, gy);
        if (prev.has(k)) continue;

        const n = nodeAt(gx, gy);
        if (!n) continue;
        if (!allowIllusion && isIllusion(c, n.cell)) continue;

        if (n.cost > 0) {
          // 잉크를 먹는다 — 이번 층에서는 확정하지 않는다.
          // 같은 층 안에서 공짜로 닿는 길이 나중에 발견될 수 있기 때문이다.
          next.push({ cell: n.cell, via: c });
          continue;
        }

        prev.set(k, c);
        cellOf.set(k, n.cell);
        if (reached(n.cell)) return finish(n.cell, cost);
        frontier.push(n.cell);
      }
    }

    // 다음 층. 여기서 처음으로 잉크가 한 칸 몫 더 든다.
    cost += INK_COST;
    frontier = [];

    for (const { cell, via } of next) {
      const k = at(cell);
      if (prev.has(k)) continue;    // 같은 층에서 공짜로 이미 닿았다

      prev.set(k, via);
      cellOf.set(k, cell);
      if (reached(cell)) return finish(cell, cost);
      frontier.push(cell);
    }
  }

  return null;
}
