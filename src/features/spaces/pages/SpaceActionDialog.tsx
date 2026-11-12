import ConfirmDialog from '../../../components/ui/ConfirmDialog';

import { useSpaces } from './SpacesContext';
export default function SpaceActionDialog(){
const { confirmAction, handleConfirmAction, isActionLoading, setConfirmAction } = useSpaces();
return (<ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'open-barrier' ? 'Confirmar registro manual' :
            confirmAction?.type === 'force-release' ? 'Forzar liberación de espacio' :
              'Marcar espacio como libre'
        }
        message={
          confirmAction?.type === 'open-barrier'
            ? <>Se registrará la autorización manual de <strong>{confirmAction.space.name}</strong> en auditoría. El sistema no acciona la barrera física.</>
            : confirmAction?.type === 'force-release'
              ? <>Esto registrará una salida de emergencia y dejará <strong>{confirmAction.space.name}</strong> disponible.</>
              : <>Si el espacio está arrendado, es mejor terminar su contrato desde Contratos antes de marcarlo libre.</>
        }
        confirmLabel={
          confirmAction?.type === 'open-barrier' ? 'Registrar Apertura' :
            confirmAction?.type === 'force-release' ? 'Liberar Espacio' :
              'Marcar Libre'
        }
        tone={confirmAction?.type === 'open-barrier' || confirmAction?.type === 'force-release' ? 'danger' : 'default'}
        isLoading={isActionLoading}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />);
}
