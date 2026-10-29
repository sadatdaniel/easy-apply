# Easy Apply — technical notes

For what the app does, see the [README](../README.md). This page is for running, building and changing it.

A local-first app for job applications. Each job gets its own folder. You copy your CV and cover-letter templates into it, tailor them, keep every version, and export them in the order you choose.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The app runs entirely in the browser. On first start it asks where to keep your files and a few onboarding questions (your details, starter templates, AI).

- **A folder on this computer** (Chrome, Edge): the app reads and writes plain files in the folder you pick. After a browser restart it asks once for permission again, unless you choose "Allow on every visit".
- **Inside this browser** (any browser): private browser storage; files are reachable only through the app.

`npm run dev` also starts a small local helper on port 4317. Browsers may not read other websites, so the helper is what fetches a job posting from a link; it also creates the PDFs (see Export). Without it, paste the posting text. The helper only answers pages on localhost (add a hosted copy's origin with `EASYCV_ORIGINS=https://…`) and refuses private network addresses.

### Install, offline, updates

`npm run build` produces `web/dist`, a static site that can be hosted anywhere (e.g. GitHub Pages) or served with `npm start`. It is an installable web app: after the first visit it works offline, and when a new version is published it shows "A new version is ready – Reload" instead of switching under you.

## Where things live

```
<your folder>/
  profile/profile.json            values for {{placeholders}}
  templates/*.md                  your CV / cover-letter templates (Markdown + frontmatter)
  extras/                         certificates, references …
  jobs/<date>_<company>_<role>/
    job.json  posting.md          details, status history, posting snapshot
    cv-en.md  cover-en.md         this job's own copies — edit freely
    versions/                     earlier versions of each document
```

AI settings and keys are kept in the browser (IndexedDB), never in the folder.

Code: `shared/` holds everything that does not depend on where it runs (document model, themes, store, AI prompts); `web/` is the React app plus the browser file access; `server/` is the optional link-fetch helper.

## Export

Step 5 (Final bucket) puts documents, attached PDFs and images in the order you set (drag or arrows) and shows a live preview of the merged PDF. **Download one PDF** gives that file; **Download zip** gives the merged PDF plus every file on its own, numbered in order. Files that can't be merged (e.g. .docx) go into the zip only.

Documents become PDFs through the local helper, which prints them with the Edge or Chrome already installed (Playwright drives it; no browser is downloaded; set `EASYCV_BROWSER` to use another Chromium). The PDFs have real, selectable text, which applicant tracking systems need. Fonts are bundled with the app and embedded into each page sent to the helper, so PDFs look the same offline. Without the helper, "print the documents with the browser" still works.

## Backup

Settings › Your files › **Download backup (.zip)** saves everything (profile, CVs and letters, extras, every application with its versions). **Restore from backup…** adds and replaces files and never deletes; any file it replaces is kept in `.trash/restore-<time>/`. Backup zips are checked before anything is written: only paths inside the app's folders, at most 20,000 files and 1 GB unpacked. With browser storage, a reminder appears once you have a few applications and no backup in two weeks.

## Appearance

Settings › Appearance (also the first onboarding step) picks the look of the app — Graphite (default), Slate or Midnight — and an accent colour. Looks are sets of CSS tokens in `web/src/styles.css`; accents live in `web/src/appearance.ts`, each with shades checked for contrast on light surfaces and on Midnight's dark columns. The choice is stored per device. Documents are not affected; they keep their resume theme.

## Documents

Everything starts from your CV. Under **Documents** (stored as `templates/*.md`), upload it as Word or PDF. A PDF holding a cover letter and a CV is split into both. Mark one CV and one cover letter per language as **main** (★). Your main CV is the source of facts for every AI suggestion, and new applications start from both ("Save & start with your CV and letter"). When you upload a letter written for one job, the company, role, date and job location it mentions become placeholders (you confirm each), so every new application fills them in; ✨ Tailor then rewrites the job-specific paragraphs. Deleting moves a file to `.trash/`.


**Upload a CV:** Documents › "Upload CV (Word or PDF)…", or during onboarding (the second step). Files are read in the browser (mammoth for Word, pdf.js for PDF) and nothing is uploaded. It recognises the name and contact line, section headings (ALL CAPS or common section words in English and German), entries written as "title + table row company | dates" or "title ⇥ dates", bullets, bold, italic and links. Your profile details in the header become placeholders, and an empty profile can be filled from the CV. You review the result with a live preview before saving. Old .doc files need to be saved as .docx first.

Templates are Markdown. Each block (heading, paragraph, bullet) can be edited on its own by clicking it on the page:

```markdown
# {{name}}
{{phone}} | {{email}} | {{website}}

## Professional Experience
### Job title | 01/2024 – now
Company, City
- What you did
```

The formatting bar above the page works on the line you are editing, or on several lines selected by dragging across them or with Shift+click (Text, Bullet, Section, Entry; **B**old Ctrl+B, *I*talic Ctrl+I, Link Ctrl+K, Divider) and on the whole document (text size, line spacing, left/justified, margins). Whole-document settings are saved in the file's frontmatter as `style:` and also apply to print/PDF. Per-word font sizes are deliberately not offered: Markdown can't store them, and a CV reads better when it is consistent.

Placeholders come from Profile (`{{name}}`, `{{email}}` …) and from the job (`{{company}}`, `{{job_title}}`, `{{job_location}}`, `{{today}}`). They are filled in once, when a template is copied into a job.

Themes live in `web/src/themes.css`: Classic, Sidebar, Serif and Academic. To add one, add a `.t-<name>` block there and an entry in `THEMES` in `shared/render.ts`.

## AI

In Settings › AI providers, add as many as you like: Ollama, LM Studio, OpenRouter, OpenAI, another OpenAI-compatible API, or Gemini. They form a fallback chain, tried top to bottom (drag or use the arrows to reorder). Each has a timeout and optional limits per minute and per 24 hours, prefilled with known free-tier numbers (Gemini, OpenRouter `:free` models) that you can adjust. A provider that is at its limit, cooling down after a "too many requests" answer, slow or failing is skipped; if every provider is only waiting for its limit, Easy Apply waits for the next free slot (up to a minute) instead of going over. Usage is counted in this browser, and the title bar shows what the chain is doing. Calls go straight from the browser to the provider. Ollama accepts localhost pages by default; for a hosted copy set `OLLAMA_ORIGINS` to its address. In LM Studio, turn on CORS. The AI fills in job details from a posting, and tailors documents one part at a time: in the editor, turn on **✨ Tailor** (or press ✨ while editing a line), click a bullet or paragraph, and review the word diff. Accept saves it and keeps the earlier text as a version; Edit, Retry (optionally with a wish such as "shorter") and Reject do what they say. The model sees the full posting and all of the job's documents, and may only use facts from them. Name, contact, entry titles, dates and company lines are left for you to edit by hand. If a suggestion uses a posting keyword that none of your documents mention, the card warns you before you accept it.
