// Does a very long, repetitive posting finish, or at least fail within the timeout? (not part of `npm test`)
import { askWith, extractJob } from '../../../shared/ai';

const TIMEOUT = Number(process.argv[2] ?? 120_000);
const ask = askWith({ provider: 'openai', preset: 'ollama', baseURL: 'http://localhost:11434/v1', apiKey: '', model: 'e2b-text-128k:latest' }, TIMEOUT);
const huge = 'Senior Data Engineer at Elbe Health, Hamburg. ' + 'You will build reliable data pipelines with Python, SQL and Airflow for clinical reporting. '.repeat(330) + ' Requirements: Python, SQL, Airflow, dbt, English C1. Salary 70,000 EUR.';
const t = Date.now();
const tick = setInterval(() => console.log(`… ${Math.round((Date.now() - t) / 1000)}s`), 30_000);
try {
  const r = await extractJob(ask, huge);
  console.log(`OK after ${((Date.now() - t) / 1000).toFixed(1)}s`, JSON.stringify(r).slice(0, 240));
} catch (e) {
  console.log(`ERROR after ${((Date.now() - t) / 1000).toFixed(1)}s:`, (e as Error).message);
} finally { clearInterval(tick); }
