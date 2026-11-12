import { useState } from "react";

import { Expense } from "../../../types";

import type { ExpenseMovementSuggestion, ExpenseReviewFilter, ExpenseReportMonthField } from "../pages/financeShared";
export function useExpenseState() {
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expensePaymentAction, setExpensePaymentAction] =
    useState<Expense | null>(null);
  const [expensePaymentNote, setExpensePaymentNote] = useState("");
  const [reconcilingExpense, setReconcilingExpense] = useState<Expense | null>(
    null,
  );
  const [expenseMovementSuggestions, setExpenseMovementSuggestions] = useState<
    ExpenseMovementSuggestion[]
  >([]);
  const [isExpenseDrawerOpen, setIsExpenseDrawerOpen] = useState(false);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isReconcilingExpense, setIsReconcilingExpense] = useState(false);
  const [expenseStatus, setExpenseStatus] = useState<
    "all" | "pending" | "paid" | "overdue" | "cancelled"
  >("all");
  const [expenseCategory, setExpenseCategory] = useState<
    Expense["category"] | "all"
  >("all");
  const [expenseDueFilter, setExpenseDueFilter] = useState<
    "all" | "overdue" | "today" | "upcoming"
  >("all");
  const [expenseReviewFilter, setExpenseReviewFilter] =
    useState<ExpenseReviewFilter>("all");
  const [expenseReportMonth, setExpenseReportMonth] = useState<string | null>(
    null,
  );
  const [expenseReportMonthField, setExpenseReportMonthField] =
    useState<ExpenseReportMonthField>("any");
  const [selectedExpenseReceiptName, setSelectedExpenseReceiptName] =
    useState("");
  return {
    editingExpense,
    setEditingExpense,
    expensePaymentAction,
    setExpensePaymentAction,
    expensePaymentNote,
    setExpensePaymentNote,
    reconcilingExpense,
    setReconcilingExpense,
    expenseMovementSuggestions,
    setExpenseMovementSuggestions,
    isExpenseDrawerOpen,
    setIsExpenseDrawerOpen,
    isSavingExpense,
    setIsSavingExpense,
    isReconcilingExpense,
    setIsReconcilingExpense,
    expenseStatus,
    setExpenseStatus,
    expenseCategory,
    setExpenseCategory,
    expenseDueFilter,
    setExpenseDueFilter,
    expenseReviewFilter,
    setExpenseReviewFilter,
    expenseReportMonth,
    setExpenseReportMonth,
    expenseReportMonthField,
    setExpenseReportMonthField,
    selectedExpenseReceiptName,
    setSelectedExpenseReceiptName,
  };
}
