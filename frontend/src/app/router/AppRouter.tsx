import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { FoundationPage } from "../../features/foundation/FoundationPage";
import { DataLayout } from "../layouts/DataLayout";
import { Dashboard } from "../../features/dashboard/Dashboard";
import { ProfilesPage } from "../../features/profiles/ProfilesPage";
import { ProfileDetail } from "../../features/profiles/ProfileDetail";
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/system" element={<FoundationPage />} />
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
