// GLSL ES 3.00 shaders — city / roads / cars / sky / water.

export const CITY_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aCol;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNrm;
out vec2 vUV;
out vec3 vCol;
out vec3 vWorld;
out float vDist;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNrm = mat3(uModel) * aNrm;
  vUV = aUV;
  vCol = aCol;
  vec4 clip = uViewProj * world;
  vDist = clip.w;
  gl_Position = clip;
}`;

export const CITY_FS = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec2 vUV;
in vec3 vCol;
in vec3 vWorld;
in float vDist;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform float uNight;
uniform float uTime;
uniform sampler2D uAlbedo;
uniform float uUseTex;
uniform float uWindowGrid;
uniform float uEmissive;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 n = normalize(vNrm);
  float ndl = max(dot(n, uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(uAmbGround, uAmbSky, hemi);
  vec3 albedo = vCol;
  if (uUseTex > 0.5) {
    vec3 tex = texture(uAlbedo, vUV).rgb;
    albedo = mix(vCol, tex * 1.8, 0.85);
  }

  // Procedural windows on building facades (finer grid, more variety)
  vec3 emis = vec3(0.0);
  if (uWindowGrid > 0.5 && abs(n.y) < 0.55) {
    vec2 wuv = vUV;
    vec2 f = fract(wuv * vec2(2.4, 0.55));
    vec2 cell = floor(wuv * vec2(2.4, 0.55));
    float lit = step(0.48, hash(cell + floor(vWorld.xz * 0.04)));
    float winMask = step(0.18, f.x) * step(f.x, 0.82) * step(0.12, f.y) * step(f.y, 0.78);
    // daytime: reflective glass strip
    albedo = mix(albedo, mix(albedo, vec3(0.32, 0.42, 0.55), 0.4), winMask * (1.0 - uNight));
    albedo = mix(albedo, albedo * 0.45, winMask * uNight * 0.55);
    float warm = 0.45 + 0.55 * hash(cell + 3.7);
    vec3 winCol = mix(vec3(1.0, 0.75, 0.4), vec3(0.7, 0.85, 1.0), step(0.7, hash(cell + 9.1)));
    float nightAmt = uNight * lit * winMask;
    emis += winCol * nightAmt * (2.4 + 1.2 * warm);
  }

  // Roof slightly darker, ground contact AO
  if (n.y > 0.7) albedo *= 0.85;
  float ao = 1.0;
  // cheap height AO for buildings
  if (uWindowGrid > 0.5) {
    ao = mix(0.75, 1.0, clamp(vWorld.y / 12.0, 0.0, 1.0));
  }

  vec3 lit = albedo * (amb + uSunCol * ndl) * ao;
  lit += emis * uEmissive;
  // night ambient cool
  lit = mix(lit, lit * vec3(0.55, 0.65, 0.95) + emis, uNight * 0.35);

  float fog = 1.0 - exp(-uFogDensity * vDist * vDist);
  fog = clamp(fog, 0.0, 1.0);
  vec3 col = mix(lit, uFogColor, fog);
  fragColor = vec4(col, 1.0);
}`;

export const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uInvViewProj;
out vec3 vDir;
void main() {
  vec4 near = uInvViewProj * vec4(aPos, -1.0, 1.0);
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vDir = far.xyz / far.w - near.xyz / near.w;
  gl_Position = vec4(aPos, 0.9999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunCol;
uniform vec3 uGroundCol;
uniform float uNight;
uniform float uTime;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(h, 0.0, 1.0), 0.65));
  vec3 ground = mix(uSkyHorizon, uGroundCol, pow(clamp(-h, 0.0, 1.0), 0.5));
  vec3 col = h > 0.0 ? sky : ground;

  // sun disk + glow
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 256.0) * 4.0 + pow(sd, 32.0) * 0.35 + pow(sd, 4.0) * 0.08);

  // soft clouds
  if (h > 0.02 && uNight < 0.85) {
    vec2 cuv = d.xz / (d.y + 0.15) * 1.2;
    float c = noise(cuv * 0.35 + uTime * 0.003) * 0.65
            + noise(cuv * 0.9 + uTime * 0.005) * 0.35;
    c = smoothstep(0.48, 0.72, c) * smoothstep(0.0, 0.2, h);
    vec3 cloudCol = mix(uSkyHorizon * 1.1, vec3(1.0, 0.97, 0.92), 0.55);
    cloudCol = mix(cloudCol, vec3(0.3, 0.32, 0.4), uNight * 0.7);
    col = mix(col, cloudCol, c * (1.0 - uNight * 0.5));
  }

  // stars at night
  if (uNight > 0.3 && h > 0.05) {
    vec2 sp = floor(d.xz / max(h, 0.1) * 40.0);
    float st = step(0.992, hash(sp));
    float tw = 0.7 + 0.3 * sin(uTime * 3.0 + hash(sp) * 20.0);
    col += vec3(0.9, 0.95, 1.0) * st * tw * uNight * smoothstep(0.1, 0.4, h);
  }

  fragColor = vec4(col, 1.0);
}`;

export const WATER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aCol;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uTime;
out vec3 vNrm;
out vec3 vWorld;
out vec2 vUV;
out float vDist;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  // gentle swell
  float w = sin(world.x * 0.04 + uTime * 0.7) * 0.12
          + cos(world.z * 0.05 + uTime * 0.5) * 0.10;
  world.y += w * 0.15;
  vWorld = world.xyz;
  vNrm = normalize(aNrm + vec3(w * 0.15, 0.0, w * 0.12));
  vUV = aUV;
  vec4 clip = uViewProj * world;
  vDist = clip.w;
  gl_Position = clip;
}`;

export const WATER_FS = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vWorld;
in vec2 vUV;
in float vDist;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uNight;
uniform float uTime;
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNrm);
  vec3 view = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  vec3 deep = mix(vec3(0.05, 0.22, 0.32), vec3(0.02, 0.06, 0.12), uNight);
  vec3 skyRef = mix(uSkyHorizon, uSkyTop, 0.35);
  vec3 col = mix(deep, skyRef, 0.35 + fres * 0.55);
  vec3 h = normalize(uSunDir + view);
  float spec = pow(max(dot(n, h), 0.0), 120.0);
  col += uSunCol * spec * (1.2 - uNight * 0.4);
  // glitter
  float g = sin(vWorld.x * 2.1 + uTime * 1.3) * sin(vWorld.z * 1.7 + uTime * 0.9);
  col += uSunCol * max(g, 0.0) * 0.04 * (1.0 - uNight);
  float fog = 1.0 - exp(-uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  fragColor = vec4(col, 0.92);
}`;

export const CAR_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aCol;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNrm;
out vec3 vCol;
out vec3 vWorld;
out vec2 vUV;
out float vDist;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNrm = mat3(uModel) * aNrm;
  vCol = aCol;
  vUV = aUV;
  vec4 clip = uViewProj * world;
  vDist = clip.w;
  gl_Position = clip;
}`;

export const CAR_FS = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vCol;
in vec3 vWorld;
in vec2 vUV;
in float vDist;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform float uNight;
uniform float uTime;
uniform vec3 uPaint;
uniform float uBrake;
uniform float uHeadlights;
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNrm);
  vec3 view = normalize(uCamPos - vWorld);
  vec3 albedo = vCol * uPaint;

  // metal / glass via vertex color: glass has high blue channel and lower paint mix
  float isGlass = step(0.65, vCol.b) * step(vCol.r, 0.45);
  float isRubber = step(0.55, vCol.r) * step(vCol.g, 0.35) * step(vCol.b, 0.35);
  float isLamp = step(0.9, vCol.r) * step(0.75, vCol.g) * step(vCol.b, 0.45);

  vec3 paint = uPaint;
  if (isGlass > 0.5) albedo = vec3(0.08, 0.10, 0.14);
  else if (isRubber > 0.5) albedo = vec3(0.08, 0.08, 0.09);
  else albedo = paint * (0.85 + 0.15 * vCol.g);

  float ndl = max(dot(n, uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(uAmbGround, uAmbSky, hemi);

  vec3 h = normalize(uSunDir + view);
  float specPow = isGlass > 0.5 ? 80.0 : 32.0;
  float spec = pow(max(dot(n, h), 0.0), specPow) * (isGlass > 0.5 ? 0.9 : 0.35);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0) * (isGlass > 0.5 ? 0.5 : 0.18);

  vec3 col = albedo * (amb + uSunCol * ndl);
  col += uSunCol * spec + uSkyTint(n) * fres;

  vec3 emis = vec3(0.0);
  // taillights (rear + brake)
  if (aPosLocalRear(n, vCol)) {}
  // simpler: brake/taillight via color mask red-ish lamp
  if (vCol.r > 0.85 && vCol.g < 0.25 && vCol.b < 0.25) {
    emis += vec3(1.2, 0.08, 0.05) * (0.35 + uBrake * 1.4);
  }
  if (vCol.r > 0.85 && vCol.g > 0.7 && vCol.b < 0.4) {
    emis += vec3(1.4, 1.1, 0.7) * uHeadlights;
  }
  // reverse lights white-blue when brake as reverse is rare; skip

  col += emis;
  col = mix(col, col * vec3(0.55, 0.65, 0.95) + emis, uNight * 0.4);

  float fog = 1.0 - exp(-uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  fragColor = vec4(col, 1.0);
}

vec3 uSkyTint(vec3 n) { return vec3(0.4, 0.55, 0.75); }
bool aPosLocalRear(vec3 n, vec3 c) { return false; }
`;

// Cleaner car FS without helper stubs (rewrite properly)
export const CAR_FS_CLEAN = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vCol;
in vec3 vWorld;
in vec2 vUV;
in float vDist;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform float uNight;
uniform vec3 uPaint;
uniform float uBrake;
uniform float uHeadlights;
out vec4 fragColor;

// Material IDs via unique vertex colors:
// body=(1,1,1) glass=(0,0,1) rubber=(0,0.5,0) head=(1,1,0) tail=(1,0,0)
// chrome=(0.5,0.5,0.5) dark=(0,0,0)
void main() {
  vec3 n = normalize(vNrm);
  vec3 view = normalize(uCamPos - vWorld);
  vec3 c = vCol;

  float isBody   = step(0.9, c.r) * step(0.9, c.g) * step(0.9, c.b);
  float isGlass  = step(0.5, c.b) * (1.0 - step(0.3, c.r)) * (1.0 - step(0.3, c.g));
  float isRubber = step(0.3, c.g) * (1.0 - step(0.3, c.r)) * (1.0 - step(0.3, c.b));
  float isHead   = step(0.8, c.r) * step(0.8, c.g) * (1.0 - step(0.3, c.b));
  float isTail   = step(0.8, c.r) * (1.0 - step(0.2, c.g)) * (1.0 - step(0.2, c.b));
  float isChrome = step(0.4, c.r) * step(0.4, c.g) * step(0.4, c.b) * (1.0 - isBody);
  float isDark   = (1.0 - step(0.15, c.r)) * (1.0 - step(0.15, c.g)) * (1.0 - step(0.15, c.b));
  // GLB props: use vertex color as albedo when it isn't a known ID and paint is white-ish
  float isProp = (1.0 - isBody) * (1.0 - isGlass) * (1.0 - isRubber) * (1.0 - isHead) * (1.0 - isTail) * (1.0 - isChrome) * (1.0 - isDark);

  vec3 albedo;
  if (isGlass > 0.5) albedo = vec3(0.08, 0.12, 0.18);
  else if (isRubber > 0.5) albedo = vec3(0.07, 0.07, 0.08);
  else if (isDark > 0.5) albedo = vec3(0.1, 0.1, 0.11);
  else if (isChrome > 0.5) albedo = mix(vec3(0.55, 0.55, 0.58), uPaint * 0.45, 0.35);
  else if (isHead > 0.5 || isTail > 0.5) albedo = c;
  else if (isProp > 0.5) {
    // GLB prop: keep vertex color; only tint if paint isn't white
    float paintMix = 1.0 - uPaint.r * uPaint.g * uPaint.b; // 0 when white
    albedo = mix(c, c * uPaint * 1.4, clamp(paintMix, 0.0, 0.85));
  }
  else albedo = uPaint;

  if (isBody > 0.5 && n.y > 0.6) albedo *= 0.7;

  float ndl = max(dot(n, uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(uAmbGround, uAmbSky, hemi);

  vec3 h = normalize(uSunDir + view);
  float gloss = mix(24.0, 90.0, max(isGlass, isBody));
  float spec = pow(max(dot(n, h), 0.0), gloss) * mix(0.15, 0.7, max(isGlass, isBody));
  float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0) * mix(0.08, 0.5, isGlass);

  vec3 col = albedo * (amb + uSunCol * ndl);
  col += uSunCol * spec;
  col += vec3(0.4, 0.55, 0.75) * fres;

  vec3 emis = vec3(0.0);
  if (isTail > 0.5) emis += vec3(1.4, 0.08, 0.05) * (0.35 + uBrake * 1.8);
  if (isHead > 0.5) emis += vec3(1.6, 1.3, 0.85) * uHeadlights;
  col += emis;
  col = mix(col, col * vec3(0.55, 0.65, 0.95) + emis * 0.7, uNight * 0.35);

  float fog = 1.0 - exp(-uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  fragColor = vec4(col, 1.0);
}`;

export const GROUND_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aCol;
uniform mat4 uViewProj;
out vec3 vNrm;
out vec3 vCol;
out vec3 vWorld;
out float vDist;
void main() {
  vWorld = aPos;
  vNrm = aNrm;
  vCol = aCol;
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  vDist = clip.w;
  gl_Position = clip;
}`;

export const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec3 vCol;
in vec3 vWorld;
in float vDist;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uNight;
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNrm);
  float ndl = max(dot(n, uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(uAmbGround, uAmbSky, hemi);
  vec3 col = vCol * (amb + uSunCol * ndl);
  col = mix(col, col * vec3(0.5, 0.6, 0.95), uNight * 0.4);
  float fog = 1.0 - exp(-uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  fragColor = vec4(col, 1.0);
}`;
