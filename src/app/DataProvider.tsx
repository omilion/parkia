import { useState } from "react";
import type { ReactNode } from "react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

/** Se monta por sesión autenticada; al salir se descarta toda la caché del usuario. */
export function DataProvider({
  children,
}: {
  children: ReactNode;
  key?: string | number;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      mutationCache: new MutationCache({
        onSuccess: async (_data, _variables, _context, mutation) => {
          const domains = mutation.meta?.invalidates;
          if (Array.isArray(domains))
            await Promise.all(
              domains
                .filter(
                  (domain): domain is string => typeof domain === "string",
                )
                .map((domain) =>
                  queryClient.invalidateQueries({ queryKey: [domain] }),
                ),
            );
        },
      }),
      defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
