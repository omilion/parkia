import { useMutation, useQueryClient } from "@tanstack/react-query";

export class ApiMutationError extends Error {
  constructor(
    message: string,
    public response?: Response,
    public status = 0,
  ) {
    super(message);
    this.name = "ApiMutationError";
  }
}
type WriteRequest = { url: string; options: RequestInit };

/** Dependencias de datos afectadas por cada operación, incluidas vistas de otros módulos. */
function affectedDomains(url: string): string[] {
  const path = url.split("?")[0];
  if (path.startsWith("/api/auth/")) return ["auth"];
  if (path.startsWith("/api/clients"))
    return ["clients", "contracts", "dashboard", "finance"];
  if (path.startsWith("/api/contracts"))
    return [
      "contracts",
      "clients",
      "spaces",
      "operator",
      "dashboard",
      "finance",
      "documents",
    ];
  if (path.startsWith("/api/finance") || path.startsWith("/api/payments"))
    return ["finance", "dashboard", "clients", "contracts", "documents"];
  if (path.startsWith("/api/visitors"))
    return ["operator", "spaces", "access", "dashboard", "finance", "ticket-validations"];
  if (path.startsWith("/api/payment-settings")) return ["payment-settings"];
  if (path.startsWith("/api/rate-plans")) return ["rate-plans", "rate-plan-versions", "operator", "dashboard"];
  if (path.startsWith("/api/agreements")) return ["agreements", "ticket-validations", "operator"];
  if (path.startsWith("/api/spaces") || path.startsWith("/api/space-maps"))
    return ["spaces", "operator", "access", "dashboard"];
  if (path.startsWith("/api/access") || path.startsWith("/api/totems"))
    return ["access", "spaces", "operator", "dashboard", "settings"];
  if (path.startsWith("/api/tasks")) return ["tasks", "dashboard", "finance"];
  if (path.startsWith("/api/documents"))
    return ["documents", "clients", "contracts", "tasks", "dashboard"];
  if (path.startsWith("/api/staff"))
    return ["staff", "tasks", "finance", "documents"];
  if (path.startsWith('/api/backups') && path.endsWith('/restore')) return ['settings', 'branches', 'clients', 'contracts', 'finance', 'spaces', 'operator', 'access', 'tasks', 'documents', 'staff', 'dashboard'];
  if (path.startsWith('/api/branches')) return ['branches', 'settings', 'spaces', 'operator', 'access', 'dashboard', 'contracts', 'finance', 'tasks', 'documents'];
  if (path.startsWith("/api/config") || path.startsWith("/api/backups"))
    return ["settings", "finance", "dashboard", 'access', 'spaces', 'operator'];
  if (path.startsWith("/api/dte")) return ["dte", "finance", "dashboard"];
  if (path.startsWith("/api/import"))
    return ["settings", "clients", "contracts", "finance", "spaces", "tasks"];
  return [];
}

export function invalidatedDomains(url: string): string[] {
  return [...new Set([...affectedDomains(url), 'audit'])];
}

export function useApiMutation(scope: string) {
  const client = useQueryClient();
  const mutation = useMutation<Response, ApiMutationError, WriteRequest>({
    mutationKey: ["apiWrite", scope],
    retry: false,
    mutationFn: async ({ url, options }) => {
      let response: Response;
      try {
        response = await fetch(url, { credentials: "include", ...options });
      } catch {
        throw new ApiMutationError(
          "No se pudo conectar con el servidor. Revisa la conexión e intenta nuevamente.",
        );
      }
      if (!response.ok) {
        let message = `No se pudo guardar la operación (${response.status}).`;
        try {
          const body = await response.clone().json();
          message = body.error || message;
        } catch {
          /* Conserva un mensaje legible si la respuesta no es JSON. */
        }
        throw new ApiMutationError(message, response, response.status);
      }
      return response;
    },
    onSuccess: async (_response, { url }) => {
      await Promise.all(
        invalidatedDomains(url).map((domain) =>
          client.invalidateQueries({ queryKey: [domain] }),
        ),
      );
    },
  });
  /** Adaptador para formularios heredados que aún inspeccionan res.ok y res.json(). */
  const request = async (
    url: string,
    options: RequestInit,
  ): Promise<Response> => {
    try {
      return await mutation.mutateAsync({ url, options });
    } catch (error) {
      const failure =
        error instanceof ApiMutationError
          ? error
          : new ApiMutationError("No se pudo guardar la operación.");
      return failure.response?.headers
        .get("content-type")
        ?.includes("application/json")
        ? failure.response
        : new Response(JSON.stringify({ error: failure.message }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
    }
  };
  const json = async <T>(url: string, options: RequestInit): Promise<T> => {
    const response = await mutation.mutateAsync({ url, options });
    return response.status === 204 ? (undefined as T) : response.json();
  };
  return { ...mutation, request, json };
}
