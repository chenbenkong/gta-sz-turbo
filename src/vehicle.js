// Procedural low-poly vehicles + arcade driving physics.

import { createMesh, VERT_STRIDE } from './gl.js';
import { clamp, wrapAngle, lerp, approachAngle, m4compose } from './math.js';

function V(arr, x, y, z, nx, ny, nz, u, v, r, g, b) {
  arr.push(x, y, z, nx, ny, nz, u, v, r, g, b);
}

function quad(arr, idx, p0, p1, p2, p3, n, c) {
  const base = arr.length / VERT_STRIDE;
  V(arr, p0[0], p0[1], p0[2], n[0], n[1], n[2], 0, 0, c[0], c[1], c[2]);
  V(arr, p1[0], p1[1], p1[2], n[0], n[1], n[2], 1, 0, c[0], c[1], c[2]);
  V(arr, p2[0], p2[1], p2[2], n[0], n[1], n[2], 1, 1, c[0], c[1], c[2]);
  V(arr, p3[0], p3[1], p3[2], n[0], n[1], n[2], 0, 1, c[0], c[1], c[2]);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function tri(arr, idx, p0, p1, p2, n, c) {
  const base = arr.length / VERT_STRIDE;
  V(arr, p0[0], p0[1], p0[2], n[0], n[1], n[2], 0, 0, c[0], c[1], c[2]);
  V(arr, p1[0], p1[1], p1[2], n[0], n[1], n[2], 1, 0, c[0], c[1], c[2]);
  V(arr, p2[0], p2[1], p2[2], n[0], n[1], n[2], 0.5, 1, c[0], c[1], c[2]);
  idx.push(base, base + 1, base + 2);
}

/** Build a stylized car mesh. type: sedan|sports|suv|taxi|police */
export function buildCarMesh(gl, type = 'sedan') {
  const Varr = [], I = [];
  // Material IDs (must match CAR_FS_CLEAN thresholds)
  const body = [1, 1, 1];
  const glass = [0, 0, 1];
  const rubber = [0, 0.5, 0];
  const head = [1, 1, 0];
  const tail = [1, 0, 0];
  const dark = [0, 0, 0];
  const chrome = [0.5, 0.5, 0.5];

  let L = 4.8, W = 2.0, H = 0.7, cabinH = 0.62, cabinL = 2.2;
  if (type === 'sports') { L = 4.6; W = 2.05; H = 0.55; cabinH = 0.5; cabinL = 1.7; }
  if (type === 'suv') { L = 5.1; W = 2.15; H = 0.9; cabinH = 0.75; cabinL = 2.5; }
  if (type === 'taxi') { L = 4.9; W = 2.0; H = 0.72; cabinH = 0.65; cabinL = 2.3; }
  if (type === 'police') { L = 5.0; W = 2.05; H = 0.72; cabinH = 0.65; cabinL = 2.3; }

  const z0 = -L / 2, z1 = L / 2;
  const x0 = -W / 2, x1 = W / 2;
  const y0 = 0.30, y1 = 0.30 + H;
  const yTop = y1 + cabinH;

  // Lower body (chassis) — slight taper
  const yLow = y0;
  quad(Varr, I, [x0, yLow, z1 - 0.15], [x1, yLow, z1 - 0.15], [x1, y1, z1], [x0, y1, z1], [0, 0.2, 1], body);
  quad(Varr, I, [x1, yLow, z0 + 0.15], [x0, yLow, z0 + 0.15], [x0, y1, z0], [x1, y1, z0], [0, 0.2, -1], body);
  quad(Varr, I, [x0, yLow, z0 + 0.1], [x0, yLow, z1 - 0.1], [x0, y1, z1], [x0, y1, z0], [-1, 0.1, 0], body);
  quad(Varr, I, [x1, yLow, z1 - 0.1], [x1, yLow, z0 + 0.1], [x1, y1, z0], [x1, y1, z1], [1, 0.1, 0], body);
  // hood / trunk tops
  quad(Varr, I, [x0, y1, z1], [x1, y1, z1], [x1, y1, z1 - 1.3], [x0, y1, z1 - 1.3], [0, 1, 0], body);
  quad(Varr, I, [x0, y1, z0 + 1.1], [x1, y1, z0 + 1.1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], body);
  quad(Varr, I, [x0, yLow, z0], [x1, yLow, z0], [x1, yLow, z1], [x0, yLow, z1], [0, -1, 0], dark);

  // Cabin greenhouse — taller & wider glass so chase cam reads it
  const cz0 = z0 + 0.7, cz1 = z0 + 0.7 + cabinL;
  const inset = 0.05;
  const cx0 = x0 + inset, cx1 = x1 - inset;
  const roofInset = 0.18;
  // windshield (more rake)
  quad(Varr, I, [cx0, y1, cz1], [cx1, y1, cz1], [cx1 - roofInset, yTop, cz1 - 0.7], [cx0 + roofInset, yTop, cz1 - 0.7], [0, 0.45, 0.85], glass);
  // rear glass (more visible from chase cam)
  quad(Varr, I, [cx1, y1, cz0], [cx0, y1, cz0], [cx0 + roofInset, yTop, cz0 + 0.35], [cx1 - roofInset, yTop, cz0 + 0.35], [0, 0.4, -0.85], glass);
  // side glass
  quad(Varr, I, [cx0, y1, cz0], [cx0, y1, cz1], [cx0 + roofInset, yTop, cz1 - 0.7], [cx0 + roofInset, yTop, cz0 + 0.35], [-1, 0.05, 0], glass);
  quad(Varr, I, [cx1, y1, cz1], [cx1, y1, cz0], [cx1 - roofInset, yTop, cz0 + 0.35], [cx1 - roofInset, yTop, cz1 - 0.7], [1, 0.05, 0], glass);
  // roof (chrome-gray so tops aren't a flat paint slab from chase cam)
  quad(Varr, I, [cx0 + roofInset, yTop, cz1 - 0.7], [cx1 - roofInset, yTop, cz1 - 0.7], [cx1 - roofInset, yTop, cz0 + 0.35], [cx0 + roofInset, yTop, cz0 + 0.35], [0, 1, 0], chrome);

  // Chrome window trim (thin bars along beltline)
  const belt = y1 + 0.02;
  quad(Varr, I, [cx0 - 0.02, belt, cz0], [cx0 - 0.02, belt, cz1], [cx0 - 0.02, belt + 0.05, cz1], [cx0 - 0.02, belt + 0.05, cz0], [-1, 0, 0], chrome);
  quad(Varr, I, [cx1 + 0.02, belt, cz1], [cx1 + 0.02, belt, cz0], [cx1 + 0.02, belt + 0.05, cz0], [cx1 + 0.02, belt + 0.05, cz1], [1, 0, 0], chrome);

  // C-pillars (body color)
  quad(Varr, I, [x0, y1, cz0], [cx0, y1, cz0], [cx0 + roofInset, yTop, cz0 + 0.35], [x0, yTop, cz0 + 0.15], [-0.5, 0.2, -0.7], body);
  quad(Varr, I, [cx1, y1, cz0], [x1, y1, cz0], [x1, yTop, cz0 + 0.15], [cx1 - roofInset, yTop, cz0 + 0.35], [0.5, 0.2, -0.7], body);

  // Headlights (pods)
  const hw = 0.32, hh = 0.16, hy = y1 - 0.32;
  quad(Varr, I, [x0 + 0.12, hy, z1 + 0.02], [x0 + 0.12 + hw, hy, z1 + 0.02], [x0 + 0.12 + hw, hy + hh, z1 + 0.02], [x0 + 0.12, hy + hh, z1 + 0.02], [0, 0, 1], head);
  quad(Varr, I, [x1 - 0.12 - hw, hy, z1 + 0.02], [x1 - 0.12, hy, z1 + 0.02], [x1 - 0.12, hy + hh, z1 + 0.02], [x1 - 0.12 - hw, hy + hh, z1 + 0.02], [0, 0, 1], head);

  // Taillights (full-width bar + chrome strip)
  quad(Varr, I, [x0 + 0.1, y1 - 0.32, z0 - 0.02], [x1 - 0.1, y1 - 0.32, z0 - 0.02], [x1 - 0.1, y1 - 0.1, z0 - 0.02], [x0 + 0.1, y1 - 0.1, z0 - 0.02], [0, 0, -1], tail);
  quad(Varr, I, [x0 + 0.1, y1 - 0.08, z0 - 0.03], [x1 - 0.1, y1 - 0.08, z0 - 0.03], [x1 - 0.1, y1 - 0.02, z0 - 0.03], [x0 + 0.1, y1 - 0.02, z0 - 0.03], [0, 0, -1], chrome);

  // Bumpers
  quad(Varr, I, [x0, yLow + 0.05, z1 + 0.05], [x1, yLow + 0.05, z1 + 0.05], [x1, yLow + 0.28, z1 + 0.02], [x0, yLow + 0.28, z1 + 0.02], [0, 0, 1], dark);
  quad(Varr, I, [x1, yLow + 0.05, z0 - 0.05], [x0, yLow + 0.05, z0 - 0.05], [x0, yLow + 0.28, z0 - 0.02], [x1, yLow + 0.28, z0 - 0.02], [0, 0, -1], dark);

  // Wheels + arches
  const wr = 0.34, ww = 0.24;
  const wzF = z1 - 0.75, wzR = z0 + 0.7;
  function wheel(cx, cz) {
    // tire
    quad(Varr, I, [cx - ww, 0.04, cz - wr], [cx - ww, 0.04, cz + wr], [cx - ww, 0.04 + wr * 2, cz + wr], [cx - ww, 0.04 + wr * 2, cz - wr], [-1, 0, 0], rubber);
    quad(Varr, I, [cx + ww, 0.04, cz + wr], [cx + ww, 0.04, cz - wr], [cx + ww, 0.04 + wr * 2, cz - wr], [cx + ww, 0.04 + wr * 2, cz + wr], [1, 0, 0], rubber);
    quad(Varr, I, [cx - ww, 0.04, cz + wr], [cx + ww, 0.04, cz + wr], [cx + ww, 0.04 + wr * 2, cz + wr], [cx - ww, 0.04 + wr * 2, cz + wr], [0, 0, 1], rubber);
    quad(Varr, I, [cx + ww, 0.04, cz - wr], [cx - ww, 0.04, cz - wr], [cx - ww, 0.04 + wr * 2, cz - wr], [cx + ww, 0.04 + wr * 2, cz - wr], [0, 0, -1], rubber);
    // hub caps
    const hc = chrome;
    quad(Varr, I, [cx - ww - 0.02, 0.1, cz - wr * 0.5], [cx - ww - 0.02, 0.1, cz + wr * 0.5], [cx - ww - 0.02, 0.1 + wr, cz + wr * 0.5], [cx - ww - 0.02, 0.1 + wr, cz - wr * 0.5], [-1, 0, 0], hc);
    quad(Varr, I, [cx + ww + 0.02, 0.1, cz + wr * 0.5], [cx + ww + 0.02, 0.1, cz - wr * 0.5], [cx + ww + 0.02, 0.1 + wr, cz - wr * 0.5], [cx + ww + 0.02, 0.1 + wr, cz + wr * 0.5], [1, 0, 0], hc);
  }
  wheel(x0 + 0.08, wzF);
  wheel(x1 - 0.08, wzF);
  wheel(x0 + 0.08, wzR);
  wheel(x1 - 0.08, wzR);

  // side skirts
  quad(Varr, I, [x0 - 0.01, yLow + 0.05, z0 + 0.5], [x0 - 0.01, yLow + 0.05, z1 - 0.5], [x0 - 0.01, yLow + 0.22, z1 - 0.5], [x0 - 0.01, yLow + 0.22, z0 + 0.5], [-1, 0, 0], dark);
  quad(Varr, I, [x1 + 0.01, yLow + 0.05, z1 - 0.5], [x1 + 0.01, yLow + 0.05, z0 + 0.5], [x1 + 0.01, yLow + 0.22, z0 + 0.5], [x1 + 0.01, yLow + 0.22, z1 - 0.5], [1, 0, 0], dark);

  if (type === 'taxi') {
    const sc = head; // yellow-ish under head emissive; used as taxi sign
    // Use chrome-colored sign base + body
    quad(Varr, I, [x0 + 0.35, yTop, cz0 + 0.7], [x1 - 0.35, yTop, cz0 + 0.7], [x1 - 0.35, yTop + 0.2, cz0 + 0.7], [x0 + 0.35, yTop + 0.2, cz0 + 0.7], [0, 0, 1], chrome);
    quad(Varr, I, [x1 - 0.35, yTop, cz0 + 0.55], [x0 + 0.35, yTop, cz0 + 0.55], [x0 + 0.35, yTop + 0.2, cz0 + 0.55], [x1 - 0.35, yTop + 0.2, cz0 + 0.55], [0, 0, -1], chrome);
    quad(Varr, I, [x0 + 0.35, yTop + 0.2, cz0 + 0.55], [x0 + 0.35, yTop + 0.2, cz0 + 0.7], [x1 - 0.35, yTop + 0.2, cz0 + 0.7], [x1 - 0.35, yTop + 0.2, cz0 + 0.55], [0, 1, 0], head);
  }

  if (type === 'police') {
    quad(Varr, I, [x0 + 0.4, yTop, cz0 + 0.7], [x0 + 0.7, yTop, cz0 + 0.7], [x0 + 0.7, yTop + 0.14, cz0 + 0.7], [x0 + 0.4, yTop + 0.14, cz0 + 0.7], [0, 0, 1], tail);
    quad(Varr, I, [x0 + 0.75, yTop, cz0 + 0.7], [x0 + 1.05, yTop, cz0 + 0.7], [x0 + 1.05, yTop + 0.14, cz0 + 0.7], [x0 + 0.75, yTop + 0.14, cz0 + 0.7], [0, 0, 1], glass);
  }

  return createMesh(gl, new Float32Array(Varr), I);
}

export const CAR_TYPES = [
  { type: 'sedan', paint: [0.75, 0.15, 0.12], name: '街头轿车' },
  { type: 'sports', paint: [0.95, 0.75, 0.1], name: '超跑' },
  { type: 'suv', paint: [0.2, 0.35, 0.55], name: 'SUV' },
  { type: 'taxi', paint: [0.9, 0.7, 0.1], name: '出租车' },
  { type: 'police', paint: [0.12, 0.14, 0.18], name: '警车' },
];

/**
 * Arcade vehicle state.
 * Heading: 0 = +Z forward (we use yaw around Y, 0 = +X in XZ... use yaw with cos/sin on XZ)
 * Position x,z on ground plane; y is up.
 */
export function createVehicle(x, z, yaw, opts = {}) {
  return {
    x, z, y: 0,
    yaw,
    speed: 0,          // m/s along heading
    steer: 0,          // visual steer
    vy: 0,
    pitch: 0,
    roll: 0,
    type: opts.type || 'sedan',
    paint: opts.paint || [0.75, 0.15, 0.12],
    brake: 0,
    headlights: 1,
    // physics params
    accel: opts.accel ?? 14,
    brakePower: opts.brakePower ?? 28,
    maxSpeed: opts.maxSpeed ?? 55, // ~200 km/h
    maxReverse: opts.maxReverse ?? 12,
    turnRate: opts.turnRate ?? 1.8,
    grip: opts.grip ?? 0.92,
    drift: 0,
    // AI
    ai: opts.ai || null,
  };
}

export function stepVehicle(v, input, dt) {
  const throttle = input.throttle;   // -1..1
  const steerIn = input.steer;       // -1..1
  const handbrake = input.handbrake ? 1 : 0;

  // speed
  if (throttle > 0) {
    v.speed += v.accel * throttle * dt * (1 - Math.max(0, v.speed) / (v.maxSpeed * 1.15));
    if (v.speed < 0) v.speed += v.brakePower * throttle * dt; // reverse brake
  } else if (throttle < 0) {
    if (v.speed > 0.5) {
      v.speed += v.brakePower * throttle * dt;
    } else {
      v.speed += v.accel * 0.55 * throttle * dt;
    }
  } else {
    // coast drag
    const drag = 0.55 + Math.abs(v.speed) * 0.02;
    if (v.speed > 0) v.speed = Math.max(0, v.speed - drag * dt * 3);
    else if (v.speed < 0) v.speed = Math.min(0, v.speed + drag * dt * 3);
  }

  if (handbrake) {
    v.speed *= Math.pow(0.35, dt * 4);
  }

  v.speed = clamp(v.speed, -v.maxReverse, v.maxSpeed);
  v.brake = lerp(v.brake, throttle < -0.1 || handbrake ? 1 : 0, 1 - Math.pow(0.001, dt));

  // steering — less effective at high speed
  const speedFactor = 1 / (1 + Math.abs(v.speed) * 0.04);
  const targetSteer = steerIn;
  v.steer = lerp(v.steer, targetSteer, 1 - Math.pow(0.0008, dt));
  const turn = v.steer * v.turnRate * speedFactor * (v.speed >= 0 ? 1 : -1) * Math.sign(v.speed || 1);
  if (Math.abs(v.speed) > 0.4) {
    v.yaw += turn * dt * (handbrake ? 1.55 : 1);
  }

  // drift / slide visual
  const driftTarget = handbrake && Math.abs(v.speed) > 8 ? Math.sign(v.steer) * 0.4 : 0;
  v.drift = lerp(v.drift, driftTarget, 1 - Math.pow(0.02, dt));
  v.roll = lerp(v.roll, -v.steer * 0.06 * Math.min(1, Math.abs(v.speed) / 20), 1 - Math.pow(0.01, dt));
  v.pitch = lerp(v.pitch, (throttle > 0 ? -0.02 : throttle < 0 ? 0.03 : 0) * Math.min(1, Math.abs(v.speed) / 15), 1 - Math.pow(0.01, dt));

  // integrate position (heading: yaw=0 faces +Z)
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
  v.x += fx * v.speed * dt;
  v.z += fz * v.speed * dt;
  v.y = 0;
}

export function vehicleModelMatrix(v, out) {
  return m4compose(out, v.x, v.y, v.z, v.yaw, v.pitch, v.roll + v.drift * 0.15);
}

/** Simple AABB-ish building collision push-out (circle vs building footprints). */
export function collideBuildings(v, buildings, radius = 1.4) {
  // cheap: only test nearby via spatial hash built once
  if (!collideBuildings._built && buildings?.length) {
    const cell = 40;
    const grid = new Map();
    for (const b of buildings) {
      const ring = b.rings?.[0];
      if (!ring) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of ring) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
      const item = { minX, maxX, minZ, maxZ, ring };
      for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
        for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
          const key = cx + ',' + cz;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(item);
        }
      }
    }
    collideBuildings._grid = grid;
    collideBuildings._cell = cell;
    collideBuildings._built = true;
  }
  const grid = collideBuildings._grid;
  if (!grid) return false;
  const cell = collideBuildings._cell;
  const cx = Math.floor(v.x / cell), cz = Math.floor(v.z / cell);
  let hit = false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get((cx + dx) + ',' + (cz + dz));
      if (!list) continue;
      for (const b of list) {
        // expand AABB by radius
        if (v.x < b.minX - radius || v.x > b.maxX + radius) continue;
        if (v.z < b.minZ - radius || v.z > b.maxZ + radius) continue;
        // point-in-expanded-polygon approx via AABB push
        let px = v.x, pz = v.z;
        if (px < b.minX) px = b.minX;
        if (px > b.maxX) px = b.maxX;
        if (pz < b.minZ) pz = b.minZ;
        if (pz > b.maxZ) pz = b.maxZ;
        let dx2 = v.x - px, dz2 = v.z - pz;
        const d = Math.hypot(dx2, dz2);
        if (d < radius) {
          // inside or near — if inside AABB, push to nearest face
          if (d < 0.001) {
            const left = v.x - b.minX, right = b.maxX - v.x;
            const near = v.z - b.minZ, far = b.maxZ - v.z;
            const m = Math.min(left, right, near, far);
            if (m === left) v.x = b.minX - radius;
            else if (m === right) v.x = b.maxX + radius;
            else if (m === near) v.z = b.minZ - radius;
            else v.z = b.maxZ + radius;
          } else {
            v.x = px + (dx2 / d) * radius;
            v.z = pz + (dz2 / d) * radius;
          }
          v.speed *= 0.55;
          hit = true;
        }
      }
    }
  }
  return hit;
}

/** Keep vehicle roughly on a drivable corridor (roads). Soft constraint. */
export function keepOnRoads(v, nav, strength = 0.15) {
  if (!nav) return;
  // gentle pull to nearest node if far from any
  const { nearestNode } = requireNearest();
  const n = nearestNode(nav, v.x, v.z);
  const node = nav.nodes[n];
  if (!node) return;
  const dx = node[0] - v.x, dz = node[1] - v.z;
  const d = Math.hypot(dx, dz);
  if (d > 18) {
    const pull = Math.min(8, (d - 18) * strength);
    v.x += (dx / d) * pull * 0.02;
    v.z += (dz / d) * pull * 0.02;
  }
}

function requireNearest() {
  // avoid circular import — duplicate tiny helper
  return {
    nearestNode(graph, x, z) {
      let best = 0, bd = Infinity;
      const nodes = graph.nodes;
      for (let i = 0; i < nodes.length; i += 8) {
        const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      // refine
      const s = Math.max(0, best - 8), e = Math.min(nodes.length, best + 8);
      for (let i = s; i < e; i++) {
        const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
  };
}
