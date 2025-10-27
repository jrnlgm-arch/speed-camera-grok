import { WorkerMsg } from './ui.js';

self.onmessage = async (e) => {
  const { type, backend, model, resolution, data, ts } = e.data;
  if (type === 'init') {
    try {
      // Placeholder: Load ONNX model (requires onnxruntime-web)
      const MODEL_URL = './models/yolov5n.onnx';
      // await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort.webgpu.min.js').then(ort => /* init session */);
      self.postMessage(WorkerMsg.result([], 0)); // Stub response
    } catch (err) {
      self.postMessage(WorkerMsg.error(`Detector init failed: ${err.message}`));
    }
  } else if (type === 'frame') {
    // Placeholder: Process ImageBitmap, return detections
    self.postMessage(WorkerMsg.result([], 0));
  } else if (type === 'dispose') {
    // Placeholder: Clean up model/session
    self.postMessage({ type: 'dispose_ack' });
  }
};
