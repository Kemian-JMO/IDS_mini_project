let socket;
let buttonColors = ['red', 'green', 'blue']; // Array of colors
let buttons = []; // Array to store buttons

function setup() {
  createCanvas(400, 300);

  // Replace with your ESP32's IP address
  let esp32IP = '10.104.195.35'; // Example, find your ESP32's IP in the Serial Monitor
  let port = 81; // Same port as on the ESP32

  socket = new WebSocket('ws://' + esp32IP + ':' + port);

  socket.onopen = function(event) {
    console.log('Connected to ESP32 WebSocket server');
  };

  socket.onmessage = function(event) {
    console.log('Received from ESP32: ' + event.data);
  };

  socket.onclose = function(event) {
    console.log('Disconnected from ESP32 WebSocket server');
  };

  socket.onerror = function(error) {
    console.error('WebSocket error:', error);
  };

  // Create three buttons for each color
  for (let i = 0; i < buttonColors.length; i++) {
    let btn = createButton(buttonColors[i]);
    btn.position(50 + i * 100, 250); // Position buttons horizontally
    btn.style('background-color', buttonColors[i]);
    btn.style('color', 'white');
    btn.style('border', 'none');
    btn.style('padding', '10px 20px');
    btn.style('font-size', '16px');
    btn.mousePressed(() => sendColor(buttonColors[i])); // Send corresponding color on click
    buttons.push(btn);
  }
}

function draw() {
  background(220);
  textSize(16);
  textAlign(CENTER, CENTER);
  fill(0);
  text("Click a button to change NeoPixel color", width / 2, height / 2 - 50);
}

// Function to send color to ESP32 via WebSocket
function sendColor(color) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(color);
    console.log("Sent:", color);
  } else {
    console.log("Socket is not open. Cannot send message.");
  }
}
