# Leah CLM Implementation Toolkit — Claude Code Instructions

## Project purpose
This is a React + TypeScript internal tooling app for the Integreon implementation team. It provides 11 tools that replace manual Leah CLM UI work with fast, API-driven operations. Built for integration specialists — not end-users.

## Tech stack
- **React 18** + **Vite 5** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (components in `src/components/ui/`)
- **TanStack Query v5** — all API state, caching, pagination
- **TanStack Table v8** — all data grids
- **Zustand** — global auth token + tenant config (persisted to localStorage)
- **React Hook Form** + **Zod** — all forms with runtime validation
- **Axios** — HTTP client, base instance in `src/api/leahClient.ts`
- **xlsx (SheetJS)** + **jsPDF** — Excel and PDF export

## Leah CLM API — three base URLs (CRITICAL)
```
Auth API:      https://{cloudInstance}/cpaimt_auth/auth/token
Old Prod API:  https://{cloudInstance}/cpaimt_api/api/{tenant}/v1/...
New Cloud API: https://{newCloudApi}/api/{tenant}/...
```
- **Auth**: POST JSON body `{ grant_type:"password", username, password, domain: tenant }`
- **Old Prod** is used for: applicationtype, department, user, roles, snapshot, v1/* endpoints
- **New Cloud** is used for: contract-request, legal-party, application-type (new), metadata, activity, audit-log, date-rules, custom-report, compare-comply, bulk-import-template, collaboration
- All calls after auth add `Authorization: Bearer {token}` header
- CORS is handled by Vite proxy in dev (see `vite.config.ts`) — all `/leah-api/*` requests are proxied

## Project conventions
- **Feature-first folder structure**: each tool lives in `src/features/{tool-name}/`
- Each feature folder contains: `index.tsx` (page), `hooks.ts` (TanStack Query hooks), `types.ts` (local types), `components/` (feature-specific components)
- Shared types in `src/types/index.ts`
- All API functions in `src/api/` — one file per domain
- Global state in `src/store/` — `authStore.ts` (token, user, tenant config) and `configStore.ts` (UI preferences)
- No `any` types — use proper TypeScript
- All forms use React Hook Form + Zod schema validation
- All lists use TanStack Table — never build custom table logic

## Key API facts (prevents bugs)
- Contract list: `GET /api/{tenant}/contract-request` — params are `PageNumber`, `PageSize`, `ApplicationTypeId` (NO `filter.` prefix)
- DO NOT pass `RequesterUserName` to contract list — it filters to only that user's contracts, hiding everything else
- Contract update payload: `requesterUser` uses uppercase `UserId` and `DepartmentId`
- App types list (old prod): params use `filter.pageNo`, `filter.perPage`, `filter.requestorUsername`
- Intake form fields: always call with `SkipFieldOptions=false` to get dropdown selectOptions
- Email masking: `email` field starts with `x` prefix when masked (e.g. `xaaron.brix@pentair.com`). `userName` is always the real email.

## The 11 tools — build order
1. `user-mask` — most critical, needed at go-live (PUT /v1/user/{id} to toggle email x-prefix)
2. `contract-edit` — already partially built, fix dropdown values
3. `audit-log` — POST /AuditLog for contract action history
4. `approval-checker` — GET /contractapproval/preexecution/{requestId}
5. `legal-party` — full CRUD GET/POST/PUT/DELETE /legal-party
6. `metadata-manager` — GET /application-type-metadata/list + field-options
7. `app-type-builder` — full CRUD GET/POST/PUT /application-type
8. `date-rules` — GET/POST /date-rules + /evaluate-date-calculation-rule preview
9. `custom-reports` — POST /custom-report + schedule-report + /{id}/data
10. `compare-comply` — GET /compare-comply/score-card + run-ai
11. `bulk-import` — GET /bulk-import-template/download + field validation

## Zustand store shape
```typescript
// authStore
{
  token: string | null
  cloudInstance: string   // e.g. "cloud20.contractpod.com"
  newCloudApi: string     // e.g. "cpai-productapi-pus20.azurewebsites.net"
  tenant: string          // e.g. "pentair"
  username: string
  isConnected: boolean
  setToken: (token: string) => void
  setConfig: (cfg: Partial<AuthConfig>) => void
  logout: () => void
}
```

## Running the project
```bash
npm install
npm run dev        # starts Vite dev server on :5173
npm run build      # production build
npm run preview    # preview production build
```

## Environment — never hardcode credentials
All connection settings come from the Zustand store (user-entered in the Settings modal). No `.env` file for secrets. The Vite proxy in `vite.config.ts` uses the stored config via request headers passed from the frontend.

## shadcn/ui component installation
Components are already copied into `src/components/ui/`. To add more:
```bash
npx shadcn@latest add {component-name}
```

## Testing module
`src/testing/` contains the scenario runner. Each scenario is a sequence of API calls with pass/fail assertions. Results are stored in TanStack Query cache and displayed in the Testing tab.

## When adding a new feature
1. Create `src/features/{name}/types.ts` — Zod schemas + inferred TypeScript types
2. Create `src/api/{name}.ts` — raw API functions (no React, just axios)
3. Create `src/features/{name}/hooks.ts` — TanStack Query hooks that wrap the API functions
4. Create `src/features/{name}/components/` — UI components
5. Create `src/features/{name}/index.tsx` — page component that assembles everything
6. Add route in `src/App.tsx`
7. Add nav item in `src/components/layout/Sidebar.tsx`
