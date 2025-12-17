import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import OpenAI from 'openai';
import player from 'play-sound';
import fs from 'fs';
import path from 'path';
import "dotenv/config";
import readline from 'readline';

// --- [1] 설정 ---
const SERIAL_PORT_PATH = '/dev/cu.usbmodem21201'; 
const BAUD_RATE = 9600;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- [2] 오브젝트 및 목소리 매핑 ---

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

// 캐릭터별 목소리 (모델)
const VOICE_MAP = {
    "Book": "ash",         
    "Bag": "ballad",       
    "Monitor": "coral",    
    "Bookshelf": "onyx",   
    "Bag rack": "sage",    
    "Desk": "sage",        
    "Andrea": "verse"      
};

// [수정 1] Voice Style Map을 더 직관적이고 강력하게 변경
// "Standard Accent" 같은 점잖은 표현 대신 "Exaggerated(과장된)" 표현 사용
const VOICE_STYLE_MAP = {
  "Desk": "Act like a DRAMATIC MOTHER. Warm but very loud and fast. Standard American.",
  "Bookshelf": "Act like a SNOBBY BRITISH BUTLER. Very dry, clipping words short. British RP Accent.",
  "Bag rack": "Act like a GHOST WHISPERING. Breathless and quick. Soft British.",
  "Book": "Act like a WISE OLD SCHOLAR. British Accent. Calm but rushing to explain.",
  "Monitor": "Act like a BREAKING NEWS ANCHOR. American Accent. Extremely fast and crisp.",
  "Bag": "Act like a COMPLAINING TEENAGER. Slangy American. Fast, annoyed, snapping.",
  // [핵심] 안드레아: "Heavy"를 넘어 "Caricature(캐리커처)" 수준으로 요구
  "Andrea": "Act like a STEREOTYPICAL ITALIAN CHEF. Exaggerate the accent heavily. Rolled Rs. Emotional and loud."
};


const WORLD_BACKSTORY = `This is Andrea's workspace. Objects are alive.`;

const FURNITURE_BACKSTORY = {
    "Desk": `Desk is proud and motherly.`,
    "Bookshelf": `Bookshelf is strict and orderly.`,
    "Bag rack": `Bag rack is patient and observant.`
};

const OBJECT_BACKSTORY = {
    "Monitor": `Monitor is focused and bright.`,
    "Book": `Book is wise and calm.`,
    "Bag": `Bag is restless and annoyed.`
};

// [수정 2] 페르소나 DB: 안드레아에게 '발음대로 쓰기' 강제
const PERSONA_DB = {
    "Desk": { description: "Proud, motherly. English only.", backstory: FURNITURE_BACKSTORY["Desk"] },
    "Bookshelf": { description: "Strict, British. English only.", backstory: FURNITURE_BACKSTORY["Bookshelf"] },
    "Bag rack": { description: "Patient, whispering. English only.", backstory: FURNITURE_BACKSTORY["Bag Rack"] },
    "Book": { description: "Wise, British. English only.", backstory: OBJECT_BACKSTORY["Book"] },
    "Monitor": { description: "Bright, fast. English only.", backstory: OBJECT_BACKSTORY["Monitor"] },
    "Bag": { description: "Restless, annoyed. English only.", backstory: OBJECT_BACKSTORY["Bag"] },
    "Andrea": {
        description: `Humorous Italian professor. 
        CRITICAL RULE: You must write in "EYE DIALECT". 
        This means spelling words how they sound in an Italian accent.
        Example: Write "It's-a me!" instead of "It's me".
        Write "I am-a so tired" instead of "I am so tired".
        Use English words, but Italian grammar/spelling flavor.`,
        backstory: `Andrea is a hardworking Italian professor.`,
    }
};

let currentReader = null;
let currentTags = new Set();
let bufferTimer = null;      
let interactionTimer = null; 
let audioQueue = [];         
let isPlaying = false;       
let currentAudioProcess = null; 
let conversationHistory = ""; 

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const audioPlayer = player({});

console.log("System Started. Robust Accent Mode.");

function handleSignal(readerId, tagUid) {
    const readerName = READERS[readerId];
    const tagName = TAGS[tagUid];

    if (!readerName || !tagName) return;

    console.log(`Input: ${readerName} detected ${tagName}`);

    if (currentReader !== readerName) {
        console.log(">>> New Location! Resetting...");
        resetSystem(); 
        currentReader = readerName;
        currentTags.add(tagName);
        
        if (bufferTimer) clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => {
            generateAndPlayDialogue(false); 
        }, 2000);
        return;
    }

    if (!currentTags.has(tagName)) {
        console.log(`>>> New Object (${tagName}) Entered!`);
        currentTags.add(tagName);
        if (bufferTimer) return; 
        if (interactionTimer) {
            console.log("!!! INTERRUPTION !!!");
            stopAudio(); 
            generateAndPlayDialogue(true, tagName); 
        }
    }
}

// --- [대화 생성 및 오디오 변환] ---
async function generateAndPlayDialogue(isInterruption, newComerName = "") {
    bufferTimer = null;

    if (interactionTimer) clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => {
        console.log("--- Session Timeout ---");
        interactionTimer = null;
        currentReader = null;
        currentTags.clear();
        conversationHistory = "";
    }, 35000);

    const tagsArray = Array.from(currentTags);
    const location = currentReader;
    const activeCharacters = [location, ...tagsArray]; 
    
    let characterContext = "";
    activeCharacters.forEach(charName => {
        const persona = PERSONA_DB[charName];
        if (!persona) return;
        characterContext += `<${charName}> ${persona.description} </${charName}>\n`;
    });

    // [수정 3] Writer 프롬프트: '대본 자체를 억양 있게 써라'고 지시
    const systemPrompt = `
    Context: Objects talking to Andrea.
    Characters: ${activeCharacters.join(', ')}
    ${characterContext}

    🔥 RULES FOR SCRIPT WRITING 🔥
    1. KEEP IT SHORT. Max 10 words per line.
    2. PING-PONG STYLE. Fast exchanges.
    3. LANGUAGE: English ONLY.
    
    4. **PHONETIC SPELLING FOR ANDREA**:
       - If Andrea speaks, write the text so it *looks* like an accent.
       - "I cannot do this" -> "I can-not do dis!"
       - "Please stop" -> "Plis-a stop, eh?"
       - This guarantees the accent stays strong.

    Format: "Name: Dialogue"
    `;

    const userMessage = isInterruption
        ? `STOP! ${newComerName} entered! Short reaction.`
        : `Start short conversation.`;

    try {
        console.log("🚀 Generating Script...");
        
        const gptResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            max_tokens: 150 
        });

        const script = gptResponse.choices[0].message.content;
        console.log("--------------------------------");
        console.log(script);
        console.log("--------------------------------");
        conversationHistory = script; 

        const lines = script.split('\n').filter(l => l.includes(':'));
        console.log(`⚡️ Requesting ${lines.length} audio files...`);

        // [수정 2] Audio Loop: 안드레아가 아닌 경우 '이탈리아 금지령' 선포
        const audioPromises = lines.map(async (line, index) => {
            const splitArr = line.split(/:(.+)/);
            if (splitArr.length < 2) return null;

            let speakerRaw = splitArr[0];
            const text = splitArr[1].trim();
            const cleanSpeaker = speakerRaw.replace(/[^a-zA-Z ]/g, "").trim();
            
            const mapKey = Object.keys(VOICE_MAP).find(key => key.toLowerCase() === cleanSpeaker.toLowerCase());
            const voice = mapKey ? VOICE_MAP[mapKey] : "alloy"; 
            
            // 스타일 가져오기
            const style = VOICE_STYLE_MAP[mapKey] || "Speak fast.";

            // [핵심] 안드레아 격리 로직
            // 현재 말하는 사람이 안드레아가 아니면, "이탈리아 억양 금지" 문구를 추가함
            let antiItalianAuth = "";
            if (cleanSpeaker.toLowerCase() !== "andrea") {
                antiItalianAuth = `
                ⚠️ NEGATIVE CONSTRAINT:
                - ABSOLUTELY DO NOT SOUND ITALIAN.
                - DO NOT ROLL YOUR R's.
                - If you sound even slightly Italian, it is WRONG.
                - Stick strictly to your requested accent (American or British).
                `;
            }

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini-audio-preview", 
                modalities: ["text", "audio"],
                audio: { voice: voice, format: "mp3" },
                messages: [
                    { 
                        role: "system", 
                        content: `You are a CARICATURE VOICE ACTOR. 
                        
                        YOUR ROLE: ${style}
                        ${antiItalianAuth}  // <-- 여기에 격리 명령 추가됨

                        PERFORMANCE INSTRUCTIONS:
                        1. SPEED: Rushed, Panic mode. Speak immediately.
                        2. DO NOT NORMALIZE the text.
                        3. EMOTION: High energy.` 
                    },
                    { role: "user", content: text }
                ]
            });

            const audioData = completion.choices[0].message.audio.data;
            const buffer = Buffer.from(audioData, 'base64');
            const fileName = path.resolve(`./temp_${Date.now()}_${index}.mp3`);
            await fs.promises.writeFile(fileName, buffer);
            
            return fileName;
        });


        playAudioSequence(audioPromises);

    } catch (e) {
        console.error("AI/TTS Error:", e);
    }
}

async function playAudioSequence(promiseArray) {
    stopAudio();
    isPlaying = true;
    const currentQueueId = Date.now();
    audioQueue = currentQueueId; 

    for (const promise of promiseArray) {
        try {
            const fileName = await promise; 
            if (!fileName) continue; 
            if (!isPlaying || audioQueue !== currentQueueId) break; 

            console.log(`▶️ Playing: ${path.basename(fileName)}`);
            await new Promise((resolve) => {
                currentAudioProcess = audioPlayer.play(fileName, (err) => {
                    resolve();
                });
            });
            try { fs.unlinkSync(fileName); } catch(e) {}
        } catch (error) {
            console.error("Playback error:", error);
        }
    }
    if (audioQueue === currentQueueId) isPlaying = false;
}

function stopAudio() {
    isPlaying = false;
    audioQueue = null; 
    if (currentAudioProcess) {
        currentAudioProcess.kill();
        currentAudioProcess = null;
    }
}

function resetSystem() {
    stopAudio();
    if (bufferTimer) clearTimeout(bufferTimer);
    if (interactionTimer) clearTimeout(interactionTimer);
    currentReader = null;
    currentTags.clear();
    conversationHistory = "";
}

function startKeyboardController() {
    console.log("\n🎹 [KEYBOARD CONTROLLER] 1:Andrea, 2:Bag, 3:Book, 4:Monitor, Space:Reset");
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on('keypress', async (str, key) => {
        if (!key) return; 
        if (key.ctrl && key.name === 'c') process.exit();

        const ID_ANDREA = "53 A0 94 65 21 00 01";
        const ID_BAG = "53 5B 06 60 21 00 01";
        const ID_BOOK = "53 B5 11 60 21 00 01";
        const ID_MONITOR = "53 60 0B 60 21 00 01";

        switch (key.name) {
            case '1': console.log("[1] Andrea -> Desk"); handleSignal("3", ID_ANDREA); break;
            case '2': console.log("[2] Bag -> Desk"); handleSignal("3", ID_BAG); break;
            case '3': console.log("[3] Book -> Desk"); handleSignal("3", ID_BOOK); break;
            case '4': console.log("[4] Monitor Interruption"); handleSignal("3", ID_MONITOR); break;
            case 'space': console.log("[Space] Reset"); resetSystem(); break;
        }
    });
}

startKeyboardController();