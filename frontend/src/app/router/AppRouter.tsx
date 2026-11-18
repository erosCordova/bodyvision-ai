import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { FoundationPage } from "../../features/foundation/FoundationPage";
import { DataLayout } from "../layouts/DataLayout";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { ProfilesPage } from "../../features/profiles/ProfilesPage";
import { ProfileDetail } from "../../features/profiles/ProfileDetail";

const BodyWorkspace = lazy(() => import("../../features/viewer/BodyWorkspace").then(m => ({ default: m.BodyWorkspace })));
const modules = () => import("../../features/foundation/ModulePages");
const MeasurementsPage = lazy(() => modules().then(m => ({ default: m.MeasurementsPage })));
const CapturePage = lazy(() => modules().then(m => ({ default: m.CapturePage })));
const AnalysisPage = lazy(() => modules().then(m => ({ default: m.AnalysisPage })));
const ReportsPage = lazy(() => modules().then(m => ({ default: m.ReportsPage })));
const AdministrationPage = lazy(() => modules().then(m => ({ default: m.AdministrationPage })));
const AccessPage = lazy(() => modules().then(m => ({ default: m.AccessPage })));
const loading = <p role="status">Preparando módulo BODYVISION…</p>;
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/system" element={<FoundationPage />} />
        <Route path="/access" element={<Suspense fallback={loading}><AccessPage /></Suspense>} />
        <Route path="/body-3d" element={<Suspense fallback={loading}><BodyWorkspace /></Suspense>} />
        <Route path="/simulation" element={<Navigate to="/body-3d?panel=simulacion" replace />} />
        <Route element={<DataLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/profiles/:profileId" element={<ProfileDetail />} />
          <Route path="/measurements" element={<Suspense fallback={loading}><MeasurementsPage /></Suspense>} />
          <Route path="/capture" element={<Suspense fallback={loading}><CapturePage /></Suspense>} />
          <Route path="/analysis" element={<Suspense fallback={loading}><AnalysisPage /></Suspense>} />
          <Route path="/reports" element={<Suspense fallback={loading}><ReportsPage /></Suspense>} />
          <Route path="/administration" element={<Suspense fallback={loading}><AdministrationPage /></Suspense>} />
          <Route path="*" element={<><h1>Página no disponible</h1><Link to="/">Volver al dashboard</Link></>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
