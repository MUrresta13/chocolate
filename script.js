"use strict";

const PASSCODE = "ALLABOARD25";

// Screens
const introScreen = document.getElementById("introScreen");
const titleScreen = document.getElementById("titleScreen");
const gameScreen  = document.getElementById("gameScreen");

// Buttons
const startChallengeBtn = document.getElementById("startChallengeBtn");
const playBtn = document.getElementById("playBtn");
const muteBtn = document.getElementById("muteBtn");
const restartBtn = document.getElementById("restartBtn");

const takeMugBtn = document.getElementById("takeMugBtn");

// HUD
const timeDisplay = document.getElementById("timeDisplay");
const deliveredDisplay = document.getElementById("deliveredDisplay");
const mistakesDisplay = document.getElementById("mistakesDisplay");

// Order UI
const traySymbolEl = document.getElementById("traySymbol");
const orderText = document.getElementById("orderText");
const statusLine = document.getElementById("statusLine");
const heatFill = document.getElementById("heatFill");
const swayFill = document.getElementById("swayFill");
const seatsWrap = document.getElementById("seats");

// Modals
const successModal = document.getElementById("successModal");
const failModal = document.getElementById("failModal");
const failReason = document.getElementById("failReason");
const copyBtn = document.getElementById("copyBtn");
const copyStatus = document.getElementById("copyStatus");
const playAgainBtn = document.getElementById("playAgainBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");
const backBtn = document.getElementById("backBtn");

// Audio
const bgm = document.getElementById("bgm");
let musicOn = false;

/* HARD CONFIG */
const SYMBOLS = ["🎟️","⭐","❄️","🔔","🎄","☕","🧣","🕯️","🍬","🦌","🛷","🎁"];
const SEAT_COUNT = 18;
const MUGS_TO_DELIVER = 10;
const START_TIME_S = 55;
const HEAT_PER_MUG_S = 4.8;
const WRONG_TIME_PENALTY_S = 2.8;
const WRONG_HEAT_SHOCK = 0.45;
const SCRAMBLE_EVERY_MS = 1300;
const SWAY_UPDATE_MS = 140;
const MAX_SWAY_PX = 16;

/* STATE */
let running = false;
let timeLeft = START_TIME_S;
let delivered = 0;
let mistakes = 0;

let carrying = false;
let currentSymbol = null;
let heatLeft = 0;

let seatNodes = [];
let seatSymbols = [];
let correctSeatIndex = -1;

let lastTick = 0;
let tickRaf = 0;
let scrambleTimer = null;
let swayTimer = null;

/* Helpers */
function showScreen(screen){
  introScreen.classList.remove("active");
  titleScreen.classList.remove("active");
  gameScreen.classList.remove("active");
  screen.classList.add("active");
}
function show(el){ el.classList.add("show"); el.setAttribute("aria-hidden","false"); }
function hide(el){ el.classList.remove("show"); el.setAttribute("aria-hidden","true"); }

function pad2(n){ return String(n).padStart(2,"0"); }
function formatTime(s){
  const m = Math.floor(s / 60);
  const r = Math.max(0, Math.floor(s % 60));
  return `${pad2(m)}:${pad2(r)}`;
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function randInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr){ return arr[randInt(0, arr.length - 1)]; }
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j = randInt(0,i);
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function setMusicState(on){
  musicOn = on;
  muteBtn.textContent = `Music: ${musicOn ? "On" : "Off"}`;
}

async function startMusic(){
  try{
    // If user comes back to title screen, keep playing; only restart if ended/paused.
    if(bgm.paused){
      await bgm.play();
    }
    setMusicState(true);
  }catch{
    setMusicState(false);
  }
}

function stopMusic(){
  try{ bgm.pause(); }catch{}
  setMusicState(false);
}

function updateHUD(){
  timeDisplay.textContent = formatTime(timeLeft);
  deliveredDisplay.textContent = `${delivered}/${MUGS_TO_DELIVER}`;
  mistakesDisplay.textContent = String(mistakes);
}

function updateBars(){
  const heatPct = carrying ? Math.max(0, Math.min(1, heatLeft / HEAT_PER_MUG_S)) : 0;
  heatFill.style.width = `${Math.round(heatPct * 100)}%`;

  const pressure = clamp01((START_TIME_S - timeLeft) / START_TIME_S);
  const mistakeBoost = clamp01(mistakes / 7);
  const swayIntensity = clamp01(0.25 + pressure * 0.55 + mistakeBoost * 0.35);
  swayFill.style.width = `${Math.round(swayIntensity * 100)}%`;
}

function setStatus(msg, kind=""){
  statusLine.textContent = msg;
  statusLine.style.color =
    kind === "ok" ? "rgba(124,255,161,.95)" :
    kind === "bad" ? "rgba(255,107,107,.95)" :
    "rgba(255,255,255,.85)";
}

/* Seats */
function buildSeats(){
  seatsWrap.innerHTML = "";
  seatNodes = [];
  seatSymbols = new Array(SEAT_COUNT).fill("—");

  for(let i=0;i<SEAT_COUNT;i++){
    const btn = document.createElement("button");
    btn.className = "seat";
    btn.type = "button";
    btn.dataset.index = String(i);

    const sym = document.createElement("div");
    sym.className = "sym";
    sym.textContent = "—";

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = `S${i+1}`;

    btn.appendChild(sym);
    btn.appendChild(tag);

    btn.addEventListener("click", () => onSeatClick(i));

    seatNodes.push(btn);
    seatsWrap.appendChild(btn);
  }
}

function scrambleSeatSymbols(){
  for(let i=0;i<SEAT_COUNT;i++){
    seatSymbols[i] = pick(SYMBOLS);
  }

  if(carrying && currentSymbol){
    correctSeatIndex = randInt(0, SEAT_COUNT - 1);
    seatSymbols[correctSeatIndex] = currentSymbol;

    const near = pick(SYMBOLS.filter(s => s !== currentSymbol));
    const extra = randInt(3,5);
    let placed = 0;
    while(placed < extra){
      const j = randInt(0, SEAT_COUNT - 1);
      if(j !== correctSeatIndex){
        seatSymbols[j] = (Math.random() < 0.55) ? near : seatSymbols[j];
        placed++;
      }
    }
  }else{
    correctSeatIndex = -1;
  }

  for(let i=0;i<SEAT_COUNT;i++){
    const btn = seatNodes[i];
    btn.classList.remove("good","bad");
    const symEl = btn.querySelector(".sym");
    symEl.textContent = seatSymbols[i];

    if(Math.random() < 0.33){
      btn.classList.add("decoy");
    }else{
      btn.classList.remove("decoy");
    }
  }
}

function applySway(){
  const pressure = clamp01((START_TIME_S - timeLeft) / START_TIME_S);
  const mistakeBoost = clamp01(mistakes / 7);
  const intensity = clamp01(0.25 + pressure * 0.55 + mistakeBoost * 0.35);
  const amp = MAX_SWAY_PX * intensity;

  for(const btn of seatNodes){
    const x = randInt(Math.floor(-amp), Math.floor(amp));
    const y = randInt(Math.floor(-amp), Math.floor(amp));
    const r = (randInt(-10,10) * 0.15) * intensity;

    btn.style.setProperty("--x", `${x}px`);
    btn.style.setProperty("--y", `${y}px`);
    btn.style.setProperty("--r", `${r}deg`);
  }
}

function pulseSeat(index, good){
  const btn = seatNodes[index];
  btn.classList.remove("good","bad");
  void btn.offsetWidth;
  btn.classList.add(good ? "good" : "bad");
  setTimeout(()=>btn.classList.remove("good","bad"), 380);
}

/* Carry */
function resetCarry(){
  carrying = false;
  currentSymbol = null;
  heatLeft = 0;
  traySymbolEl.textContent = "—";
  orderText.textContent = "Press Take Mug to begin.";
  correctSeatIndex = -1;
  scrambleSeatSymbols();
  updateBars();
}

function beginCarry(){
  carrying = true;
  currentSymbol = pick(SYMBOLS);
  heatLeft = HEAT_PER_MUG_S;

  traySymbolEl.textContent = currentSymbol;
  orderText.textContent = `Deliver: ${currentSymbol}`;

  scrambleSeatSymbols();
  setStatus("Go! Find the matching seat — it’s moving.", "");
  updateBars();
}

/* Game loop */
function startLoop(){
  lastTick = performance.now();
  tickRaf = requestAnimationFrame(tick);
}

function tick(now){
  if(!running) return;

  const dt = (now - lastTick) / 1000;
  lastTick = now;

  timeLeft = Math.max(0, timeLeft - dt);

  if(carrying){
    const deliveryRamp = clamp01(delivered / MUGS_TO_DELIVER);
    const mistakeRamp = clamp01(mistakes / 8);
    const pressure = clamp01((START_TIME_S - timeLeft) / START_TIME_S);

    const drainMultiplier = 1.0 + (deliveryRamp * 0.85) + (mistakeRamp * 0.55) + (pressure * 0.35);
    heatLeft = Math.max(0, heatLeft - dt * drainMultiplier);

    if(heatLeft <= 0){
      failGame("The cocoa went cold in your hands.");
      return;
    }
  }

  updateHUD();
  updateBars();

  if(timeLeft <= 0){
    failGame("You ran out of time.");
    return;
  }

  tickRaf = requestAnimationFrame(tick);
}

function hardModeIntervals(){
  clearInterval(scrambleTimer);
  clearInterval(swayTimer);

  scrambleTimer = setInterval(() => {
    if(!running) return;
    if(carrying){
      scrambleSeatSymbols();
    }else{
      if(Math.random() < 0.18) scrambleSeatSymbols();
    }
  }, SCRAMBLE_EVERY_MS);

  swayTimer = setInterval(() => {
    if(!running) return;
    applySway();
  }, SWAY_UPDATE_MS);
}

/* Win/Lose */
function winGame(){
  running = false;
  cancelAnimationFrame(tickRaf);
  clearInterval(scrambleTimer);
  clearInterval(swayTimer);

  show(successModal);
  copyStatus.textContent = "";
}

function failGame(reason){
  running = false;
  cancelAnimationFrame(tickRaf);
  clearInterval(scrambleTimer);
  clearInterval(swayTimer);

  failReason.textContent = reason;
  show(failModal);
}

function onSeatClick(index){
  if(!running) return;

  if(!carrying){
    mistakes++;
    timeLeft = Math.max(0, timeLeft - 1.2);
    setStatus("No mug on your tray — that cost you time.", "bad");
    pulseSeat(index, false);
    updateHUD();
    if(timeLeft <= 0) failGame("You ran out of time.");
    return;
  }

  const chosen = seatSymbols[index];
  const correct = (chosen === currentSymbol) && (index === correctSeatIndex);

  if(correct){
    delivered++;
    pulseSeat(index, true);
    setStatus("Delivered! Grab the next one — hurry.", "ok");

    // Small reward if delivered while still hot
    if(heatLeft > HEAT_PER_MUG_S * 0.30){
      timeLeft = Math.min(START_TIME_S, timeLeft + 0.35);
    }

    resetCarry();

    if(delivered >= MUGS_TO_DELIVER){
      winGame();
      return;
    }

    updateHUD();
    return;
  }

  mistakes++;
  pulseSeat(index, false);

  timeLeft = Math.max(0, timeLeft - WRONG_TIME_PENALTY_S);
  heatLeft = Math.max(0, heatLeft - HEAT_PER_MUG_S * WRONG_HEAT_SHOCK);

  setStatus("Wrong seat — the conductor is not pleased. Symbols scrambled.", "bad");
  scrambleSeatSymbols();
  applySway();

  updateHUD();
  updateBars();

  if(timeLeft <= 0){
    failGame("You ran out of time.");
  }
}

/* New game */
function newGame(){
  hide(successModal);
  hide(failModal);

  running = true;
  timeLeft = START_TIME_S;
  delivered = 0;
  mistakes = 0;

  buildSeats();
  resetCarry();
  updateHUD();
  setStatus("Take a mug. Deliver fast. Don’t guess.", "");

  hardModeIntervals();
  startLoop();
}

/* Copy */
async function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok;
}

/* Events */
// Start Challenge: starts music + shows title screen
startChallengeBtn.addEventListener("click", async () => {
  // start music from THIS gesture
  await startMusic();
  showScreen(titleScreen);
});

playBtn.addEventListener("click", () => {
  showScreen(gameScreen);
  newGame();
});

muteBtn.addEventListener("click", async () => {
  if(musicOn){
    stopMusic();
  }else{
    await startMusic();
  }
});

restartBtn.addEventListener("click", () => {
  newGame();
});

takeMugBtn.addEventListener("click", () => {
  if(!running) return;

  if(carrying){
    mistakes++;
    timeLeft = Math.max(0, timeLeft - 1.8);
    heatLeft = Math.max(0, heatLeft - HEAT_PER_MUG_S * 0.25);
    setStatus("You jostled the tray — don’t double-dip. Time lost.", "bad");
    scrambleSeatSymbols();
    applySway();
    updateHUD();
    updateBars();
    if(timeLeft <= 0) failGame("You ran out of time.");
    return;
  }

  beginCarry();
});

copyBtn.addEventListener("click", async () => {
  try{
    const ok = await copyToClipboard(PASSCODE);
    copyStatus.textContent = ok ? "Copied to clipboard." : "Copy failed — select and copy manually.";
  }catch{
    copyStatus.textContent = "Copy failed — select and copy manually.";
  }
});

playAgainBtn.addEventListener("click", () => {
  hide(successModal);
  newGame();
});

tryAgainBtn.addEventListener("click", () => {
  hide(failModal);
  newGame();
});

backBtn.addEventListener("click", () => {
  hide(failModal);
  showScreen(titleScreen);
});

/* Boot */
showScreen(introScreen);
setMusicState(false);
