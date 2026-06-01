export async function apiFetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    throw new Error('El servidor devolvio una respuesta no valida. Reinicia la app local e intenta nuevamente.');
  }

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error || 'No se pudo completar la solicitud');
  }

  return body as T;
}
