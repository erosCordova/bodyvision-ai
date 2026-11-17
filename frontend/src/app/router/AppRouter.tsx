import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { FoundationPage } from "../../features/foundation/FoundationPage";
import { DataLayout } from "../layouts/DataLayout";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { ProfilesPage } from "../../features/profiles/ProfilesPage";
import { ProfileDetail } from "../../features/profiles/ProfileDetail";

const BodyWorkspace = lazy(() => import("../../features/viewer/BodyWorkspace").then(module => ({ default: module.BodyWorkspace })));

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/system" element={<FoundationPage />} />
        <Route path="/body-3d" element={<Suspense fallback={<p role="status">Abriendo laboratorio anatómico 3D…</p>}><BodyWorkspace /></Suspense>} />
        <Route element={<DataLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          <Route path="/profiles/:profileId" element={<ProfileDetail />} />
          <Route
            path="*"
            element={
              <>
                <h1>Página no disponible</h1>
                <Link to="/">Volver al resumen</Link>
              </>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
