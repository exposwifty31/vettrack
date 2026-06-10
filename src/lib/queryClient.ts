import { QueryClient } from "@tanstack/react-query";

function isUnauthorizedError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return true;
    const responseStatus = (error as { response?: { status?: number } }).response?.status;
    if (responseStatus === 401 || responseStatus === 403) return true;
  }
  if (error instanceof Error) {
    const m = error.message;
    if (m === "Session expired" || m === "UNAUTHORIZED" || m === "AUTH_INVALID") return true;
  }
  return false;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if (isUnauthorizedError(error)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      staleTime: 60 * 1000,
    },
    mutations: {
      retry: false,
    },
  },
});

if (import.meta.env.DEV) {
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "fetch") {
      console.log("QUERY RUN:", event.query.queryKey);
    }
  });
}
