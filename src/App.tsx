import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { useIsConnected } from "@/store/authStore";

// Feature pages — lazy loaded for performance
import { lazy, Suspense } from "react";

const ConnectPage      = lazy(() => import("@/features/connect/ConnectPage"));
const UserMaskPage     = lazy(() => import("@/features/user-mask/index"));
const ContractEditPage = lazy(() => import("@/features/contract-edit/index"));
const AuditLogPage     = lazy(() => import("@/features/audit-log/index"));
const ApprovalPage     = lazy(() => import("@/features/approval-checker/index"));
const LegalPartyPage   = lazy(() => import("@/features/legal-party/index"));
const MetadataPage     = lazy(() => import("@/features/metadata-manager/index"));
const AppTypePage      = lazy(() => import("@/features/app-type-builder/index"));
const DateRulesPage    = lazy(() => import("@/features/date-rules/index"));
const ReportsPage      = lazy(() => import("@/features/custom-reports/index"));
const ComplyPage       = lazy(() => import("@/features/compare-comply/index"));
const BulkImportPage   = lazy(() => import("@/features/bulk-import/index"));
const TestingPage      = lazy(() => import("@/testing/TestingPage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isConnected = useIsConnected();
  if (!isConnected) return <Navigate to="/connect" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Toaster richColors position="bottom-right" closeButton />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/user-mask" replace />} />
            <Route path="user-mask"       element={<UserMaskPage />} />
            <Route path="contract-edit"   element={<ContractEditPage />} />
            <Route path="audit-log"       element={<AuditLogPage />} />
            <Route path="approvals"       element={<ApprovalPage />} />
            <Route path="legal-party"     element={<LegalPartyPage />} />
            <Route path="metadata"        element={<MetadataPage />} />
            <Route path="app-types"       element={<AppTypePage />} />
            <Route path="date-rules"      element={<DateRulesPage />} />
            <Route path="reports"         element={<ReportsPage />} />
            <Route path="compare-comply"  element={<ComplyPage />} />
            <Route path="bulk-import"     element={<BulkImportPage />} />
            <Route path="testing"         element={<TestingPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
