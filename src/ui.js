// HUD + minimap + menus (DOM overlay)

export function createUI(root) {
  root.innerHTML = `
    <div id="loading" class="overlay">
      <div class="load-card">
        <div class="brand">深城纪</div>
        <div class="sub">一路向海 · Open Roads</div>
        <div class="bar"><div id="loadBar"></div></div>
        <div id="loadText">正在装载城市数据…</div>
      </div>
    </div>

    <div id="hud" class="hidden">
      <div class="hud-top">
        <div class="minimap-wrap">
          <canvas id="minimap" width="180" height="180"></canvas>
          <div class="minimap-label">深圳 · 南山 / 福田 / 罗湖</div>
        </div>
        <div class="hud-top-right">
          <div class="chip" id="areaName">滨海大道</div>
          <div class="chip" id="clockChip">12:00</div>
          <div class="chip gold" id="fpsChip">60 FPS</div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="speedo">
          <div class="speed-num" id="speedNum">0</div>
          <div class="speed-unit">KM/H</div>
          <div class="gear" id="gear">D</div>
        </div>
        <div class="controls-hint">
          <span>W/S 油门刹车</span><span>A/D 转向</span><span>空格 手刹</span>
          <span>F 上下车</span><span>B 飞机</span><span>C 视角</span><span>N 昼夜</span><span>R 复位</span>
        </div>
      </div>
    </div>

    <div id="toast" class="toast hidden"></div>
    <div id="menu" class="overlay hidden">
      <div class="menu-card">
        <h1>深城纪 · 一路向海</h1>
        <p class="muted">沿深圳真实路网自由驾驶。核显优化版。</p>
        <div class="menu-row">
          <button id="btnResume" class="btn primary">继续驾驶</button>
          <button id="btnQuality" class="btn">画质：自动</button>
        </div>
        <div class="menu-row">
          <button id="btnCar" class="btn">切换载具</button>
          <button id="btnTime" class="btn">切换昼夜</button>
        </div>
        <div class="keys-help">
          <div><b>W / ↑</b> 加速</div>
          <div><b>S / ↓</b> 刹车 / 倒车</div>
          <div><b>A D / ← →</b> 转向</div>
          <div><b>Space</b> 手刹漂移</div>
          <div><b>C</b> 切换视角</div>
          <div><b>N</b> 昼 / 夜 / 黄昏</div>
          <div><b>V</b> 切换载具</div>
          <div><b>R</b> 车辆复位</div>
          <div><b>Esc</b> 菜单</div>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => document.getElementById(id);
  return {
    loading: $('loading'),
    loadBar: $('loadBar'),
    loadText: $('loadText'),
    hud: $('hud'),
    speedNum: $('speedNum'),
    gear: $('gear'),
    areaName: $('areaName'),
    clockChip: $('clockChip'),
    fpsChip: $('fpsChip'),
    minimap: $('minimap'),
    toast: $('toast'),
    menu: $('menu'),
    btnResume: $('btnResume'),
    btnQuality: $('btnQuality'),
    btnCar: $('btnCar'),
    btnTime: $('btnTime'),
  };
}

export function setLoad(ui, pct, text) {
  ui.loadBar.style.width = `${Math.round(pct * 100)}%`;
  if (text) ui.loadText.textContent = text;
}

export function showToast(ui, msg, ms = 2200) {
  ui.toast.textContent = msg;
  ui.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => ui.toast.classList.add('hidden'), ms);
}

export function updateHUD(ui, { speedKmh, gear, fps, clock, area }) {
  ui.speedNum.textContent = String(Math.round(speedKmh));
  ui.gear.textContent = gear;
  ui.fpsChip.textContent = `${fps} FPS`;
  ui.clockChip.textContent = clock;
  if (area) ui.areaName.textContent = area;
}

/** Draw minimap: roads + player + landmarks. */
export function drawMinimap(ui, opts) {
  const cv = ui.minimap;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const { px, pz, yaw, roads, landmarks, scale = 0.055, nav } = opts;
  ctx.clearRect(0, 0, W, H);

  // background
  ctx.fillStyle = '#0d1a22';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  // north-up
  const toMap = (x, z) => [(x - px) * scale, (z - pz) * scale];

  // water hint
  ctx.fillStyle = 'rgba(20,80,100,0.35)';
  ctx.beginPath();
  ctx.arc(-W * 0.55, H * 0.2, W * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // roads
  if (roads) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(180,190,170,0.45)';
    ctx.beginPath();
    const step = Math.max(1, Math.floor(roads.length / 2500));
    for (let i = 0; i < roads.length; i += step) {
      const r = roads[i];
      const pts = r.points;
      if (!pts || pts.length < 2) continue;
      for (let j = 0; j < pts.length - 1; j++) {
        const [x1, y1] = toMap(pts[j][0], pts[j][1]);
        const [x2, y2] = toMap(pts[j + 1][0], pts[j + 1][1]);
        if (Math.abs(x1) > W || Math.abs(y1) > H) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    }
    ctx.stroke();
  }

  // landmarks
  for (const lm of landmarks || []) {
    const [x, y] = toMap(lm.x, lm.z);
    if (Math.abs(x) > W / 2 || Math.abs(y) > H / 2) continue;
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }

  // player arrow
  ctx.rotate(yaw);
  ctx.fillStyle = '#ff4d6d';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // border
  ctx.strokeStyle = 'rgba(245,197,24,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
}
