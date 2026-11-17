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
const initial = "10000000-0000-4000-8000-000000000001";
const WorkspaceContext = createContext({
  id: initial,
  setId: (_id: string) => {
    void _id;
  },
  api: recordsApi(initial),
  readOnly: false,
});
export function WorkspaceProvider({ children }: PropsWithChildren) {
  const environment = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => recordsApi(initial).workspaces(),
  });
  const readOnly = environment.data?.read_only ?? true;
  const [id, setWorkspaceId] = useState(
    () => sessionStorage.getItem("bodyvision.workspace") ?? initial,
  );
  const setId = useCallback((next: string) => {
    sessionStorage.setItem("bodyvision.workspace", next);
    setWorkspaceId(next);
  }, []);
  const value = useMemo(
    () => ({ id, setId, api: recordsApi(id), readOnly }),
    [id, setId, readOnly],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
export const useWorkspace = () => useContext(WorkspaceContext);
