import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useStore } from "./store";
import { ConnectedProvider } from "./ConnectedProvider";
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
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}


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
          <Route path="/login" element={<Login />} />
          <Route path="/app" element={<Protected><AppLayout /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="expedientes" element={<Expedientes />} />
            <Route path="expedientes/:id" element={<ExpedienteDetalle />} />
            <Route path="mediciones" element={<NeedPatient><Mediciones /></NeedPatient>} />
            <Route path="captura" element={<NeedPatient><Captura /></NeedPatient>} />
            <Route path="analisis" element={<NeedPatient body><AnalisisIA /></NeedPatient>} />
            <Route path="vision-3d" element={<NeedPatient body><Vision3D /></NeedPatient>} />
            <Route path="simulador" element={<NeedPatient complete><Simulador /></NeedPatient>} />
            <Route path="analitica" element={<Analitica />} />
            <Route path="consentimientos" element={<Consentimientos />} />
            <Route path="reportes" element={<NeedPatient><Reportes /></NeedPatient>} />
            <Route path="administracion" element={<Administracion />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toasts />
    </ConnectedProvider>
  );
}
