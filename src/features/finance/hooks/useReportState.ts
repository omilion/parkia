import { useState } from "react";
import { currentMonthLocal } from "../../../../shared/dates";

export function useReportState() {
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [isClosingMonth, setIsClosingMonth] = useState(false);
  const [reportMonth, setReportMonth] = useState(
    currentMonthLocal(),
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
