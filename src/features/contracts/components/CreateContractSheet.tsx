import { ContractWizard } from "../components/ContractWizard";

import Drawer from "../../../components/ui/Drawer";

import { useContractsPageContext } from "../hooks/useContractsController";
export default function CreateContractSheet() {
  const { isDrawerOpen, setToast, selectedBranchId, branches, closeDrawer } =
    useContractsPageContext();
  return (
    <Drawer
      isOpen={isDrawerOpen}
      onClose={closeDrawer}
      title="Generar Nuevo Contrato"
    >
      <ContractWizard
        branches={branches}
        initialBranchId={selectedBranchId}
        onCancel={closeDrawer}
        onCreated={() => {
          closeDrawer();
          setToast({
            message: "Contrato generado correctamente",
            type: "success",
          });
        }}
      />
    </Drawer>
  );
}
