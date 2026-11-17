import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

const AMAZON_DOMAIN = process.env.AMAZON_DOMAIN || "amazon.de";
const PARTNER_TAG = process.env.AMAZON_PARTNER_TAG || "";

export function amazonSearchUrl(query) {
  const url = new URL(`https://www.${AMAZON_DOMAIN}/s`);
  url.searchParams.set("k", query);
  if (PARTNER_TAG) url.searchParams.set("tag", PARTNER_TAG);
  return url.toString();
}

const escape = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function buildEmail(session, result) {
  const buyable = result.gifts.filter((g) => g.buyable);
  const other = result.gifts.filter((g) => !g.buyable);
  const order = { hoch: 0, mittel: 1, niedrig: 2 };
  buyable.sort((a, b) => order[a.priority] - order[b.priority]);

  const rows = buyable
    .map(
      (g) => `<tr>
  <td style="padding:10px;border-bottom:1px solid #eee">
    <strong>${escape(g.title)}</strong>${g.priority === "hoch" ? ' <span style="color:#c0392b">★ großer Wunsch</span>' : ""}
    ${g.details ? `<br><span style="color:#666;font-size:14px">${escape(g.details)}</span>` : ""}
  </td>
  <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
    <a href="${amazonSearchUrl(g.searchQuery)}" style="background:#ff9900;color:#111;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:bold">Bei Amazon ansehen</a>
  </td>
</tr>`,
    )
    .join("\n");

  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222">
  <h2 style="color:#b3121f">🎅 Der Wunschzettel von ${escape(session.childName)}</h2>
  <p>Hallo${session.parentName ? ` ${escape(session.parentName)}` : ""},</p>
  <p>${escape(session.childName)} hat ${session.letter ? "dem Weihnachtsmann einen Brief geschrieben" : "mit dem Weihnachtsmann telefoniert"}. Hier ist die Einkaufsliste – nur für Eltern-Augen!</p>
  ${rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>` : "<p><em>Es wurden keine konkreten, kaufbaren Wünsche genannt.</em></p>"}
  ${other.length ? `<h3>Herzenswünsche (nicht käuflich)</h3><ul>${other.map((g) => `<li>${escape(g.title)}${g.details ? ` – ${escape(g.details)}` : ""}</li>`).join("")}</ul>` : ""}
  <h3>Notiz vom Weihnachtsmann</h3>
  <p style="background:#f7f3e8;padding:12px;border-radius:6px">${escape(result.parentNote)}</p>
  ${session.letterReply ? `<h3>Antwortbrief an ${escape(session.childName)}</h3><p style="white-space:pre-wrap;font-family:Georgia,serif">${escape(session.letterReply)}</p>` : ""}
  ${PARTNER_TAG ? '<p style="color:#999;font-size:12px">Die Amazon-Links sind Partnerlinks.</p>' : ""}
</div>`;

  const text = [
    `Der Wunschzettel von ${session.childName}`,
    "",
    ...buyable.map((g) => `- ${g.title}${g.details ? ` (${g.details})` : ""}: ${amazonSearchUrl(g.searchQuery)}`),
    ...(other.length ? ["", "Herzenswünsche:", ...other.map((g) => `- ${g.title}`)] : []),
    "",
    `Notiz: ${result.parentNote}`,
  ].join("\n");

  return { subject: `🎄 Wunschzettel von ${session.childName}`, html, text };
}

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

/** Verschickt die Mail per SMTP – oder legt sie lokal in data/outbox ab, wenn kein SMTP konfiguriert ist. */
export async function sendParentEmail(session, result) {
  const mail = buildEmail(session, result);
  if (transporter) {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || "Weihnachtsmann <weihnachtsmann@example.com>",
      to: session.parentEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { sent: true };
  }
  const dir = path.resolve("data/outbox");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${session.id}.html`);
  fs.writeFileSync(f, mail.html);
  console.log(`[mail] Kein SMTP konfiguriert – E-Mail für ${session.parentEmail} gespeichert unter ${f}`);
  return { sent: false, file: f };
}
