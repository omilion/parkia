/**
 * Plantillas de correo. Cada plantilla recibe datos tipados y devuelve asunto, texto plano y HTML.
 * Todo dato que llega a un correo se escapa; los enlaces solo pueden ser http(s).
 *
 * Para agregar una plantilla: declarar sus datos en `TemplateData`, escribir su funcion en `templates`
 * y, si el correo contiene un enlace con secreto (clave, verificacion), marcarla en `SENSITIVE_TEMPLATES`.
 */

export type TemplateData = {
  /** Enlace para elegir una clave nueva. */
  password_reset: { name: string; url: string; expiresMinutes: number };
  /** Enlace para confirmar la direccion de correo (alta autoservicio). */
  email_verification: { name: string; url: string; expiresHours: number };
  /** Aviso generico: cobranza, boleta, cuota por vencer, pase de visita... */
  notice: { title: string; paragraphs: string[]; cta?: { label: string; url: string }; footnote?: string };
};

export type TemplateName = keyof TemplateData;

/**
 * Correos con un secreto en el enlace. No se guarda su contenido en la bandeja de salida
 * (una filtracion de la base no debe entregar enlaces vigentes) y no se reintentan: se pide uno nuevo.
 */
export const SENSITIVE_TEMPLATES: ReadonlySet<TemplateName> = new Set<TemplateName>(["password_reset", "email_verification"]);

export type RenderedMail = { subject: string; text: string; html: string };

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Acepta solo http(s); cualquier otra cosa (javascript:, data:) se rechaza. */
export function assertSafeUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("El enlace del correo no es una URL valida");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("El enlace del correo debe ser http o https");
  return parsed.toString();
}

function layout(input: { title: string; paragraphs: string[]; cta?: { label: string; url: string }; footnote?: string }) {
  const paragraphs = input.paragraphs.map(text => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1e293b">${escapeHtml(text)}</p>`).join("");
  const cta = input.cta
    ? `<p style="margin:22px 0"><a href="${escapeHtml(assertSafeUrl(input.cta.url))}" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px">${escapeHtml(input.cta.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#64748b">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escapeHtml(input.cta.url)}</span></p>`
    : "";
  const footnote = input.footnote ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#64748b">${escapeHtml(input.footnote)}</p>` : "";
  const html = `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px">
<p style="margin:0 0 18px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4338ca">Parkia</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(input.title)}</h1>${paragraphs}${cta}${footnote}</div></body></html>`;
  const text = [
    input.title, "", ...input.paragraphs.flatMap(paragraph => [paragraph, ""]),
    ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`, ""] : []),
    ...(input.footnote ? [input.footnote] : []),
  ].join("\n").trim();
  return { html, text };
}

const templates: { [K in TemplateName]: (data: TemplateData[K]) => RenderedMail } = {
  password_reset: data => {
    const subject = "Restablece tu clave de Parkia";
    return {
      subject,
      ...layout({
        title: subject,
        paragraphs: [`Hola ${data.name}, recibimos una solicitud para cambiar tu clave.`, `El enlace sirve una sola vez y vence en ${data.expiresMinutes} minutos.`],
        cta: { label: "Elegir una clave nueva", url: data.url },
        footnote: "Si no lo solicitaste, ignora este correo: tu clave actual sigue funcionando.",
      }),
    };
  },
  email_verification: data => {
    const subject = "Confirma tu correo en Parkia";
    return {
      subject,
      ...layout({
        title: subject,
        paragraphs: [`Hola ${data.name}, confirma tu correo para activar tu cuenta.`, `El enlace vence en ${data.expiresHours} horas.`],
        cta: { label: "Confirmar mi correo", url: data.url },
        footnote: "Si no creaste una cuenta en Parkia, ignora este correo.",
      }),
    };
  },
  notice: data => ({ subject: data.title, ...layout(data) }),
};

export function renderTemplate<K extends TemplateName>(name: K, data: TemplateData[K]): RenderedMail {
  const render = templates[name] as (data: TemplateData[K]) => RenderedMail;
  if (!render) throw new Error(`Plantilla de correo desconocida: ${String(name)}`);
  return render(data);
}
