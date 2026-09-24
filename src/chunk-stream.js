// Spatial chunk streamer: load city-opt/*.bin into GPU on demand, evict far chunks.

import { createMesh, drawMesh, VERT_STRIDE } from './gl.js';

const REUSE_LIMIT = 48; // max GPU-resident chunks per layer

export function createStreamer(gl) {
  /** @type {Map<string, any>} */
  const live = new Map();
  let index = null;
  const pending = new Map();

  async function loadIndex(url) {
    const res = await fetch(url);
    index = await res.json();
    return index;
  }

  function parseBin(buf) {
    const dv = new DataView(buf);
    const vCount = dv.getUint32(0, true);
    const iCount = dv.getUint32(4, true);
    const verts = new Float32Array(buf, 8, vCount * VERT_STRIDE);
    // copy out so we don't hold the whole ArrayBuffer view weirdly
    const vcopy = new Float32Array(verts);
    const idx = new Uint32Array(buf, 8 + vCount * VERT_STRIDE * 4, iCount);
    const icopy = Array.from(idx);
    return createMesh(gl, vcopy, icopy);
  }

  async function ensureChunk(entry, layer) {
    const key = layer + ':' + entry.file;
    if (live.has(key) || pending.has(key)) return;
    pending.set(key, (async () => {
      try {
        const res = await fetch('city-opt/' + entry.file);
        const buf = await res.arrayBuffer();
        const mesh = parseBin(buf);
        live.set(key, {
          mesh, entry, layer,
          lastUsed: performance.now(),
          radius: entry.radius || 100,
          x: entry.x, z: entry.z,
        });
      } catch (e) {
        console.warn('chunk fail', entry.file, e);
      } finally {
        pending.delete(key);
      }
    })());
    await pending.get(key);
  }

  /**
   * Request chunks near (px,pz). Loads nearest missing, evicts far.
   * layers: [{ name, chunks, maxDist, budget, lodDist }]
   * If entry.lod exists and d > lodDist, draw lod box instead of full mesh.
   */
  async function update(px, pz, layers, program, uniforms, identity) {
    if (!index) return;
    for (const layer of layers) {
      const chunks = index.chunks[layer.name] || [];
      const scored = [];
      for (const c of chunks) {
        const dx = c.x - px, dz = c.z - pz;
        const d = Math.hypot(dx, dz) - (c.radius || 0);
        if (d > layer.maxDist) continue;
        scored.push([d, c]);
      }
      scored.sort((a, b) => a[0] - b[0]);
      const want = scored.slice(0, layer.budget);

      let started = 0;
      for (const [, c] of want) {
        const key = layer.name + ':' + c.file;
        if (live.has(key) || pending.has(key)) continue;
        if (started >= 3) break;
        started++;
        ensureChunk(c, layer.name);
      }

      const now = performance.now();
      const liveArr = [];
      for (const [k, v] of live) {
        if (v.layer !== layer.name) continue;
        const dx = v.x - px, dz = v.z - pz;
        const d = Math.hypot(dx, dz) - v.radius;
        if (d > layer.maxDist * 1.2) {
          gl.deleteVertexArray(v.mesh.vao);
          live.delete(k);
          continue;
        }
        liveArr.push([d, k, v]);
      }
      liveArr.sort((a, b) => a[0] - b[0]);
      for (let i = layer.budget; i < liveArr.length; i++) {
        const [, k, v] = liveArr[i];
        gl.deleteVertexArray(v.mesh.vao);
        live.delete(k);
      }

      // LOD boxes for far buildings (cheap, always available after first gen)
      const lodDist = layer.lodDist || 280;
      if (layer.name === 'buildings' && layer.lodMesh) {
        for (const [d, c] of scored) {
          if (d < lodDist) continue;
          if (d > layer.maxDist) break;
          const key = layer.name + ':' + c.file;
          if (live.has(key)) continue; // full mesh is closer/better
          // draw shared LOD box transformed... we baked boxes per-chunk in lod bins
          // For speed use a unit box scaled — skip if no matrix path; use prebuilt lod meshes lazily
          if (!c._lodMesh) {
            // async load lod once
            if (!c._lodPending) {
              c._lodPending = true;
              loadBinMesh(gl, 'city-opt/' + c.lod).then((m) => { c._lodMesh = m; }).catch(() => {});
            }
            continue;
          }
          if (uniforms.uModel) gl.uniformMatrix4fv(uniforms.uModel, false, identity);
          drawMesh(gl, c._lodMesh);
        }
      }

      // draw full-res ready chunks
      gl.useProgram(program);
      if (uniforms.uModel) gl.uniformMatrix4fv(uniforms.uModel, false, identity);
      for (const [d, k, v] of liveArr) {
        if (d > layer.maxDist) continue;
        drawMesh(gl, v.mesh);
        v.lastUsed = now;
      }
    }
  }

  function stats() {
    return { live: live.size, pending: pending.size };
  }

  return { loadIndex, update, stats, get ready() { return !!index; } };
}

/** Load a single GLB-derived bin as one mesh (props). */
export async function loadBinMesh(gl, url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  const vCount = dv.getUint32(0, true);
  const iCount = dv.getUint32(4, true);
  const vcopy = new Float32Array(buf.slice(8, 8 + vCount * VERT_STRIDE * 4));
  const idxSrc = new Uint32Array(buf, 8 + vCount * VERT_STRIDE * 4, iCount);
  return createMesh(gl, vcopy, Array.from(idxSrc));
}
