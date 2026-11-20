-- =============================================================================
-- Claims Intake and Triage Assistant: Snowflake setup
-- Synthetic data only. Illustrative logic; not claims-handling, legal, regulatory,
-- or compliance advice.
--
-- Run top to bottom in a Snowsight SQL worksheet (about 10 minutes on an XSMALL
-- warehouse; most of it is the first pass of the document pipeline).
-- Requirements (see README): a Snowflake account where Cortex AI functions are
-- available natively or through cross-region inference, and ACCOUNTADMIN (or a role
-- that can create roles, warehouses, databases, API integrations, and grant EXECUTE TASK).
--
-- Creates (and sql/cleanup.sql drops):
--   role         CLAIMS_INTAKE_DEMO_ROLE (owns everything below)
--   warehouse    CLAIMS_INTAKE_WH (XSMALL, AUTO_SUSPEND = 60)
--   database     CLAIMS_INTAKE_DEMO (schemas CLAIMS, APP)
--   integration  CLAIMS_INTAKE_GIT_API (read-only access to the public example repository)
-- It changes nothing that already exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part 1. Account-level objects (ACCOUNTADMIN)
-- -----------------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;

CREATE ROLE IF NOT EXISTS CLAIMS_INTAKE_DEMO_ROLE COMMENT = 'Claims Intake and Triage Assistant example: least-privilege owner role';
GRANT ROLE CLAIMS_INTAKE_DEMO_ROLE TO ROLE SYSADMIN;
SET my_user = CURRENT_USER();
GRANT ROLE CLAIMS_INTAKE_DEMO_ROLE TO USER IDENTIFIER($my_user);

CREATE WAREHOUSE IF NOT EXISTS CLAIMS_INTAKE_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Claims Intake and Triage Assistant example';
GRANT OWNERSHIP ON WAREHOUSE CLAIMS_INTAKE_WH TO ROLE CLAIMS_INTAKE_DEMO_ROLE;

CREATE DATABASE IF NOT EXISTS CLAIMS_INTAKE_DEMO COMMENT = 'Claims Intake and Triage Assistant example (synthetic data)';
GRANT OWNERSHIP ON DATABASE CLAIMS_INTAKE_DEMO TO ROLE CLAIMS_INTAKE_DEMO_ROLE;

-- Cortex AI functions and Cortex Search, and the right to run the pipeline task.
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE CLAIMS_INTAKE_DEMO_ROLE;
GRANT EXECUTE TASK ON ACCOUNT TO ROLE CLAIMS_INTAKE_DEMO_ROLE;

-- Read-only access to the public GitHub repository that holds the synthetic files.
CREATE API INTEGRATION IF NOT EXISTS CLAIMS_INTAKE_GIT_API
  API_PROVIDER = git_https_api
  API_ALLOWED_PREFIXES = ('https://github.com/sfc-gh-ooral/')
  ENABLED = TRUE
  COMMENT = 'Claims Intake and Triage Assistant example: public repo, no credentials';
GRANT USAGE ON INTEGRATION CLAIMS_INTAKE_GIT_API TO ROLE CLAIMS_INTAKE_DEMO_ROLE;

-- -----------------------------------------------------------------------------
-- Part 2. Everything else runs as the least-privilege owner role.
-- -----------------------------------------------------------------------------
USE ROLE CLAIMS_INTAKE_DEMO_ROLE;
USE WAREHOUSE CLAIMS_INTAKE_WH;
USE DATABASE CLAIMS_INTAKE_DEMO;
CREATE SCHEMA IF NOT EXISTS CLAIMS COMMENT = 'Policies, claims, documents and AI pipeline output (synthetic)';
CREATE SCHEMA IF NOT EXISTS APP    COMMENT = 'Adjuster decisions written by the app';
USE SCHEMA CLAIMS;

-- 2a. Reference tables from the public repository ----------------------------
CREATE OR REPLACE GIT REPOSITORY CLAIMS_REPO
  API_INTEGRATION = CLAIMS_INTAKE_GIT_API
  ORIGIN = 'https://github.com/sfc-gh-ooral/sfguide-claims-intake-assistant.git';
ALTER GIT REPOSITORY CLAIMS_REPO FETCH;
CREATE OR REPLACE STAGE CLAIMS_SEED COMMENT = 'Synthetic CSVs copied from the repository';
COPY FILES INTO @CLAIMS_SEED FROM @CLAIMS_REPO/branches/main/data/csv/;

CREATE OR REPLACE FILE FORMAT CLAIMS_CSV TYPE = CSV PARSE_HEADER = TRUE FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  NULL_IF = ('') EMPTY_FIELD_AS_NULL = TRUE;

CREATE OR REPLACE TABLE POLICIES (
  policy_number STRING, insured_name STRING, product STRING, state STRING, address STRING,
  inception_date DATE, expiration_date DATE, vehicle STRING, vin STRING,
  collision_deductible NUMBER, comprehensive_deductible NUMBER, full_glass BOOLEAN,
  bi_limit_per_person NUMBER, bi_limit_per_accident NUMBER, pd_limit NUMBER, med_pay_limit NUMBER, rental_per_day NUMBER);
CREATE OR REPLACE TABLE ADJUSTERS (adjuster_id STRING, name STRING, skills STRING, capacity NUMBER, open_claims NUMBER);
CREATE OR REPLACE TABLE CLAIMS (
  claim_id STRING, policy_number STRING, insured_name STRING, loss_type STRING, loss_date DATE, reported_date DATE,
  loss_city STRING, loss_state STRING, loss_location STRING, vehicle STRING, status STRING,
  assigned_adjuster STRING, story STRING);
CREATE OR REPLACE TABLE CLAIM_NOTES (note_id STRING, claim_id STRING, author STRING, created_at TIMESTAMP_NTZ, note_text STRING);
CREATE OR REPLACE TABLE LOSS_HISTORY (policy_number STRING, insured_name STRING, loss_date DATE, prior_carrier STRING,
  loss_type STRING, paid_amount NUMBER(12,2));
CREATE OR REPLACE TABLE CLOSED_CLAIMS (claim_id STRING, tier STRING, reported_date DATE, closed_date DATE);
-- Intake manifest: which claim each incoming file belongs to. LABELED_DOC_TYPE is the generator's
-- label, kept only to measure AI_CLASSIFY; the pipeline never reads it.
CREATE OR REPLACE TABLE DOCUMENTS (doc_id STRING, claim_id STRING, labeled_doc_type STRING, file_name STRING,
  received_at TIMESTAMP_NTZ, source STRING);

COPY INTO POLICIES      FROM @CLAIMS_SEED/policies.csv      FILE_FORMAT = (FORMAT_NAME = CLAIMS_CSV) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
COPY INTO ADJUSTERS     FROM @CLAIMS_SEED/adjusters.csv     FILE_FORMAT = (FORMAT_NAME = CLAIMS_CSV) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
COPY INTO CLAIMS        FROM @CLAIMS_SEED/claims.csv        FILE_FORMAT = (FORMAT_NAME = CLAIMS_CSV) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
COPY INTO CLAIM_NOTES   FROM @CLAIMS_SEED/claim_notes.csv   FILE_FORMAT = (FORMAT_NAME = CLAIMS_CSV) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
COPY INTO LOSS_HISTORY  FROM @CLAIMS_SEED/loss_history.csv  FILE_FORMAT = (FORMAT_NAME = CLAIMS_CSV) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
COPY INTO CLOSED_CLAIMS FROM @CLAIMS_SEED/closed_claims.csv FILE_FORMAT = (FORMAT_NAME = CLAIMS_CSV) MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
COPY INTO DOCUMENTS (doc_id, claim_id, labeled_doc_type, file_name, received_at, source)
  FROM (SELECT $1, $2, $3, $4, $5, $6 FROM @CLAIMS_SEED/documents.csv)
  FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"');

-- 2b. Document pipeline: stage + directory table + stream + task ---------------
-- New files land on CLAIM_DOCS; the stream on its directory table queues them, and the task
-- runs PROCESS_NEW_DOCUMENTS whenever the stream has data.
CREATE OR REPLACE STAGE CLAIM_DOCS ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE') DIRECTORY = (ENABLE = TRUE)
  COMMENT = 'Incoming claim documents (FNOL emails, forms, estimates, police and medical summaries, photos)';
CREATE OR REPLACE STREAM CLAIM_DOCS_STREAM ON STAGE CLAIM_DOCS;

CREATE OR REPLACE TABLE DOC_QUEUE (relative_path STRING, queued_at TIMESTAMP_NTZ, processed BOOLEAN);
CREATE OR REPLACE TABLE DOC_PARSED (
  doc_id STRING, file_name STRING, parsed_text STRING, page_count NUMBER, doc_type STRING,
  processed_at TIMESTAMP_NTZ, parse_ms NUMBER);
CREATE OR REPLACE TABLE DOC_FIELDS (doc_id STRING, doc_type STRING, fields VARIANT, scores VARIANT,
  min_score FLOAT, line_items VARIANT, line_sum NUMBER(12,2), extracted_at TIMESTAMP_NTZ);
CREATE OR REPLACE TABLE PHOTO_ASSESSMENTS (doc_id STRING, description STRING, model STRING, assessed_at TIMESTAMP_NTZ);
CREATE OR REPLACE TABLE CLAIM_TRIAGE (claim_id STRING, facts STRING, ai_summary STRING, tier STRING,
  suggested_adjuster STRING, model STRING, generated_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS APP.CLAIM_ACTIONS (action_id STRING DEFAULT UUID_STRING(), claim_id STRING, action STRING,
  field_name STRING, old_value STRING, new_value STRING, tier STRING, adjuster_id STRING, comment STRING,
  acted_by STRING DEFAULT CURRENT_USER(), acted_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP());

-- Field schemas per document type. AI_EXTRACT returns a value and a confidence score per field.
CREATE OR REPLACE TABLE EXTRACTION_SCHEMAS (doc_type STRING, response_format VARIANT, with_scores BOOLEAN);
INSERT INTO EXTRACTION_SCHEMAS
SELECT 'fnol_email', PARSE_JSON('{
  "policy_number":"What is the insurance policy number?",
  "claimant_name":"Who is reporting the claim (full name)?",
  "loss_date":"What is the date of loss, as YYYY-MM-DD?",
  "loss_location":"Where did the loss happen?",
  "vehicle":"Which vehicle (year make model)?",
  "loss_description":"In one sentence, what happened?",
  "injuries_reported":"Were any injuries reported? Answer yes or no, and who.",
  "police_report_number":"What is the police report number, if any? Answer None if not given."}'), TRUE
UNION ALL SELECT 'claim_form', PARSE_JSON('{
  "policy_number":"What is the policy number?",
  "insured_name":"Who is the named insured?",
  "loss_date":"What is the date of loss, as YYYY-MM-DD?",
  "loss_location":"What is the loss location?",
  "vehicle":"Which vehicle (year make model)?",
  "vin":"What is the VIN?",
  "loss_description":"What is the description of loss?",
  "injuries_reported":"What injuries are listed?",
  "police_report_number":"What is the police report number? Answer None if not given.",
  "other_party":"Who is the other party, if any?"}'), TRUE
UNION ALL SELECT 'police_report', PARSE_JSON('{
  "report_number":"What is the report number?",
  "incident_date":"What is the incident date, as YYYY-MM-DD?",
  "location":"What is the location?",
  "at_fault":"Which party is at fault?",
  "injuries":"What injuries are noted?",
  "narrative":"Summarize the narrative in one sentence."}'), TRUE
UNION ALL SELECT 'medical_bill', PARSE_JSON('{
  "provider":"Who is the medical provider?",
  "patient":"Who is the patient?",
  "service_date":"What is the date of service, as YYYY-MM-DD?",
  "diagnosis":"What is the diagnosis?",
  "total_billed":"What is the total billed amount, as a number without symbols?"}'), TRUE
UNION ALL SELECT 'repair_estimate', PARSE_JSON('{"schema":{"type":"object","properties":{
  "shop_name":{"description":"What is the name of the repair shop?","type":"string"},
  "estimate_number":{"description":"What is the estimate number?","type":"string"},
  "vehicle":{"description":"Which vehicle (year make model)?","type":"string"},
  "estimate_total":{"description":"What is the estimate total, as a number without symbols?","type":"string"},
  "line_items":{"description":"Repair line items","type":"object","column_ordering":["description","amount"],
    "properties":{"description":{"description":"Description","type":"array"},"amount":{"description":"Amount","type":"array"}}}}}}'), FALSE;

-- Claim facts: extracted fields joined to the policy, with the coverage check computed in SQL.
CREATE OR REPLACE VIEW CLAIM_FACTS AS
WITH f AS (
  SELECT d.claim_id, x.doc_type, x.fields, x.line_sum, d.received_at
  FROM DOC_FIELDS x JOIN DOCUMENTS d ON d.doc_id = x.doc_id
), intake AS (
  SELECT claim_id,
         MAX(IFF(doc_type IN ('fnol_email', 'claim_form'), fields:policy_number::STRING, NULL)) AS ext_policy,
         MIN(IFF(doc_type IN ('fnol_email', 'claim_form'), TRY_TO_DATE(fields:loss_date::STRING), NULL)) AS ext_loss_date,
         MAX(IFF(doc_type = 'fnol_email', fields:loss_description::STRING, NULL)) AS ext_description,
         MAX(IFF(doc_type IN ('fnol_email', 'claim_form'), fields:injuries_reported::STRING, NULL)) AS ext_injuries,
         MAX(IFF(doc_type = 'repair_estimate', TRY_TO_NUMBER(REGEXP_REPLACE(fields:estimate_total::STRING, '[^0-9.]', ''), 12, 2), NULL)) AS estimate_total,
         MAX(IFF(doc_type = 'repair_estimate', line_sum, NULL)) AS estimate_line_sum,
         SUM(IFF(doc_type = 'medical_bill', TRY_TO_NUMBER(REGEXP_REPLACE(fields:total_billed::STRING, '[^0-9.]', ''), 12, 2), 0)) AS medical_total,
         COUNT_IF(doc_type = 'medical_bill') AS medical_bills,
         MAX(IFF(doc_type = 'police_report', DATEDIFF('day', TRY_TO_DATE(fields:incident_date::STRING), received_at::DATE), NULL)) AS police_report_lag_days,
         COUNT(*) AS documents_processed
  FROM f GROUP BY claim_id
), medtrend AS (
  SELECT d.claim_id, ARRAY_AGG(TRY_TO_NUMBER(REGEXP_REPLACE(x.fields:total_billed::STRING, '[^0-9.]', ''), 12, 2))
           WITHIN GROUP (ORDER BY TRY_TO_DATE(x.fields:service_date::STRING)) AS medical_series
  FROM DOC_FIELDS x JOIN DOCUMENTS d ON d.doc_id = x.doc_id WHERE x.doc_type = 'medical_bill' GROUP BY d.claim_id
), prior AS (
  SELECT policy_number, COUNT(*) AS prior_losses, SUM(paid_amount) AS prior_paid FROM LOSS_HISTORY GROUP BY policy_number
)
SELECT c.claim_id, c.loss_type, c.reported_date, i.ext_policy, p.policy_number IS NOT NULL AS policy_found,
       COALESCE(i.ext_loss_date, c.loss_date) AS loss_date, p.inception_date,
       DATEDIFF('day', p.inception_date, COALESCE(i.ext_loss_date, c.loss_date)) AS days_since_inception,
       COALESCE(i.ext_loss_date, c.loss_date) BETWEEN p.inception_date AND p.expiration_date AS policy_active,
       CASE WHEN c.loss_type = 'Glass' THEN IFF(p.full_glass, 'Comprehensive - full glass', 'Comprehensive')
            WHEN c.loss_type LIKE 'Comprehensive%' OR c.loss_type = 'Theft' THEN 'Comprehensive'
            ELSE 'Collision' END AS coverage_part,
       CASE WHEN c.loss_type = 'Glass' AND p.full_glass THEN 0
            WHEN c.loss_type LIKE 'Comprehensive%' OR c.loss_type IN ('Theft', 'Glass') THEN p.comprehensive_deductible
            ELSE p.collision_deductible END AS deductible,
       p.bi_limit_per_person, p.med_pay_limit, p.pd_limit,
       i.ext_description, i.ext_injuries, i.estimate_total, i.estimate_line_sum,
       ABS(COALESCE(i.estimate_total, 0) - COALESCE(i.estimate_line_sum, 0)) > 1 AND i.estimate_total IS NOT NULL AS estimate_mismatch,
       i.medical_total, i.medical_bills, m.medical_series, i.police_report_lag_days,
       COALESCE(pr.prior_losses, 0) AS prior_losses, COALESCE(pr.prior_paid, 0) AS prior_paid, i.documents_processed
FROM CLAIMS c
LEFT JOIN intake i ON i.claim_id = c.claim_id
LEFT JOIN POLICIES p ON p.policy_number = COALESCE(i.ext_policy, c.policy_number)
LEFT JOIN medtrend m ON m.claim_id = c.claim_id
LEFT JOIN prior pr ON pr.policy_number = p.policy_number;

-- One readable fact sheet per claim, the input to the AI summary and tier.
CREATE OR REPLACE VIEW CLAIM_FACT_SHEET AS
SELECT claim_id,
  'Claim ' || claim_id || ' (' || loss_type || '). Reported ' || reported_date || ', loss date ' || loss_date || '.' ||
  ' Policy ' || COALESCE(ext_policy, 'not found') || IFF(policy_found, ', incepted ' || inception_date || ' (' || days_since_inception || ' days before the loss), ' ||
      IFF(policy_active, 'active on the loss date', 'NOT active on the loss date') || '.', '.') ||
  ' Coverage part: ' || coverage_part || ', deductible $' || COALESCE(deductible::STRING, '?') || '.' ||
  ' Description: ' || COALESCE(ext_description, 'n/a') ||
  ' Injuries: ' || COALESCE(ext_injuries, 'none stated') || '.' ||
  IFF(estimate_total IS NOT NULL, ' Repair estimate total $' || estimate_total || ' vs line items $' || COALESCE(estimate_line_sum::STRING, '?') ||
      IFF(estimate_mismatch, ' (MISMATCH: total does not equal the sum of line items).', '.'), ' No repair estimate yet.') ||
  IFF(medical_bills > 0, ' Medical bills: ' || medical_bills || ', total $' || medical_total || ', in date order: ' || ARRAY_TO_STRING(medical_series, ', ') || '.', '') ||
  IFF(police_report_lag_days IS NOT NULL, ' Police report received ' || police_report_lag_days || ' days after the incident.', '') ||
  ' Prior losses on loss-history report: ' || prior_losses || IFF(prior_losses > 0, ' (paid $' || prior_paid || ').', '.') AS facts
FROM CLAIM_FACTS;

-- Routing: the least-loaded adjuster whose skills match the tier (open claims / capacity).
CREATE OR REPLACE VIEW ADJUSTER_LOAD AS
SELECT a.adjuster_id, a.name, a.skills, a.capacity,
       a.open_claims + COUNT(c.claim_id) AS open_claims
FROM ADJUSTERS a
LEFT JOIN CLAIMS c ON c.assigned_adjuster = a.adjuster_id AND c.status = 'Routed'
GROUP BY a.adjuster_id, a.name, a.skills, a.capacity, a.open_claims;

-- Skills that qualify an adjuster for each tier.
CREATE OR REPLACE VIEW TIER_SKILLS AS
SELECT * FROM VALUES ('Fast track', 'fast track'), ('Standard', 'collision'), ('Standard', 'theft'),
  ('Complex', 'bodily injury'), ('Complex', 'complex'), ('SIU referral', 'siu') AS v(tier, skill);

-- The pipeline step. Called by the task; setup also calls it once for the bundled files.
CREATE OR REPLACE PROCEDURE PROCESS_NEW_DOCUMENTS()
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  n INTEGER;
  started TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP();
BEGIN
  -- 1. Consume the stream (new files only).
  INSERT INTO DOC_QUEUE SELECT relative_path, CURRENT_TIMESTAMP(), FALSE
    FROM CLAIM_DOCS_STREAM WHERE METADATA$ACTION = 'INSERT';
  -- Retry documents whose parse or classification came back empty on an earlier run
  -- (AI functions can return NULL when a call fails, for example under heavy load).
  UPDATE DOC_QUEUE SET processed = FALSE WHERE relative_path IN (SELECT file_name FROM DOC_PARSED WHERE doc_type IS NULL);
  DELETE FROM DOC_PARSED WHERE doc_type IS NULL;
  SELECT COUNT(*) INTO :n FROM DOC_QUEUE WHERE NOT processed;
  IF (n = 0) THEN RETURN 'No new documents'; END IF;

  -- 2. OCR + layout for documents; AI_CLASSIFY the document type from the parsed text.
  INSERT INTO DOC_PARSED (doc_id, file_name, parsed_text, page_count, doc_type, processed_at)
  WITH q AS (
    SELECT d.doc_id, q.relative_path
    FROM DOC_QUEUE q JOIN DOCUMENTS d ON d.file_name = q.relative_path
    WHERE NOT q.processed AND NOT ENDSWITH(LOWER(q.relative_path), '.png')
      AND d.doc_id NOT IN (SELECT doc_id FROM DOC_PARSED)
  ), p AS (
    SELECT doc_id, relative_path, AI_PARSE_DOCUMENT(TO_FILE('@CLAIM_DOCS', relative_path), {'mode': 'LAYOUT'}) AS parsed FROM q
  )
  SELECT doc_id, relative_path, parsed:content::STRING, parsed:metadata:pageCount::NUMBER,
         AI_CLASSIFY(parsed:content::STRING,
           [{'label': 'fnol_email', 'description': 'an email reporting a new insurance loss'},
            {'label': 'claim_form', 'description': 'a structured claim or notice-of-loss form'},
            {'label': 'repair_estimate', 'description': 'a body shop or glass repair estimate with line items'},
            {'label': 'police_report', 'description': 'a police traffic or incident report'},
            {'label': 'medical_bill', 'description': 'a medical bill or itemized statement'}],
           {'task_description': 'Classify the type of insurance claim document'}):labels[0]::STRING,
         CURRENT_TIMESTAMP()
  FROM p;

  -- Photos: AI_CLASSIFY on the image confirms it is damage evidence; AI_COMPLETE describes the damage.
  INSERT INTO DOC_PARSED (doc_id, file_name, parsed_text, page_count, doc_type, processed_at)
  SELECT d.doc_id, q.relative_path, NULL, 1,
         IFF(AI_CLASSIFY(TO_FILE('@CLAIM_DOCS', q.relative_path), ['vehicle damage photo', 'document scan']):labels[0]::STRING
             = 'vehicle damage photo', 'damage_photo', 'unclassified_image'),
         CURRENT_TIMESTAMP()
  FROM DOC_QUEUE q JOIN DOCUMENTS d ON d.file_name = q.relative_path
  WHERE NOT q.processed AND ENDSWITH(LOWER(q.relative_path), '.png')
    AND d.doc_id NOT IN (SELECT doc_id FROM DOC_PARSED);

  INSERT INTO PHOTO_ASSESSMENTS
  SELECT p.doc_id,
         AI_COMPLETE('claude-sonnet-4-5',
           'You are assisting an auto claims adjuster. In 2 short sentences describe the visible vehicle damage '
           || '(location on the vehicle, type of damage) and end with "Severity: minor", "Severity: moderate" or '
           || '"Severity: severe". If the image is an illustration, still describe what it depicts.',
           TO_FILE('@CLAIM_DOCS', p.file_name)),
         'claude-sonnet-4-5', CURRENT_TIMESTAMP()
  FROM DOC_PARSED p
  WHERE p.doc_type = 'damage_photo' AND p.doc_id NOT IN (SELECT doc_id FROM PHOTO_ASSESSMENTS);

  -- 3. AI_EXTRACT the fields for each document type, with confidence scores.
  INSERT INTO DOC_FIELDS (doc_id, doc_type, fields, scores, min_score, line_items, extracted_at)
  WITH x AS (
    SELECT p.doc_id, p.doc_type,
           IFF(s.with_scores,
               AI_EXTRACT(file => TO_FILE('@CLAIM_DOCS', p.file_name), responseFormat => s.response_format, scores => TRUE),
               AI_EXTRACT(file => TO_FILE('@CLAIM_DOCS', p.file_name), responseFormat => s.response_format)) AS r
    FROM DOC_PARSED p JOIN EXTRACTION_SCHEMAS s ON s.doc_type = p.doc_type
    WHERE p.doc_id NOT IN (SELECT doc_id FROM DOC_FIELDS)
  )
  SELECT x.doc_id, ANY_VALUE(x.doc_type), OBJECT_DELETE(ANY_VALUE(x.r):response, 'line_items'),
         ANY_VALUE(x.r):scoring:scores,
         -- Confidence covers identifying fields; one-sentence summaries are generative, so they are left out.
         MIN(IFF(v.key IN ('loss_description', 'narrative', 'other_party'), NULL, v.value:score::FLOAT)), ANY_VALUE(x.r):response:line_items, CURRENT_TIMESTAMP()
  FROM x, LATERAL FLATTEN(input => x.r:scoring:scores, OUTER => TRUE) v
  GROUP BY x.doc_id;
  -- Sum the extracted estimate line items, to compare with the extracted total.
  UPDATE DOC_FIELDS f SET line_sum = s.total
  FROM (SELECT doc_id, SUM(TRY_TO_NUMBER(REGEXP_REPLACE(v.value::STRING, '[^0-9.]', ''), 12, 2)) AS total
        FROM DOC_FIELDS, LATERAL FLATTEN(input => line_items:amount) v WHERE line_sum IS NULL GROUP BY doc_id) s
  WHERE f.doc_id = s.doc_id;

  UPDATE DOC_QUEUE SET processed = TRUE WHERE NOT processed;

  -- 4. Re-triage the claims that received documents: AI summary (AI_COMPLETE) and tier (AI_CLASSIFY).
  DELETE FROM CLAIM_TRIAGE WHERE claim_id IN
    (SELECT d.claim_id FROM DOC_PARSED p JOIN DOCUMENTS d ON d.doc_id = p.doc_id WHERE p.processed_at >= :started);
  INSERT INTO CLAIM_TRIAGE (claim_id, facts, ai_summary, tier, model, generated_at)
  WITH t AS (
    SELECT s.claim_id, s.facts,
           AI_CLASSIFY(s.facts,
             [{'label': 'Fast track', 'description': 'glass-only damage, or minor comprehensive damage with a repair estimate under $1,500; clear coverage, no injuries, no red flags'},
              {'label': 'Standard', 'description': 'collision, theft, hail or animal damage with a larger estimate that needs an adjuster review; no injuries and no fraud indicators'},
              {'label': 'Complex', 'description': 'bodily injury, rising medical bills, high severity, or document discrepancies needing senior review'},
              {'label': 'SIU referral', 'description': 'fraud indicators such as a loss soon after policy inception combined with a pattern of prior losses or late reporting'}],
             {'task_description': 'Choose the claim handling tier for an auto insurance claim'}):labels[0]::STRING AS tier
    FROM CLAIM_FACT_SHEET s WHERE s.claim_id IN
      (SELECT d.claim_id FROM DOC_PARSED p JOIN DOCUMENTS d ON d.doc_id = p.doc_id WHERE p.processed_at >= :started)
  )
  SELECT claim_id, facts,
         AI_COMPLETE('claude-sonnet-4-5',
           'You are a claims intake assistant. Using only these facts, write a summary for the assigned adjuster: '
           || 'first a 2-sentence overview, then up to 3 short bullet points starting with "- " covering coverage, '
           || 'any red flags or discrepancies, and the suggested next step. The suggested handling tier is ' || tier
           || '. Do not invent facts or amounts. Facts: ' || facts),
         tier, 'claude-sonnet-4-5', CURRENT_TIMESTAMP()
  FROM t;
  -- Routing: spread new claims round-robin over the qualified adjusters, least loaded first.
  UPDATE CLAIM_TRIAGE t SET suggested_adjuster = r.adjuster_id
  FROM (
    WITH elig AS (
      SELECT k.tier, l.adjuster_id,
             ROW_NUMBER() OVER (PARTITION BY k.tier ORDER BY l.open_claims / l.capacity, l.adjuster_id) AS rk,
             COUNT(*) OVER (PARTITION BY k.tier) AS k
      FROM TIER_SKILLS k JOIN ADJUSTER_LOAD l ON CONTAINS(LOWER(l.skills), k.skill)
      QUALIFY ROW_NUMBER() OVER (PARTITION BY k.tier, l.adjuster_id ORDER BY 1) = 1
    ), todo AS (
      SELECT claim_id, tier, ROW_NUMBER() OVER (PARTITION BY tier ORDER BY claim_id) AS cn
      FROM CLAIM_TRIAGE WHERE suggested_adjuster IS NULL
    )
    SELECT todo.claim_id, elig.adjuster_id FROM todo JOIN elig ON elig.tier = todo.tier AND elig.rk = MOD(todo.cn - 1, elig.k) + 1
  ) r
  WHERE t.claim_id = r.claim_id;

  RETURN n || ' documents processed';
END;
$$;

-- First pass: copy the bundled synthetic files onto the stage and process them.
COPY FILES INTO @CLAIM_DOCS FROM @CLAIMS_REPO/branches/main/data/documents/;
ALTER STAGE CLAIM_DOCS REFRESH;
CALL PROCESS_NEW_DOCUMENTS();

CREATE OR REPLACE TASK PROCESS_DOCS_TASK
  WAREHOUSE = CLAIMS_INTAKE_WH
  SCHEDULE = '5 MINUTE'
  WHEN SYSTEM$STREAM_HAS_DATA('CLAIM_DOCS_STREAM')
  AS CALL PROCESS_NEW_DOCUMENTS();
ALTER TASK PROCESS_DOCS_TASK RESUME;  -- the WHEN check costs no warehouse time while no files arrive

-- 2c. Cortex Search over every claim's documents and notes, for "Ask the claims file" ---
CREATE OR REPLACE VIEW CLAIM_FILE_CHUNKS AS
SELECT d.claim_id, p.doc_id AS source_id, p.doc_type AS source_type,
       p.file_name AS source_name, d.received_at::STRING AS source_date, p.parsed_text AS chunk
FROM DOC_PARSED p JOIN DOCUMENTS d ON d.doc_id = p.doc_id WHERE p.parsed_text IS NOT NULL
UNION ALL
SELECT d.claim_id, a.doc_id, 'damage_photo', p.file_name, d.received_at::STRING, 'Damage photo assessment: ' || a.description
FROM PHOTO_ASSESSMENTS a JOIN DOC_PARSED p ON p.doc_id = a.doc_id JOIN DOCUMENTS d ON d.doc_id = a.doc_id
UNION ALL
SELECT claim_id, note_id, 'claim_note', 'Note by ' || author, created_at::STRING, note_text FROM CLAIM_NOTES;

CREATE OR REPLACE CORTEX SEARCH SERVICE CLAIM_FILE_SEARCH
  ON chunk
  ATTRIBUTES claim_id, source_type
  WAREHOUSE = CLAIMS_INTAKE_WH
  TARGET_LAG = '1 hour'
  AS SELECT claim_id, source_id, source_type, source_name, source_date, chunk FROM CLAIM_FILE_CHUNKS;

-- 2d. Check the result -----------------------------------------------------------
SELECT COUNT(*) AS documents_parsed, COUNT_IF(p.doc_type = d.labeled_doc_type) AS doc_type_matches_label
FROM DOC_PARSED p JOIN DOCUMENTS d ON d.doc_id = p.doc_id;
SELECT tier, COUNT(*) AS claims FROM CLAIM_TRIAGE GROUP BY tier ORDER BY claims DESC;
SELECT c.story, c.claim_id, t.tier, f.estimate_mismatch, f.days_since_inception, f.prior_losses, f.medical_total
FROM CLAIMS c JOIN CLAIM_TRIAGE t USING (claim_id) JOIN CLAIM_FACTS f USING (claim_id)
WHERE c.story IS NOT NULL ORDER BY c.claim_id;
