import { useState } from "react";
import { VisitorReceipt } from "../../../types";

import type { VisitorPaymentDraft, VisitorLookupResult } from "../pages/spacesShared";
export function useVisitorState() {
  const [visitorPayment, setVisitorPayment] =
    useState<VisitorPaymentDraft | null>(null);
  const [visitorLookup, setVisitorLookup] =
    useState<VisitorLookupResult | null>(null);
  const [visitorReceipt, setVisitorReceipt] = useState<VisitorReceipt | null>(
    null,
  );
  const [visitorSearchPlate, setVisitorSearchPlate] = useState("");
  const [visitorLostTicket, setVisitorLostTicket] = useState(false);
  const [quotingVisitorId, setQuotingVisitorId] = useState<number | null>(null);
  const [isVisitorTicketDrawerOpen, setIsVisitorTicketDrawerOpen] =
    useState(false);
  const [isCashCloseDrawerOpen, setIsCashCloseDrawerOpen] = useState(false);
  return {
    visitorPayment,
    setVisitorPayment,
    visitorLookup,
    setVisitorLookup,
    visitorReceipt,
    setVisitorReceipt,
    visitorSearchPlate,
    setVisitorSearchPlate,
    visitorLostTicket,
    setVisitorLostTicket,
    quotingVisitorId,
    setQuotingVisitorId,
    isVisitorTicketDrawerOpen,
    setIsVisitorTicketDrawerOpen,
    isCashCloseDrawerOpen,
    setIsCashCloseDrawerOpen,
  };
}
