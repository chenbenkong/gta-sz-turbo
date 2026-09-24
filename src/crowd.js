// Pedestrian crowd on sidewalk path segments.

import { m4compose } from './math.js';

/**
 * paths: flat [x1,z1,x2,z2, ...]
 * Returns pedestrians that wander along segments near the player.
 */
export function createCrowd(paths, count = 36) {
  // build segment list
  const segs = [];
  for (let i = 0; i + 3 < paths.length; i += 4) {
    const x1 = paths[i], z1 = paths[i + 1], x2 = paths[i + 2], z2 = paths[i + 3];
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 2 || len > 40) continue;
    segs.push({ x1, z1, x2, z2, len, dx: dx / len, dz: dz / len });
  }

  // spatial buckets for quick lookup
  const cell = 120;
  const grid = new Map();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const kx = Math.floor(((s.x1 + s.x2) * 0.5) / cell);
    const kz = Math.floor(((s.z1 + s.z2) * 0.5) / cell);
    const key = kx + ',' + kz;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }

  const peds = [];
  for (let i = 0; i < count; i++) {
    peds.push({
      x: 0, z: 0, yaw: 0, t: 0, dir: 1,
      seg: null, speed: 1.1 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      shirt: [0.5 + Math.random() * 0.4, 0.35 + Math.random() * 0.4, 0.3 + Math.random() * 0.4],
    });
  }

  function pickSegNear(x, z) {
    const kx = Math.floor(x / cell), kz = Math.floor(z / cell);
    const cands = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get((kx + dx) + ',' + (kz + dz));
        if (list) cands.push(...list);
      }
    }
    if (!cands.length) {
      // fallback any
      return segs.length ? segs[(Math.random() * segs.length) | 0] : null;
    }
    return segs[cands[(Math.random() * cands.length) | 0]];
  }

  function respawn(p, px, pz) {
    const s = pickSegNear(px + (Math.random() - 0.5) * 80, pz + (Math.random() - 0.5) * 80);
    if (!s) return;
    p.seg = s;
    p.t = Math.random();
    p.dir = Math.random() < 0.5 ? 1 : -1;
    p.x = s.x1 + s.dx * s.len * p.t;
    p.z = s.z1 + s.dz * s.len * p.t;
  }

  // init around origin
  for (const p of peds) respawn(p, 0, 0);

  function update(dt, playerX, playerZ) {
    for (const p of peds) {
      const dxp = p.x - playerX, dzp = p.z - playerZ;
      const d2 = dxp * dxp + dzp * dzp;
      if (d2 > 140 * 140) {
        respawn(p, playerX, playerZ);
        continue;
      }
      if (!p.seg) { respawn(p, playerX, playerZ); continue; }
      p.t += (p.speed / p.seg.len) * dt * p.dir;
      if (p.t > 1) { p.t = 1; p.dir = -1; }
      if (p.t < 0) { p.t = 0; p.dir = 1; }
      p.x = p.seg.x1 + p.seg.dx * p.seg.len * p.t;
      p.z = p.seg.z1 + p.seg.dz * p.seg.len * p.t;
      p.yaw = Math.atan2(p.seg.dx * p.dir, p.seg.dz * p.dir);
      p.phase += dt * 6;
    }
  }

  function draw(gl, carProg, carU, setCommon, mesh, model, playerX, playerZ) {
    if (!mesh) return;
    gl.useProgram(carProg);
    const near = [];
    for (const p of peds) {
      const dx = p.x - playerX, dz = p.z - playerZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < 70 * 70) near.push([d2, p]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const lim = Math.min(28, near.length);
    for (let i = 0; i < lim; i++) {
      const p = near[i][1];
      const bob = Math.sin(p.phase) * 0.03;
      m4compose(model, p.x, bob, p.z, p.yaw, 0, Math.sin(p.phase * 0.5) * 0.05);
      setCommon(carU, {
        uModel: model,
        uPaint: p.shirt,
        uBrake: 0,
        uHeadlights: 0,
      });
      // drawMesh is provided via callback to avoid circular import
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
      gl.bindVertexArray(null);
    }
  }

  return { update, draw, peds };
}

/** Simple floatplane state + flight physics. */
export function createPlane(x, z, yaw) {
  return {
    x, y: 40, z, yaw,
    pitch: 0, roll: 0,
    speed: 30,
    alive: true,
  };
}

export function stepPlane(pl, input, dt) {
  // throttle / pitch
  const t = input.throttle; // W/S
  const s = input.steer;    // A/D
  const climb = input.handbrake ? 1 : (input.keys.has('KeyE') ? 1 : 0) - (input.keys.has('KeyQ') ? 1 : 0);

  pl.speed = Math.max(12, Math.min(80, pl.speed + t * 12 * dt));
  // pitch: pull up with climb, nose down with dive keys / speed
  const targetPitch = climb * 0.45 + t * 0.15;
  pl.pitch += (targetPitch - pl.pitch) * Math.min(1, dt * 3);
  // roll into turns
  const targetRoll = -s * 0.55;
  pl.roll += (targetRoll - pl.roll) * Math.min(1, dt * 4);
  pl.yaw += s * 1.1 * dt + pl.roll * 0.8 * dt;

  const fx = Math.sin(pl.yaw) * Math.cos(pl.pitch);
  const fz = Math.cos(pl.yaw) * Math.cos(pl.pitch);
  const fy = Math.sin(pl.pitch);
  pl.x += fx * pl.speed * dt;
  pl.z += fz * pl.speed * dt;
  pl.y += fy * pl.speed * dt + climb * 8 * dt;

  // ground / ceiling
  if (pl.y < 2) { pl.y = 2; pl.alive = false; }
  if (pl.y > 400) pl.y = 400;
}
