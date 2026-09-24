import { startGame } from './game.js';

const canvas = document.getElementById('game');

startGame(canvas).catch((err) => {
  console.error(err);
  const el = document.getElementById('loadText');
  if (el) {
    el.textContent = '启动失败：' + err.message;
    el.style.color = '#ff6b6b';
  }
  // show error overlay
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#0d1117;color:#f0f0f0;font:14px/1.6 system-ui;z-index:99;padding:24px';
  d.innerHTML = `<div style="max-width:520px"><h2 style="color:#f5c518">无法启动</h2><p>${err.message}</p><p style="color:#8b949e">请使用支持 WebGL2 的浏览器（Chrome / Edge / Firefox）。</p></div>`;
  document.body.appendChild(d);
});
