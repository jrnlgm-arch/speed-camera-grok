import { ui, banner, chip, debugLog, setRuntimeStatus } from './ui.js';
import { startLineCalibration, startHomographyCalibration, getCalibrationState, setPresetLength, drawCalibration } from './calibration.js';

const FPS_DOWNSHIFT = 12;
const INFER_MS_HIGH = 120;
const DOWNSHIFT_FORCE_FPS = 10;
const ADAPT_WINDOW_MS = 2000;

const BACKENDS = [];
let state = {
  running: false,
  backend: 'auto',
  resolution: 480,
  cadenceK: 2,
  videoEl: null,
  canvasEl: null,
  ctx: null,
  startTs: 0,
  frames: 0,
  fps: 0,
  inferAvgMs: 0,
  lastAdaptCheck: 0,
  videoSource: 'file',
  detectorWorker: null,
  inferTick: 0,
  tracks: [],
};

function detectCapabilities() {
  const hasWebGPU = 'gpu' in navigator;
  const canvas = document.createElement('canvas');
  const hasWebGL2 = !!canvas.getContext('webgl2');
  const hasWebGL = hasWebGL2 || !!canvas.getContext('webgl');
  if (hasWebGPU) BACKENDS.push('webgpu');
  if (hasWebGL2) BACKENDS.push('webgl2');
  else if (hasWebGL) BACKENDS.push('webgl');
  BACKENDS.push('wasm');
  const sel = document.getElementById('backendSelect');
  sel.innerHTML = `<option value="auto" selected>auto (${BACKENDS[0] || 'none'})</option>` +
    BACKENDS.map(b => `<option value="${b}">${b}</option>`).join('');
  document.getElementById('backendStatus').textContent = `detected: ${BACKENDS.join(' → ')}`;
}
detectCapabilities();

async function useWebcam() {
  const v = state.videoEl;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    v.srcObject = stream;
    await v.play();
    state.videoSource = 'webcam';
    banner.show('Webcam ready', 'ok');
    debugLog('Webcam stream started.');
  } catch (e) {
    banner.show('Webcam failed. Check permissions.', 'bad');
    debugLog('Webcam error: ' + e.message);
  }
}

function useFile(file) {
  const v = state.videoEl;
  const url = URL.createObjectURL(file);
  v.srcObject = null;
  v.src = url;
  v.onloadeddata = () => {
    v.play();
    state.videoSource = 'file';
    banner.show('Video loaded', 'ok');
    debugLog(`Loaded file: ${file.name} (${Math.round(file.size/1024)} KB)`);
  };
}

function resizeCanvasToVideo() {
  const v = state.videoEl, c = state.canvasEl;
  if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
  const aspect = v.videoWidth / v.videoHeight;
  const w = Math.min(v.videoWidth, state.resolution * aspect);
  const h = Math.min(v.videoHeight, state.resolution);
  c.width = w | 0; c.height = h | 0;
  v.style.width = `${w}px`; v.style.height = `${h}px`;
}

async function switchBackend(nextBackend) {
  if (state.detectorWorker) {
    state.detectorWorker.postMessage({ type: 'dispose' });
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for dispose
  }
  state.detectorWorker = new Worker('./detector.js');
  state.detectorWorker.postMessage({ type: 'init', backend: nextBackend, model: 'yolov5n', resolution: state.resolution });
  state.backend = nextBackend;
  chip.setText(`${nextBackend} • ${state.resolution}p • k:${state.cadenceK} • cal:${getCalibrationState()?.qualityLabel || 'N/A'}`);
  chip.flash();
  banner.show(`Backend switched to ${nextBackend}`, 'warn');
  debugLog(`Switched backend → ${nextBackend}`);
}

function loop(ts) {
  if (!state.running) return;
  const v = state.videoEl, c = state.canvasEl, ctx = state.ctx;
  if (v.readyState >= 2) {
    ctx.drawImage(v, 0, 0, c.width, c.height);
    drawCalibration(ctx);
    if (state.inferTick % state.cadenceK === 0 && state.detectorWorker) {
      const bitmap = c.transferToImageBitmap();
      state.detectorWorker.postMessage({ type: 'frame', data: bitmap, ts }, [bitmap]);
    }
    state.inferTick++;
  }

  state.frames++;
  if (!state.startTs) state.startTs = ts;
  const elapsed = ts - state.startTs;
  if (elapsed >= 1000) {
    state.fps = Math.round((state.frames * 1000) / elapsed);
    state.frames = 0;
    state.startTs = ts;
    setRuntimeStatus(`FPS:${state.fps} • backend:${state.backend} • res:${state.resolution}p`);
  }

  if (ts - state.lastAdaptCheck > ADAPT_WINDOW_MS) {
    adapt(ts);
    state.lastAdaptCheck = ts;
  }

  requestAnimationFrame(loop);
}

function adapt(ts) {
  const avgFps = state.fps;
  const isLow = avgFps && avgFps < FPS_DOWNSHIFT;
  if (isLow) {
    if (avgFps < DOWNSHIFT_FORCE_FPS && state.resolution > 480) {
      state.resolution = 480;
      banner.show('Low performance → forcing 480p', 'warn');
      debugLog('Adapt: force 480p due to FPS < 10.');
    } else if (state.resolution > 640) {
      state.resolution = 640;
      banner.show('Adaptive: 720p → 640p', 'warn');
      debugLog('Adapt: downscale 720p→640p due to FPS dip.');
    } else if (state.cadenceK < 3) {
      state.cadenceK = 3;
      banner.show('Adaptive: cadence k 2→3', 'warn');
      debugLog('Adapt: cadence increased to k=3.');
    }
    chip.setText(`${state.backend} • ${state.resolution}p • k:${state.cadenceK} • cal:${getCalibrationState()?.qualityLabel || 'N/A'}`);
    chip.flash();
  }
}

function bindUI() {
  state.videoEl = document.getElementById('video');
  state.canvasEl = document.getElementById('canvas');
  state.ctx = state.canvasEl.getContext('2d', { alpha: false });

  document.getElementById('btnWebcam').onclick = useWebcam;
  document.getElementById('fileInput').onchange = (e) => {
    const f = e.target.files?.[0]; if (f) useFile(f);
  };
  document.getElementById('backendSelect').onchange = (e) => {
    const val = e.target.value;
    state.backend = val === 'auto' ? (BACKENDS[0] || 'wasm') : val;
    switchBackend(state.backend);
  };
  document.getElementById('resSelect').onchange = (e) => {
    state.resolution = parseInt(e.target.value, 10) || 480;
    resizeCanvasToVideo();
    banner.show(`Resolution → ${state.resolution}p`, 'warn');
    chip.setText(`${state.backend} • ${state.resolution}p • k:${state.cadenceK} • cal:${getCalibrationState()?.qualityLabel || 'N/A'}`);
    chip.flash();
  };
  document.getElementById('btnStart').onclick = () => {
    if (!state.running) {
      state.running = true;
      requestAnimationFrame(loop);
      banner.show('Running', 'ok');
      debugLog('Loop started.');
    }
  };
  document.getElementById('btnStop').onclick = () => {
    state.running = false;
    banner.show('Stopped', 'warn');
    debugLog('Loop stopped.');
  };
  document.getElementById('preset').onchange = (e) => {
    const val = e.target.value;
    const units = document.getElementById('units').value;
    if (val) {
      setPresetLength(parseFloat(val), units);
      banner.show(`Preset applied: ${val} ${units}`, 'ok');
    }
  };
  document.getElementById('btnCalibrate').onclick = () => {
    const mode = document.getElementById('calMode').value;
    const len = parseFloat(document.getElementById('realLen').value);
    const units = document.getElementById('units').value;
    if (mode === 'line') startLineCalibration(state.canvasEl, len, units);
    else startHomographyCalibration(state.canvasEl, len, units);
  };
  document.getElementById('btnResetCal').onclick = () => {
    cal.mode = 'none';
    cal.line = null;
    cal.homoPts = [];
    cal.H = null;
    cal.scale_m_per_px = null;
    cal.quality = 0;
    cal.qualityLabel = 'N/A';
    setCalQualityLabel('N/A');
    banner.show('Calibration reset', 'warn');
    debugLog('Calibration reset.');
  };
}
bindUI();
chip.setText(`${state.backend} • ${state.resolution}p • k:${state.cadenceK} • cal:N/A`);
setRuntimeStatus('idle');
debugLog('App loaded. Ready.');
