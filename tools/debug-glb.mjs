// Debug GLB bounds. Run: node tools/debug-glb.mjs city/car.glb
import fs from 'node:fs';
import { parseGLB, mergeParsed } from '../src/glb.js';

const path = process.argv[2] || 'city/car.glb';
const buf = fs.readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = parseGLB(ab);
console.log('meshes', parsed.meshes.length);
const m = mergeParsed(parsed);
let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
const v = m.vertices;
for (let j = 0; j < v.length; j += 11) {
  const x = v[j], y = v[j + 1], z = v[j + 2];
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
}
console.log('bbox', { minX, minY, minZ, maxX, maxY, maxZ });
console.log('size', { sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ });
console.log('verts', v.length / 11, 'indices', m.indices.length);
const cols = new Set();
for (let j = 8; j < v.length; j += 11) {
  cols.add(v[j].toFixed(2) + ',' + v[j + 1].toFixed(2) + ',' + v[j + 2].toFixed(2));
}
console.log('colors', cols.size, [...cols].slice(0, 16));
