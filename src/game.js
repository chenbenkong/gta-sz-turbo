// 深城纪 TURBO — core game (WebGL2, original models + chunk streaming)
// Tuned for Ryzen 5 5600H + Vega 7 iGPU: no postFX, distance LOD, dynamic res.

import {
  createGL, createProgram, getUniforms, drawMesh, createTexture, loadImage,
} from './gl.js';
import {
  m4identity, m4multiply, m4perspective, m4lookAt, m4compose,
  clamp, lerp,
} from './math.js';
import {
  CITY_VS, CITY_FS, SKY_VS, SKY_FS, WATER_VS, WATER_FS,
  CAR_VS, CAR_FS_CLEAN, GROUND_VS, GROUND_FS,
} from './shaders.js';
import { buildCity, buildNavGraph, nearestNode, randomWalk } from './city.js';
import {
  buildCarMesh, CAR_TYPES, createVehicle, stepVehicle,
  vehicleModelMatrix, collideBuildings,
} from './vehicle.js';
import {
  loadCarMeshes, loadTreeMesh, loadPedestrianMesh, loadPlaneMesh, loadPlayerCharacter,
} from './assets.js';
import { createCrowd, createPlane, stepPlane } from './crowd.js';
import { createStreamer } from './chunk-stream.js';
import { createInput } from './input.js';
import { createUI, setLoad, showToast, updateHUD, drawMinimap } from './ui.js';

const QUALITY = {
  auto: { viewDist: 850, fog: 0.0000045, traffic: 20, pixelRatio: 0.75 },
  high: { viewDist: 1000, fog: 0.0000035, traffic: 28, pixelRatio: 0.85 },
  balanced: { viewDist: 750, fog: 0.000005, traffic: 18, pixelRatio: 0.7 },
  low: { viewDist: 500, fog: 0.000009, traffic: 10, pixelRatio: 0.55 },
};

const DAY = {
  time: 0.35, sunDir: [0.45, 0.7, 0.35], sunCol: [1.05, 0.98, 0.88],
  ambSky: [0.55, 0.65, 0.8], ambGround: [0.38, 0.36, 0.33],
  skyTop: [0.35, 0.55, 0.85], skyHorizon: [0.75, 0.82, 0.88],
  groundCol: [0.4, 0.4, 0.38], fogColor: [0.62, 0.7, 0.78], night: 0,
};
const SUNSET = {
  time: 0.72, sunDir: [0.85, 0.18, 0.2], sunCol: [1.3, 0.58, 0.3],
  ambSky: [0.5, 0.42, 0.55], ambGround: [0.35, 0.28, 0.26],
  skyTop: [0.25, 0.25, 0.45], skyHorizon: [1.0, 0.55, 0.35],
  groundCol: [0.35, 0.3, 0.32], fogColor: [0.78, 0.5, 0.42], night: 0.12,
};
const NIGHT = {
  time: 0.95, sunDir: [0.2, 0.55, 0.5], sunCol: [0.18, 0.2, 0.32],
  ambSky: [0.18, 0.22, 0.38], ambGround: [0.12, 0.13, 0.18],
  skyTop: [0.03, 0.05, 0.12], skyHorizon: [0.08, 0.1, 0.18],
  groundCol: [0.05, 0.06, 0.08], fogColor: [0.05, 0.07, 0.12], night: 1,
};
const TIMES = [DAY, SUNSET, NIGHT];

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`);
  return res.json();
}

function nearestRoadName(roads, x, z) {
  let best = '深圳', bd = Infinity;
  for (let i = 0; i < roads.length; i += 3) {
    const r = roads[i];
    const pts = r.points;
    if (!pts || !pts.length) continue;
    const p = pts[0];
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd && r.name) { bd = d; best = r.name; }
  }
  return best;
}

export async function startGame(canvas) {
  const ui = createUI(document.getElementById('ui'));
  const gl = createGL(canvas);

  setLoad(ui, 0.05, '编译着色器…');
  const cityProg = createProgram(gl, CITY_VS, CITY_FS);
  const cityU = getUniforms(gl, cityProg);
  const groundProg = createProgram(gl, GROUND_VS, GROUND_FS);
  const groundU = getUniforms(gl, groundProg);
  const waterProg = createProgram(gl, WATER_VS, WATER_FS);
  const waterU = getUniforms(gl, waterProg);
  const skyProg = createProgram(gl, SKY_VS, SKY_FS);
  const skyU = getUniforms(gl, skyProg);
  const carProg = createProgram(gl, CAR_VS, CAR_FS_CLEAN);
  const carU = getUniforms(gl, carProg);

  // sky triangle
  const skyVao = gl.createVertexArray();
  gl.bindVertexArray(skyVao);
  const skyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  setLoad(ui, 0.15, '读取深圳路网…');
  const city = await loadJSON('city/city.json');
  setLoad(ui, 0.4, '生成地表与道路…');
  await new Promise((r) => setTimeout(r, 0));
  const world = buildCity(gl, city);

  setLoad(ui, 0.6, '载入导航图…');
  let nav = null;
  try {
    nav = buildNavGraph(await loadJSON('city/navigation.json'));
  } catch (e) { console.warn('nav', e); }

  setLoad(ui, 0.75, '装载原版载具…');
  const carMeshes = {};
  for (const t of CAR_TYPES) carMeshes[t.type] = buildCarMesh(gl, t.type);
  let glbPlayer = null, glbTraffic = null, glbTree = null, glbPed = null, glbPlane = null, glbChar = null;
  try {
    const cars = await loadCarMeshes(gl);
    glbPlayer = cars.player; glbTraffic = cars.traffic;
  } catch (e) { console.warn('car', e); }
  try { glbTree = await loadTreeMesh(gl); } catch (e) { console.warn('tree', e); }
  try { glbPed = await loadPedestrianMesh(gl); } catch (e) { console.warn('ped', e); }
  try { glbChar = await loadPlayerCharacter(gl); } catch (e) { console.warn('char', e); }
  try { glbPlane = await loadPlaneMesh(gl); } catch (e) { console.warn('plane', e); }

  const streamer = createStreamer(gl);
  let streamReady = false;
  try {
    setLoad(ui, 0.86, '挂载原版城市几何…');
    await streamer.loadIndex('city-opt/index.json');
    streamReady = true;
  } catch (e) {
    console.warn('city-opt missing — run tools/optimize-city.mjs', e);
  }

  let treeSpots = [];
  let crowd = null;
  try {
    setLoad(ui, 0.9, '种植行道树…');
    treeSpots = await loadJSON('city/trees.json');
  } catch (_) {}
  try {
    setLoad(ui, 0.93, '召集行人…');
    const paths = await loadJSON('city/pedestrian-paths.json');
    crowd = createCrowd(Array.isArray(paths[0]) ? paths.flat() : paths, 32);
  } catch (e) { console.warn('crowd', e); }

  // textures optional
  let roadTex = null;
  try {
    const img = await loadImage('city/textures/road.jpg');
    roadTex = createTexture(gl, img, { repeat: true, mipmaps: true });
  } catch (_) {}

  const spawn = city.spawn || { x: -2664, z: -862, yaw: -1.72 };
  const player = createVehicle(spawn.x, spawn.z, spawn.yaw || 0, {
    type: 'sports', paint: [0.85, 0.12, 0.1], maxSpeed: 60, accel: 15,
  });

  const traffic = [];
  function spawnTraffic(n) {
    traffic.length = 0;
    if (!nav) return;
    for (let i = 0; i < n; i++) {
      const type = CAR_TYPES[(Math.random() * CAR_TYPES.length) | 0];
      const node = i < n * 0.5
        ? nearestNode(nav, player.x + (Math.random() - 0.5) * 280, player.z + (Math.random() - 0.5) * 280)
        : (Math.random() * nav.nodes.length) | 0;
      const p = nav.nodes[node];
      traffic.push(createVehicle(p[0], p[1], Math.random() * Math.PI * 2, {
        type: type.type, paint: type.paint, maxSpeed: 12 + Math.random() * 10, accel: 5,
        ai: { path: randomWalk(nav, node, 28), idx: 0 },
      }));
    }
  }

  let env = { ...TIMES[0], sunDir: normalize3(TIMES[0].sunDir) };
  const view = new Float32Array(16);
  const proj = new Float32Array(16);
  const viewProj = new Float32Array(16);
  const model = new Float32Array(16);
  const camPos = new Float32Array([0, 10, 0]);
  const camTarget = new Float32Array([0, 0, 0]);
  const input = createInput();

  let qualityKey = new URLSearchParams(location.search).get('quality') || 'balanced';
  if (!QUALITY[qualityKey]) qualityKey = 'balanced';
  let q = { ...QUALITY[qualityKey] };
  let autoQ = qualityKey === 'auto';
  if (autoQ) q = { ...QUALITY.balanced, pixelRatio: 0.7 };

  // Dynamic resolution — 2K panel, render ~1120–1400 wide for Vega 7
  let renderScale = q.pixelRatio;
  function applySize() {
    // cap internal res: never exceed 1600x1000 for iGPU fill-rate
    const cssW = canvas.clientWidth || 1280;
    const cssH = canvas.clientHeight || 720;
    const capW = 1600, capH = 1000;
    const fit = Math.min(capW / cssW, capH / cssH, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = renderScale * fit;
    const w = Math.max(1, Math.floor(cssW * dpr * scale));
    const h = Math.max(1, Math.floor(cssH * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }
  window.addEventListener('resize', applySize);
  applySize();

  let paused = false;
  let fps = 60, fpsAcc = 0, fpsN = 0, fpsTimer = 0;
  let clockH = 12, areaName = '深圳', lastAreaT = 0;
  let carIdx = 0, camMode = 0, timeIdx = 0;
  let onFoot = false, inPlane = false, plane = null, timeSec = 0;
  const walker = { x: 0, z: 0, yaw: 0, speed: 0 };
  const parked = { x: 0, z: 0, yaw: 0, paint: [0.85, 0.12, 0.1], type: 'sports' };

  function toggleFoot() {
    if (inPlane) return;
    onFoot = !onFoot;
    if (onFoot) {
      parked.x = player.x; parked.z = player.z; parked.yaw = player.yaw;
      parked.paint = player.paint; parked.type = player.type;
      walker.x = player.x + Math.cos(player.yaw) * 2.4;
      walker.z = player.z - Math.sin(player.yaw) * 2.4;
      walker.yaw = player.yaw; walker.speed = 0;
      showToast(ui, '步行 · F 上车 · B 飞机');
    } else {
      player.x = parked.x; player.z = parked.z; player.yaw = parked.yaw; player.speed = 0;
      showToast(ui, '已上车');
    }
  }
  function togglePlane() {
    if (inPlane) {
      inPlane = false;
      player.x = plane.x; player.z = plane.z; player.yaw = plane.yaw;
      player.y = 0; player.speed = 0; onFoot = false;
      showToast(ui, '已落地');
      return;
    }
    onFoot = false; inPlane = true;
    plane = createPlane(player.x + Math.sin(player.yaw) * 30, player.z + Math.cos(player.yaw) * 30, player.yaw);
    plane.y = 55; plane.speed = 42;
    showToast(ui, '水上飞机 · W/S · A/D · Q/E 升降 · B 落地');
  }
  function cycleCar() {
    carIdx = (carIdx + 1) % CAR_TYPES.length;
    const t = CAR_TYPES[carIdx];
    player.type = t.type; player.paint = [...t.paint];
    showToast(ui, '载具 · ' + t.name);
  }
  function cycleTime() {
    timeIdx = (timeIdx + 1) % TIMES.length;
    showToast(ui, ['晴日', '黄昏', '夜色'][timeIdx]);
  }

  ui.btnResume.onclick = () => { paused = false; ui.menu.classList.add('hidden'); ui.hud.classList.remove('hidden'); };
  ui.btnQuality.onclick = () => {
    const keys = ['auto', 'high', 'balanced', 'low'];
    qualityKey = keys[(keys.indexOf(qualityKey) + 1) % keys.length];
    q = qualityKey === 'auto' ? { ...QUALITY.balanced, pixelRatio: 0.7 } : { ...QUALITY[qualityKey] };
    autoQ = qualityKey === 'auto';
    renderScale = q.pixelRatio;
    applySize();
    ui.btnQuality.textContent = '画质：' + ({ auto: '自动', high: '极致', balanced: '均衡', low: '流畅' })[qualityKey];
  };
  ui.btnCar.onclick = () => cycleCar();
  ui.btnTime.onclick = () => cycleTime();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      paused = !paused;
      ui.menu.classList.toggle('hidden', !paused);
      ui.hud.classList.toggle('hidden', paused);
    }
    if (e.code === 'KeyC') { camMode = (camMode + 1) % 3; showToast(ui, ['追尾', '车头', '远景'][camMode]); }
    if (e.code === 'KeyN') cycleTime();
    if (e.code === 'KeyV') cycleCar();
    if (e.code === 'KeyF') toggleFoot();
    if (e.code === 'KeyB') togglePlane();
    if (e.code === 'KeyH') ui.hud.classList.toggle('hidden');
    if (e.code === 'KeyQ' && !inPlane) ui.btnQuality.click();
    if (e.code === 'KeyR') {
      player.x = spawn.x; player.z = spawn.z; player.yaw = spawn.yaw || 0; player.speed = 0;
      onFoot = false; inPlane = false; plane = null;
      showToast(ui, '已复位');
    }
  });

  spawnTraffic(q.traffic);

  function setCommon(u, extra = {}) {
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    if (u.uSunDir) gl.uniform3fv(u.uSunDir, env.sunDir);
    if (u.uSunCol) gl.uniform3fv(u.uSunCol, env.sunCol);
    if (u.uAmbSky) gl.uniform3fv(u.uAmbSky, env.ambSky);
    if (u.uAmbGround) gl.uniform3fv(u.uAmbGround, env.ambGround);
    if (u.uFogColor) gl.uniform3fv(u.uFogColor, env.fogColor);
    if (u.uFogDensity) gl.uniform1f(u.uFogDensity, q.fog);
    if (u.uCamPos) gl.uniform3fv(u.uCamPos, camPos);
    if (u.uNight) gl.uniform1f(u.uNight, env.night);
    if (u.uTime) gl.uniform1f(u.uTime, timeSec);
    for (const [k, v] of Object.entries(extra)) {
      const loc = u[k];
      if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
    }
  }

  function envBlend() {
    const t = TIMES[timeIdx];
    const k = 0.05;
    for (const key of ['sunCol', 'ambSky', 'ambGround', 'skyTop', 'skyHorizon', 'groundCol', 'fogColor', 'sunDir']) {
      if (!env[key]) env[key] = [...t[key]];
      for (let i = 0; i < 3; i++) env[key][i] = lerp(env[key][i], t[key][i], k);
    }
    env.night = lerp(env.night, t.night, k);
    env.sunDir = normalize3(env.sunDir);
    clockH = lerp(clockH, t.time * 24, k);
  }

  function stepWalker(dt) {
    const t = input.throttle, s = input.steer;
    walker.speed = lerp(walker.speed, t * (input.handbrake ? 6.5 : 3.2), 1 - Math.pow(0.001, dt));
    if (Math.abs(t) > 0.05) walker.yaw += s * 2.2 * dt * (walker.speed >= 0 ? 1 : -1);
    else if (Math.abs(s) > 0.05) walker.yaw += s * 2.2 * dt;
    walker.x += Math.sin(walker.yaw) * walker.speed * dt;
    walker.z += Math.cos(walker.yaw) * walker.speed * dt;
    const fake = { x: walker.x, z: walker.z, speed: walker.speed };
    collideBuildings(fake, city.buildings, 0.6);
    walker.x = fake.x; walker.z = fake.z;
    player.x = walker.x; player.z = walker.z; player.yaw = walker.yaw; player.speed = 0; player.y = 0;
  }

  function updateTraffic(dt) {
    if (!nav) return;
    for (const v of traffic) {
      if (!v.ai) continue;
      const path = v.ai.path;
      if (!path || v.ai.idx >= path.length) {
        v.ai.path = randomWalk(nav, nearestNode(nav, v.x, v.z), 24);
        v.ai.idx = 0;
      }
      const node = nav.nodes[path[v.ai.idx]];
      if (!node) continue;
      const dx = node[0] - v.x, dz = node[1] - v.z;
      const dist = Math.hypot(dx, dz);
      v.yaw = v.yaw + ((Math.atan2(dx, dz) - v.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * (1 - Math.pow(0.05, dt));
      v.speed = lerp(v.speed, dist > 8 ? 11 : 4, 1 - Math.pow(0.1, dt));
      v.x += Math.sin(v.yaw) * v.speed * dt;
      v.z += Math.cos(v.yaw) * v.speed * dt;
      if (dist < 6) v.ai.idx++;
    }
  }

  function updateCamera(dt) {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    let dist = 7.5, height = 2.5, look = 4, side = 1.2;
    if (camMode === 1) { dist = 0.5; height = 1.35; look = 14; side = 0; }
    if (camMode === 2) { dist = 16; height = 7.5; look = 3; side = 2.5; }
    if (onFoot) { dist = 4.2; height = 1.9; look = 3.5; side = 0.6; }
    if (inPlane && plane) { dist = 20; height = 7; look = 14; side = 2; }

    const speedT = clamp(Math.abs(player.speed) / 55, 0, 1);
    dist += speedT * 2; height += speedT * 0.8;
    const yaw = player.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const baseY = player.y || 0;
    const k = 1 - Math.pow(0.002, dt);
    camPos[0] = lerp(camPos[0], player.x - Math.sin(yaw) * dist + rx * side, k);
    camPos[1] = lerp(camPos[1], baseY + height, k * 0.65);
    camPos[2] = lerp(camPos[2], player.z - Math.cos(yaw) * dist + rz * side, k);
    camTarget[0] = player.x + fx * look;
    camTarget[1] = baseY + (inPlane ? 0.5 : 1);
    camTarget[2] = player.z + fz * look;

    const fov = (56 + speedT * 12) * Math.PI / 180;
    m4perspective(proj, fov, canvas.width / canvas.height, 0.3, q.viewDist);
    m4lookAt(view, camPos, camTarget, [0, 1, 0]);
    m4multiply(viewProj, proj, view);
  }

  setLoad(ui, 1, '就绪');
  setTimeout(() => {
    ui.loading.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    window.__GAME_READY = true;
  }, 150);

  let last = performance.now();
  async function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    timeSec += dt;

    fpsAcc += 1 / Math.max(dt, 0.001); fpsN++; fpsTimer += dt;
    if (fpsTimer > 0.5) {
      fps = Math.round(fpsAcc / fpsN);
      fpsAcc = 0; fpsN = 0; fpsTimer = 0;
      // Dynamic res: target 55–60 on this iGPU
      if (autoQ) {
        if (fps < 48 && renderScale > 0.5) { renderScale = Math.max(0.5, renderScale - 0.05); applySize(); }
        else if (fps > 58 && renderScale < q.pixelRatio) { renderScale = Math.min(q.pixelRatio, renderScale + 0.03); applySize(); }
      }
    }

    if (!paused) {
      input.update();
      if (inPlane && plane) {
        stepPlane(plane, input, dt);
        player.x = plane.x; player.z = plane.z; player.yaw = plane.yaw;
        player.y = plane.y; player.speed = plane.speed;
        if (!plane.alive) { showToast(ui, '触地！'); plane.alive = true; plane.y = 10; plane.speed = 18; }
      } else if (onFoot) {
        stepWalker(dt);
      } else {
        stepVehicle(player, input, dt);
        collideBuildings(player, city.buildings, 1.6);
      }
      if (crowd) crowd.update(dt, player.x, player.z);
      player.x = clamp(player.x, -7500, 7500);
      player.z = clamp(player.z, -3500, 3500);
      updateTraffic(dt);
      envBlend();
      lastAreaT += dt;
      if (lastAreaT > 2) { lastAreaT = 0; areaName = nearestRoadName(city.roads, player.x, player.z); }
    }
    updateCamera(dt);

    // ---- render ----
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProg);
    gl.depthMask(false);
    {
      const fx = camTarget[0] - camPos[0], fy = camTarget[1] - camPos[1], fz = camTarget[2] - camPos[2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      const f = [fx / fl, fy / fl, fz / fl];
      const r = [f[2], 0, -f[0]];
      const rl = Math.hypot(r[0], r[2]) || 1; r[0] /= rl; r[2] /= rl;
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const tanF = Math.tan((56 + clamp(Math.abs(player.speed) / 55, 0, 1) * 12) * Math.PI / 360);
      const aspect = canvas.width / canvas.height;
      const invVP = new Float32Array(16);
      invVP[0] = r[0] * tanF * aspect; invVP[4] = r[1] * tanF * aspect; invVP[8] = r[2] * tanF * aspect;
      invVP[1] = u[0] * tanF; invVP[5] = u[1] * tanF; invVP[9] = u[2] * tanF;
      invVP[2] = f[0]; invVP[6] = f[1]; invVP[10] = f[2]; invVP[15] = 1;
      gl.uniformMatrix4fv(skyU.uInvViewProj, false, invVP);
      gl.uniform3fv(skyU.uSunDir, env.sunDir);
      gl.uniform3fv(skyU.uSkyTop, env.skyTop);
      gl.uniform3fv(skyU.uSkyHorizon, env.skyHorizon);
      gl.uniform3fv(skyU.uSunCol, env.sunCol);
      gl.uniform3fv(skyU.uGroundCol, env.groundCol);
      gl.uniform1f(skyU.uNight, env.night);
      gl.uniform1f(skyU.uTime, timeSec);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);

    // ground / green
    gl.useProgram(groundProg);
    setCommon(groundU, { uModel: world.identity });
    drawMesh(gl, world.ground);
    if (world.green.count) drawMesh(gl, world.green);

    // roads (procedural base always — original roads stream on top when ready)
    gl.useProgram(cityProg);
    gl.disable(gl.CULL_FACE);
    setCommon(cityU, { uModel: world.identity, uUseTex: 0, uWindowGrid: 0, uEmissive: 0 });
    drawMesh(gl, world.roads);

    // original city geometry stream (buildings / roads / landmarks)
    setCommon(cityU, { uModel: world.identity, uUseTex: 0, uWindowGrid: 1, uEmissive: 1 });
    if (streamReady) {
      await streamer.update(player.x, player.z, [
        { name: 'roads', maxDist: 300, budget: 28, lodDist: 160 },
        { name: 'buildings', maxDist: 480, budget: 32, lodDist: 180 },
        { name: 'landmarks', maxDist: 2800, budget: 4, lodDist: 99999 },
      ], cityProg, cityU, world.identity);
    } else {
      drawMesh(gl, world.buildings);
      drawMesh(gl, world.landmarks);
    }
    gl.enable(gl.CULL_FACE);

    // water
    gl.useProgram(waterProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    setCommon(waterU, { uModel: world.identity, uSkyTop: env.skyTop, uSkyHorizon: env.skyHorizon });
    if (world.water.count) drawMesh(gl, world.water);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // vehicles / walker / plane
    gl.disable(gl.CULL_FACE);
    gl.useProgram(carProg);
    if (inPlane && plane && glbPlane) {
      m4compose(model, plane.x, plane.y, plane.z, plane.yaw, plane.pitch, plane.roll);
      setCommon(carU, { uModel: model, uPaint: [0.85, 0.88, 0.9], uBrake: 0, uHeadlights: 0 });
      drawMesh(gl, glbPlane);
    } else if (onFoot) {
      const bob = Math.sin(timeSec * 8) * Math.min(0.05, Math.abs(walker.speed) * 0.02);
      m4compose(model, walker.x, bob, walker.z, walker.yaw, 0, 0);
      setCommon(carU, { uModel: model, uPaint: [1, 1, 1], uBrake: 0, uHeadlights: 0 });
      drawMesh(gl, glbChar || glbPed || carMeshes.sedan);
      m4compose(model, parked.x, 0, parked.z, parked.yaw, 0, 0);
      setCommon(carU, { uModel: model, uPaint: parked.paint, uBrake: 0, uHeadlights: env.night > 0.3 ? 1 : 0 });
      drawMesh(gl, glbPlayer || carMeshes.sedan);
    } else {
      const drawCar = (v) => {
        vehicleModelMatrix(v, model);
        setCommon(carU, {
          uModel: model, uPaint: v === player ? player.paint : v.paint,
          uBrake: v.brake, uHeadlights: env.night > 0.3 ? 1 : 0.15,
        });
        drawMesh(gl, v === player ? (glbPlayer || carMeshes.sedan) : (glbTraffic || carMeshes.sedan));
      };
      drawCar(player);
      for (const v of traffic) {
        const dx = v.x - player.x, dz = v.z - player.z;
        if (dx * dx + dz * dz < 400 * 400) drawCar(v);
      }
    }

    if (crowd && glbPed && !inPlane) {
      crowd.draw(gl, carProg, carU, setCommon, glbPed, model, player.x, player.z);
    }

    // trees
    if (glbTree) {
      gl.useProgram(carProg);
      const white = [1, 1, 1];
      const near = [];
      for (const t of treeSpots) {
        const dx = t[0] - player.x, dz = t[1] - player.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 7 * 7 || d2 > 150 * 150) continue;
        near.push([d2, t]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(140, near.length); i++) {
        const t = near[i][1];
        let sc = t[3] || 1;
        if (!(sc > 0.2)) sc = 1;
        if (sc > 2) sc = 2;
        m4compose(model, t[0], 0, t[1], t[2] || 0, 0, 0);
        model[0] *= sc; model[5] *= sc; model[10] *= sc;
        setCommon(carU, { uModel: model, uPaint: white, uBrake: 0, uHeadlights: 0 });
        drawMesh(gl, glbTree);
      }
    }
    gl.enable(gl.CULL_FACE);

    // HUD
    const kmh = inPlane ? Math.abs(player.speed) * 3.6 : Math.abs(player.speed) * 3.6;
    const gear = inPlane ? '✈' : onFoot ? '🚶' : player.speed < -0.3 ? 'R' : player.speed < 0.3 ? 'N' : 'D';
    const hh = ((clockH % 24) + 24) % 24;
    updateHUD(ui, {
      speedKmh: kmh, gear, fps,
      clock: `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.floor((hh % 1) * 60)).padStart(2, '0')}`,
      area: areaName,
    });
    drawMinimap(ui, {
      px: player.x, pz: player.z, yaw: player.yaw,
      roads: city.roads, landmarks: city.landmarks, scale: 0.04, nav,
    });
  }

  requestAnimationFrame(frame);
  window.__OPEN_ROADS__ = { player, get fps() { return fps; }, streamer };
}
