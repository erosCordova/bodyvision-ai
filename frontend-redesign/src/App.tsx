import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "./store";
import { ConnectedProvider,useConnection } from "./ConnectedProvider";
import { NeedPatient } from "./ConnectedPages";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AppLayout from "./pages/AppLayout";
import Dashboard from "./pages/Dashboard";
import { Expedientes, ExpedienteDetalle } from "./pages/Expedientes";
import Mediciones from "./pages/Mediciones";
import Captura from "./pages/Captura";
import AnalisisIA from "./pages/AnalisisIA";
import Vision3D from "./pages/Vision3D";
import Simulador from "./pages/Simulador";
import Analitica from "./pages/Analitica";
import { Consentimientos, Reportes, Administracion } from "./pages/Admin";

function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useStore();
  const {restoring}=useConnection();
  if(restoring)return <div className="grid min-h-screen place-items-center text-cyan-300">Restaurando sesión…</div>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}


function LoginRoute(){const {user}=useStore();const {restoring}=useConnection();return restoring?<div className="grid min-h-screen place-items-center text-cyan-300">Restaurando sesión…</div>:user?<Navigate to="/app" replace/>:<Login/>;}
function AdminRoute(){const {role}=useConnection();return role==="administrator"?<Administracion/>:<Navigate to="/app" replace/>;}
function DataRoute({children}:{children:React.ReactNode}){const {role}=useConnection();return role==="privacy_officer"?<div className="panel p-6">El módulo de privacidad aún no está habilitado para esta cuenta.</div>:<>{children}</>;}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="panel panel-glow pointer-events-auto flex items-center gap-2 px-4 py-3 text-sm text-white">
          <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_10px_#22d3ee]" />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <ConnectedProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/app" element={<Protected><AppLayout /></Protected>}>
            <Route index element={<DataRoute><Dashboard /></DataRoute>} />
            <Route path="expedientes" element={<DataRoute><Expedientes /></DataRoute>} />
            <Route path="expedientes/:id" element={<DataRoute><ExpedienteDetalle /></DataRoute>} />
            <Route path="mediciones" element={<DataRoute><NeedPatient><Mediciones /></NeedPatient></DataRoute>} />
            <Route path="captura" element={<DataRoute><NeedPatient><Captura /></NeedPatient></DataRoute>} />
            <Route path="analisis" element={<DataRoute><NeedPatient body><AnalisisIA /></NeedPatient></DataRoute>} />
            <Route path="vision-3d" element={<DataRoute><NeedPatient body><Vision3D /></NeedPatient></DataRoute>} />
            <Route path="simulador" element={<DataRoute><NeedPatient complete><Simulador /></NeedPatient></DataRoute>} />
            <Route path="analitica" element={<DataRoute><Analitica /></DataRoute>} />
            <Route path="consentimientos" element={<DataRoute><Consentimientos /></DataRoute>} />
            <Route path="reportes" element={<DataRoute><NeedPatient><Reportes /></NeedPatient></DataRoute>} />
            <Route path="administracion" element={<AdminRoute />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toasts />
    </ConnectedProvider>
  );
}
