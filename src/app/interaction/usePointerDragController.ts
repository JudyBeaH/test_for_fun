import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import type {
  PointerCaptureTarget,
  PointerDragState,
  PointerDragWindowTarget,
  PointerLike,
  PointerPoint,
  PointerPreflightResult,
} from "./gestureTypes";

type PartialPointerDragOptions<TPayload, TTarget, TCommand> = Partial<Pick<PointerDragOptions<TPayload, TTarget, TCommand>, "buildCommand" | "dispatch" | "getDropTarget" | "onRejected" | "preflight">>;

export interface PointerDragOptions<TPayload, TTarget, TCommand> {
  windowTarget?: PointerDragWindowTarget | null;
  thresholdPx?: number;
  getDropTarget: (point: PointerPoint) => TTarget | null;
  buildCommand: (payload: TPayload, target: TTarget | null) => TCommand | null;
  preflight: (command: TCommand) => PointerPreflightResult;
  dispatch: (command: TCommand) => void;
  onRejected?: (messageZh: string) => void;
  onStateChange?: (state: PointerDragState<TPayload>) => void;
}

export interface PointerDragController<TPayload, TTarget, TCommand> {
  update: (options: PartialPointerDragOptions<TPayload, TTarget, TCommand>) => void;
  handlePointerDown: (event: PointerLike, payload: TPayload, captureTarget?: PointerCaptureTarget | null) => void;
  handlePointerMove: (event: PointerLike) => void;
  handlePointerUp: (event: PointerLike) => void;
  cancel: () => void;
  dispose: () => void;
  getDragState: () => PointerDragState<TPayload>;
  consumeTrailingClickSuppression: () => boolean;
}

export type PointerDragSourceHandlers<TPayload> = (payload: TPayload) => {
  onContextMenu: (event: ReactMouseEvent) => void;
  onClickCapture: (event: ReactMouseEvent) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Gesture<TPayload> = {
  pointerId: number;
  payload: TPayload;
  start: PointerPoint;
  current: PointerPoint;
  captureTarget: PointerCaptureTarget | null;
  dragging: boolean;
  dispatched: boolean;
};

function idleState<TPayload>(): PointerDragState<TPayload> {
  return { phase: "idle", payload: null, start: null, current: null };
}

function pointFromEvent(event: PointerLike): PointerPoint {
  return { x: event.clientX, y: event.clientY };
}

function distance(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPointerLike(event: unknown): event is PointerLike {
  return Boolean(event && typeof event === "object" && "clientX" in event && "clientY" in event && "pointerId" in event);
}

export function createPointerDragController<TPayload, TTarget, TCommand>(
  initialOptions: PointerDragOptions<TPayload, TTarget, TCommand>,
): PointerDragController<TPayload, TTarget, TCommand> {
  let options = { thresholdPx: 7, windowTarget: null, ...initialOptions };
  let gesture: Gesture<TPayload> | null = null;
  let suppressTrailingClick = false;
  let listenersAttached = false;

  const emitState = () => {
    if (!gesture) {
      options.onStateChange?.(idleState());
      return;
    }
    options.onStateChange?.({
      phase: gesture.dragging ? "dragging" : "pressed",
      payload: gesture.payload,
      start: gesture.start,
      current: gesture.current,
    });
  };

  const detachWindowListeners = () => {
    if (!listenersAttached || !options.windowTarget) return;
    options.windowTarget.removeEventListener("pointermove", onWindowPointerMove, true);
    options.windowTarget.removeEventListener("pointerup", onWindowPointerUp, true);
    options.windowTarget.removeEventListener("pointercancel", onWindowCancel, true);
    options.windowTarget.removeEventListener("blur", onWindowCancel);
    options.windowTarget.removeEventListener("keydown", onWindowKeyDown, true);
    listenersAttached = false;
  };

  const attachWindowListeners = () => {
    if (listenersAttached || !options.windowTarget) return;
    options.windowTarget.addEventListener("pointermove", onWindowPointerMove, true);
    options.windowTarget.addEventListener("pointerup", onWindowPointerUp, true);
    options.windowTarget.addEventListener("pointercancel", onWindowCancel, true);
    options.windowTarget.addEventListener("blur", onWindowCancel);
    options.windowTarget.addEventListener("keydown", onWindowKeyDown, true);
    listenersAttached = true;
  };

  function finishGesture(): void {
    if (gesture?.captureTarget?.releasePointerCapture) {
      try {
        gesture.captureTarget.releasePointerCapture(gesture.pointerId);
      } catch {
        // Pointer capture may already be gone after window-level cancellation.
      }
    }
    gesture = null;
    detachWindowListeners();
    emitState();
  }

  function submitCurrentGesture(): void {
    if (!gesture || gesture.dispatched || !gesture.dragging) return;
    const target = options.getDropTarget(gesture.current);
    const command = options.buildCommand(gesture.payload, target);
    if (!command) {
      options.onRejected?.("这个位置不能放置。");
      return;
    }
    const preflight = options.preflight(command);
    if (!preflight.ok) {
      options.onRejected?.(preflight.messageZh);
      return;
    }
    gesture.dispatched = true;
    suppressTrailingClick = true;
    options.dispatch(command);
  }

  function onWindowPointerMove(event: unknown): void {
    if (isPointerLike(event)) controller.handlePointerMove(event);
  }

  function onWindowPointerUp(event: unknown): void {
    if (isPointerLike(event)) controller.handlePointerUp(event);
  }

  function onWindowCancel(): void {
    controller.cancel();
  }

  function onWindowKeyDown(event: unknown): void {
    if (event && typeof event === "object" && "key" in event && event.key === "Escape") controller.cancel();
  }

  const controller: PointerDragController<TPayload, TTarget, TCommand> = {
    update(nextOptions) {
      options = { ...options, ...nextOptions };
    },
    handlePointerDown(event, payload, captureTarget = null) {
      if (event.button !== undefined && event.button !== 0) return;
      controller.cancel();
      const start = pointFromEvent(event);
      gesture = {
        pointerId: event.pointerId,
        payload,
        start,
        current: start,
        captureTarget,
        dragging: false,
        dispatched: false,
      };
      captureTarget?.setPointerCapture?.(event.pointerId);
      attachWindowListeners();
      emitState();
    },
    handlePointerMove(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.current = pointFromEvent(event);
      if (!gesture.dragging && distance(gesture.start, gesture.current) >= (options.thresholdPx ?? 7)) {
        gesture.dragging = true;
        event.preventDefault?.();
      }
      emitState();
    },
    handlePointerUp(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.current = pointFromEvent(event);
      submitCurrentGesture();
      if (gesture.dragging) event.preventDefault?.();
      finishGesture();
    },
    cancel() {
      if (!gesture) return;
      finishGesture();
    },
    dispose() {
      finishGesture();
      detachWindowListeners();
    },
    getDragState() {
      if (!gesture) return idleState();
      return {
        phase: gesture.dragging ? "dragging" : "pressed",
        payload: gesture.payload,
        start: gesture.start,
        current: gesture.current,
      };
    },
    consumeTrailingClickSuppression() {
      const suppress = suppressTrailingClick;
      suppressTrailingClick = false;
      return suppress;
    },
  };

  return controller;
}

function toPointerLike(event: ReactPointerEvent): PointerLike {
  return {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    pointerType: event.pointerType,
    preventDefault: () => event.preventDefault(),
  };
}

export function usePointerDragController<TPayload, TTarget, TCommand>(
  options: PointerDragOptions<TPayload, TTarget, TCommand>,
) {
  const [dragState, setDragState] = useState<PointerDragState<TPayload>>(idleState);
  const windowTarget = options.windowTarget ?? (typeof window === "undefined" ? null : window);
  const controllerRef = useRef<PointerDragController<TPayload, TTarget, TCommand> | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createPointerDragController({
      ...options,
      windowTarget,
      onStateChange: setDragState,
    });
  }

  controllerRef.current.update({
    buildCommand: options.buildCommand,
    dispatch: options.dispatch,
    getDropTarget: options.getDropTarget,
    preflight: options.preflight,
    onRejected: options.onRejected,
  });

  useEffect(() => () => controllerRef.current?.dispose(), []);

  const sourceHandlers = useCallback<PointerDragSourceHandlers<TPayload>>((payload) => ({
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
    onClickCapture: (event: ReactMouseEvent) => {
      if (!controllerRef.current?.consumeTrailingClickSuppression()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      controllerRef.current?.handlePointerDown(toPointerLike(event), payload, event.currentTarget);
    },
  }), []);

  return useMemo(() => ({
    dragState,
    sourceHandlers,
  }), [dragState, sourceHandlers]);
}
