import type { DocMeta } from './types';

// Examples that ship with the app: a complete CV and cover letter of a made-up person, Alex Example, in each
// of the four looks the app can draw. Start from one when you have no file of your own (or like its look);
// it is copied like any document, and you replace Alex's details with yours.
export interface Example { id: string; meta: DocMeta; body: string; note: string }

const CV = `# Alex Example

Data Engineer

+49 151 000 0000 | alex@example.com | github.com/alex-example | Hamburg

---

Data engineer with six years of experience turning messy operational data into reliable pipelines and clear reports. I like owning a data product end to end, from the first conversation with the people who use it to the dashboard they open every morning. Looking for a team that ships data products people use every day.

## Skills

- **Languages:** Python, SQL, TypeScript, Bash
- **Data:** PostgreSQL, BigQuery, Airflow, dbt, Kafka, Pandas
- **Reporting:** Power BI, Looker, Metabase
- **Engineering:** Docker, Git, GitHub Actions, Terraform, automated testing
- **Ways of working:** Scrum, code reviews, writing clear documentation

## Professional Experience

### Data Engineer | 03/2023 – present
Harbour Foods, Hamburg

- Built Python and SQL pipelines that feed the daily sales and delivery dashboards for 40 stores
- Moved weekly Excel reports to automated jobs, saving the team about four hours a week
- Designed the PostgreSQL data model for orders, customers and deliveries, used by four teams
- Cut the nightly load from three hours to 40 minutes by moving transformations to dbt
- Set up data quality checks that catch missing deliveries before the morning stand-up

### Junior Developer | 09/2020 – 02/2023
Kiel Apps, Kiel

- Developed REST APIs in Flask for a mobile app with 20,000 users
- Introduced automated tests and code reviews for the backend team, raising test coverage from 20% to 75%
- Built the first reporting database for app usage, which the product team still uses
- Mentored two working students during their first months

### Working Student, Data | 04/2018 – 08/2020
Nordlicht Energy, Hamburg

- Cleaned and joined meter readings from three systems into one weekly report
- Automated the monthly KPI deck with Python, from two days of work to one hour

## Projects

### Bike-share demand forecast | 2024
github.com/alex-example/bike-demand

- Forecasts hourly demand per station from weather and holiday data; open source, 120 stars

### Grocery price tracker | 2022
github.com/alex-example/price-tracker

- Scrapes and compares weekly prices from five supermarkets; used by a local consumer blog

## Education

### B.Sc. Computer Science | 2016 – 2020
University of Hamburg

- Thesis: Detecting late deliveries from GPS traces (grade 1.3)

## Certifications

- AWS Certified Data Engineer – Associate (2025)
- dbt Analytics Engineering Certification (2024)

## Languages

- German – native
- English – C1
- Spanish – A2

## Interests

- Cycling, open data meetups, cooking for friends
`;

const LETTER = `# Alex Example

alex@example.com · +49 151 000 0000 · Hamburg

---

**Application: Data Engineer**

Dear Hiring Team,

I'm applying for the Data Engineer role. For the past six years I have turned messy operational data into pipelines and reports that people rely on every morning, and I would love to do the same for your team.

At Harbour Foods I build the Python and SQL pipelines behind our daily sales and delivery dashboards for 40 stores. When I joined, the weekly reports were assembled by hand in Excel; I moved them to automated jobs, which now save the team about four hours every week and arrive before the Monday meeting. Last year I moved our transformations to dbt, which cut the nightly load from three hours to 40 minutes and gave the analysts tests they can trust.

What I enjoy most is the part between the data and the people who use it. Before I build anything, I sit with the store managers or the finance team to understand which question they are trying to answer, and I keep the result simple enough that they can change it themselves.

Before that, at Kiel Apps, I developed REST APIs for a mobile app with 20,000 users and introduced automated tests and code reviews for the backend team. It taught me to write code that other people can pick up, and to leave every project better documented than I found it.

I would be glad to show in a conversation how I could help your team. Thank you for your time.

Kind regards,

Alex Example
`;

/** four looks, each a CV and a matching cover letter; the classic pair keeps its original ids */
const LOOKS: [theme: string, name: string, note: string][] = [
  ['classic', 'Classic', 'Clean and compact, with a slim header line.'],
  ['sidebar', 'Two-column', 'Skills, education and languages in a coloured side column.'],
  ['serif', 'Elegant', 'A calm serif, centred header, warm accents.'],
  ['academic', 'Traditional', 'Times, with a grey line between sections.'],
];

export const EXAMPLES: Example[] = LOOKS.flatMap(([theme, name, note]) => [
  { id: theme === 'classic' ? 'example-cv' : `example-${theme}-cv`, meta: { title: `${name} CV`, kind: 'cv' as const, lang: 'en', theme }, body: CV, note: `${note} A complete CV of a made-up data engineer.` },
  { id: theme === 'classic' ? 'example-letter' : `example-${theme}-letter`, meta: { title: `${name} cover letter`, kind: 'cover' as const, lang: 'en', theme }, body: LETTER, note: `${note} The matching cover letter.` },
]);
