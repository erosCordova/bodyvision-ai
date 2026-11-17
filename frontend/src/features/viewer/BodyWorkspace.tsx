import { useState } from "react";
import { BodyViewer } from "./BodyViewer";
import { AnatomyAtlas } from "./AnatomyAtlas";
import "./anatomy.css";

/** Keep the adjustable surface and the licensed reference atlas independent:
 * the atlas is not registered to a patient's height, weight, or scan.
 */
export function BodyWorkspace() {
  const [mode, setMode] = useState<"surface" | "atlas">("atlas");
  return (
    <div>
      <div className="body-workspace-switch" role="group" aria-label="Modo de exploración 3D">
        <button type="button" aria-pressed={mode === "surface"} onClick={() => setMode("surface")}>Simulación de estatura y peso</button>
        <button type="button" aria-pressed={mode === "atlas"} onClick={() => setMode("atlas")}>Visión anatómica 3D</button>
      </div>
      {mode === "surface" ? <BodyViewer /> : <AnatomyAtlas />}
    </div>
  );
}
