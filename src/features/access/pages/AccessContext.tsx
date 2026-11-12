import { createContext, useContext } from 'react';
import type { useAccessController } from '../hooks/useAccessController';
type Workspace=ReturnType<typeof useAccessController>;
export const AccessContext=createContext<Workspace|null>(null);
export function useAccess():Workspace { const value=useContext(AccessContext);if(!value)throw new Error('AccessContext requerido');return value;}
