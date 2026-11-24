import { lazy, Suspense, type PropsWithChildren } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { FoundationPage } from "../../features/foundation/FoundationPage";
import { DataLayout } from "../layouts/DataLayout";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { ProfilesPage } from "../../features/profiles/ProfilesPage";
import { ProfileDetail } from "../../features/profiles/ProfileDetail";
import { privateAuthEnabled, usePrivateAuth } from "../providers/PrivateAuthProvider";

const BodyWorkspace = lazy(() => import("../../features/viewer/BodyWorkspace").then(m => ({ default: m.BodyWorkspace })));
const PrivacyRequestsPage = lazy(() => import("../../features/privacy/PrivacyRequestsPage").then(m => ({ default: m.PrivacyRequestsPage })));
const ProjectProgressPage = lazy(() => import("../../features/progress/ProjectProgress").then(m => ({ default: m.ProjectProgressPage })));
const modules = () => import("../../features/foundation/ModulePages");
const MeasurementsPage = lazy(() => modules().then(m => ({ default: m.MeasurementsPage })));
const CapturePage = lazy(() => modules().then(m => ({ default: m.CapturePage })));
const AnalysisPage = lazy(() => modules().then(m => ({ default: m.AnalysisPage })));
const ReportsPage = lazy(() => modules().then(m => ({ default: m.ReportsPage })));
const AdministrationPage = lazy(() => modules().then(m => ({ default: m.AdministrationPage })));
const AccessPage = lazy(() => modules().then(m => ({ default: m.AccessPage })));
const loading = <p role="status">Preparando módulo BODYVISION…</p>;
function VisualAccess({ children }: PropsWithChildren) {
  const { session, restoring } = usePrivateAuth();
  if (privateAuthEnabled() && restoring) return loading;
  return session?.role === "privacy_officer" ? <Navigate to="/privacy" replace /> : children;
}
function ApplicationRoutes() {
  const location = useLocation();
  return (
    <RouteErrorBoundary routeKey={location.key}>
      <Routes>
        <Route path="/system" element={<FoundationPage />} />
        <Route path="/access" element={<Suspense fallback={loading}><AccessPage /></Suspense>} />
        <Route path="/body-3d" element={<VisualAccess><Suspense fallback={loading}><BodyWorkspace /></Suspense></VisualAccess>} />
        <Route path="/simulation" element={<Navigate to="/body-3d?panel=simulacion" replace />} />
        <Route element={<DataLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/progress" element={<Suspense fallback={loading}><ProjectProgressPage /></Suspense>} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/profiles/:profileId" element={<ProfileDetail />} />
          <Route path="/measurements" element={<Suspense fallback={loading}><MeasurementsPage /></Suspense>} />
          <Route path="/capture" element={<Suspense fallback={loading}><CapturePage /></Suspense>} />
          <Route path="/analysis" element={<Suspense fallback={loading}><AnalysisPage /></Suspense>} />
          <Route path="/reports" element={<Suspense fallback={loading}><ReportsPage /></Suspense>} />
          <Route path="/privacy" element={<Suspense fallback={loading}><PrivacyRequestsPage /></Suspense>} />
          <Route path="/administration" element={<Suspense fallback={loading}><AdministrationPage /></Suspense>} />
          <Route path="*" element={<><h1>Página no disponible</h1><Link to="/">Volver al dashboard</Link></>} />
        </Route>
      </Routes>
    </RouteErrorBoundary>
  );
}
export function AppRouter() {
  return <BrowserRouter><ApplicationRoutes /></BrowserRouter>;
}
