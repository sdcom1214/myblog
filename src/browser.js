// WebViews may deny even reading the localStorage property. Keep the game usable
// in memory without letting a failed device write prevent a server save.
export function browserStorage(host = window) {
  const memory = new Map();
  let backend, persistent = true;
  try { backend = host.localStorage; persistent = !!backend; } catch { persistent = false; }
  return {
    get persistent() { return persistent; },
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try { const value = backend?.getItem(key) ?? null; memory.set(key, value); return value; }
      catch { persistent = false; return null; }
    },
    setItem(key, value) {
      value = String(value); memory.set(key, value);
      try { if (!backend) throw new Error('unavailable'); backend.setItem(key, value); }
      catch { persistent = false; }
    },
    removeItem(key) {
      memory.set(key, null);
      try { if (!backend) throw new Error('unavailable'); backend.removeItem(key); }
      catch { persistent = false; }
    },
  };
}

export function isInAppBrowser(agent = navigator.userAgent) {
  return /Instagram|FBAN|FBAV/i.test(agent);
}

export function canShareFile(blob, filename, host = navigator) {
  try { return typeof host.share === 'function' && typeof host.canShare === 'function' && host.canShare({ files: [new File([blob], filename, { type: blob.type })] }); }
  catch { return false; }
}

// Track one finger across the document even when pointer capture is unavailable.
// Older WebViews fall back to touch/mouse events, without double-submitting taps.
export function bindPointerInput(root, { start, move, end, cancel }) {
  let active = null;
  const down = event => {
    if (active || event.button > 0 || event.isPrimary === false) return;
    if (start(event)) active = { id: event.pointerId };
  };
  const update = (event, finish = false, cancelled = false) => {
    if (!active || active.id !== event.pointerId) return;
    if (finish) { active = null; (cancelled ? cancel : end)?.(event); }
    else move?.(event);
  };
  if ('PointerEvent' in window) {
    root.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', event => update(event), { passive: false });
    document.addEventListener('pointerup', event => update(event, true));
    document.addEventListener('pointercancel', event => update(event, true, true));
  } else {
    let lastTouch = -Infinity;
    const touchEvent = (event, touch) => ({ target: event.target, pointerId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
    root.addEventListener('touchstart', event => { lastTouch = performance.now(); if (event.changedTouches[0]) down(touchEvent(event, event.changedTouches[0])); }, { passive: false });
    document.addEventListener('touchmove', event => { for (const touch of event.changedTouches) update(touchEvent(event, touch)); }, { passive: false });
    document.addEventListener('touchend', event => { for (const touch of event.changedTouches) update(touchEvent(event, touch), true); });
    document.addEventListener('touchcancel', event => { for (const touch of event.changedTouches) update(touchEvent(event, touch), true, true); });
    const mouseEvent = event => ({ target: event.target, pointerId: 'mouse', button: event.button, clientX: event.clientX, clientY: event.clientY, preventDefault: () => event.preventDefault() });
    root.addEventListener('mousedown', event => { if (performance.now() - lastTouch > 800) down(mouseEvent(event)); });
    document.addEventListener('mousemove', event => update(mouseEvent(event)));
    document.addEventListener('mouseup', event => update(mouseEvent(event), true));
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) active = null; });
}

export function fitMobileViewport() {
  const update = () => document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
  update(); window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
}

export function capturePointer(element, event) {
  try { element.setPointerCapture?.(event.pointerId); } catch { /* Document listeners retain the stroke/hold. */ }
}
