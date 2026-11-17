const HANGUP = "[AUFLEGEN]";
const $ = (sel) => document.querySelector(sel);

const state = { id: null, childName: "", ttsMode: "browser", inCall: false, mode: null };

// ---------- Schnee ----------
for (let i = 0; i < 40; i++) {
  const f = document.createElement("span");
  f.className = "flake";
  f.textContent = "❄";
  f.style.left = `${Math.random() * 100}vw`;
  f.style.fontSize = `${8 + Math.random() * 14}px`;
  f.style.animationDuration = `${8 + Math.random() * 12}s`;
  f.style.animationDelay = `${-Math.random() * 20}s`;
  $("#snow").appendChild(f);
}

function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${screen}`));
  window.scrollTo(0, 0);
}

fetch("/api/config")
  .then((r) => r.json())
  .then((c) => (state.ttsMode = c.tts))
  .catch(() => {});

// ---------- 1. Eltern-Formular ----------
$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.consent = fd.get("consent") === "on";
  $("#setup-error").textContent = "";
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return ($("#setup-error").textContent = data.error);
  state.id = data.id;
  state.childName = data.childName;
  document.querySelectorAll(".child-name").forEach((el) => (el.textContent = data.childName));
  $("#letter-text").placeholder = `Lieber Weihnachtsmann,\n\nich heiße ${data.childName} und wünsche mir …`;
  show("choose");
});

// ---------- Sprachausgabe ----------
let santaVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("de"));
  const male = /(male|mann|markus|hans|yannick|conrad|stefan|killian|florian|jonas|helmut|bernd|daniel|thomas)/i;
  santaVoice = voices.find((v) => male.test(v.name) && !/female/i.test(v.name)) || voices[0] || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speakBrowser(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text.replace(/ho ho ho/gi, "Ho, ho, ho"));
    u.lang = "de-DE";
    if (santaVoice) u.voice = santaVoice;
    u.pitch = 0.7;
    u.rate = 0.92;
    // Sicherheitsnetz: manche Browser feuern "onend" nicht zuverlässig
    const timer = setTimeout(resolve, 3000 + text.length * 120);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

const audioEl = new Audio();
async function fetchServerAudio(text) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status !== 200) return null;
  return URL.createObjectURL(await res.blob());
}
function playUrl(url) {
  return new Promise((resolve) => {
    audioEl.src = url;
    audioEl.onended = audioEl.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audioEl.play().catch(resolve);
  });
}

/** Spricht Sätze in Reihenfolge; Audio für den nächsten Satz wird schon vorgeladen. */
class Speaker {
  constructor() {
    this.queue = [];
    this.running = Promise.resolve();
  }
  say(sentence) {
    const audio = state.ttsMode === "server" ? fetchServerAudio(sentence) : null;
    this.running = this.running.then(async () => {
      if (!state.inCall && state.mode === "call") return;
      $("#santa").classList.add("speaking");
      const url = audio ? await audio : null;
      if (url) await playUrl(url);
      else await speakBrowser(sentence);
      $("#santa").classList.remove("speaking");
    });
    return this.running;
  }
  done() {
    return this.running;
  }
  stop() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    audioEl.pause();
    $("#santa").classList.remove("speaking");
  }
}

function unlockAudio() {
  // iOS/Safari erlauben Audio nur nach einer Nutzeraktion
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  audioEl.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
  audioEl.play().catch(() => {});
}

// ---------- Spracherkennung ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listenResolve = null;
let finalText = "";
let silenceTimer = null;

function listen() {
  return new Promise((resolve) => {
    listenResolve = resolve;
    finalText = "";
    $("#you-said").textContent = "";
    $("#mic").hidden = false;
    $("#done-talking").hidden = false;
    $("#call-status").textContent = `Jetzt bist du dran, ${state.childName}!`;
    if (!Recognition) return; // Nur Texteingabe
    recognition = new Recognition();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      $("#you-said").textContent = (finalText + interim).trim();
      clearTimeout(silenceTimer);
      // Kinder machen Pausen beim Erzählen – deshalb großzügig warten
      silenceTimer = setTimeout(() => finishListening(), interim ? 2600 : 1800);
    };
    recognition.onend = () => {
      // Browser beenden die Erkennung manchmal von selbst – dann neu starten
      if (listenResolve && state.inCall) {
        try {
          recognition.start();
        } catch {}
      }
    };
    recognition.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        $("#mic-text").textContent = "Kein Mikrofon – bitte unten tippen";
        $("#type-form").hidden = false;
      }
    };
    try {
      recognition.start();
    } catch {}
  });
}

function finishListening(textOverride) {
  clearTimeout(silenceTimer);
  const text = (textOverride ?? (finalText || $("#you-said").textContent)).trim();
  if (!text || !listenResolve) return;
  const resolve = listenResolve;
  listenResolve = null;
  stopRecognition();
  resolve(text);
}

function stopRecognition() {
  $("#mic").hidden = true;
  $("#done-talking").hidden = true;
  if (recognition) {
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {}
    recognition = null;
  }
}

$("#done-talking").addEventListener("click", () => finishListening());
$("#type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#type-input").value.trim();
  if (!text) return;
  $("#type-input").value = "";
  if (listenResolve) finishListening(text);
});

// ---------- 2./3. Telefonat ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Holt die Antwort des Weihnachtsmanns gestreamt und spricht Satz für Satz. Liefert true, wenn er auflegt. */
async function santaTurn(speaker, text) {
  $("#call-status").textContent = "Der Weihnachtsmann spricht …";
  $("#subtitle").textContent = "";
  const res = await fetch(`/api/session/${state.id}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const flush = (final) => {
    const re = /[^.!?…]+[.!?…]+["“”»]?\s+/g;
    let m;
    let last = 0;
    while ((m = re.exec(buffer))) {
      emit(m[0]);
      last = re.lastIndex;
    }
    buffer = buffer.slice(last);
    if (final && buffer.trim()) {
      emit(buffer);
      buffer = "";
    }
  };
  const emit = (sentence) => {
    const s = sentence.replace(HANGUP, "").trim();
    if (!s) return;
    $("#subtitle").textContent += `${s} `;
    speaker.say(s);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    full += chunk;
    flush(false);
  }
  flush(true);
  await speaker.done();
  return full.includes(HANGUP);
}

$("#choose-call").addEventListener("click", async () => {
  unlockAudio();
  state.mode = "call";
  state.inCall = true;
  show("call");
  $("#type-form").hidden = Boolean(Recognition);
  $("#santa").classList.add("ringing");
  $("#call-status").textContent = "Es klingelt am Nordpol …";
  await sleep(2200);
  $("#santa").classList.remove("ringing");
  if (!state.inCall) return;

  const speaker = new Speaker();
  state.speaker = speaker;
  try {
    let hangup = await santaTurn(speaker, "");
    while (state.inCall && !hangup) {
      const childText = await listen();
      if (!state.inCall) break;
      $("#you-said").textContent = `„${childText}“`;
      hangup = await santaTurn(speaker, childText);
    }
  } catch (err) {
    console.error(err);
    $("#call-status").textContent = "Die Leitung ist abgebrochen.";
  }
  if (state.inCall) endCall();
});

$("#hangup").addEventListener("click", endCall);

function endCall() {
  if (!state.inCall) return;
  state.inCall = false;
  state.speaker?.stop();
  stopRecognition();
  if (listenResolve) listenResolve = null;
  finish();
}

// ---------- 4. Brief ----------
$("#choose-letter").addEventListener("click", () => {
  state.mode = "letter";
  show("letter");
});

$("#letter-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#letter-send");
  btn.disabled = true;
  btn.textContent = "Rudolph fliegt los … 🦌";
  $("#letter-error").textContent = "";
  try {
    const res = await fetch(`/api/session/${state.id}/letter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ letter: $("#letter-text").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("#letter-form").hidden = true;
    $("#letter-reply").hidden = false;
    $("#letter-reply-text").textContent = data.reply;
  } catch (err) {
    $("#letter-error").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Brief abschicken 🦌";
  }
});

$("#read-letter").addEventListener("click", async () => {
  unlockAudio();
  const speaker = new Speaker();
  state.speaker = speaker;
  const parts = $("#letter-reply-text").textContent.split(/(?<=[.!?…])\s+/);
  for (const p of parts) speaker.say(p);
});

$("#letter-done").addEventListener("click", () => {
  state.speaker?.stop();
  finish();
});

// ---------- 5. Abschluss ----------
async function finish() {
  show("done");
  $("#done-status").textContent = "Die Wichtel sortieren die Wunschliste …";
  try {
    const res = await fetch(`/api/session/${state.id}/finish`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("#done-status").textContent = "Fertig! 🎄";
    $("#mail-status").textContent = data.emailSent
      ? "Die Einkaufsliste wurde Ihnen per E-Mail geschickt."
      : "Hinweis: E-Mail-Versand ist auf dem Server nicht eingerichtet – hier ist die Liste.";
    const list = $("#gift-list");
    list.innerHTML = "";
    for (const g of data.gifts) {
      const li = document.createElement("li");
      const info = document.createElement("div");
      info.innerHTML = `<strong></strong><small></small>`;
      info.querySelector("strong").textContent = `${g.priority === "hoch" ? "★ " : ""}${g.title}`;
      info.querySelector("small").textContent = g.details || (g.buyable ? "" : "Herzenswunsch – nicht käuflich");
      li.appendChild(info);
      if (g.url) {
        const a = document.createElement("a");
        a.href = g.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Amazon";
        li.appendChild(a);
      }
      list.appendChild(li);
    }
    if (!data.gifts.length) list.innerHTML = "<li>Keine konkreten Wünsche erkannt.</li>";
    $("#parent-note").textContent = data.parentNote;
    $("#parent-area").hidden = false;
  } catch (err) {
    $("#done-status").textContent = err.message;
  }
}

$("#restart").addEventListener("click", () => location.reload());
