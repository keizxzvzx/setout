// 이동 그래프와 길찾기 — 이어져 보이면 이어진 것이다
//
// 이 파일은 순수하다. board 도 iso 의 뷰 상태도 읽지 않고, 판 칸 목록만 받는다.
// 6단계 AI 디렉터가 "이 배치가 풀리는가" 를 물을 때 아직 존재하지도 않는
// 가상의 배치에 대고 물어야 하기 때문이다. 살아 있는 게임 상태를 한 줄이라도
// 읽으면 그 순간 솔버로 재사용할 수 없게 된다.

// 판 칸이 화면에서 어느 바닥 자리에 나타나는가.
//
// 투영식을 풀면 (x, y, z) 는 바닥의 (x−z, y−z) 자리에 나타난다.
// 화면 좌표를 픽셀로 계산할 필요가 없다 — 격자 정수만으로 충분하다.
// 덕분에 이 파일이 카메라·배율과 무관해진다.
export const screenCell = (c) => ({ x: c.x - c.z, y: c.y - c.z });

// 두 칸이 화면상 한 칸 옆인가. 이것이 이 게임의 길 판정 전부다.
//
// 사방 인접만 길이 된다. 대각은 화면에서 한 칸 옆이 아니라 두 칸 건너이므로
// 이어져 보이지 않는다. 판을 한 장으로 묶는 기준(대각 포함)과 일부러 다르다.
export function isAdjacent(a, b) {
  const p = screenCell(a);
  const q = screenCell(b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
}

// 그 길이 착시인가.
//
// 화면상 인접한 두 칸이 z 까지 같으면 (x−z, y−z) 의 차가 그대로 (x, y) 의
// 차이므로 3D 에서도 인접이다 — 진짜 길. z 가 다르면 3D 에서는 절대 인접일
// 수 없다 — 착시 길. 그래서 판정이 z 비교 한 줄로 끝난다.
//
// 게임 안에는 이 구분이 드러나지 않는다. 6단계 디렉터가
// "최소 해법이 착시를 요구하는가" 를 볼 때와 플레이어 성향 지표에만 쓴다.
export function isIllusion(a, b) {
  return a.z !== b.z;
}

// 화면상 사방 인접. solver.js 도 이것을 쓴다 — 길 판정의 기준이 두 벌이 되면
// "솔버는 풀린다는데 실제로는 못 간다" 가 된다.
export const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const skey = (x, y) => x + ',' + y;

// 화면 자리 → 그 자리에서 실제로 보이는 칸. 이웃 조회를 O(1) 로 만든다.
//
// 한 화면 자리에 여러 칸이 올 수 있다. (2,2,z=0) 과 (5,5,z=3) 은 둘 다 바닥
// (2,2) 자리에 나타나고, 화면에서는 위의 것만 보인다.
//
// 그중 무엇이 보이는가는 정렬 키를 펴 보면 나온다. 같은 자리 (gx, gy) 위의
// 후보는 (gx+z, gy+z, z) 뿐이므로
//
//   depthKey = x + y + z = gx + gy + 3z
//
// 로 z 에 대해 단조증가한다. **z 가 가장 큰 것이 언제나 위**다.
// render 의 깊이 정렬, board 의 pickAt 과 같은 식이라 셋이 어긋날 수 없다.
//
// 여기서 하나만 남기는 것이 이 게임의 규칙 그 자체다.
// "이어져 보인다면 이어진 것이다" 의 역이 성립해야 한다 — 보이지 않는 것은
// 건널 수 없어야 한다. 전부 길로 치면 판에 파묻힌 칸 위로 캐릭터가 지나가고,
// 튜토리얼 문구가 없는 게임에서 플레이어는 무슨 일이 일어났는지 알 수 없다.
//
// pickAt 을 부르지 않고 같은 규칙을 스냅샷 위에 다시 세운 이유는 순수성이다.
// pickAt 은 살아 있는 board 를 읽으므로, 부르는 순간 6단계 디렉터가 가상의
// 배치를 물어볼 수 없게 된다.
//
// 6단계 솔버도 이 함수를 그대로 부른다. "무엇이 보이는가" 의 사본이 셋이
// 되면(render / board.pickAt / 여기) 어긋날 자리가 하나 더 늘고, 어긋난
// 증상은 "이어져 보이는데 못 건너간다" 로만 나타난다.
export function visibleByScreen(cells) {
  const map = new Map();
  for (const c of cells) {
    const s = screenCell(c);
    const k = skey(s.x, s.y);
    const seen = map.get(k);
    if (!seen || c.z > seen.z) map.set(k, c);
  }
  return map;
}

// 스냅샷에서 화면에 실제로 보이는 칸만 남긴다.
// 6단계 솔버가 "이 배치에서 플레이어가 볼 수 있는 것" 을 물을 때 쓴다.
export function visibleCells(cells) {
  return [...visibleByScreen(cells).values()];
}

// 최단 경로. 없으면 null.
//
// 도달 여부가 아니라 경로를 돌려준다. 솔버는 "풀리는가" 만이 아니라
// "그 해법이 착시를 요구하는가" 를 물어야 하는데, 그것은 경로의 간선을
// 봐야만 답할 수 있다.
export function findPath(cells, from, to) {
  const at = (c) => skey(c.x, c.y);
  if (at(from) === at(to)) return [from];

  const byScreen = visibleByScreen(cells);
  const prev = new Map([[at(from), null]]);
  let frontier = [from];

  while (frontier.length) {
    const next = [];

    for (const c of frontier) {
      const s = screenCell(c);

      for (const [dx, dy] of NEIGHBORS) {
        // 그 자리에서 보이는 칸 하나뿐이다. 가려진 칸은 애초에 후보가 아니다.
        const n = byScreen.get(skey(s.x + dx, s.y + dy));
        if (!n) continue;

        const k = at(n);
        if (prev.has(k)) continue;
        prev.set(k, c);

        if (k === at(to)) {
          // 도착했으므로 거슬러 올라가 경로를 복원한다
          const path = [n];
          for (let p = c; p; p = prev.get(at(p))) path.push(p);
          return path.reverse();
        }
        next.push(n);
      }
    }

    frontier = next;
  }

  return null;
}

// 경로가 착시 간선을 하나라도 쓰는가.
// 6단계의 "최소 해법이 착시를 요구하는가" 와 플레이어 지표가 이것을 쓴다.
export function usesIllusion(path) {
  if (!path) return false;
  for (let i = 1; i < path.length; i++) {
    if (isIllusion(path[i - 1], path[i])) return true;
  }
  return false;
}
