import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { FoundationPage } from '../../features/foundation/FoundationPage';

export function AppRouter() {
  return <BrowserRouter><a className="skip-link" href="#main-content">Saltar al contenido</a><Routes>
    <Route path="/" element={<FoundationPage/>}/>
    <Route path="*" element={<main id="main-content"><h1>Página no disponible</h1><Link to="/">Volver al inicio</Link></main>}/>
  </Routes></BrowserRouter>;
}
