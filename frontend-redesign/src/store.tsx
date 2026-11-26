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

export const PATIENTS: Patient[] = [];

export const imcOf = (peso: number, altura: number) => peso / (altura / 100) ** 2;
export const idealWeight = (altura: number, sexo: Sex) => +(((altura / 100) ** 2) * (sexo === "male" ? 22.5 : 21.5)).toFixed(1);

export function bodyParams(p: { sexo: Sex; grasa: number; musculo: number }) {
  const bf = p.sexo === "female" ? 24 : 15;
  const bm = p.sexo === "female" ? 31 : 40;
  return {
    fat: Number.isFinite(p.grasa)?Math.max(-12, Math.min(26, p.grasa - bf)):0,
    mus: Number.isFinite(p.musculo)?Math.max(-8, Math.min(12, p.musculo - bm)):0,
  };
}

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun"];

export function historial(_p: Patient): {mes:string;peso:number;grasa:number;imc:number;musculo:number}[] {return [];}

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
  patientId?: string;
  paciente: string;
  tipo: string;
  fecha: string;
  vigencia: string;
  estado: "Vigente" | "Pendiente" | "Revocado" | "Por vencer";
}

export interface ReportRecord { id: string; patientId: string; title: string; date: string; content: string; }
export interface Store {
  user: { nombre: string; email: string } | null;
  login: (email: string) => void;
  logout: () => void;
  patients: Patient[];
  addPatient: (p: Omit<Patient, "id" | "ultima">) => boolean;
  updatePatient: (id: string, p: Partial<Omit<Patient, "id">>) => boolean;
  deletePatient: (id: string) => boolean;
  selectedId: string;
  select: (id: string) => void;
  patient: Patient;
  mediciones: Medicion[];
  addMedicion: (m: Omit<Medicion, "id">) => boolean;
  updateMedicion: (id: string, m: Omit<Medicion, "id">) => boolean;
  deleteMedicion: (id: string) => boolean;
  consents: Consent[];
  setConsents: (c: Consent[]) => boolean;
  reports: ReportRecord[];
  setReports: (r: ReportRecord[]) => boolean;
  toast: (msg: string) => void;
  toasts: { id: number; msg: string }[];
}

export const Ctx = createContext<Store>(null!);
export const useStore = () => useContext(Ctx);

