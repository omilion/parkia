import { useApiMutation } from "../../../lib/useApiMutation";

import { useCollectionState } from "./useCollectionState";

import React from "react";

import { CollectionAction, StaffUser } from "../../../types";
import { apiFetchJson } from "../../../lib/api";

import type { PaymentDetail, CollectionPayment } from "../pages/financeShared";
import type { CollectionActionValues } from "../../../../shared/schemas/finance";

export type Dependencies_useFinanceCollectionActions = {
  collectionPayment: ReturnType<typeof useCollectionState>["collectionPayment"];
  copyText: (value: string | null | undefined, label: string) => Promise<void>;
  fetchData: () => Promise<void>;
  isSavingCollectionAction: ReturnType<
    typeof useCollectionState
  >["isSavingCollectionAction"];
  setCollectionActions: ReturnType<
    typeof useCollectionState
  >["setCollectionActions"];
  setCollectionPayment: ReturnType<
    typeof useCollectionState
  >["setCollectionPayment"];
  setIsSavingCollectionAction: ReturnType<
    typeof useCollectionState
  >["setIsSavingCollectionAction"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
  taskAssignees: any;
  user: StaffUser;
};
export function useFinanceCollectionActions(
  dependencies: Dependencies_useFinanceCollectionActions,
) {
  const {
    collectionPayment,
    copyText,
    fetchData,
    isSavingCollectionAction,
    setCollectionActions,
    setCollectionPayment,
    setIsSavingCollectionAction,
    setToast,
    taskAssignees,
    user,
  } = dependencies;
  const apiWrite = useApiMutation("finance/useFinanceCollectionActions");
  const requestAdminApproval = async (
    label: string,
    source?: {
      source_type: string;
      source_id: string | number;
      source_label: string;
    },
  ) => {
    const adminAssignee = taskAssignees.find(
      (assignee) => assignee.role === "admin",
    );
    const sourceLine = source
      ? `\n\nOrigen: ${source.source_label} #${source.source_id}.`
      : "";
    try {
      const res = await apiWrite.request("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Aprobación administrativa: ${label}`,
          description: `Solicitud creada por ${user.name} (${user.email}) desde Finanzas.\n\nAcción requerida: ${label}.${sourceLine}\n\nRevisar respaldo, motivo y trazabilidad antes de ejecutar.`,
          category: "finance",
          priority: "high",
          assigned_staff_id: adminAssignee?.id || null,
          source_type: source?.source_type || null,
          source_id: source ? String(source.source_id) : null,
          due_date: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!res.ok) throw new Error("No se pudo crear la solicitud");
      setToast({
        message: `Solicitud enviada a administración para ${label}.`,
        type: "success",
      });
    } catch {
      setToast({
        message: `No se pudo crear la solicitud. Registra manualmente la aprobación para ${label}.`,
        type: "error",
      });
    }
  };

  const fetchCollectionActions = async (paymentId: number) => {
    const res = await fetch(
      `/api/finance/payments/${paymentId}/collection-actions`,
    );
    if (!res.ok) throw new Error("No se pudo cargar la cobranza");
    return res.json() as Promise<CollectionAction[]>;
  };

  const normalizePhoneForWhatsApp = (phone: string | null | undefined) => {
    const digits = phone?.replace(/\D/g, "") || "";
    if (!digits) return "";
    if (digits.startsWith("56")) return digits;
    if (digits.length === 9) return `56${digits}`;
    return digits;
  };

  const buildCollectionMessage = (payment: CollectionPayment) => {
    const balance = Number(
      payment.remaining_amount ?? payment.amount ?? 0,
    ).toLocaleString();
    return `Hola ${payment.client_name || ""}, te contactamos desde Parkia por el saldo pendiente de $${balance} con vencimiento ${payment.due_date}. Por favor indícanos si ya fue transferido o la fecha estimada de pago.`;
  };

  const copyCollectionTemplate = (payment: CollectionPayment) => {
    copyText(buildCollectionMessage(payment), "Plantilla de cobranza");
  };

  const openCollectionDrawer = async (payment: CollectionPayment) => {
    setCollectionPayment(payment);
    if ("client_email" in payment && "client_phone" in payment) return;
    try {
      const detail = await apiFetchJson<PaymentDetail>(
        `/api/finance/payments/${payment.id}/detail`,
      );
      setCollectionPayment(detail.payment);
    } catch {
      // La cobranza sigue operativa con los datos mínimos de la fila.
    }
  };

  /** Devuelve true si se guardó, para que el formulario se limpie. */
  const handleCreateCollectionAction = async (
    values: CollectionActionValues,
  ): Promise<boolean> => {
    if (!collectionPayment) return false;

    setIsSavingCollectionAction(true);
    const res = await apiWrite.request(
      `/api/finance/payments/${collectionPayment.id}/collection-actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );
    const result = await res.json();

    if (res.ok) {
      setToast({ message: "Gestión de cobranza registrada.", type: "success" });
      const [actions] = await Promise.all([
        fetchCollectionActions(collectionPayment.id),
        fetchData(),
      ]);
      setCollectionActions(actions);
      setIsSavingCollectionAction(false);
      return true;
    }
    setToast({
      message: result.error || "No se pudo registrar la gestión.",
      type: "error",
    });
    setIsSavingCollectionAction(false);
    return false;
  };

  const handleCompleteCollectionAction = async (action: CollectionAction) => {
    if (action.status === "done" || isSavingCollectionAction) return;

    setIsSavingCollectionAction(true);
    const res = await apiWrite.request(
      `/api/finance/collection-actions/${action.id}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Seguimiento cerrado desde finanzas" }),
      },
    );
    const result = await res.json();

    if (res.ok) {
      setToast({ message: "Seguimiento cerrado.", type: "success" });
      if (collectionPayment) {
        const [actions] = await Promise.all([
          fetchCollectionActions(collectionPayment.id),
          fetchData(),
        ]);
        setCollectionActions(actions);
      } else {
        await fetchData();
      }
    } else {
      setToast({
        message: result.error || "No se pudo cerrar el seguimiento.",
        type: "error",
      });
    }
    setIsSavingCollectionAction(false);
  };

  const openCollectionPaymentFromAction = (action: CollectionAction) => {
    setCollectionPayment({
      id: action.payment_id,
      contract_id: Number(action.contract_id_display || 0),
      amount: Number(action.payment_amount || 0),
      due_date: action.payment_due_date || "",
      payment_date: null,
      status: action.payment_status || "pending",
      method: null,
      reference: null,
      receipt_file_path: null,
      receipt_file_name: null,
      receipt_mime_type: null,
      client_name: action.client_name,
      client_rut: action.client_rut,
      contract_id_display: action.contract_id_display,
      remaining_amount: action.payment_remaining_amount,
    });
  };

  const closeCollectionDrawer = () => {
    setCollectionPayment(null);
  };
  return {
    requestAdminApproval,
    fetchCollectionActions,
    normalizePhoneForWhatsApp,
    buildCollectionMessage,
    copyCollectionTemplate,
    openCollectionDrawer,
    handleCreateCollectionAction,
    handleCompleteCollectionAction,
    openCollectionPaymentFromAction,
    closeCollectionDrawer,
  };
}
