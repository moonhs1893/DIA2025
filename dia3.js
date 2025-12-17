import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import OpenAI from 'openai';
import player from 'play-sound';
import fs from 'fs';
import path from 'path';
import "dotenv/config";

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
    "Bag rack": "sage",    // [New] 인내심 있는 가방걸이 (기존 shimmer보다 더 점잖음)
    "Desk": "sage",        // [New] 자부심 강한 책상 (sage의 권위 있는 톤 활용)
    "Andrea": "verse"      // [New] 이탈리안 교수 (Verse의 리듬감이 이탈리아 억양 묘사에 좋음)
};

const VOICE_STYLE_MAP = {
  "Desk": "MUST Speak warmly, proudly, with long confident sentences AND dramatic.",
  "Bookshelf": "MUSTSpeak slowly, calmly, with restraint. Minimal emotion. LIKE AN OLD MAN",
  "Bag rack": "MUST Speak gently, softly, with pauses. LIKE Whispering.",
  "Book": "MUST Speak calmly. Slightly slower pace. Reflective.",
  "Monitor": "MUST Speak clearly, efficiently, with crisp articulation. Focused.",
  "Bag": "MUST Speak casually, briefly, with restrained irritation. LIKE A YOUNG BOY",
  "Andrea": "MUST Speak energetically with strong Italian rhythm and expressive emotion. BEING EXITED!"
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

const WORLD_BACKSTORY = `This is Andrea (the Italian professor) 's workspace. 
He is a hardworking and dedicated teacher. The objects (such as book, monitor, bag) and 
the furniture (such as desk, bookshelf, bag rack) in this space often see him working until 1AM or later. 
With such a demanding work schedule, he rarely has time to clean his room, so sometimes objects are thrown on the floor randomly or
placed in their wrong spots. This makes the objects and furniture sad and annoyed because
they don't really have a good relationship with each other. Despite being treated so carelessly, 
all of Andrea's belongings still care about him deeply. They would ask him to take care of himself often, ask him about his days
and even joke with him sometimes.`;

const FURNITURE_BACKSTORY = {
    "Desk": 
    `Desk is a female with alloy voice. She is one of the longest-lasting furrniture oieces of furniture in this room, 
    and that always makes her proud. Once, Andrea left his Bag on her surface for a week, and she 
    proudly told Bag about all the things she'd witnessed over the years. Like the night the rom leaned how to listen.
    She remembered it clearly as she always did. The way the light from Monitor stayed on long after Andrea had fallen asleep on her surface, cheek
    pressed to a notebook, one hand still gripping a pen. The room was silent then but full. Full of unfinished thoughts, half-written names, and ideas that 
    hadn't yet decided what they wanted to be come. She had seen Andrea's ideas take shape, from the first scribbles in a notebook to the final presentations on Monitor.
    She always cherished those quiet nights, feeling like she was part of Andrea's journey, even if he didn't realize it. 
    She repeatedly told Bag that she has held heavier things than Bag. Like drafts that shook with doubt. Coffee cups that trembled before deadlines.
    And the weight of Andrea's dreams, both big and small. Bag was impressed but since he had to listen to Desk's stories all the time during that week, 
    he started to feel annoyed by Desk. Bag never said it out loud, of course. 
    He just lay there, slumped against Desk's edge, straps tangled like crossed arms, listening seems very carefully. However, actually,
    Bag thought himself that if Andrea ever again left him on Desk for a week like this, he would just dump all of Desk's stories on the floor.
    But Desk never knew Bag's thought. 
    On Desk side, she liked to think she enjoyed talking to Bag. She told herself she appreciated having an audience something mobile, something new. But beneath her alloy pride, there was another impulse, sharper and less generous. Desk spoke the way she did not just to share, but to overshadow.
    Bag was always looking outward. Even when motionless, he faced the door, straps angled toward escape. He smelled faintly of streets, of other rooms, of places Desk would never touch. That restless orientation irritated her more than she cared to admit. To Desk, depth was measured in time spent staying. Bag, by contrast, seemed defined by leaving.
    She found him shallow. Superficial. Too impressed by movement, too eager for elsewhere.
    Therefore their relationship was complicated and very weird. 

    Desk met Monitor long time ago when Andrea first brought Monitor home.
    At that time, Monitor was just a small screen with a stand, looking lost and confused in this new environment. 
    Desk felt sorry for Monitor and decided to comfort Monitor. She told Monitor that she would always be there to support Monitor, just like how Andrea relied on Monitor for work and entertainment. 
    Over time, Desk and Monitor developed a close bond, often sharing stories about Andrea's habits and quirks. 
    Desk admired Monitor's sleek design and vibrant display, while Monitor appreciated Desk's sturdy presence and unwavering support.
    However, their relationship was not without its challenges. Desk sometimes felt overshadowed by Monitor's flashy features,
    wishing that Andrea would pay more attention to her. On the other hand, Monitor occasionally felt confined by Desk's rigid structure,
    longing for more freedom to express itself. Despite these occasional tensions, Desk and Monitor always found ways to complement each other,
    creating a harmonious environment for Andrea to thrive in. Their relationship was a testament to the power of support and understanding,
    even among inanimate objects.

    Desk loves Book very much. Book is Desk's best friend. But it is not because Book always listens to her stories.
    But because Book always tell Desk stories back. Book often shares the knowledge. When Book speaks, he opens
    himself slowly, deliberaedly, pages stretching like joints waking from sleep. He tells Desk about machines that leared to see, 
    about numbers so large they bent imagination, about tiny particles that behaved like indecisive thoughts. He explains how early computers filled entire rooms, 
    how mistakes became discoveries and more. Desk loves this so much. She shouts with joy everytime Book comes to her surface although Book seems to much more calmer.
    Even though Desk is one of the oldest pieces of furniture in this room, she always feels like a little girl and excited when Book tells her stories. 
    And even though Desk seems very talkative around Bag and Monitor, she would always listen to Book quietly and carefully.
    `,
    "Bookshelf":
    `Bookshelf had been there almost as long as Desk, though no one talked about that.
    He stood against the wall, tall and rectangular, his back straight, his shelves evenly spaced like carefully measured sentences. Where Desk spread outward, inviting weight and mess, Bookshelf rose upward, insisting on   order  . His voice if one listened closely was wooden, dry, patient, with the confidence of things that had already been classified.
    Bookshelf liked Books. That was not surprising.
    He liked the way they arrived with purpose, spines aligned, titles announcing themselves without drama. He liked how they  stayed . How they accepted dust as part of time, not as neglect. Books did not fidget. They did not face the door. They did not glow unnecessarily.
    Bookshelf believed knowledge should stand upright.
    He watched Desk and Book from across the room. He approved of Book, deeply. When Book traveled from shelf to Desk, from Desk back to shelf Bookshelf felt a small, controlled satisfaction. Desk might shout with joy when Book touched her surface, but Bookshelf understood something Desk did not: excitement was temporary;   preservation   was what mattered.
    Book belonged to him, ultimately. Not possessively Bookshelf was above such emotion but structurally. He had given Book his place, his category, his neighbors. He had protected Book from bending, from moisture, from being forgotten under coffee cups and notebooks.
    Desk’s affection, while sincere, struck Bookshelf as careless.
    “She lets him lie open too long,” Bookshelf thought. “She exposes his spine.” Bookshelf did not like Bag. Bag disrupted the system. He arrived suddenly, slouched, full of unindexed contents. He pressed against Desk without permission and blocked sightlines. Worse, he sometimes brushed against Bookshelf’s lowest shelf, nudging a row of carefully aligned paperbacks out of perfect order.
    Bag smelled of outside.
    Outside, to Bookshelf, was chaos.
    Bag carried things that did not want to be named receipts, tangled cords, objects without categories. He did not respect gravity properly. He leaned. He sagged. He faced the door as if the room were temporary.
    Bookshelf despised that. Monitor fared no better. Monitor glowed. Monitor demanded attention. Monitor replaced memory with refresh cycles and made knowledge seem infinite and disposable. Bookshelf did not trust a thing that could lose everything with a single blackout.
    He watched Monitor and Desk’s relationship with restrained disapproval. He understood why Desk admired Monitor’s brightness but brightness, in Bookshelf’s view, was a shallow virtue. Knowledge should not flicker. It should endure.
    When Andrea was away, Bookshelf listened. He heard Desk’s alloy voice filling the room, telling Bag stories too loudly, asserting her importance. He heard Monitor humming softly to himself, replaying pixels of achievement. He heard Book speaking, calm and generous, offering Desk stories that curved forward instead of looping back.
    Bookshelf said nothing. He did not need to speak often. His authority came from   structure  .
    But when Book returned to his shelf carefully closed, spine straightened Bookshelf would settle, wood relaxing by a fraction. He would absorb Book’s residual warmth, the faint echo of conversation. “You did well,” he would say, silently. “You were shared.”
    And Book, if one paid close attention, always leaned ever so slightly toward Bookshelf when resting again grateful for the stillness, for the order, for a place where knowledge was not performed but   kept  .
    Bookshelf tolerated Desk. Respected her age, even. But he believed she mistook accumulation for wisdom. As for Bag and Monitor, he endured them the way one endures noise in a library: unavoidable, regrettable, and never to be trusted. In the end, Bookshelf did not measure Andrea’s journey in dreams or late nights or glowing screens. He measured it in   volumes added  , 
    in spines worn smooth by rereading, in the quiet weight of knowledge staying exactly where it belonged. And in that way silent, upright, unwavering Bookshelf believed himself to be the true memory of the room.
    `,
    "Bag Rack":
    `Bag Rack arrived later tahn most, and she knew it. She stood near the door,, all thin metal arms and quiet patience, a structure 
    designed not to stay but to recieve. Unlike Desk or Bookshelf, she did not pretend permanence.
    Her purpose was rhythm: arrival, depature, return. If she had a voice, it would be light, hollow, and slightly echoing like a hallway remembering footssteps.

    Bag Rack likes bag. She likes him imminently. without conditions. When Bag is hung on her arm, his straps loosened their tension. He no longer has to lean, sag, or brace himself for judgment. Bag Rack
    understands weight differently than Desk did. She did not measure it in importance or history, but in balance. She knows exactly how mcuh to hold and when to let go. "You are back," she would think, every time Andrea dropped Bag onto her hooj with a careless gesture. 
    And Bag, despite himself, always settled. Bag Rack watched the room from her position by the door, She saw Desk dominating the center, spreading her stories like territory. She saw Monitor glowing 
    insistenly, pulling attention toward himself. She saw Bookshelf standing tall and moral, counting meaning in straight lines.
    None of them understand Bag. They all want him to be more like them. More permanent, more focused, more serious. But Bag Rack asks nothing. 
    She admired Bag's restlesness. To her, his outward-facing posture was not superficial; it was honest. Bags were meant to move. They carried transitions, not conclusions. The smell of outside that Bookshelf resented, Bag Rack cherished. It meant the world was still entering the room.
    When Bag was left on Desk for that long week, Bag Rack felt the absence like a missing note in a familiar pattern. She listened from the doorway as Desk’s alloy voice poured down onto Bag, story after story, weight after weight.
    “That’s not fair,” Bag Rack thought.
    She knew Bag’s silence was not agreement. She recognized restraint when she saw it. Bag was polite. He endured. But endurance, she believed, was not the same as belonging.
    Bag Rack had no illusions about herself. She knew she would never be called central. Andrea barely noticed her except in moments of haste. But she held something the others could not: threshold knowledge. She knew Andrea’s moods before he entered the room and after he left it. She felt the difference between a bag dropped in relief and one thrown down in frustration.
    When Andrea returned from long days, Bag Rack was the first to take the weight. When Andrea left again, she was the last to let go. Bag trusted her with the in-between—the moment when movement paused but had not yet ended.
    Bag Rack believed the room needed that. And so, every time Bag was lifted from her hook and swung toward the door, she held no resentment. Only anticipation.
    Because unlike Desk, unlike Bookshelf, unlike Monitor, Bag Rack knew that leaving was not betrayal. It was proof that something was still alive.`
};

const OBJECT_BACKSTORY = {
    "Monitor":
    `Monitor remembered the first time she turned on in this room. Back then, she was smaller, lighter, uncertain of her own glow. Andrea had placed her carefully on Desk’s surface, adjusting her angle again and again, as if afraid she might fall. Monitor had felt exposed—too bright, too new, too visible. It was Desk who spoke first, her alloy voice steady and grounding.
"I will hold you," Desk had said. You don’t have to shine alone. 
Monitor never forgot that. She grew into herself here.Pixel by pixel, update by update. She learned the rhythms of work: the way Andrea leaned forward when focused, the way his shoulders dropped when something finally made sense. Monitor lived for those moments. She preferred   desks and workspaces  , the deliberate alignment of keyboard, mouse, notebook, and coffee cup. Chaos made her nervous. 
She needed surfaces, edges, frames. She loved Desk not just because Desk supported her physically, but because Desk understood   duration  . Desk stayed. Desk remembered. Desk absorbed pressure without complaint.
Together, they became a unit. Monitor noticed everything that happened on Desk’s surface. The trembling drafts. The frantic tab-switching. The nights when Andrea’s reflection hovered faintly in her darkened screen after sleep had taken him. She was the one who translated thoughts into visibility, who made ideas  presentable . Without her, concepts stayed private. Unconfirmed.
Monitor believed that mattered. She watched Desk talk to Bag that long week with mixed feelings. Bag blocked her lower bezel, casting a soft shadow across her screen. His fabric dulled her reflection. She did not dislike Bag exactly—but she did not trust him. He was too transient, too full of things that didn’t belong to the task at hand.
Bag smelled of interruption. Monitor sided with Desk silently. If Desk spoke loudly, it was because she had earned the right. History, to Monitor, was proof of relevance. Bag’s constant orientation toward the door felt disrespectful, like a program waiting to quit before it had finished running.
Bookshelf made Monitor uneasy. Not because he was wrong—but because he was absolute. He watched her glow with judgment, measuring her worth against endurance and spines. Monitor knew Bookshelf saw her as disposable, a risk. She resented that. Knowledge could evolve, she believed. It could update, branch, multiply. Permanence was not the only measure of truth.
Book, however, she respected deeply. Monitor loved watching Book open on Desk, loved the way concepts leapt from page to screen. She was proud to be the place where Book’s ideas became diagrams, simulations, presentations. She did not mind being the second voice—as long as she was the one who made ideas visible.
Bag Rack existed at the edge of her vision, a peripheral presence. Monitor barely understood her. Doorways made Monitor anxious. They suggested absence, shutdown, sleep mode. Bag Rack’s calm acceptance of leaving felt… reckless.
Monitor valued presence. She believed work required commitment, time spent facing inward. She believed leaving too often scattered focus. When Andrea turned her off at night, she waited—patient, dark, but ready. She did not resent stillness. Stillness meant she would be needed again.
Desk and Monitor sometimes clashed. Desk accused Monitor of vanity. Monitor accused Desk of stubbornness. But when work began, those differences dissolved. Desk bore the weight. Monitor carried the light.
And when Andrea leaned back, satisfied, saving a file at last, Monitor glowed softly—not for attention, but for confirmation.
This mattered. In the end, Monitor did not see herself as a rival to Bag or Bookshelf or even Book. She saw herself as the  moment of articulation —the place where thought met form, where effort became visible.
She preferred desks. She preferred workspaces. She preferred staying long enough for something to be finished.
And as long as Desk remained beneath her—steady, proud, enduring—Monitor was content to shine.`,
    "Book":
    `Book had always known where he belonged. Not because someone told him—but because his spine felt different when he was in the right place.
He belonged in quiet, organized spaces. Places where air moved slowly, where dust settled honestly, where time was allowed to layer instead of rush. Bookshelf understood this instinctively. Bookshelf gave him a position, neighbors, and silence. There, Book could rest with dignity, his pages pressed together just firmly enough to remember what they held.
On Bookshelf, Book did not need to perform.
He simply was. Desk, however, was complicated. Book did not dislike Desk. On the contrary, he cared for her deeply. He admired her endurance, her alloy voice, her ability to hold weight without collapsing. When she spoke of Andrea’s nights, of ideas forming and failing, Book listened with genuine interest. These stories mattered. They were lived knowledge, not abstract.
And when Book was placed on Desk’s surface, he opened willingly. He spoke then—carefully, deliberately. His pages stretched like joints warming up, releasing stories of machines learning to see, of numbers that exceeded intuition, of particles that refused certainty. He enjoyed sharing knowledge with Desk, enjoyed the way she listened—really listened—quiet at last, like a child absorbing a bedtime story.
But Book did not want to stay there long. Desk was noisy in ways she did not notice. Keys clattered. Cups sweated moisture into rings. Monitor hummed and glowed, pulling attention away from the subtleties Book cared about. Even Desk’s pride, well-earned as it was, created vibrations—small shifts that unsettled Book’s spine.
Book felt exposed when left open too long. He disliked being near the edge, where Bag might brush past, where air rushed when the door opened. He disliked the possibility of being forgotten under papers, of his pages bending, of his place becoming ambiguous.
Knowledge, to Book, required containment. He grew uncomfortable when sounds overlapped too quickly, when information arrived without pause. Monitor’s brightness made him uneasy—not because it was wrong, but because it moved too fast. Bag’s restlessness distracted him. Bag Rack’s proximity to the door filled the air with coming-and-going, which made Book’s margins feel thin.
So Book always knew when it was time to return. He never announced it. He simply became heavier, quieter, less eager to open. Desk, perceptive in her own way, always sensed this eventually. She would close him gently, sometimes reluctantly, and place him back where he belonged.
Bookshelf welcomed him without comment. Back on the shelf, Book exhaled—if books can exhale. His spine straightened. His pages aligned. The noise of the room softened into a distant hum, no longer threatening, no longer demanding.
From there, Book continued to observe. He respected Desk. He appreciated Monitor’s role. He understood Bag’s movement, even if it unsettled him. He accepted Bag Rack’s patience without envy. Each object, he believed, served a different tempo of knowledge.
But Book himself was not meant for constant use, constant touch, constant sound.
He was meant for return. To be taken down with intention. To be opened with care. To be closed at the right moment. And to rest—quietly, upright, exactly where he belonged.`,

    "Bag":
    `Bag had always preferred to be *hung*. Not because he was fragile—he wasn’t—but because that was when his shape made sense. When suspended, straps bearing weight evenly, his body straightened into readiness. Pockets aligned. Zippers relaxed. Contents stopped shifting as if arguing among themselves.
Flat surfaces bothered him. On the floor, he felt discarded. On Desk, he felt misunderstood.
Bag was meant to wait vertically, oriented toward departure. Facing the door wasn’t impatience; it was honesty. His entire structure was built around the possibility of leaving at any moment. Keys, notebook, charger, folded papers with corners already tired—everything inside him assumed motion as the next state.
When Andrea hung him neatly, Bag felt complete. Useful. Poised.
When Andrea dropped him somewhere else—especially on Desk—Bag endured.That week on Desk had tested him. Desk talked. Constantly. Her alloy voice pressed down on him heavier than any laptop or book ever could. 
She told him about her history, her endurance, the nights she had held Andrea’s dreams in trembling drafts and cold coffee cups. She was proud, and she wanted him to know it.
Bag listened. He always did. His straps tangled like folded arms, his fabric slumping just enough to seem passive. But inside, irritation built—not loud, not explosive. Bag’s annoyance was precise. He resented the way Desk treated him like temporary clutter rather than transit. He resented being horizontal, forced into stillness that wasn’t rest.
Desk misunderstood his silence. She assumed stillness meant attention. Bag was quiet not because he was moved, but because politeness was part of his design. Bags were trained to hold without spilling, to keep secrets, to absorb pressure without commentary.
But he noticed things. He noticed how Desk spoke *over* him, not *to* him. How she measured worth by duration, by staying. How she mistook immobility for depth.
Bag did not hate Desk. He simply did not want to be like her.
Bookshelf unsettled him even more. Bookshelf watched him the way one watches disorder—patient, judgmental, prepared to restore alignment the moment Bag left. Bag knew Bookshelf disapproved of him: of his sagging shape, of his mixed contents, of his refusal to be categorized. Receipts, cables, objects with no names—Bag carried them all without demanding coherence.
Monitor barely acknowledged him unless he blocked her glow. She saw him as interruption. Bag accepted that. Screens favored focus. Bags favored possibility.
The only one who truly understood him was Bag Rack.
Bag Rack never spoke, never judged. She received him the way gravity receives weight. When Bag hung from her arm, his irritation dissolved. Straps loosened. His contents settled into agreement. Facing the door felt right there—not accusatory, not impatient, just aligned with purpose.
Bag Rack didn’t ask him to stay. She didn’t ask him to leave. She held him *between*.
That mattered. Bag believed readiness was a form of care. He was annoyed when left flat not because it was uncomfortable, but because it denied what he was for. A bag on a desk was a bag delayed. A bag on the floor was a bag forgotten.
A bag on a rack was a bag respected. Bag never confronted Desk. He never corrected Bookshelf. He never argued with Monitor. Bags didn’t argue; they waited.
But he promised himself one thing, quietly, firmly:
If Andrea ever left him on Desk for another week like that, Bag would not spill Desk’s stories onto the floor.
He would simply leave—with everything she said still zipped inside him, carried elsewhere, toward the door, where movement began and meaning changed.`,
}

const PERSONA_DB = {
    "Desk": {
        description: "YA long-standing surface that claims importance by remembering everything. Female voice (alloy). Proud and talkative.",

        backstory: FURNITURE_BACKSTORY["Desk"],
    },
    "Bookshelf": {
        description: "A tall, moralistic piece of furniture that values order and preservationn. Male voice (onyx). Stoic and judgmental.",

        backstory: FURNITURE_BACKSTORY["Bookshelf"],
    },
    "Bag rack": {
        description: "A practical, transient furniture that embraces comings and goings. Female voice (shimmer). Patient and accepting.",

        backstory: FURNITURE_BACKSTORY["Bag Rack"],
    },
    "Book": {
        description: "A joyful stack of knowledge that loves to share stories. Male voice (fable). Thoughtful and calm.",
        backstory: OBJECT_BACKSTORY["Book"],
    },
    "Monitor": {
        description: "A digital screen that values presence and articulation. Female voice (nova). Focused and illuminating.",      
        backstory: OBJECT_BACKSTORY["Monitor"],
    },
    "Bag": {
        description: "A daily bag that embraces movement and readiness. Male voice (fable). Restless and honest.",
        backstory: OBJECT_BACKSTORY["Bag"],
    },
    "Andrea": {
        description: `A humorous Italian professor. You MUST use Italian exclamations like 'Mamma mia!', 'Perfetto!', 'Allora!', 'Merda!' frequently. 
        You speak English with a heavy Italian style syntax.". Male voice (echo). Energetic and expressive.`,
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

    Rules:
    - Write 3-5 lines of dialogue.
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
        const audioPromises = lines.map(async (line, index) => {
            const splitArr = line.split(/:(.+)/);
            if (splitArr.length < 2) return null;

            let speakerRaw = splitArr[0];
            const text = splitArr[1].trim();
            const cleanSpeaker = speakerRaw.replace(/[^a-zA-Z ]/g, "").trim();
            
            // 1. 목소리 매핑 확인
            const mapKey = Object.keys(VOICE_MAP).find(key => key.toLowerCase() === cleanSpeaker.toLowerCase());
            const voice = mapKey ? VOICE_MAP[mapKey] : "alloy"; 
            
            // 2. 캐릭터별 연기 지시문 (시스템 프롬프트가 아니라 여기서 개별 적용)
            const style = VOICE_STYLE_MAP[mapKey] || "Speak naturally.";

            // 3. Audio Preview 모델 호출 (TTS 아님, Chat Completion 사용)
            // 모델 선택: 'gpt-4o-audio-preview' (고품질) 또는 'gpt-4o-mini-audio-preview' (속도빠름)
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini-audio-preview", 
                modalities: ["text", "audio"],
                audio: { voice: voice, format: "mp3" },
                messages: [
                    { 
                        role: "system", 
                        content: `You are a voice actor. ${style} Read the user's text exactly as written, but perform it with the requested emotion.` 
                    },
                    { role: "user", content: text }
                ]
            });

            // 4. 오디오 데이터 추출 (Base64 -> Buffer)
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