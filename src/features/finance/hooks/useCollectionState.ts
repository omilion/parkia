import { useState } from "react";

import { CollectionAction } from "../../../types";

import type { CollectionPayment } from "../pages/financeShared";
export function useCollectionState() {
  const [collectionPayment, setCollectionPayment] =
    useState<CollectionPayment | null>(null);
  const [collectionActions, setCollectionActions] = useState<
    CollectionAction[]
  >([]);
  const [isSavingCollectionAction, setIsSavingCollectionAction] =
    useState(false);
  const [collectionQueueStatus, setCollectionQueueStatus] = useState<
    "open" | "done" | "all"
  >("open");
  const [collectionQueueDue, setCollectionQueueDue] = useState<
    "all" | "overdue" | "today" | "upcoming" | "actionable"
  >("all");
  return {
    collectionPayment,
    setCollectionPayment,
    collectionActions,
    setCollectionActions,
    isSavingCollectionAction,
    setIsSavingCollectionAction,
    collectionQueueStatus,
    setCollectionQueueStatus,
    collectionQueueDue,
    setCollectionQueueDue,
  };
}
