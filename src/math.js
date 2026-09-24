// Minimal 3D math for the WebGL2 city engine.

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function approachAngle(cur, target, t) {
  return cur + wrapAngle(target - cur) * t;
}

// ---- Vec3 helpers on plain arrays ----
export function v3(x = 0, y = 0, z = 0) {
  return new Float32Array([x, y, z]);
}

export function v3copy(o, a) {
  o[0] = a[0]; o[1] = a[1]; o[2] = a[2];
  return o;
}

export function v3set(o, x, y, z) {
  o[0] = x; o[1] = y; o[2] = z;
  return o;
}

export function v3add(o, a, b) {
  o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2];
  return o;
}

export function v3sub(o, a, b) {
  o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2];
  return o;
}

export function v3scale(o, a, s) {
  o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s;
  return o;
}

export function v3dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function v3cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z;
  return o;
}

export function v3len(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function v3normalize(o, a) {
  const l = v3len(a) || 1;
  return v3scale(o, a, 1 / l);
}

export function v3lerp(o, a, b, t) {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
}

// ---- Mat4 (column-major, like WebGL) ----
export function m4identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function m4multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function m4perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function m4lookAt(out, eye, target, up) {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl, z1 = zy / zl, z2 = zz / zl;
  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  let xl = Math.hypot(x0, x1, x2) || 1;
  x0 /= xl; x1 /= xl; x2 /= xl;
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

export function m4translate(out, x, y, z) {
  m4identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function m4rotateY(out, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  m4identity(out);
  out[0] = c; out[2] = -s;
  out[8] = s; out[10] = c;
  return out;
}

export function m4rotateX(out, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  m4identity(out);
  out[5] = c; out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

export function m4transformPoint(out, m, p) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/** Model matrix from position + yaw (Y rotation) + optional pitch/roll. */
export function m4compose(out, x, y, z, yaw, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry * Rx * Rz
  out[0] = cy * cr + sy * sp * sr;
  out[1] = cp * sr;
  out[2] = -sy * cr + cy * sp * sr;
  out[3] = 0;
  out[4] = -cy * sr + sy * sp * cr;
  out[5] = cp * cr;
  out[6] = sy * sr + cy * sp * cr;
  out[7] = 0;
  out[8] = sy * cp;
  out[9] = -sp;
  out[10] = cy * cp;
  out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}
