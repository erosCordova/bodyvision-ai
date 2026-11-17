import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { recordsApi } from "../../services/api/records";
const initial = "10000000-0000-4000-8000-000000000001";
const WorkspaceContext = createContext({
  id: initial,
  setId: (_id: string) => {
    void _id;
  },
  api: recordsApi(initial),
});
export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [id, setWorkspaceId] = useState(
    () => sessionStorage.getItem("bodyvision.workspace") ?? initial,
  );
  const setId = useCallback((next: string) => {
    sessionStorage.setItem("bodyvision.workspace", next);
    setWorkspaceId(next);
  }, []);
  const value = useMemo(
    () => ({ id, setId, api: recordsApi(id) }),
    [id, setId],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
export const useWorkspace = () => useContext(WorkspaceContext);
