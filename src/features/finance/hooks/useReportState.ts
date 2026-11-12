import { useState } from "react";

export function useReportState() {
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [isClosingMonth, setIsClosingMonth] = useState(false);
  const [reportMonth, setReportMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [monthlyCloseNote, setMonthlyCloseNote] = useState("");
  const [monthlyReopenReason, setMonthlyReopenReason] = useState("");
  return {
    isSavingBudget,
    setIsSavingBudget,
    isClosingMonth,
    setIsClosingMonth,
    reportMonth,
    setReportMonth,
    monthlyCloseNote,
    setMonthlyCloseNote,
    monthlyReopenReason,
    setMonthlyReopenReason,
  };
}
