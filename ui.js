const $ = (id) => document.getElementById(id);
const bannerEl = $('banner');
const debugEl = $('debug');
const chipEl = $('adaptiveChip');
const runtimeStatusEl = $('runtimeStatus');
const calQualityEl = $('calQuality');
const calGuideEl = $('calGuide');

let bannerTimer = null;
let debugQueue = [];

export const banner = {
  show(msg, kind = 'ok') {
    clearTimeout(bannerTimer);
    bannerEl.textContent = msg;
    bannerEl.className = `banner show ${kind}`;
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 2500);
  },
};

export function debugLog(msg) {
  debugQueue.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (debugQueue.length > 50) debugQueue.shift();
  requestAnimationFrame(() => {
    debugEl.textContent = debugQueue.join('\n');
  });
}

export const chip = {
  setText(t) { chipEl.textContent = t; },
  flash() { chipEl.classList.remove('flash'); void chipEl.offsetWidth; chipEl.classList.add('flash'); },
};

export function setRuntimeStatus(text) { runtimeStatusEl.textContent = text; }
export function setCalQualityLabel(label) { calQualityEl.textContent = label; }
export function setCalGuide(text) { calGuideEl.textContent = text; }

export const WorkerMsg = {
  init: (backend, model, resolution) => ({ type: 'init', backend, model, resolution }),
  frame: (imageBitmap, ts) => ({ type: 'frame', data: imageBitmap, ts }),
  result: (detections, inferMs) => ({ type: 'result', detections, inferMs }),
  dispose: () => ({ type: 'dispose' }),
  error: (message) => ({ type: 'error', message }),
};
