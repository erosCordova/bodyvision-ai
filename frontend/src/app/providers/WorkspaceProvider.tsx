import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { recordsApi } from "../../services/api/records";
import { sessionRequired, usePrivateAuth } from "./PrivateAuthProvider";

const initial = "10000000-0000-4000-8000-000000000001";

const WorkspaceContext = createContext({
  id: initial,
  setId: (_id: string) => {
    void _id;
  },
  api: recordsApi(initial),
  readOnly: true,
});

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const { session } = usePrivateAuth();
  const protectedMode = sessionRequired();
  const [demoId, setDemoId] = useState(
    () => sessionStorage.getItem("bodyvision.workspace") ?? initial,
  );
  const id = protectedMode && session ? session.organization_id : demoId;

  const environment = useQuery({
    queryKey: [
      "workspaces",
      protectedMode ? session?.organization_id : "demo",
      protectedMode ? session?.user_id : "demo",
    ],
    queryFn: () => recordsApi(id, protectedMode ? session?.token : undefined).workspaces(),
    enabled: !protectedMode || Boolean(session),
  });

  const setId = useCallback((next: string) => {
    // Client-side organization switching is NEVER an identity primitive.
    if (protectedMode) return;
    sessionStorage.setItem("bodyvision.workspace", next);
    setDemoId(next);
  }, [protectedMode]);
  const readOnly = (environment.data?.read_only ?? true) ||
    (protectedMode && (session?.role === "member" || session?.role === "privacy_officer"));

  const value = useMemo(
    () => ({
      id,
      setId,
      api: recordsApi(id, protectedMode ? session?.token : undefined),
      readOnly,
    }),
    [id, setId, session?.token, protectedMode, readOnly],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceContext);
