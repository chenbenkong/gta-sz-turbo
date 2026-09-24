// 深城纪 · 一路向海 — core game (WebGL2)

import {
  createGL, createProgram, getUniforms, createMesh, drawMesh,
  createTexture, loadImage, VERT_STRIDE,
} from './gl.js';
import {
  m4identity, m4multiply, m4perspective, m4lookAt, m4compose,
  clamp, lerp, smoothstep, wrapAngle, approachAngle, v3,
} from './math.js';
import {
  CITY_VS, CITY_FS, SKY_VS, SKY_FS, WATER_VS, WATER_FS,
  CAR_VS, CAR_FS_CLEAN, GROUND_VS, GROUND_FS,
} from './shaders.js';
import { buildCity, buildNavGraph, nearestNode, pathTo, randomWalk } from './city.js';
import {
  buildCarMesh, CAR_TYPES, createVehicle, stepVehicle,
  vehicleModelMatrix, collideBuildings,
} from './vehicle.js';
import { loadCarMeshes, loadTreeMesh, loadLandmarkMesh } from './assets.js';
import { createInput } from './input.js';
import {
  createUI, setLoad, showToast, updateHUD, drawMinimap,
} from './ui.js';

const QUALITY = {
  auto: { viewDist: 900, fog: 0.0000042, traffic: 24, pixelRatio: 1, shadows: 0 },
  high: { viewDist: 1100, fog: 0.0000032, traffic: 36, pixelRatio: 1, shadows: 0 },
  balanced: { viewDist: 800, fog: 0.0000045, traffic: 22, pixelRatio: 0.9, shadows: 0 },
  low: { viewDist: 550, fog: 0.000008, traffic: 12, pixelRatio: 0.75, shadows: 0 },
};

const DAY = {
  name: 'day',
  time: 0.35,
  sunDir: [0.45, 0.7, 0.35],
  sunCol: [1.05, 0.98, 0.88],
  ambSky: [0.55, 0.65, 0.80],
  ambGround: [0.38, 0.36, 0.33],
  skyTop: [0.35, 0.55, 0.85],
  skyHorizon: [0.75, 0.82, 0.88],
  groundCol: [0.4, 0.4, 0.38],
  fogColor: [0.62, 0.70, 0.78],
  night: 0,
};

const SUNSET = {
  name: 'sunset',
  time: 0.72,
  sunDir: [0.85, 0.18, 0.2],
  sunCol: [1.35, 0.6, 0.3],
  ambSky: [0.5, 0.42, 0.55],
  ambGround: [0.35, 0.28, 0.26],
  skyTop: [0.25, 0.25, 0.45],
  skyHorizon: [1.0, 0.55, 0.35],
  groundCol: [0.35, 0.3, 0.32],
  fogColor: [0.78, 0.5, 0.42],
  night: 0.12,
};

const NIGHT = {
  name: 'night',
  time: 0.95,
  sunDir: [0.2, 0.55, 0.5],
  sunCol: [0.18, 0.2, 0.32],
  ambSky: [0.18, 0.22, 0.38],
  ambGround: [0.12, 0.13, 0.18],
  skyTop: [0.03, 0.05, 0.12],
  skyHorizon: [0.08, 0.1, 0.18],
  groundCol: [0.05, 0.06, 0.08],
  fogColor: [0.05, 0.07, 0.12],
  night: 1,
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
  const uiRoot = document.getElementById('ui');
  const ui = createUI(uiRoot);
  const gl = createGL(canvas);

  // ---- programs ----
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

  // ---- data ----
  setLoad(ui, 0.15, '读取深圳路网与建筑…');
  const city = await loadJSON('city/city.json');
  setLoad(ui, 0.45, '生成城市网格…');
  await new Promise(r => setTimeout(r, 0));
  const world = buildCity(gl, city);

  setLoad(ui, 0.7, '载入导航图…');
  let nav = null;
  try {
    nav = await loadJSON('city/navigation.json');
    nav = buildNavGraph(nav);
  } catch (e) {
    console.warn('nav load failed', e);
  }

  setLoad(ui, 0.8, '构建载具与街景…');
  const carMeshes = {};
  for (const t of CAR_TYPES) {
    carMeshes[t.type] = buildCarMesh(gl, t.type);
  }
  // Real GLB props (original game models)
  let glbPlayer = null, glbTraffic = null, glbTree = null, glbLandmarks = null;
  try {
    const cars = await loadCarMeshes(gl);
    glbPlayer = cars.player;
    glbTraffic = cars.traffic;
  } catch (e) { console.warn('car glb', e); }
  try {
    glbTree = await loadTreeMesh(gl);
  } catch (e) { console.warn('tree glb', e); }
  // landmarks.glb has broken transforms / non-trivial accessors — skip for now.
  // Procedural landmark towers from city.json still draw.

  // tree scatter from trees.json
  let treeSpots = [];
  try {
    setLoad(ui, 0.9, '种植行道树…');
    treeSpots = await loadJSON('city/trees.json');
  } catch (_) { treeSpots = []; }

  // textures (optional)
  let roadTex = null, buildingTex = null;
  try {
    setLoad(ui, 0.88, '载入材质…');
    const img = await loadImage('city/textures/road.jpg');
    roadTex = createTexture(gl, img, { repeat: true, mipmaps: true });
    const img2 = await loadImage('city/textures/architecture/warm-residential.png');
    buildingTex = createTexture(gl, img2, { repeat: true, mipmaps: true });
  } catch (_) { /* procedural fallback */ }

  // ---- player / traffic ----
  const spawn = city.spawn || { x: -2664, z: -862, yaw: -1.72 };
  let player = createVehicle(spawn.x, spawn.z, spawn.yaw || 0, {
    type: 'sports', paint: [0.9, 0.2, 0.15], maxSpeed: 62, accel: 16,
  });

  const traffic = [];
  function spawnTraffic(n) {
    traffic.length = 0;
    if (!nav) return;
    for (let i = 0; i < n; i++) {
      const type = CAR_TYPES[(Math.random() * CAR_TYPES.length) | 0];
      let node;
      if (i < n * 0.5) {
        node = nearestNode(nav, player.x + (Math.random() - 0.5) * 300, player.z + (Math.random() - 0.5) * 300);
      } else {
        node = (Math.random() * nav.nodes.length) | 0;
      }
      const p = nav.nodes[node];
      const v = createVehicle(p[0], p[1], Math.random() * Math.PI * 2, {
        type: type.type, paint: type.paint, maxSpeed: 14 + Math.random() * 12, accel: 5,
      });
      v.ai = {
        path: randomWalk(nav, node, 30),
        idx: 0,
        nextAt: 0,
      };
      traffic.push(v);
    }
  }

  // ---- camera ----
  let camMode = 0; // 0 chase, 1 hood, 2 far
  let timeIdx = 0;
  let env = { ...TIMES[0] };
  env.sunDir = normalize3(env.sunDir);

  const view = new Float32Array(16);
  const proj = new Float32Array(16);
  const viewProj = new Float32Array(16);
  const invViewProj = new Float32Array(16);
  const model = new Float32Array(16);
  const camPos = new Float32Array([0, 10, 0]);
  const camTarget = new Float32Array([0, 0, 0]);

  const input = createInput();

  // ---- quality ----
  let qualityKey = 'balanced';
  let q = { ...QUALITY.balanced };
  const urlQ = new URLSearchParams(location.search).get('quality');
  if (urlQ && QUALITY[urlQ]) {
    qualityKey = urlQ;
    q = { ...QUALITY[urlQ] };
  }

  function applySize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = q.pixelRatio;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }
  window.addEventListener('resize', applySize);
  applySize();

  // ---- game state ----
  let paused = false;
  let fps = 60;
  let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
  let autoQ = qualityKey === 'auto';
  let clockH = 12;
  let lastAreaT = 0;
  let areaName = '深圳';
  let camYaw = player.yaw;
  let camPitch = 0.25;
  let carIdx = 0;
  let onFoot = false;
  const walker = { x: 0, z: 0, yaw: 0, speed: 0 };

  function toggleFoot() {
    onFoot = !onFoot;
    if (onFoot) {
      walker.x = player.x + Math.cos(player.yaw) * 2.2;
      walker.z = player.z - Math.sin(player.yaw) * 2.2;
      walker.yaw = player.yaw;
      walker.speed = 0;
      showToast(ui, '步行模式 · F 上车');
    } else {
      player.x = walker.x;
      player.z = walker.z;
      player.yaw = walker.yaw;
      player.speed = 0;
      showToast(ui, '已上车');
    }
  }

  function stepWalker(dt) {
    const t = input.throttle, s = input.steer;
    const run = input.handbrake ? 6.5 : 3.2;
    walker.speed = lerp(walker.speed, t * run, 1 - Math.pow(0.001, dt));
    if (Math.abs(t) > 0.05) {
      walker.yaw += s * 2.2 * dt * (walker.speed >= 0 ? 1 : -1);
    } else if (Math.abs(s) > 0.05) {
      walker.yaw += s * 2.2 * dt;
    }
    walker.x += Math.sin(walker.yaw) * walker.speed * dt;
    walker.z += Math.cos(walker.yaw) * walker.speed * dt;
    const fake = { x: walker.x, z: walker.z, speed: walker.speed };
    collideBuildings(fake, city.buildings, 0.6);
    walker.x = fake.x; walker.z = fake.z;
    player.x = walker.x; player.z = walker.z; player.yaw = walker.yaw; player.speed = 0;
  }

  ui.btnResume.onclick = () => {
    paused = false;
    ui.menu.classList.add('hidden');
    ui.hud.classList.remove('hidden');
  };
  ui.btnQuality.onclick = () => {
    const keys = ['auto', 'high', 'balanced', 'low'];
    const i = (keys.indexOf(qualityKey) + 1) % keys.length;
    qualityKey = keys[i];
    q = qualityKey === 'auto' ? { ...QUALITY.balanced } : { ...QUALITY[qualityKey] };
    autoQ = qualityKey === 'auto';
    ui.btnQuality.textContent = '画质：' + ({ auto: '自动', high: '极致', balanced: '均衡', low: '流畅' })[qualityKey];
    applySize();
    showToast(ui, '画质 → ' + ui.btnQuality.textContent.replace('画质：', ''));
  };
  ui.btnCar.onclick = () => cycleCar();
  ui.btnTime.onclick = () => cycleTime();

  function cycleCar() {
    carIdx = (carIdx + 1) % CAR_TYPES.length;
    const t = CAR_TYPES[carIdx];
    player.type = t.type;
    player.paint = [...t.paint];
    if (t.type === 'sports') { player.maxSpeed = 62; player.accel = 16; }
    else if (t.type === 'suv') { player.maxSpeed = 48; player.accel = 12; }
    else if (t.type === 'taxi') { player.maxSpeed = 50; player.accel = 13; }
    else if (t.type === 'police') { player.maxSpeed = 58; player.accel = 15; }
    else { player.maxSpeed = 52; player.accel = 13; }
    showToast(ui, '载具 · ' + t.name);
  }

  function cycleTime() {
    timeIdx = (timeIdx + 1) % TIMES.length;
    showToast(ui, ['晴日', '黄昏', '夜色'][timeIdx]);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      paused = !paused;
      ui.menu.classList.toggle('hidden', !paused);
      ui.hud.classList.toggle('hidden', paused);
      if (paused) showToast(ui, '已暂停');
    }
    if (e.code === 'KeyC') {
      camMode = (camMode + 1) % 3;
      showToast(ui, ['追尾视角', '车头视角', '远景视角'][camMode]);
    }
    if (e.code === 'KeyN') cycleTime();
    if (e.code === 'KeyV') cycleCar();
    if (e.code === 'KeyR') {
      player.x = spawn.x; player.z = spawn.z; player.yaw = spawn.yaw || 0; player.speed = 0;
      onFoot = false;
      showToast(ui, '已复位');
    }
    if (e.code === 'KeyF') toggleFoot();
    if (e.code === 'KeyH') {
      ui.hud.classList.toggle('hidden');
    }
    if (e.code === 'KeyQ') {
      ui.btnQuality.click();
    }
  });

  spawnTraffic(q.traffic);

  // ---- helpers ----
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
    // smooth transition toward TIMES[timeIdx]
    const t = TIMES[timeIdx];
    const k = 0.04;
    for (const key of ['sunCol', 'ambSky', 'ambGround', 'skyTop', 'skyHorizon', 'groundCol', 'fogColor', 'sunDir']) {
      if (!env[key]) env[key] = [...t[key]];
      for (let i = 0; i < 3; i++) {
        env[key][i] = lerp(env[key][i], t[key][i], k);
      }
    }
    env.night = lerp(env.night, t.night, k);
    env.sunDir = normalize3(env.sunDir);
    clockH = lerp(clockH, t.time * 24, k);
  }

  function updateTraffic(dt) {
    if (!nav) return;
    for (const v of traffic) {
      if (!v.ai) continue;
      const path = v.ai.path;
      if (!path || v.ai.idx >= path.length) {
        const n = nearestNode(nav, v.x, v.z);
        v.ai.path = randomWalk(nav, n, 25);
        v.ai.idx = 0;
      }
      const nodeI = path[v.ai.idx];
      const node = nav.nodes[nodeI];
      if (!node) continue;
      const dx = node[0] - v.x, dz = node[1] - v.z;
      const dist = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(dx, dz);
      v.yaw = approachAngle(v.yaw, targetYaw, 1 - Math.pow(0.05, dt));
      const desired = 10 + (v.type === 'sports' ? 8 : 0);
      v.speed = lerp(v.speed, dist > 8 ? desired : desired * 0.4, 1 - Math.pow(0.1, dt));
      stepVehicle(v, { throttle: 0.5, steer: 0, handbrake: false }, dt);
      // force along path
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      v.x += fx * v.speed * dt;
      v.z += fz * v.speed * dt;
      if (dist < 6) v.ai.idx++;
    }
  }

  function updateCamera(dt) {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    // 3/4 rear chase — slight lateral offset so the car reads as 3D
    let dist = 7.5, height = 2.5, look = 4.0;
    let side = 1.2;
    if (camMode === 1) { dist = 0.5; height = 1.35; look = 14; side = 0; }
    if (camMode === 2) { dist = 16; height = 7.5; look = 3; side = 2.5; }
    if (typeof onFoot !== 'undefined' && onFoot) {
      dist = 4.2; height = 1.9; look = 3.5; side = 0.6;
    }

    const speedT = clamp(Math.abs(player.speed) / 55, 0, 1);
    dist += speedT * 2.0;
    height += speedT * 0.8;

    const yaw = player.yaw;
    // right vector in XZ: (cos yaw, -sin yaw)?  forward=(sin,cos), right=(cos,-sin)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const tx = player.x - Math.sin(yaw) * dist + rx * side;
    const tz = player.z - Math.cos(yaw) * dist + rz * side;
    const ty = player.y + height;

    // smooth follow
    const k = 1 - Math.pow(0.002, dt);
    camPos[0] = lerp(camPos[0], tx, k);
    camPos[1] = lerp(camPos[1], ty, k * 0.65);
    camPos[2] = lerp(camPos[2], tz, k);

    camTarget[0] = player.x + fx * look;
    camTarget[1] = player.y + 1.0;
    camTarget[2] = player.z + fz * look;

    const fov = (56 + speedT * 12) * Math.PI / 180;
    m4perspective(proj, fov, canvas.width / canvas.height, 0.3, q.viewDist);
    m4lookAt(view, camPos, camTarget, [0, 1, 0]);
    m4multiply(viewProj, proj, view);

    // invert viewProj for sky (approx via lookAt inverse)
    // For sky we only need camera basis directions — reuse lookAt matrix inverse of rotation
    // Cheap invViewProj: transpose rotation + eye
    invViewProj.set(view);
    // We only need dir from inv VP; sky shader uses full inv. Build properly-ish:
    // inv(view) = [R^T | -R^T t]
    const m = view;
    const rot = [
      m[0], m[4], m[8], 0,
      m[1], m[5], m[9], 0,
      m[2], m[6], m[10], 0,
      0, 0, 0, 1,
    ];
    const ex = camPos[0], ey = camPos[1], ez = camPos[2];
    const invView = new Float32Array([
      rot[0], rot[4], rot[8], 0,
      rot[1], rot[5], rot[9], 0,
      rot[2], rot[6], rot[10], 0,
      0, 0, 0, 1,
    ]);
    invView[12] = -(invView[0] * ex + invView[4] * ey + invView[8] * ez);
    invView[13] = -(invView[1] * ex + invView[5] * ey + invView[9] * ez);
    invView[14] = -(invView[2] * ex + invView[6] * ey + invView[10] * ez);
    // inv(proj) for perspective
    const invP = new Float32Array(16);
    invP[0] = 1 / proj[0];
    invP[5] = 1 / proj[5];
    invP[11] = 1 / proj[14];
    invP[14] = -1 / proj[14];
    invP[15] = proj[10] / proj[14];
    // wait: proper invPerspective:
    // [1/fx 0 0 0; 0 1/fy 0 0; 0 0 0 1/P14; 0 0 -1 P10/P14] roughly
    m4multiply(invViewProj, invView, invP);
  }

  let timeSec = 0;

  // ---- main loop ----
  let last = performance.now();
  let ready = false;

  setLoad(ui, 1, '就绪，开始驾驶！');
  setTimeout(() => {
    ui.loading.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ready = true;
  }, 200);

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    timeSec += dt;

    fpsAcc += 1 / Math.max(dt, 0.001);
    fpsN++;
    fpsTimer += dt;
    if (fpsTimer > 0.5) {
      fps = Math.round(fpsAcc / fpsN);
      fpsAcc = 0; fpsN = 0; fpsTimer = 0;
      // adaptive quality
      if (autoQ) {
        if (fps < 38) {
          q.viewDist = Math.max(450, q.viewDist * 0.9);
          q.fog = Math.min(0.000012, q.fog * 1.12);
          if (fps < 28 && q.pixelRatio > 0.6) {
            q.pixelRatio = Math.max(0.6, q.pixelRatio - 0.1);
            applySize();
          }
        } else if (fps > 55) {
          q.viewDist = Math.min(QUALITY.auto.viewDist, q.viewDist * 1.03);
          q.fog = Math.max(QUALITY.auto.fog, q.fog * 0.98);
        }
      }
    }

    if (!ready) return;

    if (!paused) {
      input.update();
      if (onFoot) {
        stepWalker(dt);
      } else {
        stepVehicle(player, input, dt);
        collideBuildings(player, city.buildings, 1.6);
      }
      // keep in bounds
      player.x = clamp(player.x, -7500, 7500);
      player.z = clamp(player.z, -3500, 3500);

      // respawn if fell
      if (!isFinite(player.x) || !isFinite(player.z)) {
        player.x = spawn.x; player.z = spawn.z; player.speed = 0;
      }

      updateTraffic(dt);
      envBlend();

      // area name every 2s
      lastAreaT += dt;
      if (lastAreaT > 2) {
        lastAreaT = 0;
        areaName = nearestRoadName(city.roads, player.x, player.z);
      }
    }

    updateCamera(dt);

    // ---- render ----
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    // sky
    gl.useProgram(skyProg);
    gl.depthMask(false);
    // pass invViewProj — sky shader multiplies; simplify with view-proj identity dirs
    // Use a dedicated uniform: we still set uInvViewProj
    // Reconstruct a working inv: use inverse of viewProj approx
    // Fallback: use view rotation only (sky is directional)
    const invVP = new Float32Array(16);
    // Build from camera basis (cheaper & stable)
    {
      // forward, right, up from lookAt
      const fx = camTarget[0] - camPos[0], fy = camTarget[1] - camPos[1], fz = camTarget[2] - camPos[2];
      const fl = Math.hypot(fx, fy, fz) || 1;
      const f = [fx / fl, fy / fl, fz / fl];
      const r = [f[2], 0, -f[0]];
      const rl = Math.hypot(r[0], r[1], r[2]) || 1;
      r[0] /= rl; r[2] /= rl;
      const u = [
        r[1] * f[2] - r[2] * f[1],
        r[2] * f[0] - r[0] * f[2],
        r[0] * f[1] - r[1] * f[0],
      ];
      const tanF = Math.tan((55 + clamp(Math.abs(player.speed) / 50, 0, 1) * 12) * Math.PI / 360);
      const aspect = canvas.width / canvas.height;
      // invViewProj as if near=1 far=large — enough for directions
      invVP[0] = r[0] * tanF * aspect; invVP[4] = r[1] * tanF * aspect; invVP[8] = r[2] * tanF * aspect;
      invVP[1] = u[0] * tanF; invVP[5] = u[1] * tanF; invVP[9] = u[2] * tanF;
      invVP[2] = f[0]; invVP[6] = f[1]; invVP[10] = f[2];
      invVP[12] = 0; invVP[13] = 0; invVP[14] = 0; invVP[15] = 1;
    }
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
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);

    // ground
    gl.useProgram(groundProg);
    setCommon(groundU, { uModel: world.identity });
    drawMesh(gl, world.ground);

    // green
    if (world.green.count) {
      setCommon(groundU, { uModel: world.identity });
      drawMesh(gl, world.green);
    }

    // roads — solid procedural asphalt
    gl.useProgram(cityProg);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1.5, -2);
    setCommon(cityU, {
      uModel: world.identity,
      uUseTex: 0,
      uWindowGrid: 0,
      uEmissive: 0,
    });
    drawMesh(gl, world.roads);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // buildings + landmarks
    setCommon(cityU, {
      uModel: world.identity,
      uUseTex: 0,
      uWindowGrid: 1,
      uEmissive: 1,
    });
    drawMesh(gl, world.buildings);
    drawMesh(gl, world.landmarks);
    gl.enable(gl.CULL_FACE);

    // water (blend) — includes sea plane + lakes
    gl.useProgram(waterProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    setCommon(waterU, {
      uModel: world.identity,
      uSkyTop: env.skyTop,
      uSkyHorizon: env.skyHorizon,
    });
    if (world.water.count) drawMesh(gl, world.water);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // vehicles — GLB model with original vertex colors; paint multiplies body-ish tones
    gl.disable(gl.CULL_FACE);
    gl.useProgram(carProg);
    const drawCar = (v) => {
      vehicleModelMatrix(v, model);
      setCommon(carU, {
        uModel: model,
        uPaint: v === player ? player.paint : v.paint,
        uBrake: v.brake,
        uHeadlights: env.night > 0.3 ? 1 : (clockH > 18 || clockH < 6 ? 1 : 0.15),
      });
      const mesh = (v === player ? (glbPlayer || carMeshes[v.type] || carMeshes.sedan)
        : (glbTraffic || carMeshes[v.type] || carMeshes.sedan));
      drawMesh(gl, mesh);
    };
    drawCar(player);
    for (const v of traffic) {
      const dx = v.x - player.x, dz = v.z - player.z;
      if (dx * dx + dz * dz > 400 * 400) continue;
      drawCar(v);
    }

    // trees — skip ones that would swallow the camera/car
    if (glbTree) {
      gl.useProgram(carProg);
      const white = [1, 1, 1];
      const near = [];
      for (let i = 0; i < treeSpots.length; i++) {
        const t = treeSpots[i];
        const dx = t[0] - player.x, dz = t[1] - player.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 8 * 8) continue; // don't spawn on top of the car
        if (d2 < 160 * 160) near.push([d2, t]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const lim = Math.min(160, near.length);
      for (let i = 0; i < lim; i++) {
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

    // landmarks (already in city coordinates)
    if (glbLandmarks) {
      gl.disable(gl.CULL_FACE);
      gl.useProgram(cityProg);
      setCommon(cityU, {
        uModel: world.identity,
        uUseTex: 0,
        uWindowGrid: 1,
        uEmissive: 1,
      });
      drawMesh(gl, glbLandmarks);
      gl.enable(gl.CULL_FACE);
    }
    gl.enable(gl.CULL_FACE);

    // ---- HUD ----
    const kmh = Math.abs(player.speed) * 3.6;
    const gear = player.speed < -0.3 ? 'R' : player.speed < 0.3 ? 'N' : 'D';
    const hh = ((clockH % 24) + 24) % 24;
    const mm = Math.floor((hh % 1) * 60);
    updateHUD(ui, {
      speedKmh: kmh,
      gear,
      fps,
      clock: `${String(Math.floor(hh)).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      area: areaName,
    });
    drawMinimap(ui, {
      px: player.x,
      pz: player.z,
      yaw: player.yaw,
      roads: city.roads,
      landmarks: city.landmarks,
      scale: 0.04,
      nav,
    });
  }

  requestAnimationFrame(frame);

  // expose debug
  window.__OPEN_ROADS__ = {
    player, city, get fps() { return fps; },
    setQuality(k) { ui.btnQuality && (qualityKey = k); },
  };
}
