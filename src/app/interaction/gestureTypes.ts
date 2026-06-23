import type { ItemInstanceId, ItemSlotRef, OfferId, SpeciesId, UnitId, UnitSlotRef } from "../../domain/types";

export interface PointerPoint {
  x: number;
  y: number;
}

export interface PointerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
  pointerType?: string;
  preventDefault?: () => void;
}

export interface PointerCaptureTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

export interface PointerDragWindowTarget {
  addEventListener: (type: string, listener: (event: unknown) => void, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void, options?: boolean | EventListenerOptions) => void;
}

export type PointerDragPhase = "idle" | "pressed" | "dragging";

export interface PointerDragState<TPayload> {
  phase: PointerDragPhase;
  payload: TPayload | null;
  start: PointerPoint | null;
  current: PointerPoint | null;
}

export type CampDragPayload =
  | { kind: "ownedUnit"; unitId: UnitId }
  | { kind: "animalOffer"; offerId: OfferId }
  | { kind: "upgradeDiscovery"; discoveryId: string; speciesId: SpeciesId }
  | { kind: "pendingRecruit" }
  | { kind: "itemOffer"; offerId: OfferId }
  | { kind: "inventoryItem"; itemInstanceId: ItemInstanceId };

export type CampDropTarget =
  | { kind: "unitSlot"; ref: UnitSlotRef }
  | { kind: "inventorySlot"; ref: ItemSlotRef }
  | { kind: "releaseZone" };

export type PointerPreflightResult = {
  ok: boolean;
  messageZh: string;
};
