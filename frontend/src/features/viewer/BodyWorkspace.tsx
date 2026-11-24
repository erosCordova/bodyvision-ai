import { Navigate } from "react-router-dom";
import { sessionRequired, usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import { AnatomyAtlas } from "./AnatomyAtlas";

/** Immersive anatomical atlas; the original selected 3D avatar is retained.
 * Private test mode requires a verified session before mounting any viewer
 * queries, while the public synthetic demo remains readable.
 */
export function BodyWorkspace() {
  const { session } = usePrivateAuth();
  if (sessionRequired() && !session) {
    return <Navigate to="/access" replace />;
  }
  return <AnatomyAtlas />;
}
