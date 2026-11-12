import { createContext, useContext } from 'react';
import type { useSpacesController } from '../hooks/useSpacesController';
type Workspace=ReturnType<typeof useSpacesController>;
export const SpacesContext=createContext<Workspace|null>(null);
export function useSpaces():Workspace { const value=useContext(SpacesContext);if(!value)throw new Error('SpacesContext requerido');return value;}
