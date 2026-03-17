let faceModel, emotionModel;
let detections = [];
let isDetecting = false;
let camera;
let modelsLoaded = false;

const anchors = [
  [[0.5, 0.625], [0.75, 1.0], [1.25, 1.5]],
  [[0.9375, 1.1875], [1.4375, 1.875], [2.4375, 3.25]],
  [[2.25, 3.03125], [3.84375, 5.125], [6.53125, 9.28125]]
];

async function preload() {
  emotionModel = await tf.loadGraphModel('emotion/model.json');
  faceModel = await tf.loadGraphModel('face/model.json');
  modelsLoaded = true;
}

function setup() {
  createCanvas(640, 640);
  camera = createCapture(VIDEO);
  camera.size(width, height);
  camera.hide();
}

function draw() {
  image(camera, 0, 0, width, height);
  if (modelsLoaded && !isDetecting) detectFrame();

  for (let d of detections) {
    stroke(0, 255, 0);
    strokeWeight(2);
    noFill();
    rect(d.x, d.y, d.w, d.h);
    noStroke();
    fill(0, 255, 0);
    textSize(16);
    text((d.conf * 100).toFixed(0) + '%', d.x, d.y - 4);
  }
}

async function detectFrame() {
  isDetecting = true;

  // Check camera is ready
  if (!camera || !camera.elt || camera.elt.videoWidth === 0) {
    isDetecting = false;
    return;
  }

  const input = tf.tidy(() => {
    return tf.browser.fromPixels(camera.elt)
        .resizeBilinear([640, 640])
        .toFloat()
        .div(255.0)
        .transpose([2, 0, 1])
        .expandDims(0);
  });

  const outputs = await faceModel.predict(input);
  input.dispose();

  const boxes = await parseDetections(outputs);
  console.log('boxes before NMS:', boxes.length);
  detections = nms(boxes, 0.45);
  console.log('boxes after NMS:', detections.length);

  outputs.forEach(t => t.dispose());
  isDetecting = false;
}

async function parseDetections(outputs) {
  const CONF_THRESHOLD = 0.5;
  const strides = [8, 16, 32];
  let results = [];

  for (let i = 0; i < outputs.length; i++) {
    const data = await outputs[i].array();
    const H = data[0].length;
    const W = data[0][0].length;
    const stride = strides[i];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let a = 0; a < 3; a++) {
          const offset = a * 21;
          const raw = data[0][y][x];

          const conf = sigmoid(raw[offset + 4]);
          if (conf < CONF_THRESHOLD) continue;

          const cx = (sigmoid(raw[offset + 0]) * 2 - 0.5 + x) * stride;
          const cy = (sigmoid(raw[offset + 1]) * 2 - 0.5 + y) * stride;
          const w  = Math.pow(sigmoid(raw[offset + 2]) * 2, 2) * anchors[i][a][0] * stride;
          const h  = Math.pow(sigmoid(raw[offset + 3]) * 2, 2) * anchors[i][a][1] * stride;

          results.push({
            x: cx - w / 2,
            y: cy - h / 2,
            w: w,
            h: h,
            conf: conf
          });
        }
      }
    }
  }

  return results;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function nms(boxes, iouThreshold) {
  // Sort by confidence, highest first
  boxes.sort((a, b) => b.conf - a.conf);

  const kept = [];

  while (boxes.length > 0) {
    const best = boxes.shift(); // take highest confidence box
    kept.push(best);

    // Remove boxes that overlap too much with the best box
    boxes = boxes.filter(box => iou(best, box) < iouThreshold);
  }

  return kept;
}

function iou(a, b) {
  // Calculate intersection
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const unionArea = a.w * a.h + b.w * b.h - intersection;

  return intersection / unionArea;
}