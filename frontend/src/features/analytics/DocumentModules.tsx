import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { privateAuthEnabled } from "../../app/providers/PrivateAuthProvider";
import { DashboardEvolution } from "../dashboard/Dashboard";
import { ProfilePicker } from "../foundation/ModuleControls";
import { ConsentPanel } from "../profiles/ConsentPanel";
import { ErrorState, LoadingState } from "../../components/ui/States";

export function AnalyticsPage() {
  return <div className="enterprise-module">
    <div className="enterprise-page-head"><h1>Evolución corporal</h1></div>
    <DashboardEvolution initiallyOpen/>
  </div>;
}

function PrivateConsents() {
  const { id, api } = useWorkspace();
  const [params] = useSearchParams();
  const [profileId,setProfileId] = useState(params.get("profile") ?? "");
  const profile=useQuery({queryKey:["profile",id,profileId],queryFn:()=>api.profile(profileId),enabled:Boolean(profileId)});
  return <>
    <section className="enterprise-panel product-evolution-body">
      <h2>Seleccionar expediente</h2>
      <ProfilePicker selected={profile.data??null} selectedId={profileId} onChange={setProfileId}/>
      {profileId && (profile.isPending ? <LoadingState/> : profile.isError ? <ErrorState error={profile.error} retry={()=>void profile.refetch()}/> : <Link to={"/profiles/"+profileId}>Abrir expediente →</Link>)}
    </section>
    {profileId && profile.isSuccess && <ConsentPanel key={profileId} profileId={profileId}/>}
  </>;
}
export function ConsentsPage() {
  return <div className="enterprise-module">
    <div className="enterprise-page-head"><h1>Consentimientos</h1></div>
    {privateAuthEnabled() ? <PrivateConsents/> : <section className="enterprise-panel product-evolution-body">
      <h2>Acceso restringido</h2><p>Las aceptaciones, revocaciones y su historial requieren una sesión privada autorizada. La demostración pública no registra consentimientos de personas.</p>
      <Link className="secondary-button" to="/access">Acceso y seguridad →</Link>
    </section>}
  </div>;
}
