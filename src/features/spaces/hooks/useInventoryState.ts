import { useState } from "react";
import { Space } from "../../../types";

import type { ConfirmAction, SpaceDetail } from "../pages/spacesShared";
export function useInventoryState() {
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [spaceDetail, setSpaceDetail] = useState<SpaceDetail | null>(null);
  const [openedUrlSpaceId, setOpenedUrlSpaceId] = useState<number | null>(null);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  return {
    selectedSpace,
    setSelectedSpace,
    isDrawerOpen,
    setIsDrawerOpen,
    confirmAction,
    setConfirmAction,
    spaceDetail,
    setSpaceDetail,
    openedUrlSpaceId,
    setOpenedUrlSpaceId,
    editingSpace,
    setEditingSpace,
    isCreateDrawerOpen,
    setIsCreateDrawerOpen,
  };
}
