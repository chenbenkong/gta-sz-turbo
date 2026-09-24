# 深城纪 TURBO · 一路向海

沿**深圳真实路网**自由驾驶的开放世界小游戏 —— **核显优化重制版**。

自研零依赖 **WebGL2** 引擎：程序化城市生成、极少 draw call、无重后处理，目标核显 **60 FPS**。

**在线游玩**：https://chenbenkong.github.io/gta-sz-turbo/

> 本仓库独立于 `gta-sz-open-roads`，不改动原项目。城市数据源自 OpenStreetMap /
> linranff/GTA_SZ，见 `licenses/`。

---

## 本地一键启动

```powershell
powershell -ExecutionPolicy Bypass -File .\Launch-Game.ps1
```

脚本启动本地静态服务并打开浏览器。首次加载约 10 MB 城市数据。

---

## 操作

| 按键 | 功能 |
|------|------|
| `W` / `↑` | 加速 |
| `S` / `↓` | 刹车 / 倒车 |
| `A` / `←` | 左转 |
| `D` / `→` | 右转 |
| `空格` | 手刹漂移 |
| `C` | 切换视角（追尾 / 车头 / 远景） |
| `N` | 昼 / 黄昏 / 夜 |
| `V` | 切换载具 |
| `R` | 复位 |
| `H` | 显示/隐藏 HUD |
| `Q` | 切换画质 |
| `Esc` | 菜单 |

---

## 为什么流畅

| 手段 | 说明 |
|------|------|
| 程序化城市 | 从 `city.json` 实时生成建筑/道路，不再加载 80MB+ 高模 |
| 合批渲染 | 全城建筑 1 个 draw call，道路 1 个，地面/水/载具各 1 个 |
| 简单光照 | 半球光 + 单向太阳 + 雾，无 SSAO / Bloom / 反射 |
| 程序化夜窗 | 着色器内生成窗户灯光 |
| 自适应画质 | 帧率不足时自动收紧视距、雾距与渲染分辨率 |
| 小资源体积 | 核心只需 `city.json` + 导航图 ≈ 10 MB |

---

## 仓库结构

```
├── index.html          # 入口
├── src/                # WebGL2 游戏源码（零运行时依赖）
│   ├── main.js         # 启动
│   ├── game.js         # 主循环 / 渲染 / 玩法
│   ├── city.js         # 城市网格生成
│   ├── vehicle.js      # 载具网格与街机物理
│   ├── shaders.js      # GLSL
│   ├── gl.js / math.js
│   ├── input.js / ui.js
│   └── styles.css
├── city/               # 城市数据（city.json / navigation.json / 贴图）
├── data/               # 地点表
├── licenses/           # 许可
├── Launch-Game.ps1     # 本地一键启动
└── tools/              # 验收脚本
```

---

## 数据来源与许可

| 内容 | 来源 | 许可 |
|------|------|------|
| 道路 / 建筑轮廓 | OpenStreetMap 贡献者 | ODbL 1.0 |
| 地形参考 | Copernicus 30m DSM | 免费开放 |
| 城市数据衍生 | linranff/GTA_SZ | 见 `licenses/` |
