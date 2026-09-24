// Build merged city meshes from city.json (OSM-derived Shenzhen).
// Vertex layout matches gl.js VERT_STRIDE: pos3 nrm3 uv2 col3.

import { VERT_STRIDE, createMesh } from './gl.js';

function pushVert(arr, x, y, z, nx, ny, nz, u, v, r, g, b) {
  arr.push(x, y, z, nx, ny, nz, u, v, r, g, b);
}

/** Append a quad (two tris) into vertex/index arrays. */
function addQuad(V, I, p0, p1, p2, p3, n, u0, u1, u2, u3, c0, c1, c2, c3) {
  const base = V.length / VERT_STRIDE;
  pushVert(V, p0[0], p0[1], p0[2], n[0], n[1], n[2], u0[0], u0[1], c0[0], c0[1], c0[2]);
  pushVert(V, p1[0], p1[1], p1[2], n[0], n[1], n[2], u1[0], u1[1], c1[0], c1[1], c1[2]);
  pushVert(V, p2[0], p2[1], p2[2], n[0], n[1], n[2], u2[0], u2[1], c2[0], c2[1], c2[2]);
  pushVert(V, p3[0], p3[1], p3[2], n[0], n[1], n[2], u3[0], u3[1], c3[0], c3[1], c3[2]);
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function addTri(V, I, p0, p1, p2, n, u0, u1, u2, c0, c1, c2) {
  const base = V.length / VERT_STRIDE;
  pushVert(V, p0[0], p0[1], p0[2], n[0], n[1], n[2], u0[0], u0[1], c0[0], c0[1], c0[2]);
  pushVert(V, p1[0], p1[1], p1[2], n[0], n[1], n[2], u1[0], u1[1], c1[0], c1[1], c1[2]);
  pushVert(V, p2[0], p2[1], p2[2], n[0], n[1], n[2], u2[0], u2[1], c2[0], c2[1], c2[2]);
  I.push(base, base + 1, base + 2);
}

/** Fan-triangulate a polygon (assumes roughly convex). */
function addPoly(V, I, pts, n, y, color, uvScale = 0.05) {
  if (pts.length < 3) return;
  for (let i = 1; i < pts.length - 1; i++) {
    addTri(
      V, I,
      [pts[0][0], y, pts[0][1]],
      [pts[i][0], y, pts[i][1]],
      [pts[i + 1][0], y, pts[i + 1][1]],
      n,
      [pts[0][0] * uvScale, pts[0][1] * uvScale],
      [pts[i][0] * uvScale, pts[i][1] * uvScale],
      [pts[i + 1][0] * uvScale, pts[i + 1][1] * uvScale],
      color, color, color
    );
  }
}

const STYLE_COLORS = {
  office: [0.78, 0.80, 0.84],
  residential: [0.84, 0.76, 0.66],
  commercial: [0.80, 0.74, 0.68],
  industrial: [0.68, 0.68, 0.66],
  retail: [0.82, 0.72, 0.60],
  default: [0.76, 0.74, 0.70],
};

function styleColor(style, seed) {
  const base = STYLE_COLORS[style] || STYLE_COLORS.default;
  const j = ((seed % 100) / 100 - 0.5) * 0.08;
  return [
    Math.min(1, Math.max(0, base[0] + j)),
    Math.min(1, Math.max(0, base[1] + j * 0.7)),
    Math.min(1, Math.max(0, base[2] + j * 0.5)),
  ];
}

const ROAD_WIDTH = {
  trunk: 18,
  trunk_link: 10,
  primary: 14,
  primary_link: 9,
  secondary: 11,
  secondary_link: 8,
  tertiary: 9,
  tertiary_link: 7,
  residential: 7.5,
  service: 5,
  unclassified: 6,
};

function roadWidth(kind, declared) {
  if (declared && declared > 2) return Math.min(declared, 24);
  return ROAD_WIDTH[kind] || 7;
}

/** Extrude building footprint into walls + roof. */
function addBuilding(V, I, building) {
  const rings = building.rings;
  if (!rings || !rings.length) return;
  const h = Math.max(4, Math.min(building.height || 10, 320));
  const col = styleColor(building.style, building.seed || 0);
  const roofCol = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.58];

  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    // Ensure CCW when viewed from above (XZ)
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const pts = area < 0 ? ring.slice().reverse() : ring;

    // Walls
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const nx = dz / len, nz = -dx / len; // outward for CCW
      const u0 = dist * 0.12, u1 = (dist + len) * 0.12;
      const v1 = h * 0.12;
      // slightly randomize wall shade by edge
      const shade = 0.92 + 0.08 * ((i * 17) % 7) / 7;
      const wc = [col[0] * shade, col[1] * shade, col[2] * shade];
      addQuad(
        V, I,
        [a[0], 0, a[1]],
        [b[0], 0, b[1]],
        [b[0], h, b[1]],
        [a[0], h, a[1]],
        [nx, 0, nz],
        [u0, 0], [u1, 0], [u1, v1], [u0, v1],
        wc, wc, wc, wc
      );
      dist += len;
    }

    // Roof
    addPoly(V, I, pts.map(p => [p[0], p[1]]), [0, 1, 0], h, roofCol, 0.03);
  }
}

/** Road ribbon along polyline with dashed centerline + edge lines. */
function addRoadSegment(V, I, pts, width, color, y = 0.05) {
  const half = width * 0.5;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const nx = -dz / len * half, nz = dx / len * half;
    const s0 = i * 8, s1 = (i + 1) * 8;
    const edge = [0.55, 0.55, 0.52];
    const paint = [0.7, 0.68, 0.58];
    // main asphalt
    addQuad(
      V, I,
      [a[0] + nx, y, a[1] + nz], [a[0] - nx, y, a[1] - nz],
      [b[0] - nx, y, b[1] - nz], [b[0] + nx, y, b[1] + nz],
      [0, 1, 0], [0, s0], [1, s0], [1, s1], [0, s1],
      color, color, color, color
    );
    // edge lines
    const ew = width * 0.06;
    addQuad(
      V, I,
      [a[0] + nx * 0.92, y + 0.01, a[1] + nz * 0.92], [a[0] + nx * (0.92 - ew), y + 0.01, a[1] + nz * (0.92 - ew)],
      [b[0] + nx * (0.92 - ew), y + 0.01, b[1] + nz * (0.92 - ew)], [b[0] + nx * 0.92, y + 0.01, b[1] + nz * 0.92],
      [0, 1, 0], [0, s0], [1, s0], [1, s1], [0, s1],
      edge, edge, edge, edge
    );
    addQuad(
      V, I,
      [a[0] - nx * (0.92 - ew), y + 0.01, a[1] - nz * (0.92 - ew)], [a[0] - nx * 0.92, y + 0.01, a[1] - nz * 0.92],
      [b[0] - nx * 0.92, y + 0.01, b[1] - nz * 0.92], [b[0] - nx * (0.92 - ew), y + 0.01, b[1] - nz * (0.92 - ew)],
      [0, 1, 0], [0, s0], [1, s0], [1, s1], [0, s1],
      edge, edge, edge, edge
    );
    // dashed centerline (short quads every other segment-ish)
    if (i % 2 === 0 && width > 6) {
      const cw = width * 0.04;
      addQuad(
        V, I,
        [a[0] + cw, y + 0.015, a[1]], [a[0] - cw, y + 0.015, a[1]],
        [b[0] - cw, y + 0.015, b[1]], [b[0] + cw, y + 0.015, b[1]],
        [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1],
        paint, paint, paint, paint
      );
    }
  }
}

function pointInPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    const hit = ((zi > z) !== (zj > z)) &&
      (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * Build all static city meshes.
 * @returns {{ground, roads, buildings, water, green, landmarks, identity, stats}}
 */
export function buildCity(gl, city) {
  const groundV = [], groundI = [];
  const roadV = [], roadI = [];
  const bldV = [], bldI = [];
  const waterV = [], waterI = [];
  const greenV = [], greenI = [];
  const markV = [], markI = [];

  // Land polygon for coastal silhouette
  const landRing = city.land?.[0]?.value || city.land?.[0] || null;

  // Sea / base water plane (slightly below land)
  {
    const S = 9000;
    const sea = [0.12, 0.32, 0.42];
    addQuad(
      waterV, waterI,
      [-S, -0.12, -S], [-S, -0.12, S], [S, -0.12, S], [S, -0.12, -S],
      [0, 1, 0],
      [0, 0], [0, 20], [20, 20], [20, 0],
      sea, sea, sea, sea
    );
  }

  // Land ground: grid cells inside land polygon (gives a clean coastline)
  if (landRing && landRing.length >= 3) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of landRing) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
    const cell = 80;
    const landCol = [0.45, 0.47, 0.42];
    for (let x = minX; x < maxX; x += cell) {
      for (let z = minZ; z < maxZ; z += cell) {
        const cx = x + cell * 0.5, cz = z + cell * 0.5;
        if (!pointInPoly(cx, cz, landRing)) continue;
        addQuad(
          groundV, groundI,
          [x, 0, z], [x, 0, z + cell], [x + cell, 0, z + cell], [x + cell, 0, z],
          [0, 1, 0],
          [x * 0.02, z * 0.02], [x * 0.02, (z + cell) * 0.02],
          [(x + cell) * 0.02, (z + cell) * 0.02], [(x + cell) * 0.02, z * 0.02],
          landCol, landCol, landCol, landCol
        );
      }
    }
  } else {
    const S = 8000;
    const gcol = [0.38, 0.40, 0.36];
    addQuad(
      groundV, groundI,
      [-S, 0, -S], [-S, 0, S], [S, 0, S], [S, 0, -S],
      [0, 1, 0],
      [0, 0], [0, 20], [20, 20], [20, 0],
      gcol, gcol, gcol, gcol
    );
  }

  // Water (lakes / harbors)
  const waterCol = [0.15, 0.35, 0.45];
  for (const w of city.water || []) {
    const rr = w.rings || [];
    for (const ring of rr) {
      if (ring && ring.length >= 3) addPoly(waterV, waterI, ring, [0, 1, 0], 0.0, waterCol, 0.01);
    }
  }

  // Green parks
  const greenCol = [0.32, 0.50, 0.28];
  for (const g of city.green || []) {
    for (const ring of g.rings || []) {
      if (ring && ring.length >= 3) addPoly(greenV, greenI, ring, [0, 1, 0], 0.02, greenCol, 0.02);
    }
  }

  // Roads — solid asphalt with baked lane paint (no texture multiply)
  const majorCol = [0.28, 0.28, 0.30];
  const minorCol = [0.32, 0.32, 0.34];
  for (const r of city.roads || []) {
    const pts = r.points;
    if (!pts || pts.length < 2) continue;
    const w = roadWidth(r.kind, r.width);
    const major = r.kind === 'trunk' || r.kind === 'primary' || r.kind === 'secondary' || r.kind === 'trunk_link' || r.kind === 'primary_link';
    addRoadSegment(roadV, roadI, pts, w, major ? majorCol : minorCol, major ? 0.12 : 0.10);
  }

  // Buildings
  for (const b of city.buildings || []) {
    addBuilding(bldV, bldI, b);
  }

  // Landmarks: emphasize with taller boxes if no footprint
  const lmCol = [0.75, 0.72, 0.70];
  for (const lm of city.landmarks || []) {
    const x = lm.x, z = lm.z, h = lm.height || 80;
    const rx = 18, rz = 14;
    // simple tower box
    const y = 0, hh = h;
    addQuad(markV, markI, [x - rx, y, z - rz], [x + rx, y, z - rz], [x + rx, hh, z - rz], [x - rx, hh, z - rz], [0, 0, -1], [0, 0], [1, 0], [1, hh * 0.08], [0, hh * 0.08], lmCol, lmCol, lmCol, lmCol);
    addQuad(markV, markI, [x + rx, y, z - rz], [x + rx, y, z + rz], [x + rx, hh, z + rz], [x + rx, hh, z - rz], [1, 0, 0], [0, 0], [1, 0], [1, hh * 0.08], [0, hh * 0.08], lmCol, lmCol, lmCol, lmCol);
    addQuad(markV, markI, [x + rx, y, z + rz], [x - rx, y, z + rz], [x - rx, hh, z + rz], [x + rx, hh, z + rz], [0, 0, 1], [0, 0], [1, 0], [1, hh * 0.08], [0, hh * 0.08], lmCol, lmCol, lmCol, lmCol);
    addQuad(markV, markI, [x - rx, y, z + rz], [x - rx, y, z - rz], [x - rx, hh, z - rz], [x - rx, hh, z + rz], [-1, 0, 0], [0, 0], [1, 0], [1, hh * 0.08], [0, hh * 0.08], lmCol, lmCol, lmCol, lmCol);
    addPoly(markV, markI, [[x - rx, z - rz], [x + rx, z - rz], [x + rx, z + rz], [x - rx, z + rz]], [0, 1, 0], hh, [0.5, 0.5, 0.55], 0.05);
  }

  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  return {
    ground: createMesh(gl, new Float32Array(groundV), groundI),
    roads: createMesh(gl, new Float32Array(roadV), roadI),
    buildings: createMesh(gl, new Float32Array(bldV), bldI),
    water: createMesh(gl, new Float32Array(waterV), waterI),
    green: createMesh(gl, new Float32Array(greenV), greenI),
    landmarks: createMesh(gl, new Float32Array(markV), markI),
    identity,
    stats: {
      buildings: city.buildings?.length || 0,
      roads: city.roads?.length || 0,
      water: city.water?.length || 0,
      green: city.green?.length || 0,
    },
  };
}

/** Road graph for traffic / AI from navigation.json. */
export function buildNavGraph(nav, city) {
  const nodes = nav.nodes || [];
  const edges = nav.edges || [];
  const adj = Array.from({ length: nodes.length }, () => []);
  for (const e of edges) {
    const a = e[0], b = e[1];
    if (a == null || b == null || a === b) continue;
    adj[a].push(b);
    adj[b].push(a);
  }
  return { nodes, edges, adj };
}

/** Find nearest nav node to a point. */
export function nearestNode(graph, x, z) {
  let best = 0, bd = Infinity;
  const nodes = graph.nodes;
  // coarse grid accel
  if (!nearestNode._grid) {
    const cell = 80;
    const g = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const kx = Math.floor(nodes[i][0] / cell);
      const kz = Math.floor(nodes[i][1] / cell);
      const key = kx + ',' + kz;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(i);
    }
    nearestNode._grid = { g, cell };
  }
  const { g, cell } = nearestNode._grid;
  const kx = Math.floor(x / cell), kz = Math.floor(z / cell);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = g.get((kx + dx) + ',' + (kz + dz));
      if (!list) continue;
      for (const i of list) {
        const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
  }
  return best;
}

/** Pick a random connected wander path from a node. */
export function randomWalk(graph, start, steps = 20) {
  const path = [start];
  let cur = start;
  let prev = -1;
  for (let i = 0; i < steps; i++) {
    const nbs = graph.adj[cur].filter(n => n !== prev);
    if (!nbs.length) break;
    const next = nbs[(Math.random() * nbs.length) | 0];
    path.push(next);
    prev = cur;
    cur = next;
  }
  return path;
}

/** Next node toward target using greedy local search (fast, imperfect). */
export function pathTo(graph, from, to, maxExpand = 4000) {
  if (from === to) return [from];
  const prev = new Int32Array(graph.nodes.length).fill(-1);
  const visited = new Uint8Array(graph.nodes.length);
  const q = [from];
  visited[from] = 1;
  let found = false;
  let expand = 0;
  while (q.length && expand < maxExpand) {
    // prefer expanding nodes closer to target
    let bestI = 0, bestScore = Infinity;
    for (let i = 0; i < q.length; i++) {
      const n = q[i];
      const dx = graph.nodes[n][0] - graph.nodes[to][0];
      const dz = graph.nodes[n][1] - graph.nodes[to][1];
      const sc = dx * dx + dz * dz;
      if (sc < bestScore) { bestScore = sc; bestI = i; }
    }
    const cur = q.splice(bestI, 1)[0];
    expand++;
    if (cur === to) { found = true; break; }
    for (const n of graph.adj[cur]) {
      if (visited[n]) continue;
      visited[n] = 1;
      prev[n] = cur;
      q.push(n);
    }
  }
  if (!found && !visited[to]) {
    // fallback: walk greedily
    return randomWalk(graph, from, 12);
  }
  const path = [];
  let c = to;
  while (c >= 0) {
    path.push(c);
    c = prev[c];
  }
  path.reverse();
  return path.length > 1 ? path : [from];
}
