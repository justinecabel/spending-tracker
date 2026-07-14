import { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A stopped Docker/Funnel API is temporary. Keep the loading state and
      // resume automatically instead of turning cached screens into errors.
      retry: true,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 15_000),
    },
  },
});

export function Providers({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
