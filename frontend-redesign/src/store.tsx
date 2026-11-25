import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Sex } from "./three/assets";

export interface Patient {
  id: string;
  nombre: string;
  edad: number;
  sexo: Sex;
  altura: number;
  peso: number;
  grasa: number;
  musculo: number;
  tono: string;
  objetivo: string;
  estado: "Activo" | "En seguimiento" | "Nuevo" | "Alta";
  ultima: string;
  email: string;
  foto?: string;
}

const base: Omit<Patient, "id">[] = [
  { nombre: "Carlos Ramírez", edad: 34, sexo: "male", altura: 178, peso: 86.4, grasa: 24.5, musculo: 38.2, tono: "medio", objetivo: "Pérdida de grasa", estado: "En seguimiento", ultima: "Hace 2 h", email: "c.ramirez@correo.com" },
  { nombre: "Lucía Fernández", edad: 29, sexo: "female", altura: 165, peso: 71.2, grasa: 31.5, musculo: 29.8, tono: "claro", objetivo: "Recomposición corporal", estado: "Activo", ultima: "Ayer", email: "lucia.f@correo.com" },
  { nombre: "Andrés Molina", edad: 41, sexo: "male", altura: 183, peso: 97.8, grasa: 29.4, musculo: 36.1, tono: "trigueño", objetivo: "Reducción de peso", estado: "En seguimiento", ultima: "Hace 3 días", email: "andres.m@correo.com" },
  { nombre: "Valeria Soto", edad: 36, sexo: "female", altura: 170, peso: 64.0, grasa: 26.1, musculo: 31.4, tono: "medio", objetivo: "Tonificación", estado: "Activo", ultima: "Hace 5 h", email: "valeria.s@correo.com" },
  { nombre: "Diego Herrera", edad: 27, sexo: "male", altura: 180, peso: 79.5, grasa: 14.8, musculo: 44.0, tono: "oscuro", objetivo: "Hipertrofia", estado: "Activo", ultima: "Hoy", email: "diego.h@correo.com" },
  { nombre: "Mariana Ortiz", edad: 45, sexo: "female", altura: 160, peso: 78.3, grasa: 38.2, musculo: 27.9, tono: "claro", objetivo: "Pérdida de peso", estado: "En seguimiento", ultima: "Hace 1 semana", email: "mariana.o@correo.com" },
  { nombre: "Javier Núñez", edad: 52, sexo: "male", altura: 175, peso: 91.0, grasa: 27.8, musculo: 35.0, tono: "medio", objetivo: "Salud metabólica", estado: "Nuevo", ultima: "Hace 10 min", email: "javier.n@correo.com" },
  { nombre: "Camila Reyes", edad: 31, sexo: "female", altura: 168, peso: 58.7, grasa: 22.4, musculo: 33.2, tono: "trigueño", objetivo: "Mantenimiento", estado: "Alta", ultima: "Hace 2 semanas", email: "camila.r@correo.com" },
  { nombre: "Sergio Vidal", edad: 38, sexo: "male", altura: 176, peso: 82.1, grasa: 19.9, musculo: 40.5, tono: "oscuro", objetivo: "Definición", estado: "Activo", ultima: "Hace 4 días", email: "sergio.v@correo.com" },
  { nombre: "Paula Navarro", edad: 24, sexo: "female", altura: 172, peso: 66.5, grasa: 25.0, musculo: 30.8, tono: "claro", objetivo: "Tonificación", estado: "Nuevo", ultima: "Hace 20 min", email: "paula.n@correo.com" },
];

export const PATIENTS: Patient[] = base.map((p, i) => ({ ...p, id: `EXP-${(2401 + i).toString()}` }));

export const imcOf = (peso: number, altura: number) => peso / (altura / 100) ** 2;
export const idealWeight = (altura: number, sexo: Sex) => +(((altura / 100) ** 2) * (sexo === "male" ? 22.5 : 21.5)).toFixed(1);

export function bodyParams(p: { sexo: Sex; grasa: number; musculo: number }) {
  const bf = p.sexo === "female" ? 24 : 15;
  const bm = p.sexo === "female" ? 31 : 40;
  return {
    fat: Math.max(-12, Math.min(26, p.grasa - bf)),
    mus: Math.max(-8, Math.min(12, p.musculo - bm)),
  };
}

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun"];

export function historial(p: Patient) {
  const seed = p.id.charCodeAt(5) + p.edad;
  return MESES.map((m, i) => {
    const k = (5 - i) / 5;
    const wob = Math.sin(seed + i * 1.7) * 0.5;
    const peso = +(p.peso + k * (p.estado === "Nuevo" ? 0.4 : 4.2) + wob).toFixed(1);
    const grasa = +(p.grasa + k * 3.1 + wob * 0.4).toFixed(1);
    return { mes: m, peso, grasa, imc: +imcOf(peso, p.altura).toFixed(1), musculo: +(p.musculo - k * 1.8 + wob * 0.2).toFixed(1) };
  });
}

export interface Medicion {
  id: string;
  patientId?: string;
  paciente: string;
  fecha: string;
  peso: number;
  cintura: number;
  cadera: number;
  pecho: number;
  brazo: number;
  muslo: number;
  grasa: number;
  fuente: "Manual" | "Captura 3D";
}

export interface Consent {
  id: string;
  paciente: string;
  tipo: string;
  fecha: string;
  vigencia: string;
  estado: "Vigente" | "Pendiente" | "Revocado" | "Por vencer";
}

interface Store {
  user: { nombre: string; email: string } | null;
  login: (email: string) => void;
  logout: () => void;
  patients: Patient[];
  addPatient: (p: Omit<Patient, "id" | "ultima">) => boolean;
  selectedId: string;
  select: (id: string) => void;
  patient: Patient;
  mediciones: Medicion[];
  addMedicion: (m: Omit<Medicion, "id">) => void;
  consents: Consent[];
  setConsents: (c: Consent[]) => void;
  toast: (msg: string) => void;
  toasts: { id: number; msg: string }[];
}

const Ctx = createContext<Store>(null!);
export const useStore = () => useContext(Ctx);

const initialMed: Medicion[] = PATIENTS.slice(0, 6).map((p, i) => ({
  id: `MED-${1428 - i}`,
  paciente: p.nombre,
  fecha: `${20 - i * 2} jun 2025`,
  peso: p.peso,
  cintura: Math.round(p.altura * (p.sexo === "male" ? 0.5 : 0.44) + p.grasa * 0.35),
  cadera: Math.round(p.altura * 0.54 + p.grasa * 0.2),
  pecho: Math.round(p.altura * (p.sexo === "male" ? 0.57 : 0.5) + p.grasa * 0.12),
  brazo: Math.round(27 + p.musculo * 0.15 + p.grasa * 0.1),
  muslo: Math.round(46 + p.grasa * 0.35),
  grasa: p.grasa,
  fuente: i % 2 ? "Manual" : "Captura 3D",
}));

const initialConsents: Consent[] = PATIENTS.slice(0, 8).map((p, i) => ({
  id: `CON-${300 + i}`,
  paciente: p.nombre,
  tipo: ["Tratamiento de imágenes corporales", "Reconstrucción 3D", "Uso de IA en análisis", "Compartir con especialista"][i % 4],
  fecha: `${3 + i} may 2025`,
  vigencia: `${3 + i} may 2026`,
  estado: (["Vigente", "Vigente", "Pendiente", "Por vencer", "Vigente", "Revocado", "Vigente", "Pendiente"] as const)[i],
}));

const SESSION_KEY = "bv_demo_expedientes_v1";
function restorePatients(): Patient[] {
  try {
    const user = JSON.parse(localStorage.getItem("bv_user") || "null");
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (user && saved?.email === user.email && Array.isArray(saved.patients) && saved.patients.length) return saved.patients;
  } catch { /* session storage unavailable */ }
  return PATIENTS;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Store["user"]>(() => {
    try {
      return JSON.parse(localStorage.getItem("bv_user") || "null");
    } catch {
      return null;
    }
  });
  const [patients, setPatients] = useState<Patient[]>(restorePatients);
  const [selectedId, setSelectedId] = useState(PATIENTS[0].id);
  const [mediciones, setMediciones] = useState(initialMed);
  const [consents, setConsents] = useState(initialConsents);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const value = useMemo<Store>(
    () => ({
      user,
      login: (email) => {
        const u = { nombre: "Dr. Martínez", email };
        sessionStorage.removeItem(SESSION_KEY);
        setPatients(PATIENTS);
        setSelectedId(PATIENTS[0].id);
        localStorage.setItem("bv_user", JSON.stringify(u));
        setUser(u);
      },
      logout: () => {
        sessionStorage.removeItem(SESSION_KEY);
        setPatients(PATIENTS);
        setSelectedId(PATIENTS[0].id);
        localStorage.removeItem("bv_user");
        setUser(null);
      },
      patients,
      addPatient: (p) => {
        const np = { ...p, id: `EXP-${2401 + patients.length}`, ultima: "Ahora" } as Patient;
        const next = [np, ...patients];
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: user?.email, patients: next }));
        } catch { return false; }
        setPatients(next);
        setSelectedId(np.id);
        return true;
      },
      selectedId,
      select: setSelectedId,
      patient: patients.find((p) => p.id === selectedId) || patients[0],
      mediciones,
      addMedicion: (m) => setMediciones((l) => [{ ...m, id: `MED-${1429 + l.length - 5}` }, ...l]),
      consents,
      setConsents,
      toast,
      toasts,
    }),
    [user, patients, selectedId, mediciones, consents, toast, toasts]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
