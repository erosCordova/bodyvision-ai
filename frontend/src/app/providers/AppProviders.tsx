import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { PrivateAuthProvider } from "./PrivateAuthProvider";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <PrivateAuthProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </PrivateAuthProvider>
    </QueryClientProvider>
  );
}
