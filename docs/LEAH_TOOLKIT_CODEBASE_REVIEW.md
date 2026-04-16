# Leah Toolkit Codebase Review and Current-State Documentation

Last reviewed: 2026-04-16
Review baseline: `main` at commit `8c07a94` (`Fix GitHub Pages deploy build`)
Repository remote: `https://github.com/satyamraj2101/sleepwell`

## 1. Executive Summary

Leah Toolkit is an internal React/Vite single-page application used to operate Leah CLM through a set of focused implementation, migration, validation, and admin utilities. The codebase is aimed at implementation and go-live support teams rather than end customers.

At the time of review, the product is functionally rich and already covers a meaningful portion of the Leah API surface:

- user masking / unmasking for UAT vs go-live
- contract lookup and quick-edit flows
- legal party CRUD
- metadata / field configuration and visibility-rule inspection
- application type administration
- audit log lookup
- pre-execution approval checks
- compare-and-comply AI scorecard access
- date rule preview and rule management
- custom report browsing/export
- bulk import template download
- manual scenario testing
- bulk test creation and end-to-end workflow simulation

The main business value is strong. The main engineering risk is not lack of features, but uneven code health:

- `npm run build` is currently broken because strict TypeScript checks fail in active feature areas.
- `npm run lint` is also broken.
- some security-sensitive logic is implemented client-side and should be moved or removed.
- a few architectural assumptions are inconsistent between GitHub Pages deployment, direct API calls, and the unused Node proxy.

The deploy path is currently stable again because GitHub Pages now uses `npm run build:deploy`, but that is a deploy workaround, not a full code-health fix.

## 2. Review Scope and Sources

This document was prepared from:

- the current repository contents and recent git history
- the live Swagger for the New Product API:
  - `https://cpai-productapi-stg5.azurewebsites.net/swagger/index.html`
  - `https://cpai-productapi-stg5.azurewebsites.net/swagger/v1/swagger.json`
- URI metadata extractable from the attached `ContractPodAi API Specification Documentation v1.9 1.pdf`
- the attached `API Leah.pdf`, which appears to be a release-notes style document (`Leah CLM 3.0 - API Release Notes`) but was not machine-readable in this environment

Important note:

- the live Swagger was used as the primary API truth source for the New Product API
- the local code was used as the primary truth source for what the toolkit actually calls today
- the v1.9 PDF was still useful for confirming example endpoint families and naming patterns even though full text extraction was not available

## 3. Product Purpose

The toolkit acts as a power-user admin console for Leah CLM implementation work. It is not a generic portal. It is optimized for:

- migration and go-live readiness
- diagnosing configuration issues quickly
- operating multiple Leah API families from one place
- reducing repetitive UI work by exposing direct API workflows

The current app description in `package.json` still says "11 API-driven tools", but the routed application currently exposes more than that. The codebase now behaves more like a consolidated internal operations suite than a small toolkit.

## 4. Technology Stack

### Frontend

- React 18
- TypeScript
- Vite 5
- TanStack Query
- Zustand
- Tailwind CSS
- Radix UI primitives
- Sonner toasts
- `xlsx`, `jspdf`, `papaparse` for export/import workflows

### Backend / runtime assumptions

- static deployment to GitHub Pages for the UI
- optional Express proxy server in `server.js`
- direct browser calls to Leah APIs using Axios

### Deployment

- GitHub Actions deploys `dist` to `gh-pages`
- current workflow uses Node 20 and `npm run build:deploy`
- the strict TypeScript gate is not part of the deploy build at the moment

## 5. High-Level Architecture

### App shell

The app is a lazy-loaded SPA with authenticated routes defined in `src/App.tsx`. The major authenticated routes are:

- `/user-mask`
- `/contract-edit`
- `/audit-log`
- `/approvals`
- `/legal-party`
- `/metadata`
- `/app-types`
- `/date-rules`
- `/reports`
- `/compare-comply`
- `/bulk-import`
- `/testing`
- `/bulk-test`

### State model

Two stores matter most:

- `useAuthStore` stores environment, tenant, username, token, and expiry
- `useConfigStore` stores app-level UI configuration such as selected app type

### Data loading

TanStack Query is used consistently for:

- list/detail loading
- cache invalidation after mutations
- feature-level data orchestration

### API client split

The toolkit uses three API families:

1. Auth API
   - base pattern: `https://{cloudInstance}/cpaimt_auth`
   - used for token retrieval

2. Old Prod API
   - base pattern: `https://{cloudInstance}/cpaimt_api`
   - used for users, roles, departments, countries, and several legacy support endpoints

3. New Product API
   - base pattern: `https://{newCloudApi}`
   - used for contract requests, metadata, legal parties, reports, approvals, compare-comply, date rules, bulk import templates, version uploads, and related modern flows

## 6. Route-by-Route Feature Inventory

### 6.1 Connect

Purpose:

- collects tenant/environment inputs
- authenticates against Leah
- stores connection context

Key code:

- `src/features/connect/ConnectPage.tsx`
- `src/api/auth.ts`
- `src/store/authStore.ts`

APIs:

- `POST /cpaimt_auth/auth/token`

Notes:

- default environment values point to staging
- includes a hard-coded "master verification code" gate in the client

### 6.2 User Email Mask / Unmask

Purpose:

- fetch all users
- classify masked vs unmasked accounts
- bulk mask or unmask users
- export user mask state

Key code:

- `src/features/user-mask/index.tsx`
- `src/features/user-mask/hooks.ts`
- `src/api/users.ts`

APIs:

- `GET /api/{tenant}/v1/user`
- `PUT /api/{tenant}/v1/user/{id}`
- `GET /api/{tenant}/v1/roles`

Strength:

- useful go-live/UAT safety tool with progress feedback and export support

Risk:

- bulk updates are sequential and potentially slow at scale

### 6.3 Contract Navigator / Quick Edit

Purpose:

- browse contracts by application type
- search by request ID
- open contract detail
- edit selected fields and description
- bulk stage update selected contracts

Key code:

- `src/features/contract-edit/index.tsx`
- `src/features/contract-edit/hooks.ts`
- `src/features/contract-edit/components/ContractEditDrawer.tsx`
- `src/api/contractRequest.ts`

APIs:

- `GET /api/{tenantName}/contract-request`
- `GET /api/{tenantName}/contract-request/{id}`
- `PUT /api/{tenantName}/contract-request/{id}`
- `POST /api/{tenantName}/contract-request/search`
- intake-form-field-groups API

Strength:

- this is one of the most operationally useful parts of the app

### 6.4 Audit Log Viewer

Purpose:

- query change history by request ID, user ID, and dates
- export audit entries

Key code:

- `src/features/audit-log/index.tsx`
- `src/api/auditLog.ts`

APIs:

- `GET /api/{tenantName}/AuditLog`

### 6.5 Pre-Execution Approval Checker

Purpose:

- verify approval readiness before e-sign flows

Key code:

- `src/features/approval-checker/index.tsx`
- `src/api/approval.ts`

APIs:

- `GET /api/{tenantName}/contractapproval/preexecution/{requestId}`
- `GET /api/{tenantName}/contractapproval/preexecutionstatus/{requestId}`
- `GET /api/{tenantName}/contractapproval/is-upcomingapproval-feature-enable`

### 6.6 Legal Party Manager

Purpose:

- list, create, update, delete, and bulk delete legal parties
- CSV import and export

Key code:

- `src/features/legal-party/index.tsx`
- `src/api/legalParty.ts`
- `src/api/departments.ts`

APIs:

- `GET /api/{tenantName}/legal-party`
- `POST /api/{tenantName}/legal-party`
- `PUT /api/{tenantName}/legal-party/{id}`
- `DELETE /api/{tenantName}/legal-party/{id}`
- `POST /api/{tenantName}/legal-party/bulk-delete`

Strength:

- good operations utility for bulk maintenance

Risk:

- CSV import currently creates rows one-by-one and tolerates per-row failures silently

### 6.7 Field (Metadata) Manager

Purpose:

- metadata field CRUD
- field option management
- app-type scoping
- visibility-rule analysis
- rule matrix view
- blueprint inspection
- intake-form comparison support

Key code:

- `src/features/metadata-manager/index.tsx`
- `src/features/metadata-manager/components/BlueprintInspectorDrawer.tsx`
- `src/features/metadata-manager/components/SimulatedFields.tsx`
- `src/features/metadata-manager/utils/logicEvaluator.ts`
- `src/api/metadata.ts`

APIs:

- `POST /api/{tenantName}/application-type-metadata`
- `PUT /api/{tenantName}/application-type-metadata`
- `GET /api/{tenantName}/application-type-metadata/list`
- `GET /api/{tenantName}/application-type-metadata/field-types`
- `POST /api/{tenantName}/application-type-metadata/field-options`
- `GET /api/{tenantName}/application-type/intake-form-field-groups`
- additional metadata helper endpoints for reference field details and legal-party fields

Strength:

- this is the richest configuration screen in the app and likely one of the highest-value admin tools

Risk:

- this is also one of the least maintainable parts of the codebase in its current size and condition

### 6.8 Application Type Builder

Purpose:

- browse application types
- create, edit, clone, delete

Key code:

- `src/features/app-type-builder/index.tsx`
- `src/api/applicationTypes.ts`

APIs:

- `GET /api/{tenantName}/application-type`
- `POST /api/{tenantName}/application-type`
- `PUT /api/{tenantName}/application-type/{id}`
- `POST /api/{tenantName}/application-type/bulk-delete`
- `GET /api/{tenantName}/application-type/{applicationTypeId}/contract-template`

### 6.9 Date Calculation Rule Manager

Purpose:

- list rules
- preview/evaluate date calculations
- inspect rules fired for a specific request
- create new rules

Key code:

- `src/features/date-rules/index.tsx`
- `src/api/dateRules.ts`

APIs:

- `GET /api/{tenantName}/date-rules`
- `POST /api/{tenantName}/date-rules`
- `GET /api/{tenantName}/date-rules/{id}`
- `POST /api/{tenantName}/date-rules/evaluate-date-calculation-rule`
- `GET /api/{tenantName}/date-rules/get-request-executed`
- `GET /api/{tenantName}/date-rules/fields`

### 6.10 Custom Report Builder & Scheduler

Purpose:

- list reports
- load report data
- filter by date range
- export report output

Key code:

- `src/features/custom-reports/index.tsx`
- `src/api/customReports.ts`

APIs:

- `GET /api/{tenantName}/custom-report`
- `POST /api/{tenantName}/custom-report`
- `GET /api/{tenantName}/custom-report/{reportId}/data`
- `POST /api/{tenantName}/custom-report/schedule-report`

### 6.11 Compare & Comply Dashboard

Purpose:

- load AI scorecard
- trigger AI run
- lock/unlock obligation items

Key code:

- `src/features/compare-comply/index.tsx`
- `src/api/compareComply.ts`

APIs:

- `GET /api/{tenantname}/compare-comply/score-card`
- `POST /api/{tenantname}/compare-comply/run-ai`
- `POST /api/{tenantname}/compare-comply/request-item/lock`
- `GET /api/{tenantname}/compare-comply/load-tab`
- `GET /api/{tenantname}/compare-comply/extraction-history`

### 6.12 Bulk Import Template Tool

Purpose:

- download preformatted import templates
- inspect available templates for selected app type

Key code:

- `src/features/bulk-import/index.tsx`
- `src/api/bulkImport.ts`

APIs:

- `GET /api/{tenantName}/bulk-import-template/get-all-bulkimport-template`
- `POST /api/{tenantName}/bulk-import-template/download`
- `POST /api/{tenantName}/bulk-import-template`

### 6.13 Configuration Test Runner

Purpose:

- run manual scenario-based validation checks
- verify user masking
- verify contract lifecycle access
- verify API reachability

Key code:

- `src/testing/TestingPage.tsx`

Observation:

- this is useful operationally, but it is not automated test coverage

### 6.14 Bulk Test Creator

Purpose:

- orchestrate end-to-end test contract generation
- fill intake fields automatically
- upload or generate contract versions
- fetch and update details
- check approvals
- trigger eSign
- manage scenario presets

Key code:

- `src/features/bulk-test-creator/index.tsx`
- `src/api/contractRequest.ts`
- `src/api/esign.ts`
- `src/api/users.ts`
- `src/api/approval.ts`
- `src/api/metadata.ts`

APIs:

- contract request create/update/detail/search
- intake-form-field-groups
- questionnaire submission
- version upload endpoints
- eSign endpoints
- approval snapshot endpoints

Strength:

- highly valuable for implementation teams validating flows quickly

Risk:

- currently one of the most fragile and TypeScript-broken parts of the repository

## 7. API Coverage Summary

### 7.1 What the code clearly covers today

From the code and the live Swagger, the toolkit actively covers these New Product API families:

- `application-type`
- `application-type/intake-form-field-groups`
- `application-type-metadata`
- `legal-party`
- `contract-request`
- `contractapproval`
- `compare-comply`
- `custom-report`
- `date-rules`
- `bulk-import-template`
- `version/upload/form-data/{requestId}`
- signing-related account lookup

From the v1.9 PDF URI metadata, the toolkit also aligns with older / supporting endpoint families such as:

- `/cpaimt_auth/auth/token`
- `/cpaimt_api/api/{tenant}/v1/applicationtype`
- `/cpaimt_api/api/{tenant}/v1/department`
- `/cpaimt_api/api/{tenant}/v1/user`
- `/cpaimt_api/api/{tenant}/v1/roles`
- `/cpaimt_api/api/{tenant}/v1/snapshot/snapshot`
- questionnaire and contract template retrieval patterns

### 7.2 What is present in Swagger but not strongly surfaced in the UI yet

The live Swagger contains many families not fully represented in the toolkit UI, including:

- activity
- clause and clause category
- collaboration and multi-party collaboration
- client search and client-type
- auto-assignment rules
- organization management
- workshare / redline comparison operations
- risk compliance and scoring model families
- document type management

This means the toolkit already covers a strong operational subset, but not the full New Product API estate.

## 8. Strengths

- Strong business alignment: the tool is built around real implementation workflows, not abstract demos.
- Clear route separation: each major capability has its own screen and API wrapper.
- Good use of TanStack Query for caching and mutation refreshes.
- Useful admin affordances: export, bulk actions, filters, search, copy IDs, progress indicators.
- API wrapper organization is sensible by domain.
- The toolkit now deploys successfully to GitHub Pages.

## 9. Key Bugs, Risks, and Review Findings

### High priority

1. Auth token is persisted in browser storage despite the code comment saying it should not be.
   - In `src/store/authStore.ts`, the comment says "Never persist the token itself", but `partialize` includes `token`, `tokenExpiresAt`, and `isConnected`.
   - Impact: sensitive session state survives reloads and may remain on shared machines longer than intended.

2. The connect page uses a hard-coded client-side master code (`12069`) as a security gate.
   - This is visible in `src/features/connect/ConnectPage.tsx`.
   - Impact: anyone with bundle access can read or bypass it; it is not real security.

3. Strict build health is currently broken.
   - `npm run build` fails because `tsc && vite build` hits many TypeScript errors, especially in:
     - `src/features/bulk-test-creator/index.tsx`
     - `src/features/metadata-manager/index.tsx`
     - metadata helper components/utilities
   - Impact: local engineering confidence is lower, and future changes are riskier.

### Medium priority

4. Lint is also broken.
   - `npm run lint` currently fails.
   - Issues observed include:
     - `react-refresh/only-export-components` rule resolution failure
     - parse failure on `temp_restore.tsx`
     - many unused/import/type issues
   - Impact: code quality gates are not trustworthy.

5. Production architecture is inconsistent.
   - The deployed site is GitHub Pages, which is static.
   - `server.js` implements a runtime proxy, but GitHub Pages cannot run that server.
   - `leahClient.ts` comments say direct CORS-based access is the active model.
   - `vite.config.ts` still carries development proxy infrastructure.
   - Impact: future contributors can easily misunderstand which runtime path is real.

6. Very large feature files are becoming maintenance hotspots.
   - especially:
     - metadata manager
     - bulk test creator
     - contract edit
   - Impact: bug fixing, onboarding, and testability all suffer.

7. Character encoding issues are visible in the source.
   - Multiple files contain mojibake such as `â€”` and similar artifacts.
   - Impact: degraded UI copy quality and potential export/report readability issues.

### Lower priority but important

8. There is no real automated test suite.
   - The `TestingPage` is a useful manual operator tool, not CI-grade testing.

9. Staging defaults are built into the auth store and connect experience.
   - Good for internal usage, but risky if environments need stronger separation.

10. Repo hygiene needs cleanup.
   - `temp_restore.tsx` appears to be a temporary artifact and currently hurts linting.

## 10. Current Build and Quality Status

Observed during review:

- `npm run build:deploy`: passes
- `npm run build`: fails
- `npm run lint`: fails

Interpretation:

- deployment is currently operational
- development quality gates are not
- the repository is in a "usable product / unhealthy engineering baseline" state

## 11. Recommended Enhancements

### Security and access

1. Remove the hard-coded client-side master code.
2. Stop persisting the auth token in local storage.
3. Move any real access restriction to a server-controlled mechanism, SSO gate, or allowed-user check.

### Engineering quality

4. Restore a green `npm run build` by fixing TypeScript errors.
5. Restore a green `npm run lint`, including fixing the ESLint rule loading issue and removing or ignoring temporary files.
6. Normalize file encodings to UTF-8.

### Architecture

7. Decide on one production networking model and document it explicitly:
   - static app calling Leah APIs directly, or
   - hosted app with a real proxy layer
8. Split `metadata-manager` and `bulk-test-creator` into smaller components, hooks, and service helpers.
9. Generate or validate typed API contracts from Swagger where practical.

### Product / operations

10. Add a top-level dashboard/home page summarizing environment, auth status, and tool health.
11. Add saved filters / recent searches for audit log, approvals, and contract lookup.
12. Expand report scheduling and downstream export workflows if those are active business needs.

### Documentation

13. Add a root `README.md` that links to this document and explains setup, auth, and deployment.
14. Add per-feature docs for the two most complex modules:
   - metadata manager
   - bulk test creator

## 12. Suggested Remediation Order

### Phase 1: Safety and trust

- remove hard-coded master code
- stop persisting bearer token
- clean temporary files and encoding issues

### Phase 2: Restore engineering baseline

- fix `npm run build`
- fix `npm run lint`
- add a minimum CI pipeline for type-check + lint

### Phase 3: Maintainability

- break down large modules
- standardize API wrapper typing
- add test coverage around critical workflows

### Phase 4: Product maturity

- add discoverability docs
- add environment-aware configuration
- expand unsupported but high-value Swagger endpoint families only if implementation teams need them

## 13. Practical Takeaways for the Team

If the goal is "use the toolkit safely today", the answer is yes, with awareness:

- the deployed UI works
- the main operator flows are real and useful
- the API integration surface is substantial

If the goal is "treat this as a clean, scalable engineering codebase", the answer is not yet:

- the codebase needs a security cleanup
- it needs a restored type/lint baseline
- the largest feature modules need decomposition

## 14. Appendix: Reference Endpoint Families Seen During Review

### From live Swagger (`stg5`)

- `/api/{tenantName}/application-type`
- `/api/{tenantName}/application-type/intake-form-field-groups`
- `/api/{tenantName}/application-type-metadata`
- `/api/{tenantName}/application-type-metadata/field-types`
- `/api/{tenantName}/legal-party`
- `/api/{tenantName}/contract-request`
- `/api/{tenantName}/contract-request/{id}`
- `/api/{tenantName}/contract-request/search`
- `/api/{tenantName}/contractapproval/preexecution/{requestId}`
- `/api/{tenantname}/compare-comply/score-card`
- `/api/{tenantname}/compare-comply/run-ai`
- `/api/{tenantName}/custom-report`
- `/api/{tenantName}/date-rules`
- `/api/{tenantName}/bulk-import-template`
- `/api/{tenantName}/version/upload/form-data/{requestId}`
- `/api/{tenantName}/signing-system-account`

### From the v1.9 PDF URI metadata (`stg3` examples)

- `https://cloudstaging3.contractpod.com/cpaimt_auth/auth/token`
- `https://cloudstaging3.contractpod.com/cpaimt_api/api/qa/v1/applicationtype`
- `https://cpai-productapi-stg3.azurewebsites.net/api/{{tenant-name}}/application-type/intake-form-field-groups`
- `https://cloudstaging3.contractpod.com/cpaimt_api/api/qa/v1/department`
- `https://cpai-productapi-stg3.azurewebsites.net/api/qa/legal-party`
- `https://cloudstaging3.contractpod.com/cpaimt_api/api/qa/v1/user`
- `https://cloudstaging3.contractpod.com/cpaimt_api/api/qa/v1/roles`
- `https://cloudstaging3.contractpod.com/cpaimt_api/api/qa/v1/snapshot/snapshot`
- `https://cpai-productapi-stg3.azurewebsites.net/api/qa/contract-request`
- `https://cpai-productapi-stg3.azurewebsites.net/api/qa/version`
- version upload and latest-download patterns
- questionnaire and collaboration examples

---

This document is intended to be the current-state baseline for onboarding, planning, cleanup, and enhancement work. It should be updated after major feature additions, security cleanup, or any build/lint recovery effort.
