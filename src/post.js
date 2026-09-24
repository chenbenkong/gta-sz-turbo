// Cheap cinematic post-chain for Vega 7: scene → FBO → grade+bloom+vignette.
// One extra fullscreen pass + tiny bright/blur. No SSAO, no heavy DOF.

export const POST_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(0.72, 1.1, l);
  fragColor = vec4(c * k, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 fragColor;
void main() {
  vec3 s = texture(uTex, vUV).rgb * 0.227027;
  s += texture(uTex, vUV + uDir * 1.3846).rgb * 0.316216;
  s += texture(uTex, vUV - uDir * 1.3846).rgb * 0.316216;
  s += texture(uTex, vUV + uDir * 3.2307).rgb * 0.070270;
  s += texture(uTex, vUV - uDir * 3.2307).rgb * 0.070270;
  fragColor = vec4(s, 1.0);
}`;

export const GRADE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uTexel;
uniform float uTime;
uniform float uNight;
uniform float uSpeed;   // 0..1 for subtle CA / grain boost
uniform float uBloomAmt;
out vec4 fragColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUV;
  // subtle radial chromatic aberration (speed makes it wider)
  float r2 = dot(uv - 0.5, uv - 0.5);
  vec2 ca = (uv - 0.5) * (0.0015 + uSpeed * 0.004) * r2;
  vec3 col;
  col.r = texture(uScene, uv + ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - ca).b;

  // bloom
  vec3 bloom = texture(uBloom, uv).rgb;
  col += bloom * uBloomAmt;

  // filmic tonemap (slightly darker exposure)
  col = aces(col * 0.92);

  // teal-orange grade
  vec3 shadow = vec3(0.03, 0.05, 0.09);
  vec3 high = vec3(1.02, 0.96, 0.88);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(shadow, high, l), 0.28);
  col += vec3(0.01, 0.02, 0.05) * uNight * (1.0 - l);

  // contrast + saturation
  col = (col - 0.5) * 1.18 + 0.5;
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(g), col, 1.22);

  // vignette (stronger, filmic)
  float vig = smoothstep(1.05, 0.2, r2 * 2.4);
  col *= mix(0.62, 1.0, vig);

  // tiny grain
  float n = fract(sin(dot(uv * (800.0 + uTime), vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * 0.015;

  fragColor = vec4(col, 1.0);
}`;

export function createPost(gl) {
  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, depth, w, h };
  }

  let scene = null;
  let bright = null;
  let blurA = null;
  let blurB = null;

  function resize(w, h) {
    for (const t of [scene, bright, blurA, blurB]) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
      gl.deleteRenderbuffer(t.depth);
    }
    scene = makeTarget(w, h);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    bright = makeTarget(bw, bh);
    blurA = makeTarget(bw, bh);
    blurB = makeTarget(bw, bh);
  }

  function bindScene() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
  }

  function blit(program, srcTex, dst) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
    gl.viewport(0, 0, dst ? dst.w : scene.w, dst ? dst.h : scene.h);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function present(progs, opts = {}) {
    // bright extract
    gl.useProgram(progs.bright);
    gl.uniform1i(gl.getUniformLocation(progs.bright, 'uTex'), 0);
    blit(progs.bright, scene.tex, bright);
    // blur H/V
    gl.useProgram(progs.blur);
    gl.uniform1i(gl.getUniformLocation(progs.blur, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(progs.blur, 'uDir'), 1 / bright.w, 0);
    blit(progs.blur, bright.tex, blurA);
    gl.uniform2f(gl.getUniformLocation(progs.blur, 'uDir'), 0, 1 / bright.h);
    blit(progs.blur, blurA.tex, blurB);
    // one more softer
    gl.uniform2f(gl.getUniformLocation(progs.blur, 'uDir'), 2 / bright.w, 0);
    blit(progs.blur, blurB.tex, blurA);
    gl.uniform2f(gl.getUniformLocation(progs.blur, 'uDir'), 0, 2 / bright.h);
    blit(progs.blur, blurA.tex, blurB);

    // final grade to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const canvas = gl.canvas;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(progs.grade);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(progs.grade, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
    gl.uniform1i(gl.getUniformLocation(progs.grade, 'uBloom'), 1);
    gl.uniform2f(gl.getUniformLocation(progs.grade, 'uTexel'), 1 / scene.w, 1 / scene.h);
    gl.uniform1f(gl.getUniformLocation(progs.grade, 'uTime'), opts.time || 0);
    gl.uniform1f(gl.getUniformLocation(progs.grade, 'uNight'), opts.night || 0);
    gl.uniform1f(gl.getUniformLocation(progs.grade, 'uSpeed'), opts.speed || 0);
    gl.uniform1f(gl.getUniformLocation(progs.grade, 'uBloomAmt'), opts.bloom ?? 0.45);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  return { resize, bindScene, present, get size() { return scene ? [scene.w, scene.h] : [0, 0]; } };
}
