import { Component, type PropsWithChildren } from "react";
import { Link } from "react-router-dom";

type Props = PropsWithChildren<{ routeKey: string }>;
type State = { failed: boolean; routeKey: string };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, routeKey: this.props.routeKey };
  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.routeKey !== state.routeKey ? { failed: false, routeKey: props.routeKey } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="panel state" role="alert">
      <h1>El módulo no se pudo abrir</h1>
      <p>Puede haber ocurrido un problema de conexión o una actualización de la aplicación.
        No se mostrarán resultados incompletos.</p>
      <button type="button" className="secondary-button" onClick={()=>window.location.reload()}>Recargar página</button>
      {" "}<Link className="secondary-button" to="/">Volver al inicio</Link>
    </main>;
  }
}
