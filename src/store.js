import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DIR = path.resolve("data/sessions");
fs.mkdirSync(DIR, { recursive: true });

const cache = new Map();

function file(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Ungültige ID");
  return path.join(DIR, `${id}.json`);
}

export function createSession(data) {
  const session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    history: [],
    letter: null,
    letterReply: null,
    result: null,
    ...data,
  };
  saveSession(session);
  return session;
}

export function getSession(id) {
  if (cache.has(id)) return cache.get(id);
  const f = file(id);
  if (!fs.existsSync(f)) return null;
  const session = JSON.parse(fs.readFileSync(f, "utf8"));
  cache.set(id, session);
  return session;
}

export function saveSession(session) {
  cache.set(session.id, session);
  fs.writeFileSync(file(session.id), JSON.stringify(session, null, 2));
}
