import { useState } from "react";

export function useSpaceNavigationState() {
  const [activeType, setActiveType] = useState<"parking" | "visitors">(
    "parking",
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [parkingMode, setParkingMode] = useState<"grid" | "map">("grid");
  return {
    activeType,
    setActiveType,
    selectedBranchId,
    setSelectedBranchId,
    filterStatus,
    setFilterStatus,
    parkingMode,
    setParkingMode,
  };
}
