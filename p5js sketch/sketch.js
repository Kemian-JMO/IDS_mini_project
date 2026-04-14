let faceModel, emotionModel;
let detections = [];
let isDetecting = false;
let camera;
let modelsLoaded = false;
let isconnected = false;

/*
The 8 emotion classes the trained model can recognize.
it is in this order as that is what the model expects
 */
const EMOTIONS = ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

// Replace with your ESP32's IP address
let esp32IP = '192.168.50.8';
//let esp32IP = '10.104.67.55'; // Example, find your ESP32's IP in the Serial Monitor
let port = 81; // Same port as on the ESP32

/* the models are trained with YOLOv5 which has anchor boxes to help predict bounding boxes.
* 3 anchors for detecting small, medium, large faces at different stages of the model.
*
 */
const anchors = [
  [[0.5, 0.625], [0.75, 1.0], [1.25, 1.5]],
  [[0.9375, 1.1875], [1.4375, 1.875], [2.4375, 3.25]],
  [[2.25, 3.03125], [3.84375, 5.125], [6.53125, 9.28125]]
];

//Start a webserver with python in terminal
//python -m http.server 8080

/*
 * Here the models are loaded from the local folder.
 * The emotion model is a RepVgg classification model, the face model is a Yolov5 model.
 * The were taken from this github repo: https://github.com/George-Ogden/emotion
 * The models were both converted from pytorch to ONNX to Tensorflow.js.
 */
async function preload() {
  emotionModel = await tf.loadGraphModel('emotion/model.json');
  faceModel = await tf.loadGraphModel('face/model.json');
  modelsLoaded = true;
}

function setup() {
  createCanvas(640, 640);
  background(200);

  // This creates a camera feed that is displayed in the canvas. It also hides the html element.
  camera = createCapture(VIDEO);
  camera.size(width, height);
  camera.hide();

// Connects to the ESP32 WebSocket server
  socket = new WebSocket('ws://' + esp32IP + ':' + port);

  socket.onopen = function(event) {
    console.log('Connected to ESP32 WebSocket server');
    isconnected = true;
  };

  socket.onmessage = function(event) {
    console.log('Received from ESP32: ' + event.data);
  };

  socket.onclose = function(event) {
    console.log('Disconnected from ESP32 WebSocket server');
    isconnected = false;
  };

  socket.onerror = function(error) {
    console.error('WebSocket error:', error);
    isconnected = false;
  };

  // Create buttons for open and close signals, for maunally test the open and close signals
  let openButton = createButton("open");
  openButton.mousePressed(() => sendSignal("open")); // Send open signal on click
  let closeButton = createButton("close");
  closeButton.mousePressed(() => sendSignal("close")); // Send close signal on click


}

function draw() {
  // Draws the camera feed onto the canvas.
  image(camera, 0, 0, width, height);

  /*
   *This postpones the detection of the face until the models are loaded.
   *And the previous detections are cleared.
   */
  if (modelsLoaded && !isDetecting) detectFrame();

  //This draws the bounding boxes and the emotion labels on the canvas, for each detected face.
  for (let d of detections) {
    //this skips the detections that have not been classified with an emotion yet.
    if (!d.emotion) continue;
    stroke(0, 255, 0);
    strokeWeight(2);
    noFill();
    rect(d.x, d.y, d.w, d.h);
    noStroke();
    fill(0, 255, 0);
    textSize(16);
    text(d.emotion + ' ' + (d.conf * 100).toFixed(0) + '%', d.x, d.y - 4);

    // If the detected face is happy, send an open signal to the ESP32. otherwise send a close signal.
    if (d.emotion === 'happy') {
      sendSignal("open");
      console.log("Happy detected, sent open signal");
    } else {
      sendSignal("close");
      console.log("Not happy, sent close signal");
    }
  }

}

async function detectFrame() {
  isDetecting = true;

  //This makes sure the camera is ready before trying to detect faces. If the camera is not ready, it stops the detection and waits for the next frame.
  if (!camera || !camera.elt || camera.elt.videoWidth === 0) {
    isDetecting = false;
    return;
  }

  //This prepares the input for the face model.
  //It resizes the image to 640x640 as the model was trained on that size.
  //It converts the image to floats as the model expects floats.
  //It then divides the pixel values by 255 to normalize them to the range [0, 1].
  //Then it transposes the image to a format that the model expects.
  //Finally, it expands the dimensions of the image to a batch of size 1.
  //This is all done so that the model gets the input in the format it was trained on, which is crucial for the model to work correctly.
  const input = tf.tidy(() => {
    return tf.browser.fromPixels(camera.elt)
        .resizeBilinear([640, 640])
        .toFloat()
        .div(255.0)
        .transpose([2, 0, 1])
        .expandDims(0);
  });

  //This runs the face model on the input image and gets the output.
  const outputs = await faceModel.predict(input);
  input.dispose();

  //This parses the output of the face model and gets the bounding boxes and their confidences.
  const boxes = await parseDetections(outputs);
  outputs.forEach(t => t.dispose());

  //This removes overlapping bounding boxes using non-maximum suppression (NMS) to keep only the most confident ones.
  //The iouThreshold is set to 0,45 as that is the standard in YOLO implementations.
  //This means that boxes that overlap by more than 45% is considered the same box and is removed.
  detections = nms(boxes, 0.45);

  //This classifies the detected faces using the emotion model and assigns an emotion label to each face.
  for (let d of detections) {
    d.emotion = await classifyEmotion(d);
  }

  //This stops the detection of faces after the current frame is processed.
  isDetecting = false;
}


async function parseDetections(outputs) {
  //This sets the confidence threshold for the detections. 0,5 means that it will only consider detections with a confidence of at least 50%.
  const CONF_THRESHOLD = 0.5;

  //This is the detections strides. The model outputs three tensors with different resolutions, each responsible for detecting faces of different sizes.
  //The strides is how many pixels the model have in each detection. A stride of 8 means that the model looks at 8x8 pixels for a face, therefore makes a grid of 8x8 pixels.
  const strides = [8, 16, 32];
  let results = [];

  //For each of the output tensors.
  for (let i = 0; i < outputs.length; i++) {
    //We convert the output tensor to a JavaScript array.
    const data = await outputs[i].array(); //Shape is [1,H,W,63]
    //Here we get the height and width of the output tensor.
    const H = data[0].length;
    const W = data[0][0].length;
    const stride = strides[i];

    //This loops through every cell of the output. The cell has 3 anchors, in an array of 63, 21 for each anchor, so we offset by 21 for each anchor, to get the output from each anchor.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let a = 0; a < 3; a++) {
          const offset = a * 21;
          const raw = data[0][y][x];

          //Here it applies the sigmoid function to the raw output of the model to get the confidence of the detection.
          //As the confidence score is at position 4 of the raw output, we take the value at that position.
          const conf = sigmoid(raw[offset + 4]);
          if (conf < CONF_THRESHOLD) continue;

          //To get the bounding box coordinates, we use the sigmoid function to convert the raw output to a value between 0 and 1.
          //Then we multiply the value by the stride to get the actual pixel coordinates.
          const cx = (sigmoid(raw[offset]) * 2 - 0.5 + x) * stride;
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

//The sigmoid fuction is used to convert the raw output of the model to a value between 0 and 1.
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

//This is the non-maximum suppression (NMS) function that removes overlapping bounding boxes.
function nms(boxes, iouThreshold) {
  // Sort by confidence, highest first
  boxes.sort((a, b) => b.conf - a.conf);

  const kept = [];

  while (boxes.length > 0) {
    // Take box with the highest confidence
    const best = boxes.shift();
    kept.push(best);

    // Remove boxes that overlap too much with the best box
    boxes = boxes.filter(box => iou(best, box) < iouThreshold);
  }

  return kept;
}

function iou(a, b) {
  //This calculates the intersection over union (IOU) between two bounding boxes.
  //Where it returns a value between 0 and 1.
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const unionArea = a.w * a.h + b.w * b.h - intersection;

  return intersection / unionArea;
}

// Function to send signal to ESP32 via WebSocket
function sendSignal(signal) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(signal);
    console.log("Sent:", signal);
  } else {
    console.log("Socket is not open. Cannot send message.");
  }
}

async function connect(){
  if (!isconnected) {
	socket = new WebSocket('ws://' + esp32IP + ':' + port);
  }
}

async function classifyEmotion(box) {
  //This is a console log to check the box coordinates.
  //  console.log('classifyEmotion called with box:', box);

  //This makes the frame into a tensor and prepares it for the emotion model.
  const emotion = tf.tidy(() => {
    //This takes the frame from the camera and converts it to a tensor.
    const frame = tf.browser.fromPixels(camera.elt);

    // This takes the bounding box coordinates and crops the frame to the bounding box.
    // It then makes sure that the cropped frame is withing the camera frame and only takes that part.
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    const w = Math.min(Math.round(box.w), camera.elt.videoWidth - x);
    const h = Math.min(Math.round(box.h), camera.elt.videoHeight - y);

    //This creates tensors for the mean and standard deviation of the RGB values.
    //These values are from the RepVGG model that was trained on the ImageNet dataset.
    //https://github.com/DingXiaoH/RepVGG
    const mean = tf.tensor([0.485, 0.456, 0.406]);
    const std  = tf.tensor([0.229, 0.224, 0.225]);

    return frame
        //This crops the frame to the bounding box.
        .slice([y, x, 0], [h, w, 3])
        //Then transposes the image to the format that the model expects.
        .resizeBilinear([224, 224])
        .toFloat()
        .div(255.0)
        .sub(mean)
        .div(std)
        .expandDims(0);  // [1, 224, 224, 3]
  });

  const output = await emotionModel.predict(emotion);
  const scores = await output.array();
//  console.log('emotion output shape:', output.shape);
//  console.log('emotion scores:', scores);
  emotion.dispose();
  output.dispose();
  //The model outputs a 8-dimensional array with scores for each emotion.
  //This takes the index of the maximum score and returns the corresponding emotion.
  const emotionIdx = scores[0].indexOf(Math.max(...scores[0]));
  return EMOTIONS[emotionIdx];
}

