/* * 3 RFID Readers & 3 RGB LEDs System (Multi-Tag Version)
 * Logic: One Reader can accept MULTIPLE valid tags.
 */

#include <SPI.h>
#include <MFRC522.h>

// --- 1. 핀 설정 ---
#define NR_OF_READERS 3

byte ssPins[] = {10, 8, 6};
byte rstPins[] = {9, 7, 5};

byte ledRedPins[] = {2, 4, A1};
byte ledGreenPins[] = {A0, 3, A2};

MFRC522 mfrc522[NR_OF_READERS]; 

// --- 2. 정답 태그 설정 (핵심 변경 부분) ---

// 리더기 하나당 기억할 수 있는 최대 태그 개수 (필요하면 늘리세요)
const int MAX_TAGS = 5; 

// 3차원 배열: [리더기번호][태그슬롯][UID바이트]
byte validUIDs[NR_OF_READERS][MAX_TAGS][7] = {
  // >> 리더 1 행거가 좋아하는 태그 목록 (최대 5개)
  {
    {0x53, 0x5B, 0x06, 0x60, 0x21, 0x00, 0x01}, // BAG
    {0x53, 0xA0, 0x94, 0x65, 0x21, 0x00, 0x01}, // 안드레아
    {0x00, 0x00, 0x00, 0x00}, // (비어있음) 0으로 채워둠
    {0x00, 0x00, 0x00, 0x00},
    {0x00, 0x00, 0x00, 0x00}
  },
  
  // >> 리더 2  책장이 좋아하는 태그 목록
  {
    {0x53, 0xB5, 0x11, 0x60, 0x21, 0x00, 0x01}, // 책
    {0x53, 0xA0, 0x94, 0x65, 0x21, 0x00, 0x01}, // 안드레아
    {0x00, 0x00, 0x00, 0x00}, 
    {0x00, 0x00, 0x00, 0x00},
    {0x00, 0x00, 0x00, 0x00}
  },

  // >> 리더 3 데스크가 좋아하는 태그 목록
  {
    {0x53, 0xB5, 0x11, 0x60, 0x21, 0x00, 0x01}, // 책
    {0x53, 0xA0, 0x94, 0x65, 0x21, 0x00, 0x01}, // 안드레아
    {0x53, 0x60, 0x0B, 0x60, 0x21, 0x00, 0x01}, // 모니터
    {0x00, 0x00, 0x00, 0x00},
    {0x00, 0x00, 0x00, 0x00}
  }
};

void setup() {

  delay(1000);

  Serial.begin(9600);
  while (!Serial); 
  SPI.begin(); 

  for (uint8_t i = 0; i < NR_OF_READERS; i++) {
    mfrc522[i].PCD_Init(ssPins[i], rstPins[i]);
    mfrc522[i].PCD_SetAntennaGain(mfrc522[i].RxGain_max);
    
    pinMode(ledRedPins[i], OUTPUT);
    pinMode(ledGreenPins[i], OUTPUT);
    digitalWrite(ledRedPins[i], LOW);
    digitalWrite(ledGreenPins[i], LOW);
  }
  Serial.println(F("System Ready. Multiple tags supported."));
}

void loop() {
  for (uint8_t i = 0; i < NR_OF_READERS; i++) {
    if (mfrc522[i].PICC_IsNewCardPresent() && mfrc522[i].PICC_ReadCardSerial()) {
      
      Serial.print(F("(Reader "));
      Serial.print(i + 1);
      Serial.print(F(","));
      dump_byte_array(mfrc522[i].uid.uidByte, mfrc522[i].uid.size);
      Serial.println(F(")"));
      
      // 판별 로직 호출
      if (checkUID(i, mfrc522[i].uid.uidByte)) {
        // Serial.println(F(" -> Match! (Green)"));
        blinkLED(i, true); 
      } else {
        // Serial.println(F(" -> Mismatch! (Red)"));
        blinkLED(i, false);
      }

      mfrc522[i].PICC_HaltA();
      mfrc522[i].PCD_StopCrypto1();
    }
  }
}

// --- 수정된 판별 함수 (리스트 전체 스캔) ---
boolean checkUID(int readerIndex, byte *readUID) {
  // 해당 리더기에 저장된 태그 리스트(MAX_TAGS)를 하나씩 검사
  for (int tagIdx = 0; tagIdx < MAX_TAGS; tagIdx++) {
    
    boolean isMatch = true; // 일단 맞다고 가정하고 검사 시작
    
    // 비어있는 슬롯(00 00 00 00)은 검사하지 않고 패스 (최적화)
    if (validUIDs[readerIndex][tagIdx][0] == 0x00) continue;

    // 4바이트 비교
    for (int byteIdx = 0; byteIdx < 4; byteIdx++) {
      if (readUID[byteIdx] != validUIDs[readerIndex][tagIdx][byteIdx]) {
        isMatch = false; // 하나라도 틀리면 이 태그는 아님
        break; 
      }
    }

    // 만약 이번 태그(tagIdx)가 완전히 일치한다면?
    if (isMatch) {
      return true; // 즉시 합격 리턴!
    }
  }
  
  // 리스트를 다 뒤졌는데 일치하는게 없으면
  return false; // 불합격
}

void blinkLED(int readerIndex, boolean isSuccess) {
  int greenPin = ledGreenPins[readerIndex];
  int redPin = ledRedPins[readerIndex];

  digitalWrite(greenPin, LOW);
  digitalWrite(redPin, LOW);

  if (isSuccess) {
    digitalWrite(greenPin, HIGH);
    delay(1000); 
    digitalWrite(greenPin, LOW);
  } else {
    digitalWrite(redPin, HIGH);
    delay(1000); 
    digitalWrite(redPin, LOW);
  }
}

void dump_byte_array(byte *buffer, byte bufferSize) {
  for (byte i = 0; i < bufferSize; i++) {
    Serial.print(buffer[i] < 0x10 ? " 0" : " ");
    Serial.print(buffer[i], HEX);
  }
}