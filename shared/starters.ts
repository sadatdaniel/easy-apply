import type { DocMeta } from './types';

// Starter layouts offered during onboarding, for people without a CV file: example text you replace once.
export interface Starter { id: string; meta: DocMeta; body: string; note: string }

const CV_EN = `# Your Name

Your headline, e.g. Data Analyst

+49 170 000 0000 | you@example.com | yourwebsite.com | City

---

Two or three sentences about who you are, what you are good at and what you are looking for.

## Skills

- **Languages:** e.g. Python, SQL, TypeScript
- **Tools:** e.g. Git, Docker, Excel
- **Other:** e.g. project management, data analysis

## Professional Experience

### Job title | 01/2023 – present
Company, City

- What you achieved, ideally with a number (e.g. "cut report time by 40%")
- A second result or responsibility

### Earlier job title | 06/2020 – 12/2022
Company, City

- What you did there

## Education

### Degree, subject | 2016 – 2020
University, City

## Languages

- English – C1
- German – B1
`;

const CV_DE = `# Your Name

Your headline, e.g. Data Analyst

+49 170 000 0000 | you@example.com | yourwebsite.com | City

---

Zwei, drei Sätze dazu, wer Sie sind, was Sie gut können und was Sie suchen.

## Kenntnisse

- **Programmiersprachen:** z. B. Python, SQL
- **Werkzeuge:** z. B. Git, Docker, Excel

## Berufserfahrung

### Position | 01/2023 – heute
Firma, Ort

- Was Sie erreicht haben, am besten mit einer Zahl
- Eine weitere Aufgabe oder ein Ergebnis

## Ausbildung

### Abschluss, Fach | 2016 – 2020
Hochschule, Ort

## Sprachen

- Deutsch – Muttersprache
- Englisch – C1
`;

const COVER_EN = `# Your Name

City
+49 170 000 0000 · you@example.com

---

Date

Company name
City

**Application for Job title**

Dear Hiring Team,

Opening: why this role at this company caught your attention, in one or two sentences.

Your strongest match: one concrete experience that shows you can do what the role asks.

A second strength or result, ideally with a number.

Why this company: something specific about the company, product or team.

I would welcome the chance to talk about how I can contribute. Thank you for your time.

Kind regards,
Your Name
`;

const COVER_DE = `# Your Name

City
+49 170 000 0000 · you@example.com

---

Datum

Firmenname
Ort

**Bewerbung als Stellentitel**

Sehr geehrte Damen und Herren,

Einstieg: warum diese Stelle Sie anspricht, in ein, zwei Sätzen.

Ihre stärkste Übereinstimmung: eine konkrete Erfahrung, die zeigt, dass Sie die Aufgaben erfüllen können.

Eine zweite Stärke oder ein Ergebnis, am besten mit Zahl.

Warum dieses Unternehmen: etwas Konkretes über das Unternehmen, Produkt oder Team.

Über eine Einladung zu einem persönlichen Gespräch freue ich mich.

Mit freundlichen Grüßen
Your Name
`;

export const STARTERS: Starter[] = [
  { id: 'cv-en', meta: { title: 'CV · English', kind: 'cv', lang: 'en', theme: 'classic' }, body: CV_EN, note: 'One page, reverse-chronological.' },
  { id: 'cover-en', meta: { title: 'Cover letter · English', kind: 'cover', lang: 'en', theme: 'classic' }, body: COVER_EN, note: 'A short letter to adapt for each job.' },
  { id: 'cv-de', meta: { title: 'Lebenslauf · Deutsch', kind: 'cv', lang: 'de', theme: 'classic' }, body: CV_DE, note: 'German CV layout.' },
  { id: 'cover-de', meta: { title: 'Anschreiben · Deutsch', kind: 'cover', lang: 'de', theme: 'classic' }, body: COVER_DE, note: 'German cover letter.' },
];
