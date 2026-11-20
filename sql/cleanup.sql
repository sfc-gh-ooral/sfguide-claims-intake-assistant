-- =============================================================================
-- Claims Intake and Triage Assistant: cleanup
-- Drops everything sql/setup.sql created. The database drop removes its tables, views,
-- stage and files, stream, task, procedure, Cortex Search service, and Git repository clone.
-- =============================================================================
-- Objects are owned by the example role, so drop them as that role first.
USE ROLE CLAIMS_INTAKE_DEMO_ROLE;
DROP DATABASE IF EXISTS CLAIMS_INTAKE_DEMO;
DROP WAREHOUSE IF EXISTS CLAIMS_INTAKE_WH;

USE ROLE ACCOUNTADMIN;
DROP INTEGRATION IF EXISTS CLAIMS_INTAKE_GIT_API;
DROP ROLE IF EXISTS CLAIMS_INTAKE_DEMO_ROLE;
