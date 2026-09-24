// Load and normalize GLB props (cars / trees / landmarks) into engine meshes.

import { createMesh, VERT_STRIDE } from './gl.js';
import { loadGLB, mergeParsed } from './glb.js';

/** Compute bbox of interleaved verts (pos at 0,1,2). */
function bbox(verts) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i += VERT_STRIDE) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

/**
 * Scale/center a merged mesh.
 * opts.targetLen — fit longest horizontal axis to this length
 * opts.ground — put minY at this height (default 0)
 */
export function normalizeMesh(verts, opts = {}) {
  const b = bbox(verts);
  const horiz = Math.max(b.sx, b.sz, 0.001);
  const target = opts.targetLen || 4.5;
  const s = target / horiz;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const gy = opts.ground ?? 0;
  const out = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += VERT_STRIDE) {
    const x = (verts[i] - cx) * s;
    const y = (verts[i + 1] - b.minY) * s + gy;
    const z = (verts[i + 2] - cz) * s;
    let nx = verts[i + 3], ny = verts[i + 4], nz = verts[i + 5];
    const nl = Math.hypot(nx, ny, nz) || 1;
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    out[i + 3] = nx / nl; out[i + 4] = ny / nl; out[i + 5] = nz / nl;
    out[i + 6] = verts[i + 6]; out[i + 7] = verts[i + 7];
    out[i + 8] = verts[i + 8]; out[i + 9] = verts[i + 9]; out[i + 10] = verts[i + 10];
  }
  return out;
}

export async function loadProp(gl, url, opts = {}) {
  const parsed = await loadGLB(url);
  const merged = mergeParsed(parsed);
  const verts = normalizeMesh(merged.vertices, opts);
  return createMesh(gl, verts, merged.indices);
}

export async function loadCarMeshes(gl) {
  // traffic-car.glb is a clean, correctly-scaled sedan (2.3 × 1.4 × 4.6).
  // car.glb has broken node transforms (bbox ~32m) — skip it.
  let mesh = null;
  try {
    mesh = await loadProp(gl, 'city/traffic-car.glb', { targetLen: 4.6 });
  } catch (e) {
    console.warn('traffic-car.glb', e);
    return { player: null, traffic: null };
  }
  return { player: mesh, traffic: mesh };
}

export async function loadTreeMesh(gl) {
  return loadProp(gl, 'city/tree.glb', { targetLen: 7, ground: 0 });
}

export async function loadPalmMesh(gl) {
  return loadProp(gl, 'city/palm.glb', { targetLen: 9, ground: 0 });
}

export async function loadLandmarkMesh(gl) {
  // landmarks.glb is a collection placed in city coordinates already
  // (nodes carry world transforms). Do NOT re-center — keep as-is.
  const parsed = await loadGLB('city/landmarks.glb');
  const merged = mergeParsed(parsed);
  return createMesh(gl, merged.vertices, merged.indices);
}
