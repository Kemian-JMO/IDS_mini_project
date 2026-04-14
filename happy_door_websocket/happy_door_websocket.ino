#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ESP32Servo.h>


// Wifi info
const char* ssid = "RUC-IOT"; //name of WIFI
const char* password = "GiHa5934La";

// Create websocket server
WebSocketsServer webSocket = WebSocketsServer(81);

// Servo object
Servo servoDoor;

// Servo setting
const int SERVO_PIN = 4;
const int CLOSED_ANGLE = 0;
const int OPEN_ANGLE = 90;  // as motor condition, the angle could be changed

// Door setting
bool doorIsOpen = false;
unsigned long openTime = 0;
const unsigned long OPEN_DURATION = 3000; // 3 seconds

String IPaddress;

// Function declarations
void openDoor();
void closeDoor();
void handleMessage(uint8_t num, String message);

// Websocket event handler
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {

  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected!\n", num);
      break;

    case WStype_CONNECTED:
      Serial.printf("[%u] Connected\n", num);
      webSocket.sendTXT(num, "Hello from ESP32!");
      break;

    case WStype_TEXT: {
        String message = String((char*)payload);
        message.toLowerCase();
        
        Serial.printf("[%u] Received: %s\n", num, message.c_str());
        
        handleMessage(num, message);

        // This code sends message to client through handleMessage()
        //webSocket.sendTXT(num, "Received: " + message);
        break;
      }
      break;

    case WStype_BIN:
      Serial.printf("[%u] Received Binary data, length: %u\n", num, length);
      break;
  }

}

// Handle received message
void handleMessage(uint8_t num, String message){

  if(message == "open"){
    openDoor();
    webSocket.sendTXT(num, "door opened");
  }
  else if(message == "close"){
    closeDoor();
    webSocket.sendTXT(num, "door closed");
  }
  else{
    Serial.println("Unknown command received");
    webSocket.sendTXT(num, "unknown command");
  }

}

// Open door
void openDoor(){

  if(!doorIsOpen){
    servoDoor.write(OPEN_ANGLE);
    Serial.println("Door opened");
  }
  else{
    Serial.println("Door already open - timer extended");
  }

  doorIsOpen = true;
  openTime = millis();  // reset timer every time "open" is received

}

// Close door
void closeDoor(){
  
  servoDoor.write(CLOSED_ANGLE);
  doorIsOpen = false;
  Serial.println("Door closed");

}

void setup() {
  
  // Serial begin
  Serial.begin(115200);

  // Servo setting
  servoDoor.attach(SERVO_PIN);
  servoDoor.write(CLOSED_ANGLE);

  // Wi-Fi connect
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());

  IPaddress = WiFi.localIP().toString();

  //Websocket server start
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

}

void loop() {
  
  webSocket.loop();

  if(doorIsOpen && millis() - openTime >= OPEN_DURATION){
    closeDoor();
    Serial.println("Door closed automatically");
  }

}
