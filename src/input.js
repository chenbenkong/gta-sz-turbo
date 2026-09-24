// Input handling

export function createInput() {
  const keys = new Set();
  const state = {
    throttle: 0,
    steer: 0,
    handbrake: false,
    keys,
  };

  const onKeyDown = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    // prevent page scroll
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  state.update = () => {
    let t = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) t += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) t -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s += 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s -= 1;
    state.throttle = t;
    state.steer = s;
    state.handbrake = keys.has('Space');
  };

  state.justPressed = (code) => {
    return keys.has(code);
  };

  return state;
}
