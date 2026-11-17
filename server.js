import "dotenv/config";
import express from "express";
import { createSession, getSession, saveSession } from "./src/store.js";
import { streamSantaReply, writeLetterReply, extractGiftList, HANGUP_MARKER } from "./src/santa.js";
import { sendParentEmail, amazonSearchUrl } from "./src/mailer.js";
import { ttsEnabled, synthesize } from "./src/tts.js";

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

const MAX_TURNS = 40;
const clean = (s, max) => String(s ?? "").trim().slice(0, max);

function loadSession(req, res) {
  let session = null;
  try {
    session = getSession(req.params.id);
  } catch {}
  if (!session) res.status(404).json({ error: "Sitzung nicht gefunden" });
  return session;
}

app.get("/api/config", (_req, res) => res.json({ tts: ttsEnabled ? "server" : "browser" }));

// Eltern legen das Kind an
app.post("/api/session", (req, res) => {
  const childName = clean(req.body.childName, 40);
  const parentEmail = clean(req.body.parentEmail, 120);
  const age = Number.parseInt(req.body.age, 10);
  if (!childName) return res.status(400).json({ error: "Bitte den Namen des Kindes angeben." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail))
    return res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse angeben." });
  if (req.body.consent !== true)
    return res.status(400).json({ error: "Bitte der Datenverarbeitung zustimmen." });

  const session = createSession({
    childName,
    parentEmail,
    parentName: clean(req.body.parentName, 60),
    age: age > 0 && age < 18 ? age : null,
    notes: clean(req.body.notes, 600),
  });
  res.json({ id: session.id, childName: session.childName });
});

// Telefonat: nächste Antwort des Weihnachtsmanns (gestreamt als Text)
app.post("/api/session/:id/call", async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;

  const text = clean(req.body.text, 1000);
  if (session.history.length === 0) {
    session.history.push({
      role: "user",
      hidden: true,
      content: `(Der Anruf ist gerade verbunden. ${session.childName} ist am Telefon und hört zu. Begrüße ${session.childName} herzlich.)`,
    });
  } else if (text) {
    session.history.push({ role: "user", content: text });
  } else {
    return res.status(400).json({ error: "Leere Nachricht" });
  }
  if (session.history.length > MAX_TURNS * 2) {
    session.history.push({
      role: "user",
      hidden: true,
      content: "(Die Zeit ist um. Verabschiede dich jetzt herzlich.)",
    });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  try {
    const reply = await streamSantaReply(session, (chunk) => res.write(chunk));
    session.history.push({ role: "assistant", content: reply.replace(HANGUP_MARKER, "").trim() });
    saveSession(session);
  } catch (err) {
    console.error(err);
    session.history.pop();
    res.write(`\n${"Oh je, die Leitung zum Nordpol ist gerade gestört. Versuch es gleich nochmal!"}`);
  }
  res.end();
});

// Brief an den Weihnachtsmann
app.post("/api/session/:id/letter", async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const letter = clean(req.body.letter, 5000);
  if (letter.length < 3) return res.status(400).json({ error: "Der Brief ist noch leer." });
  try {
    session.letter = letter;
    session.letterReply = await writeLetterReply(session, letter);
    saveSession(session);
    res.json({ reply: session.letterReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Der Brief ist im Schneesturm hängen geblieben. Bitte nochmal versuchen." });
  }
});

// Abschluss: Wunschliste erstellen und an die Eltern schicken
app.post("/api/session/:id/finish", async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  try {
    if (!session.result) {
      session.result = await extractGiftList(session);
      saveSession(session);
    }
    const mail = await sendParentEmail(session, session.result);
    res.json({
      emailSent: mail.sent,
      gifts: session.result.gifts.map((g) => ({ ...g, url: g.buyable ? amazonSearchUrl(g.searchQuery) : null })),
      parentNote: session.result.parentNote,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Die Wunschliste konnte nicht erstellt werden." });
  }
});

// Sprachausgabe (nur wenn ElevenLabs konfiguriert ist)
app.post("/api/tts", async (req, res) => {
  if (!ttsEnabled) return res.status(204).end();
  const text = clean(req.body.text, 800);
  if (!text) return res.status(400).end();
  try {
    const audio = await synthesize(text);
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (err) {
    console.error(err);
    res.status(502).end();
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`🎅 Weihnachtsmann-Hotline läuft auf http://localhost:${port}`));
