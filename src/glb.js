// Minimal GLB (glTF binary) static-mesh loader for the WebGL2 engine.
// Extracts POSITION / NORMAL / TEXCOORD_0 + indices + material baseColor.
// No skins, no animations — enough for cars / trees / landmarks.

const FLOAT = 5126, UINT16 = 5123, UINT32 = 5125;

function compCount(type) {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT4': return 16;
    default: return 1;
  }
}

function readAccessor(json, bin, idx) {
  const acc = json.accessors[idx];
  const view = json.bufferViews[acc.bufferView];
  const comps = compCount(acc.type);
  const n = acc.count;
  const out = new Float32Array(n * comps);
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset + start, acc.count * comps * 4);
  for (let i = 0; i < n * comps; i++) out[i] = dv.getFloat32(i * 4, true);
  return { data: out, comps, count: n };
}

function readIndices(json, bin, idx) {
  const acc = json.accessors[idx];
  const view = json.bufferViews[acc.bufferView];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const n = acc.count;
  if (acc.componentType === UINT32) {
    const out = new Uint32Array(n);
    const dv = new DataView(bin.buffer, bin.byteOffset + start, n * 4);
    for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, true);
    return out;
  }
  const out = new Uint16Array(n);
  const dv = new DataView(bin.buffer, bin.byteOffset + start, n * 2);
  for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, true);
  return out;
}

/**
 * Parse a GLB ArrayBuffer into { meshes: [{ positions, normals, uvs, indices, color }], sceneNodes }.
 * color is baseColorFactor (RGBA).
 */
export function parseGLB(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('不是 GLB 文件');
  // version = dv.getUint32(4,true)
  const total = dv.getUint32(8, true);

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < total) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const chunkData = new Uint8Array(arrayBuffer, offset + 8, chunkLen);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunkData));
    } else if (chunkType === 0x004e4942) {
      bin = chunkData;
    }
    offset += 8 + chunkLen;
    // 4-byte align
    if (offset % 4) offset += 4 - (offset % 4);
  }
  if (!json) throw new Error('GLB 缺少 JSON 块');

  // material colors
  const matColors = (json.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {};
    const c = pbr.baseColorFactor || [1, 1, 1, 1];
    return [c[0], c[1], c[2]];
  });

  // node world transforms (flat: only TRS/matrix, no deep nesting walk beyond scenes)
  const nodes = json.nodes || [];
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix; // glTF is column-major 16
    const t = n.translation || [0, 0, 0];
    const r = n.rotation || [0, 0, 0, 1]; // quat xyzw
    const s = n.scale || [1, 1, 1];
    // compose T * R * S
    const [x, y, z, w] = r;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s[0], sy = s[1], sz = s[2];
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1,
    ];
  }

  function mulMat(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
      o[i * 4 + 1] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
      o[i * 4 + 2] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
      o[i * 4 + 3] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];
    }
    return o;
  }

  function xformPoint(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
  }
  function xformDir(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    ];
  }

  const meshes = [];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function collect(nodeIdx, parentMat) {
    const n = nodes[nodeIdx];
    if (!n) return;
    const local = nodeMatrix(n);
    const world = mulMat(parentMat, local);
    if (n.mesh != null) {
      const mesh = json.meshes[n.mesh];
      for (const prim of mesh.primitives || []) {
        if (prim.mode != null && prim.mode !== 4) continue; // triangles only
        const attrs = prim.attributes || {};
        if (attrs.POSITION == null) continue;
        const pos = readAccessor(json, bin, attrs.POSITION);
        const nrm = attrs.NORMAL != null ? readAccessor(json, bin, attrs.NORMAL) : null;
        const uv = attrs.TEXCOORD_0 != null ? readAccessor(json, bin, attrs.TEXCOORD_0) : null;
        let indices;
        if (prim.indices != null) {
          indices = readIndices(json, bin, prim.indices);
        } else {
          indices = new Uint32Array(pos.count);
          for (let i = 0; i < pos.count; i++) indices[i] = i;
        }
        // bake transform into interleaved verts: pos3 nrm3 uv2 col3
        const col = prim.material != null ? (matColors[prim.material] || [1, 1, 1]) : [1, 1, 1];
        const vertCount = pos.count;
        const verts = new Float32Array(vertCount * 11);
        for (let i = 0; i < vertCount; i++) {
          const px = pos.data[i * 3], py = pos.data[i * 3 + 1], pz = pos.data[i * 3 + 2];
          const P = xformPoint(world, px, py, pz);
          verts[i * 11] = P[0]; verts[i * 11 + 1] = P[1]; verts[i * 11 + 2] = P[2];
          if (nrm) {
            const nx = nrm.data[i * 3], ny = nrm.data[i * 3 + 1], nz = nrm.data[i * 3 + 2];
            const N = xformDir(world, nx, ny, nz);
            const nl = Math.hypot(N[0], N[1], N[2]) || 1;
            verts[i * 11 + 3] = N[0] / nl; verts[i * 11 + 4] = N[1] / nl; verts[i * 11 + 5] = N[2] / nl;
          } else {
            verts[i * 11 + 3] = 0; verts[i * 11 + 4] = 1; verts[i * 11 + 5] = 0;
          }
          if (uv) {
            verts[i * 11 + 6] = uv.data[i * 2]; verts[i * 11 + 7] = uv.data[i * 2 + 1];
          }
          verts[i * 11 + 8] = col[0]; verts[i * 11 + 9] = col[1]; verts[i * 11 + 10] = col[2];
        }
        meshes.push({ vertices: verts, indices: Array.from(indices) });
      }
    }
    for (const c of n.children || []) collect(c, world);
  }

  const scenes = json.scenes || [{ nodes: nodes.map((_, i) => i) }];
  const rootNodes = (scenes[json.scene || 0] || scenes[0]).nodes || [];
  for (const rn of rootNodes) collect(rn, identity);

  return { meshes, materials: matColors };
}

/** Merge parsed meshes into one interleaved buffer ready for createMesh. */
export function mergeParsed(parsed) {
  let vTotal = 0, iTotal = 0;
  for (const m of parsed.meshes) {
    vTotal += m.vertices.length / 11;
    iTotal += m.indices.length;
  }
  const verts = new Float32Array(vTotal * 11);
  const indices = [];
  let vo = 0;
  for (const m of parsed.meshes) {
    verts.set(m.vertices, vo * 11);
    for (const i of m.indices) indices.push(i + vo);
    vo += m.vertices.length / 11;
  }
  return { vertices: verts, indices };
}

export async function loadGLB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('GLB 加载失败 ' + url + ' ' + res.status);
  const buf = await res.arrayBuffer();
  return parseGLB(buf);
}
