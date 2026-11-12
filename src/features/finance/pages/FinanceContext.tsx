import { createContext, useContext } from 'react';
import type { useFinanceController } from '../hooks/useFinanceController';
export type FinanceWorkspace = ReturnType<typeof useFinanceController>;
export const FinanceContext = createContext<FinanceWorkspace | null>(null);
export function useFinance(): FinanceWorkspace {
  const workspace = useContext(FinanceContext);
  if (!workspace) throw new Error('FinanceContext requerido');
  return workspace;
}
