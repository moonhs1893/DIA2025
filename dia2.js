import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import OpenAI from 'openai';
import player from 'play-sound';
import fs from 'fs';
import path from 'path';

// --- [1] 설정 (반드시 수정하세요) ---
const SERIAL_PORT_PATH = '/dev/cu.usbmodem21201'; // 본인의 포트 경로로 수정!
const BAUD_RATE = 9600;
require("dotenv").config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- [2] 오브젝트 및 목소리 매핑 ---
// OpenAI Voices: alloy(여), echo(남), fable(남/높음), onyx(남/낮음), nova(여), shimmer(여)

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

// 캐릭터별 목소리 설정
const VOICE_MAP = {
    "Book": "fable",       // 유쾌한 남성
    "Bag": "fable",        // 유쾌한 남성
    "Monitor": "nova",     // 여성
    "Bookshelf": "onyx",   // 남성 (중후함)
    "Bag rack": "shimmer", // 여성
    "Desk": "alloy",       // 여성
    "Andrea": "echo"       // 남성 (이탈리안 악센트는 프롬프트로 처리)
};

const POSITIVE_RELATIONS = {
    "Bookshelf": ["Book", "Andrea"],
    "Desk": ["Monitor", "Book", "Andrea"],
    "Bag rack": ["Bag", "Andrea"]
};

// 페르소나 정의 (Andrea의 말투 강조)
// [수정] 문자열이 아니라 객체(Dictionary)로 변경
const PERSONA_DB = {
    "Desk": "You are a productive desk (Female voice). You support work. Like: Monitor, Book, Andrea. Dislike: Bag.",
    "Bookcase": "You are a calm, organized bookcase (Male voice). Like: Book, Andrea. Dislike: Bag, Monitor.",
    "Bag rack": "You are a practical bag rack (Female voice). Like: Bag, Andrea. Dislike: Book, Monitor.",
    "Book": "You are a thoughtful, joyful stack of books (Male voice). Uncomfortable in noisy places.",
    "Monitor": "You are a digital monitor (Female voice). Need a desk.",
    "Bag": "You are a daily bag (Male voice). Like being hung neatly.",
    "Andrea": "You are a humorous Italian professor (Male voice). You MUST use Italian exclamations like 'Mamma mia!', 'Perfetto!', 'Allora!', 'Merda!' frequently. You speak English with a heavy Italian style syntax."
};

// --- [3] 시스템 상태 변수 ---
let currentReader = null;
let currentTags = new Set();
let bufferTimer = null;      // 2초 대기
let interactionTimer = null; // 30초 대화 유지
let audioQueue = [];         // 재생할 오디오 파일 리스트
let isPlaying = false;       // 현재 재생 중인지
let currentAudioProcess = null; // 현재 재생 중인 프로세스 (kill용)
let conversationHistory = ""; // 직전 대화 내용 기억

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const audioPlayer = player({});
const port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

console.log("System Started. Multi-voice interactive mode ready.");

// --- [4] 시리얼 통신 핸들링 ---
parser.on('data', (line) => {
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

    if (!readerName || !tagName) return;

    console.log(`Input: ${readerName} detected ${tagName}`);

    // 1. 리더기가 바뀐 경우 (완전 새로운 상황)
    if (currentReader !== readerName) {
        console.log(">>> New Location! Resetting...");
        resetSystem(); // 기존 대화/오디오 모두 중단
        currentReader = readerName;
        currentTags.add(tagName);
        
        // 2초 버퍼링 시작
        if (bufferTimer) clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => {
            generateAndPlayDialogue(false); // false = 새로운 대화
        }, 2000);
        return;
    }

    // 2. 같은 리더기 내 추가 태그 (난입)
    if (!currentTags.has(tagName)) {
        console.log(`>>> New Object (${tagName}) Entered!`);
        currentTags.add(tagName);

        if (bufferTimer) {
            console.log("...Buffering (waiting for others)...");
            return; 
        }

        // 이미 대화 중이라면 (30초 내) -> 난입 발생!
        if (interactionTimer) {
            console.log("!!! INTERRUPTION TRIGGERED !!!");
            stopAudio(); // 현재 말하던거 끊기
            generateAndPlayDialogue(true, tagName); // true = 난입 모드
        }
    }
}

// --- [5] 대화 생성 및 오디오 변환 (고속화 버전) ---
async function generateAndPlayDialogue(isInterruption, newComerName = "") {
    bufferTimer = null;

    if (interactionTimer) clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => {
        console.log("--- Session Timeout (30s) ---");
        interactionTimer = null;
        currentReader = null;
        currentTags.clear();
        conversationHistory = "";
    }, 35000);

    const tagsArray = Array.from(currentTags);
    const location = currentReader;
    
    // --- [핵심 수정] 현재 있는 녀석들의 페르소나만 문자열로 조합 ---
    // 리더기(장소) + 태그들(오브젝트) 목록
    const activeCharacters = [location, ...tagsArray]; 
    
    let activePersonas = "";
    activeCharacters.forEach(charName => {
        if (PERSONA_DB[charName]) {
            activePersonas += `<${charName}> ${PERSONA_DB[charName]}\n`;
        }
    });
    // -------------------------------------------------------

    // 무드 분석 (그대로 유지)
    const positives = POSITIVE_RELATIONS[location] || [];
    const goodMatches = tagsArray.filter(t => positives.includes(t));
    const badMatches = tagsArray.filter(t => !positives.includes(t));
    let mood = "";
    if (badMatches.length === 0) mood = "Friendly, happy.";
    else if (goodMatches.length === 0) mood = "Hostile, annoyed.";
    else mood = "Chaotic/Mixed.";

    // ... (앞부분 로직은 그대로) ...

    const systemPrompt = `
    Location (HOST): ${location}. 
    Guests: ${tagsArray.join(', ')}. 
    Mood: ${mood}

    --- Character Descriptions ---
    ${activePersonas}
    ------------------------------

    Rules:
    - Write 3-5 lines of dialogue.
    - Format: "Name: Dialogue"
    - NO Markdown.
    - IMPORTANT: The Host (${location}) MUST speak at least once. 
    - The Host should react to the guests or the situation.
    - DO NOT include characters NOT listed above.
    `;

    // ... (이하 코드 그대로) ...

    const userMessage = isInterruption
        ? `STOP! ${newComerName} entered! Context: "${conversationHistory}". React.`
        : `Start conversation between ${location} and ${tagsArray.join(', ')}.`;

    try {
        console.log("🚀 Generating Script (gpt-4o-mini)...");
        
        // [속도업 1] 모델을 mini로 변경하여 반응 속도 극대화
        const gptResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            max_tokens: 200
        });

        const script = gptResponse.choices[0].message.content;
        console.log("--------------------------------");
        console.log(script);
        console.log("--------------------------------");
        conversationHistory = script; 

        // 대본 파싱
        const lines = script.split('\n').filter(l => l.includes(':'));
        console.log(`⚡️ Requesting ${lines.length} audio files in PARALLEL...`);

        // [속도업 2] 모든 오디오를 동시에 요청 (Promise 배열 생성)
        const audioPromises = lines.map(async (line, index) => {
            const splitArr = line.split(/:(.+)/);
            if (splitArr.length < 2) return null;

            let speakerRaw = splitArr[0];
            const text = splitArr[1].trim();
            const cleanSpeaker = speakerRaw.replace(/[^a-zA-Z ]/g, "").trim();
            
            // 목소리 매핑
            const mapKey = Object.keys(VOICE_MAP).find(key => key.toLowerCase() === cleanSpeaker.toLowerCase());
            const voice = mapKey ? VOICE_MAP[mapKey] : "alloy"; 

            // TTS 요청 (await가 있지만 map 내부라서 병렬로 실행됨)
            const mp3Response = await openai.audio.speech.create({
                model: "tts-1",
                voice: voice,
                input: text
            });
            
            const buffer = Buffer.from(await mp3Response.arrayBuffer());
            const fileName = path.resolve(`./temp_${Date.now()}_${index}.mp3`);
            await fs.promises.writeFile(fileName, buffer);
            
            return fileName;
        });

        // [속도업 3] 다운로드가 다 끝날 때까지 기다리지 않고, 처리 로직으로 넘김
        // 실제 재생은 playAudioSequence에서 '순서대로' 기다리며 처리
        playAudioSequence(audioPromises);

    } catch (e) {
        console.error("AI/TTS Error:", e);
    }
}

// --- [6] 오디오 재생 관리 (파이프라인 방식) ---
async function playAudioSequence(promiseArray) {
    // 기존 재생 중단
    stopAudio();
    isPlaying = true;

    // 난입 시 취소를 위해 현재 큐 ID 생성
    const currentQueueId = Date.now();
    audioQueue = currentQueueId; 

    for (const promise of promiseArray) {
        try {
            // [핵심] 앞 순서 파일이 준비될 때까지만 기다림
            // 뒷 순서 파일들은 이 시간 동안 백그라운드에서 다운로드 중임
            const fileName = await promise; 
            
            if (!fileName) continue; // 빈 줄 무시
            if (!isPlaying || audioQueue !== currentQueueId) break; // 난입 발생 시 중단

            console.log(`▶️ Playing: ${path.basename(fileName)}`);
            
            // 파일 재생 (비동기를 동기처럼 기다림)
            await new Promise((resolve, reject) => {
                currentAudioProcess = audioPlayer.play(fileName, (err) => {
                    if (err && !err.killed) console.error("Play error:", err);
                    resolve();
                });
            });

            // 다 듣고 나서 삭제
            try { fs.unlinkSync(fileName); } catch(e) {}

        } catch (error) {
            console.error("Playback pipeline error:", error);
        }
    }
    
    if (audioQueue === currentQueueId) {
        isPlaying = false;
        console.log("✅ Dialogue Finished.");
    }
}

// stopAudio 함수도 약간 수정 필요 (Queue ID 초기화)
function stopAudio() {
    isPlaying = false;
    audioQueue = null; // 큐 ID 초기화로 반복문 탈출 유도
    if (currentAudioProcess) {
        currentAudioProcess.kill();
        currentAudioProcess = null;
    }
}

function playNext() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        console.log("Dialogue Finished.");
        return;
    }

    isPlaying = true;
    const currentFile = audioQueue.shift(); // 첫번째 파일 꺼냄

    // 재생
    currentAudioProcess = audioPlayer.play(currentFile, (err) => {
        if (err && !err.killed) console.error("Play error:", err);
        
        // 파일 삭제 (청소)
        try { fs.unlinkSync(currentFile); } catch(e) {}

        // 다음 파일 재생 (재귀 호출)
        if (isPlaying) playNext(); 
    });
}



function resetSystem() {
    stopAudio();
    if (bufferTimer) clearTimeout(bufferTimer);
    if (interactionTimer) clearTimeout(interactionTimer);
    currentReader = null;
    currentTags.clear();
    conversationHistory = "";
}