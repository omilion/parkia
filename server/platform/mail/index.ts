export { sendMail, processMailOutbox, recentMailCount, isValidEmail, MAX_MAIL_ATTEMPTS } from "./service";
export { getMailConfig, resolveMailTransport, setMailTransportForTesting, memoryOutbox, resetMemoryOutbox } from "./transports";
export { renderTemplate, SENSITIVE_TEMPLATES, type TemplateData, type TemplateName } from "./templates";
export { MailDeliveryError, type MailTransport, type MailMessage, type SendMailResult } from "./types";
