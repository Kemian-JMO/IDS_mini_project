#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>


// Wifi info
const char* ssid = "RUC-IOT"; //name of WIFI
const char* password = "GiHa5934La"; 


// Create web server
WebServer server(80);

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


// Function to add CORS headers : Cross-Origin Resource Sharing
void addCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Handle OPTIONS requests (CORS preflight)
void handleOptions() {
  addCORSHeaders();
  server.send(204);  // No Content response
}

void handleMotor(){
	addCORSHeaders();
	
	if(server.hasArg("state")){
		String state = server.arg("state");
		Serial.println("Received condition: " + state);
		
		if(state == "open"){
			if(!doorIsOpen){
				servoDoor.write(OPEN_ANGLE);
			}
			doorIsOpen = true;
			openTime = millis();
			server.send(200, "text/plain", "Door opened");
		}
		else if(state == "close"){
			servoDoor.write(CLOSED_ANGLE);
			doorIsOpen = false;
			server.send(200, "text/plain", "Door closed");
		}
		else{
			Serial.println("Unknown state received");
			server.send(400, "text/plain", "Unknown state");
			return;
		}
	}
	else{
		server.send(400, "text/plain", "Missing state argument");
	}
}


void setup() {
  
  // Serial begin
  Serial.begin(115200);

  // Servo setting
  servoDoor.setPeriodHertz(50);  // SG90 standard
  servoDoor.attach(SERVO_PIN);
  servoDoor.write(CLOSED_ANGLE);

  // Wi-Fi connect
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
  delay(1000);
  Serial.print(".");
  }
  Serial.println("\nWiFi connected");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());

  // add route in setup() - GET request
  server.on("/motor", HTTP_GET, handleMotor);  // http://ESP32_IP/motor?state=open

  // Handle CORS preflight using OPTIONS request
  server.on("/motor", HTTP_OPTIONS, handleOptions);

  // server begin
  server.begin();

}

void loop() {

  server.handleClient();

  if(doorIsOpen && millis() - openTime >= OPEN_DURATION){
    servoDoor.write(CLOSED_ANGLE);
    doorIsOpen = false;
    
    Serial.println("Door closed automatically");
  }

}
