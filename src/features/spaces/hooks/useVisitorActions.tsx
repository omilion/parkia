import { useVisitorState } from "./useVisitorState";
import type { CloseCashFormValues, PayVisitorFormValues } from "../../../../shared/schemas/spaces";
import type { TicketEntryValues } from "../../../../shared/schemas/tickets";
import { useApiMutation } from "../../../lib/useApiMutation";

import React from "react";
import { CashSessionSummary, VisitorQuote, VisitorTicket } from "../../../types";
import { apiFetchJson } from "../../../lib/api";

import { readErrorMessage, formatCurrency } from "../pages/spacesShared";
import type { VisitorLookupResult } from "../pages/spacesShared";

export type Dependencies_useVisitorActions = {
  canManageVisitors: boolean;
  fetchData: () => Promise<void>;
  setIsActionLoading: any;
  setIsCashCloseDrawerOpen: ReturnType<
    typeof useVisitorState
  >["setIsCashCloseDrawerOpen"];
  setIsVisitorTicketDrawerOpen: ReturnType<
    typeof useVisitorState
  >["setIsVisitorTicketDrawerOpen"];
  setQuotingVisitorId: ReturnType<
    typeof useVisitorState
  >["setQuotingVisitorId"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
  setVisitorLookup: ReturnType<typeof useVisitorState>["setVisitorLookup"];
  setVisitorPayment: ReturnType<typeof useVisitorState>["setVisitorPayment"];
  setVisitorReceipt: ReturnType<typeof useVisitorState>["setVisitorReceipt"];
  visitorCashSummary: CashSessionSummary;
  visitorLostTicket: ReturnType<typeof useVisitorState>["visitorLostTicket"];
  visitorPayment: ReturnType<typeof useVisitorState>["visitorPayment"];
  visitorReceipt: ReturnType<typeof useVisitorState>["visitorReceipt"];
  visitorSearchPlate: ReturnType<typeof useVisitorState>["visitorSearchPlate"];
};
export function useVisitorActions(
  dependencies: Dependencies_useVisitorActions,
) {
  const {
    canManageVisitors,
    fetchData,
    setIsActionLoading,
    setIsCashCloseDrawerOpen,
    setIsVisitorTicketDrawerOpen,
    setQuotingVisitorId,
    setToast,
    setVisitorLookup,
    setVisitorPayment,
    setVisitorReceipt,
    visitorCashSummary,
    visitorLostTicket,
    visitorPayment,
    visitorReceipt,
    visitorSearchPlate,
  } = dependencies;
  const apiWrite = useApiMutation("spaces/useVisitorActions");
  const openVisitorPayment = async (visitor: VisitorTicket) => {
    if (!canManageVisitors) return;
    setQuotingVisitorId(visitor.id);
    try {
      const quote = await apiFetchJson<VisitorQuote>(
        `/api/visitors/${visitor.id}/quote`,
      );
      setVisitorPayment({
        ...quote,
        ticket_id: visitor.id,
        plate: visitor.plate,
        space_name: visitor.space_name || null,
        method: "cash",
        amount: String(quote.total),
      });
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo calcular el cobro de la visita",
        type: "error",
      });
    } finally {
      setQuotingVisitorId(null);
    }
  };

  const handleLookupVisitor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageVisitors) return;
    const plate = visitorSearchPlate.trim();
    if (!plate) return;
    setIsActionLoading(true);
    try {
      const params = new URLSearchParams({ plate });
      if (visitorLostTicket) params.set("lost_ticket", "true");
      const result = await apiFetchJson<VisitorLookupResult>(
        `/api/visitors/lookup?${params}`,
      );
      setVisitorLookup(result);
      if (result.ticket.status === "active") {
        await openVisitorPayment(result.ticket);
      } else if (result.ticket.status === "paid") {
        setToast({
          message: "Ticket pagado encontrado. Puedes autorizar salida.",
          type: "success",
        });
      }
    } catch (error: any) {
      setVisitorLookup(null);
      setToast({
        message: error.message || "No se encontró ticket para esa patente",
        type: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePayVisitor = async ({ method, amount, override_reason }: PayVisitorFormValues) => {
    if (!canManageVisitors) return;
    if (!visitorPayment) return;

    setIsActionLoading(true);
    const overrideReason = String(override_reason || "").trim();
    const res = await apiWrite.request(
      `/api/visitors/${visitorPayment.ticket_id}/pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          amount,
          quote_id: visitorPayment.id,
          override_reason: overrideReason || undefined,
        }),
      },
    );

    if (res.ok) {
      const body = await res.json();
      setToast({
        message: "Pago de visita registrado. Pase de salida generado.",
        type: "success",
      });
      setVisitorReceipt(body.receipt || null);
      setVisitorPayment(null);
      await fetchData();
    } else {
      setToast({
        message: await readErrorMessage(
          res,
          "Error al registrar pago de visita",
        ),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const handleCreateVisitorTicket = async (data: TicketEntryValues) => {
    if (!canManageVisitors) return;
    setIsActionLoading(true);

    const res = await apiWrite.request("/api/visitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      const body = await res.json();
      setToast({
        message: `Ticket #${body.ticket.ticketId} creado para ${body.ticket.plate}`,
        type: "success",
      });
      setIsVisitorTicketDrawerOpen(false);
      await fetchData();
    } else {
      setToast({
        message: await readErrorMessage(res, "No se pudo crear el ticket"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const handleCompleteVisitor = async (id: number) => {
    if (!canManageVisitors) return;
    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/visitors/${id}/complete`, {
      method: "POST",
    });
    if (res.ok) {
      setToast({
        message: "Visita finalizada. Cupo liberado.",
        type: "success",
      });
      if (visitorReceipt?.ticket_id === id) setVisitorReceipt(null);
      await fetchData();
    } else {
      setToast({
        message: await readErrorMessage(res, "Error al autorizar salida"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const handleCloseVisitorCashSession = async (data: CloseCashFormValues) => {
    if (!canManageVisitors || !visitorCashSummary) return;
    setIsActionLoading(true);

    const res = await apiWrite.request("/api/visitors/cash/current/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      const body = await res.json();
      const difference = Number(body.closure?.difference_cash || 0);
      setToast({
        message:
          difference === 0
            ? "Caja cerrada y cuadrada."
            : `Caja cerrada con diferencia de ${formatCurrency(difference)}.`,
        type: "success",
      });
      setIsCashCloseDrawerOpen(false);
      await fetchData();
    } else {
      setToast({
        message: await readErrorMessage(res, "No se pudo cerrar la caja"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };
  return {
    openVisitorPayment,
    handleLookupVisitor,
    handlePayVisitor,
    handleCreateVisitorTicket,
    handleCompleteVisitor,
    handleCloseVisitorCashSession,
  };
}
