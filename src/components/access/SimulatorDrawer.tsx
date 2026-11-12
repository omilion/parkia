import { Suspense, lazy, useEffect, useState } from 'react';

// El panel (con su formulario y validación) no forma parte de la carga inicial.
const SimulatorPanel = lazy(() => import('./SimulatorPanel'));

/** Escucha el evento global que abre el simulador LPR y monta el panel solo cuando se usa. */
const SimulatorDrawer = () => {
  const [openCount, setOpenCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => {
      setOpenCount(count => count + 1);
      setIsOpen(true);
    };
    window.addEventListener('openSimulatorDrawer', handleOpen);
    return () => window.removeEventListener('openSimulatorDrawer', handleOpen);
  }, []);

  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      {/* Cada apertura monta un panel nuevo, con el formulario limpio. */}
      <div key={openCount} className="contents">
        <SimulatorPanel onClose={() => setIsOpen(false)} />
      </div>
    </Suspense>
  );
};

export default SimulatorDrawer;
