import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import OpenAI from 'openai';
import player from 'play-sound';
import fs from 'fs';
import path from 'path';
import "dotenv/config";
import readline from 'readline';

// --- [1] 설정 (반드시 수정하세요) ---
const SERIAL_PORT_PATH = '/dev/cu.usbmodem21201'; // 본인의 포트 경로로 수정!
const BAUD_RATE = 9600;
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
// 캐릭터별 목소리 설정 (New Voices 적용 버전)
const VOICE_MAP = {
    "Book": "ash",         // [New] 사색적인 책 (기존 fable보다 더 차분함)
    "Bag": "ballad",       // [New] 철없는 가방 (기존 fable보다 더 생동감 있음)
    "Monitor": "coral",    // [New] 또렷한 모니터 (기존 nova보다 더 밝음)
    "Bookshelf": "onyx",   // [기존 유지] 중후한 노인은 여전히 onyx가 최고입니다.
    "Bag rack": "alloy",    // [New] 인내심 있는 가방걸이 (기존 shimmer보다 더 점잖음)
    "Desk": "sage",        // [New] 자부심 강한 책상 (sage의 권위 있는 톤 활용)
    "Andrea": "verse"      // [New] 이탈리안 교수 (Verse의 리듬감이 이탈리아 억양 묘사에 좋음)
};

// [수정 1] 억양 및 연기 스타일 명확화
// [수정 1] 악센트 유지 및 언어(English) 강제 설정
const VOICE_STYLE_MAP = {
  "Desk": "Voice Acting: Standard American Accent. Tone: Warm, proud, dramatic. Maintain the American accent clearly.",
  "Bookshelf": "Voice Acting: Standard British Accent (RP). Tone: Dry, slow, stoic. DO NOT revert to American accent.",
  "Bag rack": "Voice Acting: Soft British Accent. Tone: Whispering, gentle, patient.",
  "Book": "Voice Acting: British English Accent. Tone: Scholarly, calm, reflective. Enunciate clearly.",
  "Monitor": "Voice Acting: Crisp American Accent (Tech/News anchor style). Tone: Fast, efficient, bright.",
  "Bag": "Voice Acting: American Youth Accent (Slangy). Tone: Restless, annoyed, fast-paced.",
  // [핵심] 안드레아: "영어"로 말하라고 강하게 지시
  "Andrea": "Voice Acting: Speak ENGLISH with a Heavy Italian Accent. DO NOT speak Italian. Sound like an Italian man trying to speak English."
};


const POSITIVE_RELATIONS = {
    "Bookshelf": ["Book", "Andrea"],
    "Desk": ["Monitor", "Book", "Andrea"],
    "Bag rack": ["Bag", "Andrea"]
};

// 페르소나 정의 (Andrea의 말투 강조)
// [수정] 문자열이 아니라 객체(Dictionary)로 변경
// const PERSONA_DB = {
//     "Desk": "You are a productive desk (Female voice). You support work. Like: Monitor, Book, Andrea. Dislike: Bag.",
//     "Bookcase": "You are a calm, organized bookcase (Male voice). Like: Book, Andrea. Dislike: Bag, Monitor.",
//     "Bag rack": "You are a practical bag rack (Female voice). Like: Bag, Andrea. Dislike: Book, Monitor.",
//     "Book": "You are a thoughtful, joyful stack of books (Male voice). Uncomfortable in noisy places.",
//     "Monitor": "You are a digital monitor (Female voice). Need a desk.",
//     "Bag": "You are a daily bag (Male voice). Like being hung neatly.",
//     "Andrea": "You are a humorous Italian professor (Male voice). You MUST use Italian exclamations like 'Mamma mia!', 'Perfetto!', 'Allora!', 'Merda!' frequently. You speak English with a heavy Italian style syntax."
// };

// [수정] 월드 설정: 서술형 제거 -> 핵심 상황만 요약
const WORLD_BACKSTORY = `
Situation: Andrea's workspace. Late night.
Atmosphere: Tense but caring. Objects are alive and have strong personalities.
Current State: Andrea is overworked. The room is messy.
`;

// [수정] 가구 설정: 소설 같은 묘사 제거 -> 성격 키워드 + 억양 정보 집중
const FURNITURE_BACKSTORY = {
    "Desk": `
    Role: The longest-lasting furniture figure.
    Personality: Proud, dramatic, worried, loud.
    Relationship: Loves Book & Andrea. Thinks Bag is messy/shallow.
    Voice: Standard American. Warm but commanding.
    `,
    "Bookshelf": `
    Role: The Rigid Elder.
    Personality: Strict, orderly, stoic, snobby.
    Relationship: Obsessed with order. Likes Andrea Dislikes Bag (too messy) and Monitor (too flashy).
    Voice: British (RP). Dry and clipping.
    `,
    "Bag rack": `
    Role: The Observer.
    Personality: Patient, whispering, accepting.
    Relationship: Likes Bag (understands him). Likes Andrea. Dislikes others.
    Voice: Soft British. Gentle.
    `
};

// [수정] 사물 설정: 불필요한 서사 제거
const OBJECT_BACKSTORY = {
    "Monitor": `
    Role: The Tech / Visuals.
    Personality: Focused, bright, fast-talking, efficient.
    Relationship: Supports Desk. Thinks Bookshelf is outdated.
    Voice: Crisp American (News Anchor style).
    `,
    "Book": `
    Role: The Scholar.
    Personality: Wise, calm, reflective, slow.
    Relationship: Best friend of Desk. Needs quiet.
    Voice: British. Articulate.
    `,
    "Bag": `
    Role: The Teenager / Wanderer.
    Personality: Restless, annoyed, slangy, impatient.
    Relationship: Hates lying on Desk. Wants to hang on Bag Rack.
    Voice: American Youth.
    `
};

// [수정] 페르소나 DB: 규칙을 여기에도 박아넣음 (이중 장치)
const PERSONA_DB = {
    "Desk": {
        description: "Proud, dramatic American Desk. Speaks English only.",
        backstory: FURNITURE_BACKSTORY["Desk"],
    },
    "Bookshelf": {
        description: "Strict, snobby British furniture. Speaks English only.",
        backstory: FURNITURE_BACKSTORY["Bookshelf"],
    },
    "Bag rack": {
        description: "Whispering, patient British rack. Speaks English only.",
        backstory: FURNITURE_BACKSTORY["Bag Rack"],
    },
    "Book": {
        description: "Wise, calm British book. Speaks English only.",
        backstory: OBJECT_BACKSTORY["Book"],
    },
    "Monitor": {
        description: "Fast-talking, efficient American monitor. Speaks English only.",      
        backstory: OBJECT_BACKSTORY["Monitor"],
    },
    "Bag": {
        description: "Annoyed, restless American bag. Speaks English only.",
        backstory: OBJECT_BACKSTORY["Bag"],
    },
    "Andrea": {
        description: `Humorous Italian professor. 
        Speak ENGLISH with a HEAVY ITALIAN ACCENT.
        Use English words, but Italian grammar/spelling flavor.`,
        backstory: `Andrea is a hardworking and dedicated Italian professor who often works late into the night. 
        He has a heavy Italian accent and frequently uses Italian exclamations in his speech.`,
    }
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
    let characterContext = "";
    activeCharacters.forEach(charName => {
        const persona = PERSONA_DB[charName];
        if (!persona) return;
        characterContext += `
        <${charName}>
        Description: ${persona.description}
        Backstory: ${persona.backstory}
        </${charName}>
        `;
    });
    
    // let activePersonas = "";
    // activeCharacters.forEach(charName => {
    //     if (PERSONA_DB[charName]) {
    //         activePersonas += `<${charName}> ${PERSONA_DB[charName]}\n`;
    //     }
    // });
    // -------------------------------------------------------

    // 무드 분석 (그대로 유지)
    // const positives = POSITIVE_RELATIONS[location] || [];
    // const goodMatches = tagsArray.filter(t => positives.includes(t));
    // const badMatches = tagsArray.filter(t => !positives.includes(t));
    // let mood = "";
    // if (badMatches.length === 0) mood = "Friendly, happy.";
    // else if (goodMatches.length === 0) mood = "Hostile, annoyed.";
    // else mood = "Chaotic/Mixed.";

    const mood = "Emerge naturally from character backstories, relationships, and the situation.";



    // ... (앞부분 로직은 그대로) ...

    const systemPrompt = `
   --- WORLD CONTEXT ---
    ${WORLD_BACKSTORY}

    --- LOCATION CONTEXT (${location}) ---
    ${FURNITURE_BACKSTORY[location] || ""}

    --- CHARACTER CONTEXT ---
    ${characterContext}

Mood: ${mood}

    GLOBAL LANGUAGE RULE:
    - ALL dialogue MUST be in ENGLISH.
    - Do NOT write sentences in Italian, Korean, or any other language.
    - Foreign words are only allowed as short exclamations (1-2 words).

    Rules:
    - Write 3-4 lines of dialogue. KEEP IT SHORT. Max 15-17 words per dialogue.
    - Format: "Name: Dialogue"
    - NO Markdown.
    - IMPORTANT: The Host (${location}) MUST speak at least once.
    - The Host should react to the guests or the situation.
    - DO NOT include characters NOT listed above.

    IMPORTANT SPEECH TRANSFORMATION RULE:

    All dialogue must be written as SPOKEN PERFORMANCE, not written prose.

    When a character feels:
    - unhappy → they interrupt, repeat, hesitate, and escalate
    - annoyed → short bursts, sharp stops, clipped phrases
    - judgmental → slow, deliberate phrasing with pauses
    - emotional → fragments, dashes, ellipses, repetition

    NEVER write neutral sentences like:
    "I am unhappy with this situation."

    Instead, transform the meaning into expressive speech like:
    "No—no. This is wrong. Completely wrong."

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
        // [수정됨] Audio 모델을 사용하여 '연기'를 시키는 코드
        // [수정 2] 성우(Audio Model)에게 짧고 굵게 연기하라고 지시
        // [수정 2] 억양 풀림 방지 코드
        // [수정 3] 악센트 풀림 방지 & 언어 고정 로직
        // [수정] 악센트 풀림 방지 "극약 처방" 적용
        const audioPromises = lines.map(async (line, index) => {
            const splitArr = line.split(/:(.+)/);
            if (splitArr.length < 2) return null;

            let speakerRaw = splitArr[0];
            let rawText = splitArr[1].trim();

            // -----------------------------------------------------------
            // [핵심 수정] 지문 제거 (Regex Cleaning)
            // 1. *sigh*, (laughs), [cough] 같은 괄호 안의 내용 삭제
            // 2. 불필요한 공백 정리
            // -----------------------------------------------------------
            let cleanText = rawText.replace(/[\(\[\*].*?[\)\]\*]/g, "").trim();
            
            // 지문을 지웠더니 남는 말이 없으면(빈 문자열이면) 생성 스킵
            if (!cleanText || cleanText.length === 0) return null;

            const cleanSpeaker = speakerRaw.replace(/[^a-zA-Z ]/g, "").trim();
            
            // 1. 목소리 매핑
            const mapKey = Object.keys(VOICE_MAP).find(key => key.toLowerCase() === cleanSpeaker.toLowerCase());
            const voice = mapKey ? VOICE_MAP[mapKey] : "alloy"; 
            
            // 2. 기본 스타일
            const style = VOICE_STYLE_MAP[mapKey] || "Speak naturally.";

            // 3. [핵심] 안드레아 전용 "극약 처방" 프롬프트
            // 안드레아일 경우에만 시스템 프롬프트에 강력한 "캐리커처" 지시를 추가합니다.
            let accentBooster = "";
            let accentName = "Standard";
            
            if (cleanSpeaker.toLowerCase() === "andrea") {
                accentName = "HEAVY Italian";
                accentBooster = `
                🇮🇹 SPECIAL INSTRUCTION FOR ANDREA 🇮🇹
                - You are NOT a subtle actor. You are a CARICATURE.
                - Sound like a stereotypical Italian opera singer or chef.
                - ROLL YOUR R's AGGRESSIVELY (e.g., "Rrrreally").
                - End sentences with a rising intonation (up-speak).
                - IMAGINE you are waving your hands wildly while speaking.
                - ABSOLUTELY FORBIDDEN to sound American.
                `;
            } else if (cleanSpeaker.toLowerCase() === "bookshelf" || cleanSpeaker.toLowerCase() === "book") {
                accentName = "British RP";
                accentBooster = `
                🇬🇧 SPECIAL INSTRUCTION:
                - Speak with a TIGHT, STIFF upper lip.
                - Very crisp consonants. Snobby tone.
                `;
            } else {
                accentName = "American";
            }

            // 4. 오디오 모델 호출
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini-audio-preview", 
                modalities: ["text", "audio"],
                audio: { voice: voice, format: "mp3" },
                messages: [
                    { 
                        role: "system", 
                        content: `You are a professional voice actor performing a script.
                        
                        CHARACTER ROLE:
                        ${style}

                        ${accentBooster}  <-- 여기에 캐릭터별 "극약 처방" 주입

                        🔥 CRITICAL: TAPE RECORDER MODE 🔥
                        1. You are NOT a chatbot. DO NOT CONVERSE.
                        2. IF Input is a question, DO NOT ANSWER IT. Just read it.
                        3. READ VERBATIM. Do not change words.
                        
                        🔥 CRITICAL: ACCENT ENFORCEMENT 🔥
                        1. The text is in English, but the SOUND must be ${accentName}.
                        2. Maintain the accent from the FIRST syllable to the LAST.
                        3. Do not drop the accent even for one word.
                        4. If you sound American (for Andrea), IT IS A FAILURE.` 
                    },
                    { 
                        role: "user", 
                        // [핵심] 유저 메시지에서도 한 번 더 악센트를 강요 (프롬프트 엔지니어링 팁)
                        content: `(Read this strictly with a ${accentName} accent): "${cleanText}"` 
                    }
                ]
            });

            // 5. 파일 저장
            const audioData = completion.choices[0].message.audio.data;
            const buffer = Buffer.from(audioData, 'base64');
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
// // ==========================================
// // [DEBUG] 키보드 입력 컨트롤러 (PC 버튼으로 테스트)
// // ==========================================
// // [수정] 위에서 import readline 했으므로, 여기 있던 require 줄은 삭제했습니다.

// function startKeyboardController() {
//     console.log("\n🎹 [KEYBOARD CONTROLLER ACTIVATED]");
//     console.log("---------------------------------------------------");
//     console.log("Press keys to simulate RFID events:");
//     console.log("[1] Put 'Andrea' on Desk");
//     console.log("[2] Put 'Bag' on Desk");
//     console.log("[3] Put 'Book' on Desk");
//     console.log("[4] Monitor enters (Interruption Test)");
//     console.log("[Space] Reset / Clear All");
//     console.log("[V] Voice Test Mode (Hear single lines)");
//     console.log("[Ctrl+C] Exit");
//     console.log("---------------------------------------------------");

//     readline.emitKeypressEvents(process.stdin);
//     if (process.stdin.isTTY) process.stdin.setRawMode(true);

//     process.stdin.on('keypress', async (str, key) => {
//         // key가 undefined일 경우 방지
//         if (!key) return; 

//         if (key.ctrl && key.name === 'c') {
//             process.exit();
//         }

//         // Reader ID "3" = Desk (책상)
//         const ID_ANDREA = "53 A0 94 65 21 00 01";
//         const ID_BAG = "53 5B 06 60 21 00 01";
//         const ID_BOOK = "53 B5 11 60 21 00 01";
//         const ID_MONITOR = "53 60 0B 60 21 00 01";

//         switch (key.name) {
//             case '1':
//                 console.log("\n👉 [Key 1] Andrea placed on Desk");
//                 handleSignal("3", ID_ANDREA);
//                 break;
//             case '2':
//                 console.log("\n👉 [Key 2] Bag placed on Desk");
//                 handleSignal("3", ID_BAG);
//                 break;
//             case '3':
//                 console.log("\n👉 [Key 3] Book placed on Desk");
//                 handleSignal("3", ID_BOOK);
//                 break;
//             case '4':
//                 console.log("\n⚡ [Key 4] Monitor INTERRUPTS!");
//                 handleSignal("3", ID_MONITOR);
//                 break;
//             case 'space':
//                 console.log("\n🔄 [Space] System Reset");
//                 resetSystem();
//                 break;
//             case 'v':
//                 console.log("\n🎤 [Voice Check] Testing 'Andrea' voice...");
//                 await testSingleVoice("Andrea", "Mamma mia! This is a test of my beautiful voice!");
//                 break;
//         }
//     });
// }

// // 목소리만 빠르게 들어보기 위한 단일 테스트 함수
// async function testSingleVoice(charName, sampleText) {
//     try {
//         const persona = PERSONA_DB[charName];
//         if(!persona) return console.log("No persona found");
        
//         console.log(`Generating audio for ${charName}...`);
        
//         // 1. 목소리 찾기
//         const mapKey = Object.keys(VOICE_MAP).find(k => k.toLowerCase() === charName.toLowerCase());
//         const voice = mapKey ? VOICE_MAP[mapKey] : "alloy";
//         const style = VOICE_STYLE_MAP[mapKey] || "";

//         // 2. 오디오 생성 (gpt-4o-audio-preview 사용)
//         const completion = await openai.chat.completions.create({
//             model: "gpt-4o-mini-audio-preview", // 혹은 gpt-4o-audio-preview
//             modalities: ["text", "audio"],
//             audio: { voice: voice, format: "mp3" },
//             messages: [
//                 { role: "system", content: `Perform this text. ${style}` },
//                 { role: "user", content: sampleText }
//             ]
//         });

//         // 3. 재생
//         const audioData = completion.choices[0].message.audio.data;
//         const buffer = Buffer.from(audioData, 'base64');
//         const fileName = path.resolve(`./test_voice_${Date.now()}.mp3`);
//         await fs.promises.writeFile(fileName, buffer);

//         console.log("▶️ Playing sample...");
//         await new Promise((resolve) => {
//             audioPlayer.play(fileName, () => {
//                 try { fs.unlinkSync(fileName); } catch(e) {}
//                 resolve();
//             });
//         });
//     } catch (e) {
//         console.error("Voice test failed:", e);
//     }
// }

// // 컨트롤러 시작
// startKeyboardController();