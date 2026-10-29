# Easy Apply

**Never lose track of which CV and cover letter you sent where.**

After a few weeks of job hunting, the files pile up: `CV_final.docx`, `CV_final_v2_EN.docx`, `Cover_Letter_Acme_new.pdf`… Which version went to which company? Did you change the German one too? What exactly did you send the company that just invited you to an interview?

Easy Apply keeps it all in order. Think in folders and files: every application gets its own folder, holding the posting, the exact CV and letter you sent, every earlier version, and where things stand.

![An application in its own window: its files in a strip, the one you picked open for editing](docs/screenshots/applications.png)

## One place for every application

**A folder per job.** When you add a job, Easy Apply creates its folder. That folder holds:
- the posting, saved in case the ad disappears;
- the job's details: company, role, deadline and contact;
- that job's own copies of your CV and cover letter, plus any certificates or references you add.

**One application, one window.** Each application opens in its own window, in three steps: the posting, the documents, the export. Minimise it like an email you are writing, look something up, and come back. It saves as you go and opens where you left off.

**Your originals stay clean.** Your CVs, cover letters and files live under *Documents*. An application always works on its own copy, so changing a letter for one company never touches the original or any other application.

![Documents: your CVs, cover letters and files, with a large preview](docs/screenshots/documents.png)

**Your file keeps its look.** Upload your CV and cover letter as Word or PDF. Easy Apply keeps their own fonts, sizes, colours and spacing; it doesn't force a design on you. No CV yet? Start from one of four complete examples, each a CV with a matching letter.

**Edit like in a word processor.** Click anywhere on the page and type. Select across lines, undo and redo, copy and paste between documents. The editor shows real pages, and the PDF breaks them in exactly the same places: what you see is what you send.

**Every version kept.** Each change you make is saved, and earlier versions stay in the job's folder. You can always see what you sent, and go back to any version with one click.

**Know where everything stands.** A tracker shows every application at a glance, with its status (applied, interview, offer, rejected), what's next, and when. Open any application to see exactly what you sent.

![The tracker](docs/screenshots/tracker.png)

**Export it the same way every time.** Drag the documents for a job into order (letter, CV, certificates, references), preview them, and download one PDF, a zip, or each file on its own. You get the same clean result for every application, named the way you chose.

## Privacy first

Your CV is about as personal as documents get. Easy Apply treats it that way.

- **Your files stay with you.** Everything is stored as ordinary files in a folder you choose, or inside your browser, on your own computer. There's no account, no cloud and no server holding your data.
- **Nothing calls home.** No analytics, no tracking, no telemetry. Easy Apply only goes online when you ask it to: to fetch a job posting from a link (only the link is sent, never your documents), or to use the AI provider you chose.
- **You decide about AI.** It's entirely optional; the app works fully without it. If you want it, run a model on your own computer, so nothing leaves your machine. Or use your own key for OpenRouter, OpenAI or Gemini, and the app tells you when text goes to a cloud service.
- **Your keys stay in your browser.** They're never written into your documents folder, and they're only sent to the provider they belong to.
- **Works offline.** Once opened, Easy Apply runs without an internet connection, and a full backup is one click.

## Help along the way

- **Fill in a job from its posting.** Paste the ad or its link, and AI (if you use it) fills in the details.
- **Tailor with care.** Click a line to get a version matched to the job, and accept or reject it word by word. AI may only use facts from your own documents, and anything new is flagged.
- **Recently used first.** Adding documents to an application shows what you used last on top, with a large preview, like a Finder window.

![A tailoring suggestion: what changes, word by word](docs/screenshots/tailor.png)

## Local AI first

I believe AI that runs on your own computer is the future, so local models are first-class in Easy Apply, not an afterthought. Your CV never has to leave your machine to get help with it. The prompts are written and tested for small local models; Easy Apply is tested with Gemma 4 (`e2b-text-128k`) running in [Ollama](https://ollama.com).

**Set up Ollama:**

1. Install Ollama from [ollama.com](https://ollama.com) and download a model, for example: `ollama pull gemma4:e2b`
2. Let the Easy Apply website talk to it. Ollama only answers pages it trusts, so add Easy Apply's address once:
   - **Windows:** Settings › System › About › Advanced system settings › Environment Variables › New user variable: name `OLLAMA_ORIGINS`, value `https://easy-apply.sadatdaniel.workers.dev`. Then quit Ollama from the system tray and start it again.
   - **macOS:** in Terminal, `launchctl setenv OLLAMA_ORIGINS "https://easy-apply.sadatdaniel.workers.dev"`, then quit and reopen Ollama.
   - **Linux:** `sudo systemctl edit ollama.service`, add `Environment="OLLAMA_ORIGINS=https://easy-apply.sadatdaniel.workers.dev"` under `[Service]`, then `sudo systemctl restart ollama`.
3. In Easy Apply, open Settings › AI providers, add **Ollama (local)** and pick your model. Chrome or Edge may ask once whether the site may connect to devices on your local network; allow it, since that is how it reaches Ollama on your computer.

LM Studio works the same way: turn on CORS in its server settings.

## Good to know

- **Chrome or Edge.** Easy Apply is built and tested for them. Firefox and Safari don't let a website open a folder on your computer, and there's nothing a website can do about that: in those browsers your files can only live inside the browser.

- Word files keep their look best. A PDF keeps its fonts and sizes, but not its colours.
- Photos and other images inside a CV are left out; the text comes through.
- Designer templates built from floating text boxes come in as text, but may need their order and headings fixed by hand.

## Get started

Open **[easy-apply.sadatdaniel.workers.dev](https://easy-apply.sadatdaniel.workers.dev)** in Chrome or Edge. Nothing to install: choose where to keep your files, upload your CV and cover letter, and Easy Apply guides you through the rest. After the first visit it also works offline (the first visit downloads the whole app, about 5 MB, so give it a minute), and you can install it as an app from the address bar.

**Run it yourself:** you need [Node.js](https://nodejs.org) (version 20 or newer).

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

Want to know how it works inside? See the [technical notes](docs/TECHNICAL.md).

## License

Copyright (c) 2026 Sadat Daniel. Easy Apply is free software under the [GNU Affero General Public License v3.0](LICENSE): you may use, change and share it, and if you share a changed version, or offer it to others as a website or service, you must publish your changes under the same licence.
