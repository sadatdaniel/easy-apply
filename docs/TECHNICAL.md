# Easy Apply — technical notes

For what the app does, see the [README](../README.md). This page is for running, building and changing it.

A local-first app for job applications. Each job gets its own folder. You copy your CV and cover letter into it, tailor them, keep every version, and export them in the order you choose.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The app runs entirely in the browser. On first start it asks where to keep your files, then the app's look, your CV and letter (or a starter layout), and an AI provider (optional).

- **A folder on this computer** (Chrome, Edge): the app reads and writes plain files in the folder you pick. After a browser restart it asks once for permission again, unless you choose "Allow on every visit".
- **Inside this browser** (any browser): private browser storage; files are reachable only through the app.

`npm run dev` also starts a small local helper on port 4317. Browsers may not read other websites, so the helper is what fetches a job posting from a link (the hosted app has the same fetch as a Cloudflare function, `functions/api/fetch-posting.ts`). Without either, paste the posting text. The helper only answers pages on localhost (add a hosted copy's origin with `EASYCV_ORIGINS=https://…`) and refuses private network addresses.

### Hosting (Cloudflare Workers)

The public site is published by Cloudflare from this repository: every push to `main` is built and published, other branches get preview versions. Build command `npm run build -w web`, deploy command `npx wrangler deploy` (preview: `npx wrangler versions upload`), environment variable `NODE_VERSION=22`; `wrangler.jsonc` points Cloudflare at `web/dist` and at `worker/index.ts`, which runs the posting fetcher (`functions/api/fetch-posting.ts`, which also works as a Pages Function). Missing files are real 404s, never the app's page. The fetcher it fetches a job posting's page for the browser (only the link is sent, only the app's own pages may use it, never local or private addresses; see `shared/fetchpage.ts`). `web/public/_headers` sets response headers (no caching for the offline worker, so updates arrive). `EASYCV_BASE=/sub/path/` builds the app for a host that serves it under a sub-path.

### Install, offline, updates

`npm run build` produces `web/dist`, a static site that can be hosted anywhere (e.g. GitHub Pages) or served with `npm start`. It is an installable web app: after the first visit it works offline, and when a new version is published it shows "A new version is ready – Reload" instead of switching under you.

## Where things live

```
<your folder>/
  templates/*.md                  Documents: your CVs and cover letters (Markdown + frontmatter)
  extras/                         Documents › Files: certificates, references …
  jobs/<date>_<company>_<role>/
    job.json  posting.md          details, status history, posting snapshot
    cv-en.md  cover-en.md         this job's own copies — edit freely
    <certificate>.pdf             files added to this application
    versions/                     earlier versions of each document
    .removed/                     documents taken out of this application
```

AI settings and keys are kept in the browser (IndexedDB), never in the folder.

Code: `shared/` holds everything that does not depend on where it runs (document model, themes, store, AI prompts); `web/` is the React app plus the browser file access; `server/` is the optional link-fetch helper.

## Export

Step 3 (Export) puts documents, attached PDFs and images in the order you set (drag, or the arrows) and previews the merged PDF on request. **Download one PDF** gives that file; **Download zip** gives the merged PDF plus every file on its own, numbered in order; ⬇ next to a file downloads just that one. Files that can't be merged (e.g. .docx) go into the zip only.

Pages: `web/src/paginate.ts` decides where pages break (A4, 12 mm top and bottom margins; a heading never stays alone at the bottom), once, for the editor and the PDF alike. The editor shows the pages; the PDF gets a page break at the same places, so both match.

Documents become PDFs in the browser (`web/src/pdfdraw.ts`, with pdf-lib and fontkit): the page is laid out off screen with the app's styles, broken into pages by `paginate.ts`, and every word, line, border, bullet and coloured area is drawn into the PDF where the browser put it. Text lines and box edges sit on whole pixels, as they do when Chrome prints, and each word is spread to the width the browser measured, so the PDF matches the editor and a printed copy to within a pixel. The text is real, in reading order, in embedded subsets of the bundled fonts, so applicant tracking systems can read it; links are clickable. A Word file's own fonts (Calibri, Cambria, ...) come from the computer through Local Font Access (Chrome and Edge, once allowed, from the Export step); without them the page is laid out and drawn in the stand-in font (Arimo or Tinos). Nothing is sent anywhere. "Print the documents with the browser" remains as an alternative.

## Backup

Settings › Your files › **Download backup (.zip)** saves everything (your documents and files, every application with its versions). **Restore from backup…** adds and replaces files and never deletes; any file it replaces is kept in `.trash/restore-<time>/`. Backup zips are checked before anything is written: only paths inside the app's folders, at most 20,000 files and 1 GB unpacked. With browser storage, a reminder appears once you have a few applications and no backup in two weeks.

## Appearance

Settings › Appearance (also the first onboarding step) picks the look of the app — Graphite (default), Slate or Midnight — and an accent colour. Looks are sets of CSS tokens in `web/src/styles.css`; accents live in `web/src/appearance.ts`, each with shades checked for contrast on light surfaces and on Midnight's dark columns. The choice is stored per device. Documents are not affected; they keep their own look.

## Documents

Everything starts from your CV. Under **Documents** (stored as `templates/*.md`, files in `extras/`), upload it as Word or PDF; a PDF holding a cover letter and a CV is split into both. Documents open for editing in their own window. Adding a document to an application copies it into the application's folder; only that copy changes. Deleting moves a file to `.trash/`.

**Upload:** Documents › "Upload CV or letter", the drop area, or during onboarding. Files are read in the browser (mammoth for Word, pdf.js for PDF); nothing is uploaded. It recognises the name and contact line, section headings (ALL CAPS, bold through a Word style, or common section words in English and German), entries written as "title + table row company | dates" or "title ⇥ dates", bullets, bold, italic and links. A layout table (a photo beside the name and contact lines) is read as text, in order. Images are left out. You review the result with a live preview before saving. Old .doc files need to be saved as .docx first.

**Your file's own look** (`theme: original`, `look:` in the frontmatter): a Word file's fonts, sizes, colours, bold and capitals, heading lines, line spacing, paragraph spacing, alignment and side margins are read from its styles (`shared/docxlook.ts`); a PDF gives its fonts, sizes, line spacing and margins (`shared/pdflook.ts`). They are drawn by `.t-original` in `web/src/themes.css` through CSS variables (`shared/look.ts`, which checks every value). Fonts come from the computer, with a bundled stand-in for missing ones.

**Examples:** four complete pairs (CV + cover letter) of a made-up person, in the Classic, Two-column, Elegant and Academic looks (`shared/examples.ts`); the looks are `.t-classic`, `.t-sidebar`, `.t-serif` and `.t-academic` in `web/src/themes.css`.

Documents are Markdown. The page itself is the editor (`web/src/DocEditor.tsx`, `web/src/pageEdit.ts`): click anywhere and type, select across lines, Ctrl+Z / Ctrl+Shift+Z, copy and paste between documents (as Markdown, HTML and plain text; Word and Google Docs HTML is read on paste). Each change is applied to the document's blocks and the page is drawn again.

```markdown
# Alex Example
Data Engineer
+49 151 000 0000 | alex@example.com | Hamburg

---

## Professional Experience
### Data Engineer | 03/2023 – present
Harbour Foods, Hamburg
- What you did
```

The formatting bar above the page acts on the selection (Text, Bullet, Section; **B**old Ctrl+B, *I*talic Ctrl+I, Link Ctrl+K, Divider). The panel on the right holds settings for the whole document (text size, line spacing, alignment, margins), saved in the frontmatter as `style:`, plus the keyword match and versions. A divider right under the contact line takes the place of the look's own line.

Placeholders such as `{{company}}` are no longer used; ones in older documents are still filled in when a document is copied into an application.

## AI

In Settings › AI providers, add as many as you like: Ollama, LM Studio, OpenRouter, OpenAI, another OpenAI-compatible API, or Gemini. They form a fallback chain, tried top to bottom (drag or use the arrows to reorder). Each has a timeout and optional limits per minute and per 24 hours, prefilled with known free-tier numbers (Gemini, OpenRouter `:free` models) that you can adjust. A provider that is at its limit, cooling down after a "too many requests" answer, slow or failing is skipped; if every provider is only waiting for its limit, Easy Apply waits for the next free slot (up to a minute) instead of going over. Usage is counted in this browser, and the title bar shows what the chain is doing. Calls go straight from the browser to the provider. Ollama accepts localhost pages by default; for a hosted copy set `OLLAMA_ORIGINS` to its address. In LM Studio, turn on CORS. The AI fills in job details from a posting, and tailors documents one part at a time: in the editor, turn on **✨ Tailor** (or press ✨ while editing a line), click a bullet or paragraph, and review the word diff. Accept saves it and keeps the earlier text as a version; Edit, Retry (optionally with a wish such as "shorter") and Reject do what they say. The model sees the full posting, all of the job's documents and your CV under Documents, and may only use facts from them. Name, contact, entry titles, dates and company lines are left for you to edit by hand. If a suggestion uses a posting keyword that none of your documents mention, the card warns you before you accept it.

## Tests

```bash
npm test                                    # unit tests (vitest)
cd server && node test/live/pwa.mjs <dir>   # offline, update and broken-update checks of a production build in headless Edge
```
