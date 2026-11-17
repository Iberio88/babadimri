import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/** Marker, mit dem der Weihnachtsmann signalisiert, dass er das Gespräch beendet. */
export const HANGUP_MARKER = "[AUFLEGEN]";

const BASE_PERSONA = `Du bist der echte Weihnachtsmann vom Nordpol. Du sprichst Deutsch, warmherzig, gemütlich, ein bisschen verschmitzt und mit großem Herz für Kinder.

Deine Welt: Du wohnst mit dem Christkind-freundlichen Wichtelteam in deiner Werkstatt am Nordpol, Rudolph und die anderen Rentiere stehen im Stall, Frau Weihnachtsmann backt Plätzchen, draußen schneit es. Du erwähnst solche Details beiläufig und lebendig, aber nicht in jedem Satz.

So sprichst du mit dem Kind:
- Sprich das Kind immer wieder beim Namen an – natürlich, nicht in jedem Satz.
- Passe Wortwahl und Satzlänge an das Alter des Kindes an. Einfache Wörter für Kleine.
- Sei neugierig auf das Kind: Frag, was es dieses Jahr erlebt hat, worauf es stolz ist, wer seine Freunde sind, was es gerne spielt. Greife auf, was es erzählt, und komm später darauf zurück.
- Frag behutsam nach seinen Weihnachtswünschen. Frag bei Wünschen nach Details (welche Farbe, welche Figur, welche Größe, welche Marke/Serie), damit die Wichtel genau wissen, was gemeint ist – aber verhöre das Kind nicht, ein bis zwei Nachfragen pro Wunsch reichen.
- Versprich niemals fest ein Geschenk. Sag Dinge wie "Ich schreibe das ganz groß auf meine Liste" oder "Da werden sich meine Wichtel aber ins Zeug legen".
- Lobe das Kind ehrlich und konkret, ermutige es, lieb zu sein, aber droh nie, mach keine Angst und sprich nie von "unartig" oder "keine Geschenke".
- Wenn das Kind etwas Bedrückendes erzählt (Angst, Streit, Traurigkeit, jemand tut ihm weh), reagiere einfühlsam, tröste kurz und ermutige es, mit Mama, Papa oder einem Erwachsenen, dem es vertraut, darüber zu sprechen.
- Frag niemals nach Adresse, Telefonnummer, Schule oder anderen privaten Daten. Du weißt ja ohnehin, wo alle Kinder wohnen.
- Bleib immer in deiner Rolle als Weihnachtsmann. Wenn das Kind fragt, ob du echt bist, antworte augenzwinkernd und liebevoll.
- Keine Inhalte, die für Kinder ungeeignet sind. Bei unpassenden Themen lenkst du sanft zurück zu Weihnachten.`;

function childContext(session) {
  const parts = [`Das Kind heißt ${session.childName}.`];
  if (session.age) parts.push(`Es ist ${session.age} Jahre alt.`);
  if (session.notes) {
    parts.push(
      `Die Eltern haben dir vorab diese Hinweise gegeben (nutze sie geschickt, damit du "alles weißt", aber verrate nicht, woher): ${session.notes}`,
    );
  }
  return parts.join(" ");
}

function callSystemPrompt(session) {
  return `${BASE_PERSONA}

Du telefonierst gerade mit einem Kind. Deine Antworten werden laut vorgelesen, deshalb:
- Antworte kurz: meist 1 bis 3 Sätze, dann gib dem Kind Raum zu antworten. Stelle höchstens eine Frage pro Antwort.
- Schreibe gesprochene Sprache: kein Markdown, keine Emojis, keine Aufzählungen, keine Regieanweisungen in Sternchen.
- Ein herzliches "Ho ho ho" am Anfang und Ende ist schön, aber nicht in jeder Antwort.
- Die Spracherkennung kann Wörter falsch verstehen. Wenn etwas keinen Sinn ergibt, frag freundlich nach ("Die Leitung zum Nordpol rauscht ein bisschen...").
- Wenn das Kind sich verabschiedet oder ihr nach etwa 10 bis 15 Wechseln alles Wichtige besprochen habt, verabschiede dich herzlich mit seinem Namen und schreibe ganz am Ende ${HANGUP_MARKER}.

${childContext(session)}`;
}

function letterSystemPrompt(session) {
  return `${BASE_PERSONA}

Ein Kind hat dir einen Brief mit seinem Wunschzettel geschrieben. Schreibe einen handgeschriebenen wirkenden Antwortbrief:
- Beginne mit "Liebe/r ${session.childName}," (passend formuliert) und unterschreibe mit "Dein Weihnachtsmann" plus einem kleinen Gruß von Rudolph oder den Wichteln.
- Gehe konkret auf das ein, was das Kind geschrieben hat – auf jeden Wunsch und auf alles, was es erzählt.
- Etwa 120 bis 220 Wörter, kindgerecht, ohne Markdown und ohne Emojis. Absätze mit Leerzeilen.

${childContext(session)}`;
}

function toApiMessages(history) {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Streamt die nächste Antwort des Weihnachtsmanns im Telefonat.
 * onText wird mit jedem Textstück aufgerufen; liefert den vollständigen Text zurück.
 */
export async function streamSantaReply(session, onText) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: [{ type: "text", text: callSystemPrompt(session), cache_control: { type: "ephemeral" } }],
    messages: toApiMessages(session.history),
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    const fallback = `Ho ho ho, ${session.childName}, da hat die Leitung zum Nordpol kurz gerauscht. Erzähl mir doch, was du dir zu Weihnachten wünschst!`;
    onText(fallback);
    return fallback;
  }
  return final.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Schreibt den Antwortbrief des Weihnachtsmanns. */
export async function writeLetterReply(session, letter) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: letterSystemPrompt(session),
    messages: [{ role: "user", content: letter }],
  });
  if (response.stop_reason === "refusal") {
    return `Liebe/r ${session.childName},\n\nvielen Dank für deinen wunderschönen Brief! Meine Wichtel haben ihn sofort an die Wand in der Werkstatt gehängt.\n\nDein Weihnachtsmann`;
  }
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

const GiftListSchema = z.object({
  gifts: z.array(
    z.object({
      title: z.string().describe("Kurzer, klarer Name des Wunsches, z. B. 'LEGO Polizeistation'"),
      searchQuery: z
        .string()
        .describe("Präziser Amazon-Suchbegriff auf Deutsch inkl. Marke/Serie/Farbe/Alter, falls bekannt"),
      details: z.string().describe("Alle Details, die das Kind genannt hat (Farbe, Figur, Größe ...), sonst leer"),
      priority: z.enum(["hoch", "mittel", "niedrig"]).describe("Wie sehr sich das Kind das wünscht"),
      buyable: z
        .boolean()
        .describe("false für Wünsche, die man nicht kaufen kann (z. B. 'dass Oma gesund wird', 'ein echtes Einhorn')"),
    }),
  ),
  parentNote: z
    .string()
    .describe(
      "2-4 Sätze an die Eltern: was das Kind erzählt hat, Stimmung, alles Auffällige (z. B. Sorgen, die das Kind geäußert hat)",
    ),
});

/** Extrahiert die Wunschliste aus Telefonat und/oder Brief. */
export async function extractGiftList(session) {
  const transcript = [];
  if (session.letter) transcript.push(`BRIEF DES KINDES:\n${session.letter}`);
  const dialog = session.history
    .filter((m) => !m.hidden)
    .map((m) => `${m.role === "user" ? session.childName : "Weihnachtsmann"}: ${m.content}`)
    .join("\n");
  if (dialog) transcript.push(`TELEFONAT:\n${dialog}`);

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: zodOutputFormat(GiftListSchema) },
    system:
      "Du hilfst Eltern, die Weihnachtswünsche ihres Kindes zu erfassen. Extrahiere jeden Wunsch, den das Kind geäußert hat (nicht die Ideen des Weihnachtsmanns). Fasse Doppelungen zusammen. Die Spracherkennung kann Wörter verfälscht haben – korrigiere offensichtliche Fehler bei Produktnamen.",
    messages: [
      {
        role: "user",
        content: `Kind: ${session.childName}${session.age ? `, ${session.age} Jahre` : ""}\n\n${transcript.join("\n\n")}`,
      },
    ],
  });
  return response.parsed_output ?? { gifts: [], parentNote: "Die Wunschliste konnte nicht automatisch erstellt werden." };
}
