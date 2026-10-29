import type { DocMeta } from './types';

// Examples that ship with the app: a complete CV and cover letter of a made-up person, Alex Example,
// to start from when you have no file of your own (or want to see what a finished one looks like).
// Copied into an application like any document; replace Alex's details with yours.
export interface Example { id: string; meta: DocMeta; body: string; note: string }

const CV = `# Alex Example

Data Engineer

+49 151 000 0000 | alex@example.com | github.com/alex-example | Hamburg

Data engineer with five years of experience turning messy operational data into reliable pipelines and clear reports. Looking for a team that ships data products people use every day.

## Skills

- **Languages:** Python, SQL, TypeScript
- **Tools:** PostgreSQL, Airflow, dbt, Docker, Git
- **Reporting:** Power BI, Looker, Pandas

## Professional Experience

### Data Engineer | 03/2023 – present
Harbour Foods, Hamburg

- Built Python and SQL pipelines that feed the daily sales and delivery dashboards for 40 stores
- Moved weekly Excel reports to automated jobs, saving the team about four hours a week
- Designed the PostgreSQL data model for orders, customers and deliveries

### Junior Developer | 09/2020 – 02/2023
Kiel Apps, Kiel

- Developed REST APIs in Flask for a mobile app with 20,000 users
- Introduced automated tests and code reviews for the backend team

## Education

### B.Sc. Computer Science | 2016 – 2020
University of Hamburg

## Languages

- English – C1
- German – native
`;

const LETTER = `# Alex Example

alex@example.com · +49 151 000 0000

---

{{today}}

**{{company}}**

{{job_location}}

**Application: {{job_title}}**

Dear {{company}} team,

I'm applying for the {{job_title}} role. For the past five years I have turned messy operational data into pipelines and reports that people rely on every morning, and I would love to do the same at {{company}}.

At Harbour Foods I build the Python and SQL pipelines behind our daily sales and delivery dashboards. When I joined, the weekly reports were assembled by hand in Excel; I moved them to automated jobs, which now save the team about four hours every week and arrive before the Monday meeting.

Before that, at Kiel Apps, I developed REST APIs for a mobile app with 20,000 users and introduced automated tests and code reviews for the backend team.

I would be glad to show in a conversation how I could help {{company}}. Thank you for your time.

Kind regards,

Alex Example
`;

export const EXAMPLES: Example[] = [
  { id: 'example-cv', meta: { title: 'Example CV', kind: 'cv', lang: 'en', theme: 'classic' }, body: CV, note: 'A complete one-page CV of a made-up data engineer.' },
  { id: 'example-letter', meta: { title: 'Example cover letter', kind: 'cover', lang: 'en', theme: 'classic' }, body: LETTER, note: 'Fills in the company, role and date of each job.' },
];
