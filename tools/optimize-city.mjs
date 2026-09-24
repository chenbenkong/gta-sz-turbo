/**
 * Offline city optimizer: buildings.glb / roads.glb / landmarks.glb
 * → spatially chunked binary packs for streaming on iGPU.
 *
 * Output: city-opt/
 *   index.json          chunk list with bboxes
 *   bld_XXXX.bin        merged interleaved verts (pos3 nrm3 uv2 col3) + indices
 *
 * Run: node tools/optimize-city.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseGLB, mergeParsed } from '../src/glb.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'city-opt');
const CELL = 220; // meters per chunk

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function loadGlb(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parseGLB(ab);
}

function chunkMeshes(meshes, label) {
  const cells = new Map();
  for (const m of meshes) {
    const v = m.vertices;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = 0;
    for (let i = 0; i < v.length; i += 11) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (y > maxY) maxY = y;
    }
    // assign to cell of centroid (meshes are per-building so this is fine)
    const cx = Math.floor(((minX + maxX) * 0.5) / CELL);
    const cz = Math.floor(((minZ + maxZ) * 0.5) / CELL);
    const key = cx + ',' + cz;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ mesh: m, minX, maxX, minZ, maxZ, maxY });
  }

  const index = [];
  let id = 0;
  for (const [key, list] of cells) {
    // merge all meshes in cell
    let vTotal = 0, iTotal = 0;
    for (const it of list) {
      vTotal += it.mesh.vertices.length / 11;
      iTotal += it.mesh.indices.length;
    }
    const verts = new Float32Array(vTotal * 11);
    const idx = new Uint32Array(iTotal);
    let vo = 0, io = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
    for (const it of list) {
      verts.set(it.mesh.vertices, vo * 11);
      for (let i = 0; i < it.mesh.indices.length; i++) {
        idx[io++] = it.mesh.indices[i] + vo;
      }
      vo += it.mesh.vertices.length / 11;
      if (it.minX < minX) minX = it.minX;
      if (it.maxX > maxX) maxX = it.maxX;
      if (it.minZ < minZ) minZ = it.minZ;
      if (it.maxZ > maxZ) maxZ = it.maxZ;
      if (it.maxY > maxY) maxY = it.maxY;
    }
    const name = `${label}_${String(id).padStart(4, '0')}`;
    // bin layout: [u32 vertCount][u32 idxCount][verts f32...][idx u32...]
    const header = 8;
    const bin = Buffer.alloc(header + verts.byteLength + idx.byteLength);
    bin.writeUInt32LE(vo, 0);
    bin.writeUInt32LE(io, 4);
    Buffer.from(verts.buffer, verts.byteOffset, verts.byteLength).copy(bin, header);
    Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength).copy(bin, header + verts.byteLength);
    const file = `${name}.bin`;
    fs.writeFileSync(path.join(OUT, file), bin);
    index.push({
      file,
      x: (minX + maxX) * 0.5,
      z: (minZ + maxZ) * 0.5,
      minX, maxX, minZ, maxZ, maxY,
      radius: Math.hypot(maxX - minX, maxZ - minZ) * 0.5,
      tris: io / 3,
      bytes: bin.length,
    });
    id++;
  }
  console.log(`${label}: ${meshes.length} meshes → ${index.length} chunks, ${index.reduce((s, c) => s + c.tris, 0) | 0} tris`);
  return index;
}

console.log('Parsing buildings.glb …');
console.time('buildings');
const bld = loadGlb(path.join(ROOT, 'city', 'buildings.glb'));
console.timeEnd('buildings');
const bldChunks = chunkMeshes(bld.meshes, 'bld');

console.log('Parsing roads.glb …');
console.time('roads');
let roadChunks = [];
try {
  const roads = loadGlb(path.join(ROOT, 'city', 'roads.glb'));
  // roads can be one big mesh — split by vertex centroid into cells
  const roadMeshes = roads.meshes;
  if (roadMeshes.length < 20) {
    // split large mesh into cells by triangles
    const split = [];
    for (const m of roadMeshes) {
      // group triangles by centroid cell
      const buckets = new Map();
      const V = m.vertices, I = m.indices;
      for (let t = 0; t < I.length; t += 3) {
        const i0 = I[t] * 11, i1 = I[t + 1] * 11, i2 = I[t + 2] * 11;
        const cx = (V[i0] + V[i1] + V[i2]) / 3;
        const cz = (V[i0 + 2] + V[i1 + 2] + V[i2 + 2]) / 3;
        const key = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL);
        if (!buckets.has(key)) buckets.set(key, { tris: [] });
        buckets.get(key).tris.push(I[t], I[t + 1], I[t + 2]);
      }
      for (const b of buckets.values()) {
        // compact vertices used
        const map = new Map();
        const verts = [];
        const idx = [];
        for (const src of b.tris) {
          if (!map.has(src)) {
            map.set(src, verts.length / 11);
            for (let k = 0; k < 11; k++) verts.push(V[src * 11 + k]);
          }
          idx.push(map.get(src));
        }
        split.push({ vertices: new Float32Array(verts), indices: idx });
      }
    }
    roadChunks = chunkMeshes(split, 'rd');
  } else {
    roadChunks = chunkMeshes(roadMeshes, 'rd');
  }
} catch (e) {
  console.warn('roads skip', e.message);
}
console.timeEnd('roads');

console.log('Parsing landmarks.glb …');
let lm = null;
try {
  lm = loadGlb(path.join(ROOT, 'city', 'landmarks.glb'));
  const merged = mergeParsed(lm);
  const name = 'lm_0000.bin';
  const verts = merged.vertices;
  const idx = new Uint32Array(merged.indices);
  const header = 8;
  const bin = Buffer.alloc(header + verts.byteLength + idx.byteLength);
  bin.writeUInt32LE(verts.length / 11, 0);
  bin.writeUInt32LE(idx.length, 4);
  Buffer.from(verts.buffer, verts.byteOffset, verts.byteLength).copy(bin, header);
  Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength).copy(bin, header + verts.byteLength);
  fs.writeFileSync(path.join(OUT, name), bin);
  console.log('landmarks: 1 chunk,', idx.length / 3, 'tris');
} catch (e) {
  console.warn('landmarks skip', e.message);
}

const index = {
  cell: CELL,
  format: 'v1',
  vertexStrideFloats: 11,
  chunks: {
    buildings: bldChunks,
    roads: roadChunks,
    landmarks: lm ? [{
      file: 'lm_0000.bin', x: 0, z: 0,
      minX: -6000, maxX: 6000, minZ: -2000, maxZ: 2000, maxY: 300,
      radius: 7000, tris: 0, bytes: 0,
    }] : [],
  },
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
const total = bldChunks.concat(roadChunks).reduce((s, c) => s + c.bytes, 0);
console.log('Wrote', OUT, `(${(total / 1048576).toFixed(1)} MB geom)`);
console.log('chunks', { buildings: bldChunks.length, roads: roadChunks.length });
