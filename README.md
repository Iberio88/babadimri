# 🎅 Weihnachtsmann-Hotline

Kinder können den Weihnachtsmann **anrufen** (Sprache) oder ihm einen **Brief schreiben**.
Der Weihnachtsmann spricht das Kind persönlich mit Namen an, geht auf alles ein, was es erzählt,
und fragt nach Details zu den Wünschen. Am Ende wird daraus eine **Amazon-Einkaufsliste** erstellt
und den Eltern per E-Mail geschickt – das Kind sieht davon nichts.

## Ablauf

1. **Eltern** geben Vorname + Alter des Kindes, ihre E-Mail-Adresse und optional „Geheimtipps“
   (Haustier, Geschwister, Erlebnisse des Jahres) ein – damit wirkt der Weihnachtsmann allwissend.
2. **Kind** wählt *Anrufen* oder *Brief schreiben*.
   - **Anruf:** Spracherkennung im Browser (Deutsch) → Claude antwortet als Weihnachtsmann (gestreamt) →
     Antwort wird Satz für Satz vorgelesen. Der Weihnachtsmann legt selbst auf, wenn alles besprochen ist.
   - **Brief:** Das Kind schreibt, der Weihnachtsmann antwortet mit einem persönlichen Brief (auch vorlesbar).
3. **Abschluss:** Claude extrahiert die Wünsche (inkl. Details wie Farbe/Serie, Priorität,
   „Herzenswünsche“, die man nicht kaufen kann) und eine kurze Notiz für die Eltern.
   Die Eltern bekommen eine E-Mail mit Amazon-Links zu jedem Wunsch.

## Start

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY eintragen, optional SMTP + ElevenLabs
npm start              # http://localhost:3000
```

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | **Pflicht.** Claude als Weihnachtsmann |
| `SMTP_*`, `MAIL_FROM` | E-Mail-Versand. Ohne SMTP landet die Mail als HTML in `data/outbox/` |
| `AMAZON_DOMAIN` | z. B. `amazon.de`, `amazon.at` |
| `AMAZON_PARTNER_TAG` | Optional: Amazon-PartnerNet-ID für Provisionen |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Optional, **sehr empfohlen**: natürliche, tiefe Weihnachtsmann-Stimme. Ohne nutzt der Browser seine eingebaute Stimme |

## Hinweise

- **Browser:** Spracherkennung funktioniert in Chrome, Edge und Safari. In anderen Browsern
  (z. B. Firefox) erscheint automatisch ein Textfeld.
- **Mikrofon** braucht HTTPS (oder `localhost`).
- **Datenschutz:** Es werden Daten von Kindern verarbeitet. Vor dem Livegang Datenschutzerklärung,
  Impressum, Auftragsverarbeitungsverträge (Anthropic, ggf. ElevenLabs, Mail-Anbieter) und
  Löschfristen für `data/sessions/` klären.
- **Amazon:** Die Links sind Amazon-Suchen zu präzisen Suchbegriffen. Für direkte Produktlinks mit
  Preisen wäre die Amazon Product Advertising API nötig (PartnerNet-Konto).

## Struktur

```
server.js          Express-API
src/santa.js       Weihnachtsmann-Persona, Telefonat (Streaming), Antwortbrief, Wunschlisten-Extraktion
src/mailer.js      E-Mail an die Eltern + Amazon-Links
src/tts.js         Optionale ElevenLabs-Stimme
src/store.js       Sitzungen als JSON in data/sessions/
public/            Oberfläche (HTML/CSS/JS, keine Build-Tools)
```
