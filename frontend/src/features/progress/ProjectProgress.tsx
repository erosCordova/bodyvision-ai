import { Link } from "react-router-dom";
import { overallProgress, phaseAssessment, phaseProgressMethod, reviewedAt } from "./projectProgress";
import { phaseClosureAudit } from "./phaseClosureAudit";
import "./progress.css";

export function ProjectProgressSummary() {
  return (
    <section className="project-progress-summary" aria-label="Progreso de desarrollo de BODYVISION">
      <div className="project-progress-text">
        <p>DESARROLLO DE BODYVISION AI</p>
        <h2>Avance del proyecto</h2>
        <span>Revisión técnica basada en las 10 fases del documento maestro.</span>
      </div>
      <div className="project-progress-meter">
        <div className="project-progress-meter-top">
          <strong>{overallProgress}%</strong><span>del alcance especificado</span>
        </div>
        <div className="project-progress-track" role="progressbar" aria-label="Avance estimado del proyecto" aria-valuenow={overallProgress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: overallProgress + "%" }} />
        </div>
        <small>Estimación manual · {reviewedAt}</small>
      </div>
      <Link to="/progress" className="project-progress-action">Ver avances por fase →</Link>
    </section>
  );
}

export function ProjectProgressPage() {
  return (
    <div className="project-progress-page">
      <header className="enterprise-page-head">
        <div>
          <p className="eyebrow">HOJA DE RUTA · FASES 0–9</p>
          <h1>Progreso de implementación</h1>
          <p>Evaluación del código y las pruebas frente a los entregables del documento maestro BODYVISION AI v3.</p>
        </div>
      </header>
      <ProjectProgressSummary />
      <div className="project-progress-note">
        <strong>Cómo se calcula</strong>
        <p>{phaseProgressMethod} Los controles marcados como pendientes no se consideran operativos por tener únicamente una pantalla diseñada. Última revisión: {reviewedAt}.</p>
      </div>
      <section className="project-acceptance-audit" aria-label="Auditoría de cierre de fases 0 a 2">
        <div className="project-acceptance-heading">
          <div>
            <h2>Auditoría de cierre · fases 0–2</h2>
            <p>Separación entre gate técnico comprobado y aceptación formal. Ninguna fase está firmada; la evidencia no aumenta el porcentaje por sí sola.</p>
          </div>
          <a href="https://github.com/erosCordova/bodyvision-ai/blob/feature/phase3-auth-security/docs/qa/PHASE_0_2_ACCEPTANCE_AUDIT.md" target="_blank" rel="noopener noreferrer">
            Abrir matriz completa
          </a>
        </div>
        <div className="project-acceptance-grid">
          {phaseClosureAudit.map(gate => (
            <article className="project-acceptance-card" key={gate.phaseId}>
              <h3>Fase {gate.phaseId} · {gate.title}</h3>
              <p><strong>Gate técnico:</strong> {gate.technical === "verified" ? "Verificado" : "Pendiente"}</p>
              <p><strong>Aceptación formal:</strong> Pendiente, sin firma</p>
              <p><strong>Responsable:</strong> {gate.owner}</p>
              <p className="project-acceptance-mapping">{gate.mappedExecutionPhase}</p>
              <ul>
                {gate.checks.map(check => (
                  <li key={check.id}>
                    <span className="project-acceptance-check">
                      <strong>{check.state === "verified" ? "Comprobado" : "Pendiente"}</strong>
                      {" "}{check.requirement}
                    </span>
                    {check.pendingReason && <small>{check.pendingReason}</small>}
                    {check.evidence && <a href={check.evidence.url} target="_blank" rel="noopener noreferrer">
                      {check.evidence.label}
                    </a>}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="project-phase-list" aria-label="Estado de las diez fases">
        {phaseAssessment.map(phase => (
          <article className="project-phase-card" key={phase.id}>
            <div className="project-phase-header">
              <div><span>FASE {phase.id}</span><h2>{phase.name}</h2></div>
              <strong>{phase.progress}%</strong>
            </div>
            <div className="project-progress-track" role="progressbar" aria-label={"Avance de " + phase.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.progress}>
              <span style={{ width: phase.progress + "%" }} />
            </div>
            <dl>
              <div><dt>Avanzado</dt><dd>{phase.completed}</dd></div>
              <div><dt>Pendiente</dt><dd>{phase.pending}</dd></div>
              <div><dt>Criterio para cerrar la fase</dt><dd>{phase.milestone}</dd></div>
            </dl>
          </article>
        ))}
      </section>
      <section className="project-next-step" aria-label="Próxima prioridad">
        <div><span>PRÓXIMA PRIORIDAD</span><h2>Recuperación y protección de cuentas</h2>
          <p>Completar el alta administrativa inicial, recuperación autónoma de cuentas, MFA y revisión de privacidad antes de permitir capturas o análisis reales.</p>
        </div>
        <Link to="/administration">Ver seguridad y administración →</Link>
      </section>
      <p className="project-progress-footnote">Referencias: Documentación Maestra Integral Visual v2 y Arquitectura, Modelos Funcionales y Fases v3, sección 6. Los porcentajes corresponden al criterio técnico de revisión y no sustituyen la aceptación final de las fases por sus responsables.</p>
    </div>
  );
}
