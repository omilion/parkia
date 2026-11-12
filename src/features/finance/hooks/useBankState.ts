import { useState } from "react";

import { BankMovement, PaymentAllocation } from "../../../types";

import type { MovementSuggestion } from "../pages/financeShared";
export function useBankState() {
  const [selectedMovement, setSelectedMovement] = useState<BankMovement | null>(
    null,
  );
  const [editingMovement, setEditingMovement] = useState<BankMovement | null>(
    null,
  );
  const [movementAllocationHistory, setMovementAllocationHistory] = useState<
    PaymentAllocation[]
  >([]);
  const [movementSuggestions, setMovementSuggestions] = useState<
    MovementSuggestion[]
  >([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isImportingBank, setIsImportingBank] = useState(false);
  const [isUpdatingMovement, setIsUpdatingMovement] = useState(false);
  const [movementSearch, setMovementSearch] = useState("");
  const [movementStatus, setMovementStatus] = useState<
    "all" | "attention" | "pending" | "partial" | "reconciled"
  >("pending");
  const [movementReportMonth, setMovementReportMonth] = useState<string | null>(
    null,
  );
  return {
    selectedMovement,
    setSelectedMovement,
    editingMovement,
    setEditingMovement,
    movementAllocationHistory,
    setMovementAllocationHistory,
    movementSuggestions,
    setMovementSuggestions,
    isSyncing,
    setIsSyncing,
    isReconciling,
    setIsReconciling,
    isImportingBank,
    setIsImportingBank,
    isUpdatingMovement,
    setIsUpdatingMovement,
    movementSearch,
    setMovementSearch,
    movementStatus,
    setMovementStatus,
    movementReportMonth,
    setMovementReportMonth,
  };
}
