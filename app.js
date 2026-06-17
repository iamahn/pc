// =====================================
// AUDIO CONTEXT CONFIG
// =====================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.5;
masterGain.connect(audioCtx.destination);

// =====================================
// COUNTING VOICE
// =====================================
const voiceUrls = {
	1: 'https://iamahn.github.io/beat/counting_voice/(female)01.wav', 
	2: 'https://iamahn.github.io/beat/counting_voice/(female)02.wav',
	3: 'https://iamahn.github.io/beat/counting_voice/(female)03.wav',
	4: 'https://iamahn.github.io/beat/counting_voice/(female)04.wav',
	5: 'https://iamahn.github.io/beat/counting_voice/(female)05.wav',
	6: 'https://iamahn.github.io/beat/counting_voice/(female)06.wav',
	7: 'https://iamahn.github.io/beat/counting_voice/(female)07.wav',
	8: 'https://iamahn.github.io/beat/counting_voice/(female)08.wav',
	9: 'https://iamahn.github.io/beat/counting_voice/(female)09.wav'
};
let voiceBuffers = {};
let currentVoiceSource = null;
let currentVoiceGain = null;

async function loadHumanVoices() {
    for (let beat in voiceUrls) {
        try {
            const response = await fetch(voiceUrls[beat]);
            const arrayBuffer = await response.arrayBuffer();
            voiceBuffers[beat] = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.error(`${beat}번 음성 파일을 불러오는데 실패했습니다:`, e);
        }
    }
}
loadHumanVoices();

function playVoice(beatNumber, time) {
    if (!voiceBuffers[beatNumber]) return;

    const source = audioCtx.createBufferSource();
    const voiceGain = audioCtx.createGain();
    
    source.buffer = voiceBuffers[beatNumber];
    voiceGain.gain.setValueAtTime(1.0, time);
    
    // 🎯 피치 변경 로직 삭제 (BPM에 상관없이 항상 원본 피치 1.0 유지)
    
    source.connect(voiceGain);
    voiceGain.connect(masterGain);
    source.start(time);
}

// =====================================
// DOM ELEMENTS MATRIX
// =====================================
const bpmInput = document.getElementById("bpm");
const beatsInput = document.getElementById("beats");
const subdivisionInput = document.getElementById("subdivision");
const soundTypeInput = document.getElementById("soundType");
const accentInput = document.getElementById("accent");
const volumeInput = document.getElementById("volume");
const visualizer = document.getElementById("visualizer");

const timerEnable = document.getElementById("timerEnable");
const timerMinutes = document.getElementById("timerMinutes");
const bpmHub = document.getElementById("bpmHub");
const bpmValue = document.getElementById("bpmValue");

const bpmUpBtn = document.getElementById("bpmUpBtn");
const bpmDownBtn = document.getElementById("bpmDownBtn");
const bpmMinus10Btn = document.getElementById("bpmMinus10Btn");
const bpmMinus5Btn = document.getElementById("bpmMinus5Btn");
const bpmPlus5Btn = document.getElementById("bpmPlus5Btn");
const bpmPlus10Btn = document.getElementById("bpmPlus10Btn");
const timerDisplay = document.getElementById("timerDisplay");
const trainingInfo = document.getElementById("trainingInfo");

const trainingModeCheck = document.getElementById("trainingMode");
const startBpmInput = document.getElementById("startBpm");
const targetBpmInput = document.getElementById("targetBpm");
const stepBpmInput = document.getElementById("stepBpm");
const barsPerStepInput = document.getElementById("barsPerStep");
const measureInput = document.getElementById("measure");

// =====================================
// 🎯 ULTRA-ACCURATE SCHEDULER STATE ENGINE
// =====================================
let isRunning = false;
let schedulerIntervalId = null; 
let timerId = null;
let timerRemaining = 0;

const lookahead = 25.0;       // 스케줄러가 깨어나는 주기 (ms)
const scheduleAheadTime = 0.1 // 미래 예약을 걸어둘 버퍼 시간 (seconds)
let nextNoteTime = 0.0;       // 다음 박자가 울려야 할 하드웨어 절대 시간 (seconds)

let currentStep = 0;
let totalSteps = 0;
let currentBar = 0;
let currentBpm = 120;
let tapTimes = [];

let trainingEnabled = false; 
let barsCompleted = 0;
let totalBarsCompleted = 0;  
let totalTrainingBars = 0;   
let targetBpm = 0;
let bpmIncrement = 0;
let barsPerStep = 0;

let bpmHoldInterval = null;
let bpmHoldTimeout = null;
let bpmHoldDirection = 0;

let allSubdivisionOptions = [];

// =====================================
// 🎯 SUBDIVISION DROPDOWN FILTER
// =====================================
function updateSubdivisionOptions() {
    if (!subdivisionInput || !beatsInput) return;

    if (allSubdivisionOptions.length === 0) {
        allSubdivisionOptions = Array.from(subdivisionInput.querySelectorAll("option"));
    }

    const timeSig = beatsInput.value;
    let targetClass = "sub-common";
    if (timeSig === "6/8") targetClass = "sub-68";
    if (timeSig === "2/2") targetClass = "sub-22";

    subdivisionInput.innerHTML = "";
    let firstMatchValue = null;
    allSubdivisionOptions.forEach(opt => {
        if (opt.classList.contains(targetClass)) {
            const clone = opt.cloneNode(true);
            clone.hidden = false;
            clone.style.display = "block";
            clone.disabled = false;
            subdivisionInput.appendChild(clone);
            if (!firstMatchValue) firstMatchValue = clone.value;
        }
    });

    if (firstMatchValue) subdivisionInput.value = firstMatchValue;
    
    // 스텝 수 즉시 재계산
    const beats = getBeatsCount();
    const subdivision = Math.ceil(parseFloat(subdivisionInput.value) || 1);
    totalSteps = beats * subdivision;
}

function getBeatsCount() {
    return parseInt(beatsInput.value.split('/')[0]) || 4;
}

// =====================================
// VISUALIZER GENERATOR
// =====================================
function createVisualizer() {
    if (!visualizer) return; 
    visualizer.innerHTML = "";

    const beats = getBeatsCount();
    const subdivision = Math.ceil(parseFloat(subdivisionInput.value) || 1);
    totalSteps = beats * subdivision;

    const measureRow = document.createElement('div');
    measureRow.className = 'measure-row current-measure';

    const counterDiv = document.createElement('div');
    counterDiv.className = 'measure-counter';
    counterDiv.id = 'liveMeasureCounter';
    counterDiv.innerText = "1"; 
    measureRow.appendChild(counterDiv);

    for (let b = 0; b < beats; b++) {
        const box = document.createElement("div");
        box.className = "beat-box";
        box.setAttribute("data-sub", subdivision); 

        for (let s = 0; s < subdivision; s++) {
            const dot = document.createElement("div");
            dot.className = "dot";
            box.appendChild(dot);
        }
        measureRow.appendChild(box);
    }
    visualizer.appendChild(measureRow);
    
    if (currentStep >= totalSteps) currentStep = 0;
}

function updateVisualizerUI(step) {
    if (!visualizer) return;
    const dots = visualizer.querySelectorAll(".dot");
    const boxes = visualizer.querySelectorAll(".beat-box");
    const subdivision = Math.ceil(parseFloat(subdivisionInput.value) || 1);
    
    const currentBeatIndex = Math.floor(step / subdivision);

    dots.forEach(d => d.classList.remove("active", "done", "accent", "pulse"));
    boxes.forEach(b => b.classList.remove("current-beat"));

    for (let i = 0; i < dots.length; i++) {
        if (i < step) dots[i].classList.add("done");
    }
    if (boxes[currentBeatIndex]) boxes[currentBeatIndex].classList.add("current-beat");

    if (dots[step]) {
        dots[step].classList.add("active", "pulse");
        if (step === 0 || (step % subdivision === 0 && accentInput.checked)) {
            dots[step].classList.add("accent");
        }
    }
}

// =====================================
// 🎯 AUDIO SCHEDULER ENGINE
// =====================================
function advanceNote() {
    const subdivision = parseFloat(subdivisionInput.value) || 1;
    const secondsPerBeat = 60.0 / currentBpm;
    const secondsPerStep = secondsPerBeat / subdivision;
    
    nextNoteTime += secondsPerStep; 

    currentStep++;
    if (currentStep >= totalSteps) {
        currentStep = 0;
        currentBar++;
        
        if (trainingEnabled) {
            barsCompleted++;
            totalBarsCompleted++;
            if (totalBarsCompleted >= totalTrainingBars) {
                setBpm(targetBpm);
                stopMetronome();
                if (trainingInfo) {
                    trainingInfo.style.color = "red";
                    trainingInfo.innerHTML = "[ TRAINING COMPLETE ] 🎉 Target BPM achieved!";
                }
                return;
            }
            if (barsCompleted >= barsPerStep) {
                barsCompleted = 0;
                currentBar = 0;
                const nextBpm = currentBpm + bpmIncrement;
                setBpm(nextBpm >= targetBpm ? targetBpm : nextBpm);
            }
            updateTrainingInfoText(false);
        } else {
            if (measureInput) {
                const maxMeasures = parseInt(measureInput.value) || 4;
                if (currentBar >= maxMeasures) currentBar = 0;
            }
        }
    }
}

function scheduleNote(step, time) {
    const subdivision = Math.ceil(parseFloat(subdivisionInput.value) || 1);
    const currentBeatNumber = Math.floor(step / subdivision) + 1;
    const isSubdivision = (step % subdivision !== 0);
    const accent = accentInput.checked && (step === 0);

    if (soundTypeInput.value === "human") {
        if (!isSubdivision) {
            const voiceIndex = currentBeatNumber <= 9 ? currentBeatNumber : ((currentBeatNumber - 1) % 9) + 1;
            playVoice(voiceIndex, time);
        } else {
            playClickAtTime(false, true, true, time);
        }
    } else {
        playClickAtTime(accent, isSubdivision, false, time);
    }

    // 예약된 오디오 시간에 맞춰 UI 변경을 정확하게 위임
    setTimeout(() => {
        if (!isRunning) return;
        updateVisualizerUI(step);
        if (step === 0) {
            bpmHub.classList.remove("pulse");
            void bpmHub.offsetWidth;
            bpmHub.classList.add("pulse");
        }
        updateMeasureCounter();
    }, Math.max(0, (time - audioCtx.currentTime) * 1000));
}

function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
        scheduleNote(currentStep, nextNoteTime);
        advanceNote();
    }
}

function playClickAtTime(accent, isSubdivision, isForcedHumanSub, time) {
    const now = time; 
    let currentType = isForcedHumanSub ? "wood" : soundTypeInput.value;

    // -----------------------------------------------------------------
    // 1. SHAKER
    // -----------------------------------------------------------------
    if (currentType === "shaker") {
        const bufferSize = audioCtx.sampleRate * 0.05; 
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(accent ? 6000 : 7500, now); 
        
        const gain = audioCtx.createGain();
        const volume = accent ? 0.6 : (isSubdivision ? 0.3 : 0.45); 
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (accent ? 0.045 : 0.035));
        
        noise.connect(filter); 
        filter.connect(gain); 
        gain.connect(masterGain);
        
        noise.start(now);
        
        // 🎯 [메모리 해제 안전장치] 소리가 끝나면 노드 연결을 끊어 메모리 누수 방지
        const duration = accent ? 0.05 : 0.04;
        noise.stop(now + duration);
        setTimeout(() => {
            noise.disconnect();
            filter.disconnect();
            gain.disconnect();
        }, (now - audioCtx.currentTime + duration + 0.1) * 1000);
        return; 
    }

    // -----------------------------------------------------------------
    // 2. SNARE
    // -----------------------------------------------------------------
    if (currentType === "snare") {
        const osc = audioCtx.createOscillator(); 
        const oscGain = audioCtx.createGain();
        osc.type = "triangle"; 
        osc.frequency.setValueAtTime(accent ? 210 : 160, now); 
        oscGain.gain.setValueAtTime(accent ? 0.6 : 0.4, now);
        oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.connect(oscGain); 
        oscGain.connect(masterGain);
        
        const bufferSize = audioCtx.sampleRate * 0.15;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        
        const noise = audioCtx.createBufferSource(); 
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter(); 
        filter.type = "bandpass"; 
        filter.frequency.setValueAtTime(1000, now); 
        
        const noiseGain = audioCtx.createGain(); 
        const nVol = accent ? 0.45 : (isSubdivision ? 0.2 : 0.35);
        noiseGain.gain.setValueAtTime(nVol, now); 
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        
        noise.connect(filter); 
        filter.connect(noiseGain); 
        noiseGain.connect(masterGain);
        
        osc.start(now); 
        noise.start(now); 
        osc.stop(now + 0.15); 
        noise.stop(now + 0.15); 
        
        // 🎯 [메모리 해제 안전장치]
        setTimeout(() => {
            osc.disconnect(); oscGain.disconnect();
            noise.disconnect(); filter.disconnect(); noiseGain.disconnect();
        }, (now - audioCtx.currentTime + 0.3) * 1000);
        return;
    }

    // -----------------------------------------------------------------
    // 3. COWBELL
    // -----------------------------------------------------------------
    if (currentType === "cowbell") {
        const baseHz = accent ? 580 : 510; 
        const osc1 = audioCtx.createOscillator(); 
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain(); 
        const filter = audioCtx.createBiquadFilter();
        
        osc1.type = "square"; osc1.frequency.setValueAtTime(baseHz, now);
        osc2.type = "square"; osc2.frequency.setValueAtTime(baseHz * 1.48, now); 
        filter.type = "bandpass"; filter.frequency.setValueAtTime(baseHz * 1.55, now);
        
        const volume = accent ? 0.5 : (isSubdivision ? 0.22 : 0.35);
        gain.gain.setValueAtTime(volume, now); 
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        
        osc1.connect(filter); osc2.connect(filter); 
        filter.connect(gain); gain.connect(masterGain);
        
        osc1.start(now); osc2.start(now); 
        osc1.stop(now + 0.2); osc2.stop(now + 0.2); 
        
        // 🎯 [메모리 해제 안전장치]
        setTimeout(() => {
            osc1.disconnect(); osc2.disconnect();
            filter.disconnect(); gain.disconnect();
        }, (now - audioCtx.currentTime + 0.3) * 1000);
        return;
    }

    // -----------------------------------------------------------------
    // 4. CLAVES
    // -----------------------------------------------------------------
    if (currentType === "claves") {
        const osc = audioCtx.createOscillator(); 
        const gain = audioCtx.createGain();
        osc.type = "sine"; 
        let startHz = accent ? 3500 : 2500; 
        let endHz = accent ? 1500 : 1200;
        
        osc.frequency.setValueAtTime(startHz, now); 
        osc.frequency.exponentialRampToValueAtTime(endHz, now + 0.012);
        
        const volume = accent ? 0.8 : (isSubdivision ? 0.3 : 0.55);
        gain.gain.setValueAtTime(volume, now); 
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        
        osc.connect(gain); 
        gain.connect(masterGain);
        
        osc.start(now); 
        osc.stop(now + 0.07); 
        
        // 🎯 [메모리 해제 안전장치]
        setTimeout(() => {
            osc.disconnect();
            gain.disconnect();
        }, (now - audioCtx.currentTime + 0.15) * 1000);
        return;
    }

    // -----------------------------------------------------------------
    // 5. 기본 신호음 기반 사운드들 (Click, Wood, Beep)
    // -----------------------------------------------------------------
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    if (currentType === "wood") {
        osc.type = "triangle"; osc.frequency.setValueAtTime(accent ? 1800 : 1000, now);
    } else if (currentType === "click") {
        osc.type = "sine"; osc.frequency.setValueAtTime(accent ? 1500 : 800, now);
    } else { 
        osc.type = "sine"; osc.frequency.setValueAtTime(accent ? 1000 : 500, now);
    }
    
    const defaultVolume = accent ? 1.0 : 0.65;
    gain.gain.setValueAtTime(defaultVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    
    osc.connect(gain); 
    gain.connect(masterGain);
    
    osc.start(now); 
    osc.stop(now + 0.05);

    // 🎯 [메모리 해제 안전장치] 0.05초 재생이 완전히 끝난 후 노드 연결을 끊어 브라우저가 즉시 메모리를 청소하게 만듦
    setTimeout(() => {
        osc.disconnect();
        gain.disconnect();
    }, (now - audioCtx.currentTime + 0.1) * 1000);
}
// =====================================
// CONTROL PANEL ENGINES
// =====================================
function updateTrainingInfoText(isFirstStart = false) {
    if (!trainingInfo) return;
    if (trainingEnabled && isRunning) {
        trainingInfo.style.color = "red"; trainingInfo.style.fontWeight = "bold";
        if (isFirstStart) {
            trainingInfo.innerHTML = "[ TRAINING MODE ] 🏋️ Training begins!";
        } else {
            let progressPercent = totalTrainingBars > 0 ? Math.round((totalBarsCompleted / totalTrainingBars) * 100) : 0;
            trainingInfo.innerHTML = `[ TRAINING MODE ]  ${Math.min(100, progressPercent)}%  achieved`;
        }
    } else {
        trainingInfo.innerHTML = "&nbsp;";
    }
}

function updateMeasureCounter() {
    const counterElement = document.getElementById('liveMeasureCounter');
    if (!counterElement) return;
    if (trainingEnabled) {
        counterElement.innerText = (barsCompleted % (barsPerStep || 4)) + 1;
    } else {
        if (measureInput) {
            counterElement.innerText = (currentBar % (parseInt(measureInput.value) || 4)) + 1;
        }
    }
}

function setBpm(value) {
    currentBpm = Math.max(20, Math.min(400, value));
    if (bpmInput) bpmInput.value = currentBpm;
    if (bpmValue) bpmValue.textContent = Math.round(currentBpm);
}

function startMetronome() {
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    stopMetronome();

    currentStep = 0;
    currentBar = 0;
    
    // 상태값 강제 주입 및 뷰 재생성
    const beats = getBeatsCount();
    const subdivision = Math.ceil(parseFloat(subdivisionInput.value) || 1);
    totalSteps = beats * subdivision;

    initTraining(); 
    createVisualizer();

    isRunning = true;
    bpmHub.classList.add("running");

    // 첫 노트 발사 타이밍 강제 지정
    nextNoteTime = audioCtx.currentTime + 0.05; 
    schedulerIntervalId = setInterval(scheduler, lookahead);
    startTimer();
    updateTrainingInfoText(true);
}

function stopMetronome() {
    clearInterval(schedulerIntervalId);
    clearInterval(timerId);
    schedulerIntervalId = null; 
    timerId = null;
    isRunning = false;
    bpmHub.classList.remove("running");
    updateTrainingInfoText(false);
}

// =====================================
// EVENT CONTROLS
// =====================================
function startHold(direction) {
    bpmHoldDirection = direction; setBpm(currentBpm + direction);
    clearTimeout(bpmHoldTimeout); clearInterval(bpmHoldInterval);
    bpmHoldTimeout = setTimeout(() => {
        bpmHoldInterval = setInterval(() => { setBpm(currentBpm + bpmHoldDirection); }, 80);
    }, 400);
}
function stopHold() {
    if (bpmHoldTimeout) clearTimeout(bpmHoldTimeout);
    if (bpmHoldInterval) clearInterval(bpmHoldInterval);
}
function bindHold(btn, direction) {
    if (!btn) return;
    btn.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault(); startHold(direction);
    });
    btn.addEventListener("pointerup", stopHold); btn.addEventListener("pointerleave", stopHold); btn.addEventListener("pointercancel", stopHold);
}

function startTimer() {
    if (!timerEnable.checked) { timerDisplay.textContent = "∞"; return; }
    const minutes = parseInt(timerMinutes.value || "0");
    if (minutes <= 0) { timerDisplay.textContent = "∞"; return; }
    timerRemaining = minutes * 60;
    timerDisplay.textContent = formatTime(timerRemaining);
    timerId = setInterval(() => {
        timerRemaining--; timerDisplay.textContent = formatTime(timerRemaining);
        if (timerRemaining <= 0) stopMetronome();
    }, 1000);
}
function formatTime(sec) { return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`; }

function tapTempo() {
    const now = performance.now(); tapTimes.push(now);
    if (tapTimes.length > 6) tapTimes.shift();
    if (tapTimes.length < 2) return;
    let intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    setBpm(Math.round(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)));
}

function initTraining() {
    trainingEnabled = trainingModeCheck ? trainingModeCheck.checked : false;
    if (!trainingEnabled) return;
    let rawStart = startBpmInput ? parseInt(startBpmInput.value) : 120;
    let rawTarget = targetBpmInput ? parseInt(targetBpmInput.value) : 140;
    bpmIncrement = stepBpmInput ? parseInt(stepBpmInput.value) : 5;       
    barsPerStep = barsPerStepInput ? parseInt(barsPerStepInput.value) : 4;
    targetBpm = Math.max(20, rawTarget); barsCompleted = 0; totalBarsCompleted = 0; currentBar = 0; 
    let startBpm = Math.max(20, rawStart); setBpm(startBpm);
    if (targetBpm > startBpm && bpmIncrement > 0) {
        totalTrainingBars = (Math.floor((targetBpm - startBpm) / bpmIncrement) + 1) * barsPerStep;
    } else { totalTrainingBars = barsPerStep; }
}

bindHold(bpmUpBtn, +1); bindHold(bpmDownBtn, -1);
bindHold(bpmPlus5Btn, +5); bindHold(bpmMinus5Btn, -5);
bindHold(bpmPlus10Btn, +10); bindHold(bpmMinus10Btn, -10);

bpmHub.addEventListener("click", () => { if (isRunning) stopMetronome(); else startMetronome(); });
document.getElementById("tapBtn").addEventListener("click", tapTempo);

if (bpmInput) {
    bpmInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value); if (!isNaN(val)) setBpm(val);
    });
}
beatsInput.addEventListener("change", () => { updateSubdivisionOptions(); createVisualizer(); });
subdivisionInput.addEventListener("change", () => { createVisualizer(); });
volumeInput.addEventListener("input", (e) => { masterGain.gain.value = parseFloat(e.target.value); });

if (trainingModeCheck) trainingModeCheck.addEventListener("change", initTraining);
if (startBpmInput) startBpmInput.addEventListener("input", initTraining);
if (targetBpmInput) targetBpmInput.addEventListener("input", initTraining);
if (stepBpmInput) stepBpmInput.addEventListener("input", initTraining);
if (barsPerStepInput) barsPerStepInput.addEventListener("input", initTraining);
if (measureInput) {
    measureInput.addEventListener("input", () => { initTraining(); createVisualizer(); updateMeasureCounter(); });
}

document.addEventListener("DOMContentLoaded", () => {
    updateSubdivisionOptions(); 
    createVisualizer();
    if (bpmInput) currentBpm = parseInt(bpmInput.value) || 120;
    bpmValue.textContent = currentBpm;
});

// KEYBOARD CONTROLS ENGINE
const activeKeys = new Set(); let keyHoldInterval = null; let keyHoldTimeout = null;
document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "Enter") { e.preventDefault(); if (isRunning) stopMetronome(); else startMetronome(); return; }
    if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault(); const tapBtn = document.getElementById("tapBtn");
        if (tapBtn) { tapBtn.classList.add("active"); setTimeout(() => tapBtn.classList.remove("active"), 100); }
        tapTempo(); return;
    }
    let direction = 0;
    switch (e.key) {
        case "ArrowUp": direction = +1; break; case "ArrowDown": direction = -1; break;
        case "ArrowLeft": direction = -10; break; case "ArrowRight": direction = +10; break;
        default: return;
    }
    e.preventDefault(); if (activeKeys.has(e.key)) return; activeKeys.add(e.key);
    setBpm(currentBpm + direction);
    clearTimeout(keyHoldTimeout); clearInterval(keyHoldInterval);
    keyHoldTimeout = setTimeout(() => {
        keyHoldInterval = setInterval(() => { setBpm(currentBpm + direction); }, 80);
    }, 400);
});
document.addEventListener("keyup", (e) => {
    if (activeKeys.has(e.key)) { activeKeys.delete(e.key); clearTimeout(keyHoldTimeout); clearInterval(keyHoldInterval); }
});
window.addEventListener("blur", () => {
    activeKeys.clear(); clearTimeout(keyHoldTimeout); clearInterval(keyHoldInterval);
});