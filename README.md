# Claims Intake and Triage Assistant

Help claims teams turn first notice of loss (FNOL) emails, forms, photos and repair estimates into structured, triaged claims, with an AI summary for every adjuster.

**[Guide](https://sfc-gh-ooral.github.io/sfguide-claims-intake-assistant/)** · **[Try the example](https://sfc-gh-ooral.github.io/sfguide-claims-intake-assistant/try/)** (no account needed)

> Synthetic data and illustrative logic only. Not claims-handling, legal, regulatory or compliance advice. This is an example, not an official Snowflake product, and it isn't supported by Snowflake Support.

## What it does

A fictional auto insurer, Veltrona Mutual, receives about 300 documents for 105 claims: FNOL emails, claim forms, repair estimates, police report excerpts, medical bill summaries and damage photos. Each file lands on a Snowflake stage. A stream on the stage's directory table queues it, and a task runs one procedure that:

1. reads the document with **AI_PARSE_DOCUMENT** (OCR and layout),
2. names its type with **AI_CLASSIFY** (and confirms that images are damage photos),
3. pulls the fields for that type with **AI_EXTRACT**, with a confidence score per field and table extraction for estimate line items,
4. describes damage photos with **AI_COMPLETE** on the image,
5. checks coverage against the policy in SQL (active on the loss date, deductible, days since inception, estimate total vs line items, medical bills vs med pay, prior losses), and
6. writes an adjuster summary with **AI_COMPLETE** and a handling tier with **AI_CLASSIFY**, then suggests the least-loaded qualified adjuster.

**Cortex Search** indexes each claim's parsed documents, photo assessments and notes, so an adjuster can ask questions about one claim file and get answers with citations.

| Screen | What you see |
| --- | --- |
| Intake inbox | Every incoming document with pipeline status and lowest field confidence; documents by type |
| Claim file | The parsed source document with extracted values highlighted, the fields and scores beside it, the coverage check, the AI summary, tier and suggested adjuster. Accept the suggestion, correct a field or route the claim yourself |
| Triage board | Fast track, standard, complex and SIU lanes with red-flag tags, adjuster workload, and cycle time by tier |
| Ask the claims file | Questions over one claim's documents and notes, answered with numbered citations |

Planted stories on this synthetic data set (details in [data/README.md](data/README.md)): a theft reported two days after the policy was bound with three prior losses (CLM-24003, SIU referral), a windshield claim suited to fast track (CLM-24004), a bodily-injury claim with climbing medical bills (CLM-24005), and an estimate whose total doesn't match its line items (CLM-24008).

## Prerequisites

- **No-account mode:** Node.js 20.19 or later. Nothing else.
- **Live mode:**
  - A Snowflake account (any edition) where Cortex AI functions and Cortex Search are available in your region, or with [cross-region inference](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cross-region-inference) enabled. Tested in AWS US East 1 in November 2026.
  - The `claude-sonnet-4-5` model for AI_COMPLETE (text and images). Set `SNOWFLAKE_COMPLETE_MODEL` and edit the procedure in `sql/setup.sql` to use another [supported model](https://docs.snowflake.com/en/sql-reference/functions/ai_complete-single-file).
  - ACCOUNTADMIN for Part 1 of setup, or a role that can create roles, warehouses, databases and API integrations and grant EXECUTE TASK.
  - Outbound access from Snowflake to github.com (setup clones this public repository through a Git repository object).
  - Key-pair authentication for the user that runs the app.

## Quick start: no account

```bash
git clone https://github.com/sfc-gh-ooral/sfguide-claims-intake-assistant.git
cd sfguide-claims-intake-assistant
npm install
npm run dev
```

Open http://localhost:3000. The app runs on bundled responses captured from the live pipeline on the same synthetic data. AI answers are labeled **Sample AI response**, and they wait a few seconds with staged progress steps to mirror the live calls. In Sample mode, "Ask the claims file" has captured answers for the suggested questions on the story claims and the 12 newest claims.

## Live mode: deploy to your account

1. Open `sql/setup.sql` in a Snowsight SQL worksheet and run it top to bottom. Part 1 runs as ACCOUNTADMIN; everything else runs as the least-privilege role `CLAIMS_INTAKE_DEMO_ROLE`. The final three queries show how many documents were parsed, the tier mix, and the four planted stories.
2. Create a key pair and register the public key on your user (commands in `.env.example`).
3. Copy `.env.example` to `.env.local` and fill in the account, user and key path.
4. Run `npm run dev` and switch the header to **Live**. Every screen now reads from `CLAIMS_INTAKE_DEMO`; Regenerate, Ask, Accept, Correct and Route call Snowflake, and the badges show measured latency. If a live call fails, the app shows the error rather than sample data.

Parsing, classification, extraction and photo descriptions run only in the task, not when you open a screen. To process a new document in Live mode, use **Process new documents** on the Intake screen: pick a claim and a PDF or PNG (up to 5 MB). The app puts the file on `CLAIM_DOCS` with a generated name, adds its manifest row, refreshes the directory table and runs `EXECUTE TASK PROCESS_DOCS_TASK`, then shows the document type, confidence and new tier when the task finishes. In our test a one-page estimate PDF took about 2 minutes (task run 118 s) and a damage photo about 20 seconds.

To do the same in SQL, upload a PDF to the stage, add a manifest row, and refresh the directory table. The task runs within five minutes (or run `EXECUTE TASK PROCESS_DOCS_TASK`):

```sql
USE ROLE CLAIMS_INTAKE_DEMO_ROLE;
USE SCHEMA CLAIMS_INTAKE_DEMO.CLAIMS;
-- PUT file:///path/to/DOC-0999-fnol-email.pdf @CLAIM_DOCS AUTO_COMPRESS = FALSE;  (SnowSQL or Snowflake CLI)
INSERT INTO DOCUMENTS VALUES ('DOC-0999', 'CLM-24003', NULL, 'DOC-0999-fnol-email.pdf', CURRENT_TIMESTAMP(), 'Email');
ALTER STAGE CLAIM_DOCS REFRESH;
```

### Objects created

| Object | Name | Purpose |
| --- | --- | --- |
| Role | `CLAIMS_INTAKE_DEMO_ROLE` | Owns everything below; granted to the user who runs setup |
| Warehouse | `CLAIMS_INTAKE_WH` | XSMALL, AUTO_SUSPEND = 60 |
| API integration | `CLAIMS_INTAKE_GIT_API` | Read-only access to this public repository |
| Database | `CLAIMS_INTAKE_DEMO` | Schemas `CLAIMS` and `APP` |
| Git repository | `CLAIMS.CLAIMS_REPO` | Source of the synthetic CSVs and documents |
| Stages | `CLAIMS.CLAIMS_SEED`, `CLAIMS.CLAIM_DOCS` | Seed CSVs; incoming documents (directory table enabled) |
| Stream | `CLAIMS.CLAIM_DOCS_STREAM` | New files on the document stage |
| Task | `CLAIMS.PROCESS_DOCS_TASK` | Every 5 minutes, only when the stream has data |
| Procedure | `CLAIMS.PROCESS_NEW_DOCUMENTS` | Parse, classify, extract, describe photos, summarize and tier |
| Tables | `POLICIES`, `CLAIMS`, `DOCUMENTS`, `CLAIM_NOTES`, `ADJUSTERS`, `LOSS_HISTORY`, `CLOSED_CLAIMS`, `EXTRACTION_SCHEMAS`, `DOC_QUEUE`, `DOC_PARSED`, `DOC_FIELDS`, `PHOTO_ASSESSMENTS`, `CLAIM_TRIAGE`, `APP.CLAIM_ACTIONS` | Reference data, pipeline output and adjuster decisions |
| Views | `CLAIM_FACTS`, `CLAIM_FACT_SHEET`, `ADJUSTER_LOAD`, `TIER_SKILLS`, `CLAIM_FILE_CHUNKS` | Coverage check, AI input, routing, search corpus |
| Cortex Search service | `CLAIMS.CLAIM_FILE_SEARCH` | Q&A over each claim file, filtered by claim |

### Expected cost and time

Measured on an XSMALL warehouse in AWS US East 1, November 2026, for the 306 bundled documents:

| | Measured |
| --- | --- |
| Setup time | 19 minutes end to end on the latest clean run (November 2026); parsing all 306 documents took most of it. An earlier run on a busier shared account took 36 minutes because the AI_EXTRACT batch queued |
| Cortex AI credits per full setup | About 15: AI_EXTRACT about 13 (about 0.044 credits per document), AI_PARSE_DOCUMENT about 1.1, AI_CLASSIFY and AI_COMPLETE well under 1 together |
| Warehouse credits | About 0.45–0.6 for setup, plus a few seconds per app query; the warehouse suspends after 60 seconds |
| Live app latency | Screens 0.7–4.1 s; Ask the claims file 3.1–6.8 s (median 4.6 s); Regenerate summary 5.5–8.8 s |

Most of the cost is AI_EXTRACT. To try it more cheaply on your own documents, start with a small sample or fewer fields. The task's `WHEN SYSTEM$STREAM_HAS_DATA` check doesn't start the warehouse while no files arrive. Costs depend on your region, model, document length and pricing; check the [Snowflake Service Consumption Table](https://www.snowflake.com/legal-files/CreditConsumptionTable.pdf).

### Clean up

Run `sql/cleanup.sql`. It drops the database (and with it every table, stage, file, stream, task, procedure, view and search service), the warehouse, the API integration and the role. It drops objects as `CLAIMS_INTAKE_DEMO_ROLE` first, because ACCOUNTADMIN doesn't inherit that role's ownership, so run it before you revoke the role from yourself.

## Known limitations

- The damage "photos" are drawn illustrations, so the AI_COMPLETE descriptions describe illustrations. Real photos give richer descriptions.
- AI function calls can return NULL when a call fails, for example under heavy load. The procedure retries documents with an empty type on its next run.
- Confidence uses AI_EXTRACT scores for identifying fields only (policy number, dates, amounts, names). One-sentence summaries such as the loss description are generative, so they don't count toward "Needs review". Estimate extraction uses a table schema, which doesn't return scores.
- Tiers come from AI_CLASSIFY with label descriptions. They are suggestions; on this data set the planted stories land in the expected lanes, but tune the descriptions and check them against your own routing guidelines before relying on them.
- Routing is a simple round robin over qualified adjusters ordered by load. It doesn't model territories, licensing or availability.
- New documents need a manifest row that links them to a claim, and internal stages need `ALTER STAGE ... REFRESH` before the stream sees new files.
- The Cortex Search service uses `TARGET_LAG = '1 hour'`, so a newly processed document can take up to an hour to show up in Ask the claims file. Lower the lag for fresher answers at higher refresh cost, or run `ALTER CORTEX SEARCH SERVICE CLAIM_FILE_SEARCH REFRESH`.
- The app connects as one role. There is no row-level separation between adjusters in this example.
- Sample mode keeps your accept, correct and route decisions in memory for the current session only.

## Customize with Cortex Code

- "Point the pipeline at my stage of FNOL documents and propose the extraction schema from 20 samples. Show me the fields and confidence you get before changing `EXTRACTION_SCHEMAS`."
- "Tune the complexity tiers to my routing guidelines and show where the AI tier disagrees with past adjuster decisions in `APP.CLAIM_ACTIONS`."
- "Add a subrogation-potential flag to `CLAIM_FACTS` with the evidence it uses, and show it on the claim file and triage board."

## Project layout

```text
app/                 Next.js screens (inbox, claim file, triage board, ask) and the /api/data route
components/          Shell, Sample/Live switch, staged AI progress, shared UI
lib/live-data.ts     Live mode: Snowflake queries with bind variables
lib/mock-data.ts     No-account mode: responses captured from the live app
scripts/             Data generator, sample capture, hosted-example build, screenshots
sql/                 setup.sql and cleanup.sql
data/                Synthetic CSVs and documents (see data/README.md)
docs/                GitHub Pages guide; docs/try/ is the hosted no-account example
```

Rebuild the hosted example with `npm run build:example`. Refresh the sample data from a live deployment with `node scripts/capture-sample.mjs` while `npm run dev` runs in Live mode.

## License

Apache 2.0. See [LICENSE](LICENSE) and [LEGAL.md](LEGAL.md). This is an illustrative example provided as-is. It is not an official Snowflake product and isn't supported by Snowflake Support. It contains no customer data. Review and test before any production use.

Owner: Oz Oral · Last reviewed: November 2026
