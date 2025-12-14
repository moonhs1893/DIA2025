import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import OpenAI from 'openai';
import player from 'play-sound';
import fs from 'fs';
import path from 'path';

// --- 설정 ---
const SERIAL_PORT_PATH = '/dev/cu.usbmodem21201'; // 맥/리눅스는 '/dev/tty.usbmodem...' 등 확인 필요
const BAUD_RATE = 9600;
require("dotenv").config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// --- 데이터 및 페르소나 정의 ---
const TAGS = {
    "53 B5 11 60 21 00 01": "Book",
    "53 A0 94 65 21 00 01": "Andrea",
    "53 5B 06 60 21 00 01": "Bag",
    "53 60 0B 60 21 00 01": "Monitor"
};

const READERS = {
    "1": "Bag rack",
    "2": "Bookshelf",
    "3": "Desk"
};

// 긍정 궁합 정의 (Location -> [Likable Objects])
const POSITIVE_RELATIONS = {
    "Bookshelf": ["Book", "Andrea"],
    "Desk": ["Monitor", "Book", "Andrea"],
    "Bag rack": ["Bag", "Andrea"]
};

const PERSONAS = `
<Desk> You are a productive desk that supports work and focus. You like: Monitor, Book, Andrea. You dislike: Bag.
<Bookcase> You are a calm and organized bookcase that values order and knowledge. You like: Book, Andrea. You dislike: Bag, Monitor.
<Bag rack> You are a practical bag rack designed to hang items neatly. You like: Bag, Andrea. You dislike: Book, Monitor.
<Book> You are a thoughtful stack of books. You feel uncomfortable in noisy/unsuitable places.
<Monitor> You are a digital monitor. You feel out of place without a proper desk.
<Bag> You are a daily bag. You feel annoyed when left on flat surfaces.
<Andrea> You are a humorous Italian professor. You speak 'Mamma mia!' or 'Merda!' sometimes.
`;

// --- 시스템 상태 변수 ---
let currentReader = null;
let currentTags = new Set(); // 현재 인식된 태그들
let bufferTimer = null; // 2초 대기 타이머
let interactionTimer = null; // 30초 대화 유지 타이머
let isPlaying = false; // 재생 중 여부
let audioProcess = null; // 오디오 프로세스 (중단용)
let conversationContext = ""; // 이전 대화 맥락 저장

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const audioPlayer = player({});

// --- 시리얼 통신 설정 ---
const port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

console.log("System Started. Waiting for Arduino signals...");

// --- 메인 로직 ---
parser.on('data', (line) => {
    // 아두이노 데이터 포맷: "(Reader 1, 53 B5 11 60 21 00 01)"
    // 정규식으로 파싱
    const match = line.match(/\(Reader (\d+), ([0-9A-F ]+)\)/);
    
    if (match) {
        const readerId = match[1];
        const tagUid = match[2].trim();
        
        handleSignal(readerId, tagUid);
    }
});

function handleSignal(readerId, tagUid) {
    const readerName = READERS[readerId];
    const tagName = TAGS[tagUid];

    if (!readerName || !tagName) {
        console.log(`Unknown signal: Reader ${readerId}, Tag ${tagUid}`);
        return;
    }

    console.log(`Input: ${readerName} detected ${tagName}`);

    // 1. 다른 리더기에서 신호가 온 경우 -> 즉시 리셋 및 새 대화
    if (currentReader !== readerName) {
        console.log(">>> New Reader Detected! Resetting...");
        resetSystem();
        currentReader = readerName;
        currentTags.add(tagName);
        
        // 2초 버퍼 시작 (여러 태그 동시 인식 대기)
        if (bufferTimer) clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => {
            startConversation(false); // false = 새로운 대화 시작
        }, 2000);
        
        return;
    }

    // 2. 같은 리더기에서 신호가 온 경우
    if (!currentTags.has(tagName)) {
        console.log(`>>> New Tag (${tagName}) added to current reader!`);
        currentTags.add(tagName);

        // A. 아직 2초 버퍼 중이라면? -> 그냥 태그 리스트에 추가만 하고 타이머 유지
        if (bufferTimer) {
            console.log("Buffering... waiting for more tags.");
            return; 
        }

        // B. 대화가 이미 진행 중(30초 내)이라면? -> 난입(Interruption) 로직
        if (interactionTimer) {
            console.log(">>> Interruption! Modifying conversation...");
            stopAudio(); // 말 끊기
            startConversation(true); // true = 난입 모드
        }
    }
}

// --- 대화 생성 및 재생 ---
async function startConversation(isInterruption) {
    bufferTimer = null; // 버퍼 종료

    // 30초 타이머 (재설정)
    if (interactionTimer) clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => {
        console.log("Interaction window closed.");
        interactionTimer = null;
        currentReader = null;
        currentTags.clear();
        conversationContext = "";
    }, 35000); // 여유있게 35초

    const tagsArray = Array.from(currentTags);
    const location = currentReader; // Bookshelf, Desk, Bag rack

    console.log(`Generating script for: [${location}] with [${tagsArray.join(', ')}]`);

    // 궁합 분석
    let moodDescription = "";
    const positives = POSITIVE_RELATIONS[location] || [];
    
    // 분류
    const goodMatches = tagsArray.filter(t => positives.includes(t));
    const badMatches = tagsArray.filter(t => !positives.includes(t));

    if (badMatches.length === 0) {
        moodDescription = "All participants are in Harmony. Create a friendly, productive, or calm conversation.";
    } else if (goodMatches.length === 0) {
        moodDescription = "Total Conflict. The Reader hates the object(s). The object feels uncomfortable. Create a hostile, annoyed, or complaining conversation.";
    } else {
        moodDescription = "Mixed Atmosphere. There is tension. The 'Good Match' objects should try to mediate or calm down the 'Bad Match' objects, while the Reader complains about the Bad Match.";
    }

    // AI 프롬프트 구성
    const systemPrompt = `
    You are a scriptwriter for an interactive IoT exhibition.
    
    Current Location (Reader): ${location}
    Participants (Tags): ${tagsArray.join(', ')}
    Characters present: ${location}, ${tagsArray.join(', ')}
    
    RELATIONSHIP MOOD: ${moodDescription}
    
    ${PERSONAS}
    
    INSTRUCTIONS:
    - Generate a short dialogue script (approx 40 seconds spoken).
    - Write ONLY the dialogue lines. Format: "Character: Text"
    - If 'isInterruption' is true, start by acknowledging the new arrival naturally.
    - Language: English.
    - Andrea must use Italian exclamations occasionally.
    - Keep it dynamic and emotional based on the mood.
    `;

    let userMessage = isInterruption 
        ? `A new object entered! Previous Context: "${conversationContext}". New participant: ${tagsArray[tagsArray.length-1]}. Continue naturally.`
        : `Start a new conversation between these objects.`;

    try {
        // 1. 텍스트 생성 (GPT-4o)
        const gptResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            max_tokens: 300
        });

        const script = gptResponse.choices[0].message.content;
        console.log("--- Generated Script ---");
        console.log(script);
        console.log("------------------------");
        
        // 맥락 저장 (다음 난입을 위해)
        conversationContext = script.substring(script.length - 100); // 마지막 부분만 기억

        // 2. 음성 생성 (TTS API)
        const mp3Response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy", // alloy, echo, fable, onyx, nova, shimmer 중 선택 가능
            input: script
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());
        const audioFile = path.resolve(`./output_${Date.now()}.mp3`);
        
        await fs.promises.writeFile(audioFile, buffer);
        
        // 3. 재생
        playAudio(audioFile);

    } catch (error) {
        console.error("AI Error:", error);
    }
}

function playAudio(filePath) {
    if (isPlaying) stopAudio();

    isPlaying = true;
    console.log("Playing audio...");

    // play-sound 라이브러리로 재생 (mpg123 or mplayer 필요할 수 있음)
    audioProcess = audioPlayer.play(filePath, (err) => {
        if (err && !err.killed) console.error("Playback error:", err);
        isPlaying = false;
        // 재생 후 파일 삭제 (선택사항)
        // fs.unlinkSync(filePath); 
    });
}

function stopAudio() {
    if (audioProcess) {
        audioProcess.kill();
        audioProcess = null;
    }
    isPlaying = false;
    console.log("Audio stopped.");
}

function resetSystem() {
    stopAudio();
    if (bufferTimer) clearTimeout(bufferTimer);
    if (interactionTimer) clearTimeout(interactionTimer);
    
    currentReader = null;
    currentTags.clear();
    conversationContext = "";
}