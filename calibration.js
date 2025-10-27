import { banner, debugLog, setCalQualityLabel, setCalGuide } from './ui.js';

let cal = {
  mode: 'none',
  line: null,
  homoPts: [],
  H: null,
  scale_m_per_px: null,
  axis_unit: { x: 1, y: 0 },
  quality: 0,
  qualityLabel: 'N/A',
  units: 'ft',
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const norm = v => { const d = Math.hypot(v.x, v.y) || 1e-6; return { x: v.x / d, y: v.y / d }; };

function segIntersect(p1, p2, p3, p4) {
  function orient(a, b, c) { return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)); }
  const o1 = orient(p1, p2, p3), o2 = orient(p1, p2, p4), o3 = orient(p3, p4, p1), o4 = orient(p3, p4, p2);
  return o1 !== o2 && o3 !== o4;
}

function computeHomography(pts) {
  // Placeholder: returns identity matrix for scaffold
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function qualityFrom(lineOrLane, shapeConsistency, visualOK) {
  const length_plaus = (() => {
    let score = 1;
    if (cal.units === 'ft') {
      if (lineOrLane < 10) score = clamp((lineOrLane - 5) / 5, 0, 1);
      else if (lineOrLane > 120) score = clamp((200 - lineOrLane) / 80, 0, 1);
    } else {
      if (lineOrLane < 3) score = clamp((lineOrLane - 1) / 2, 0, 1);
      else if (lineOrLane > 40) score = clamp((60 - lineOrLane) / 20, 0, 1);
    }
    return score;
  })();
  const shape_cons = clamp(1 - (shapeConsistency / 40), 0, 1);
  const visual_QA = visualOK ? 1 : 0;
  return 0.4 * length_plaus + 0.3 * shape_cons + 0.3 * visual_QA;
}

export function setPresetLength(val, units = 'ft') {
  cal.units = units;
  document.getElementById('realLen').value = String(val);
  debugLog(`Preset length set: ${val} ${units}`);
}

export function getCalibrationState() { return cal; }

export function startLineCalibration(canvas, realLen, units = 'ft') {
  cal.mode = 'line'; cal.units = units; cal.line = null; cal.scale_m_per_px = null; cal.quality = 0; cal.qualityLabel = 'N/A';
  setCalGuide('Click and drag along the road to draw a line, then release.');
  banner.show('Draw a line along the road, then release.', 'ok');
  const ctx = canvas.getContext('2d');
  let tmp = { drawing: false, x1: 0, y1: 0, x2: 0, y2: 0 };

  function onDown(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || x > r.width || y < 0 || y > r.height) return;
    tmp.x1 = x; tmp.y1 = y; tmp.drawing = true;
  }

  function onMove(e) {
    if (!tmp.drawing) return;
    const r = canvas.getBoundingClientRect();
    tmp.x2 = e.clientX - r.left; tmp.y2 = e.clientY - r.top;
    ctx.strokeStyle = '#4bd3ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(tmp.x1, tmp.y1); ctx.lineTo(tmp.x2, tmp.y2); ctx.stroke(); ctx.setLineDash([]);
  }

  function onUp() {
    if (!tmp.drawing) return;
    tmp.drawing = false;
    const pxLen = Math.hypot(tmp.x2 - tmp.x1, tmp.y2 - tmp.y1);
    if (pxLen < 20) {
      banner.show('Line too short (<20 px). Try again.', 'bad');
      cleanup();
      return;
    }
    const rl = parseFloat(realLen || document.getElementById('realLen').value);
    if (!rl || rl <= 0) {
      banner.show('Enter a real-world length or choose a preset.', 'warn');
      cleanup();
      return;
    }

    cal.line = { x1: tmp.x1, y1: tmp.y1, x2: tmp.x2, y2: tmp.y2, pxLen };
    const meters = (cal.units === 'ft') ? rl * 0.3048 : rl;
    cal.scale_m_per_px = meters / pxLen;
    cal.axis_unit = norm({ x: tmp.x2 - tmp.x1, y: tmp.y2 - tmp.y1 });
    cal.quality = qualityFrom(rl, 0, true);
    cal.qualityLabel = cal.quality >= 0.75 ? 'Good' : cal.quality >= 0.5 ? 'Fair' : 'Poor';
    setCalQualityLabel(cal.qualityLabel);
    banner.show(`Line calibration set (${rl} ${cal.units}).`, 'ok');
    debugLog(`Calibration line: pxLen=${pxLen.toFixed(1)}, scale=${cal.scale_m_per_px.toFixed(5)} m/px`);
    cleanup();
  }

  function cleanup() {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    setCalGuide('Select mode and click Start Calibration');
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
}

export function startHomographyCalibration(canvas, laneWidthValue, units = 'ft') {
  cal.mode = 'homo'; cal.units = units; cal.homoPts = []; cal.H = null; cal.scale_m_per_px = null; cal.quality = 0; cal.qualityLabel = 'N/A';
  setCalGuide('Click 4 points: near-left, near-right, far-right, far-left.');
  banner.show('Click 4 points: near-left, near-right, far-right, far-left.', 'ok');

  let clickCount = 0;
  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || x > r.width || y < 0 || y > r.height) return;
    cal.homoPts.push({ x, y });
    clickCount++;
    setCalGuide(`Point ${clickCount}/4 clicked. ${4 - clickCount} remaining.`);

    if (cal.homoPts.length === 4) {
      const [p1, p2, p3, p4] = cal.homoPts;
      if (segIntersect(p1, p2, p3, p4) || segIntersect(p2, p3, p4, p1)) {
        banner.show('Trapezoid self-intersects. Try again.', 'bad');
        cal.homoPts = [];
        clickCount = 0;
        setCalGuide('Click 4 points: near-left, near-right, far-right, far-left.');
        return;
      }
      const near = dist(p1, p2), far = dist(p3, p4);
      const ratio = Math.max(near, far) / Math.max(1, Math.min(near, far));
      const vNear = norm({ x: p2.x - p1.x, y: p2.y - p1.y });
      const vFar = norm({ x: p3.x - p4.x, y: p3.y - p4.y });
      const ang = Math.acos(clamp(dot(vNear, vFar), -1, 1)) * 180 / Math.PI;

      if (ratio > 1.3 && ang > 15) {
        banner.show('Opposite edges differ too much. Proceed with caution.', 'warn');
      }

      cal.H = computeHomography(cal.homoPts);
      cal.axis_unit = vNear;
      const rl = parseFloat(laneWidthValue || document.getElementById('realLen').value);
      cal.quality = qualityFrom(rl, ang, true);
      cal.qualityLabel = cal.quality >= 0.75 ? 'Good' : cal.quality >= 0.5 ? 'Fair' : 'Poor';
      setCalQualityLabel(cal.qualityLabel);
      banner.show('Homography set. Grid overlay shown.', 'ok');
      debugLog(`Homography set. near=${near.toFixed(1)} far=${far.toFixed(1)} angle≈${ang.toFixed(1)}°`);
      canvas.removeEventListener('pointerdown', onClick);
      setCalGuide('Select mode and click Start Calibration');
    }
  }
  canvas.addEventListener('pointerdown', onClick);
}

export function drawCalibration(ctx) {
  if (cal.mode === 'line' && cal.line) {
    ctx.save();
    ctx.strokeStyle = '#4bd3ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(cal.line.x1, cal.line.y1); ctx.lineTo(cal.line.x2, cal.line.y2); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }
  if (cal.mode === 'homo' && cal.homoPts.length) {
    const pts = cal.homoPts;
    ctx.save();
    ctx.strokeStyle = '#ffd54b'; ctx.lineWidth = 2;
    const drawPt = p => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#ffd54b'; ctx.fill(); };
    for (let i = 0; i < pts.length; i++) drawPt(pts[i]);
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath(); ctx.stroke();
    if (pts.length === 4) {
      ctx.globalAlpha = 0.2;
      for (let i = 1; i < 10; i++) {
        const t = i / 10;
        const ax = pts[0].x + (pts[1].x - pts[0].x) * t, ay = pts[0].y + (pts[1].y - pts[0].y) * t;
        const bx = pts[3].x + (pts[2].x - pts[3].x) * t, by = pts[3].y + (pts[2].y - pts[3].y) * t;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

export { cal as _cal_internal };
