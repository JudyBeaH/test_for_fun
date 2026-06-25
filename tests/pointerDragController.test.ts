import { describe, expect, it } from "vitest";
import { createDropRegistry } from "../src/app/interaction/dropRegistry";
import { createPointerDragController } from "../src/app/interaction/usePointerDragController";
import type { PointerDragWindowTarget } from "../src/app/interaction/gestureTypes";

type TestCommand = { type: "move"; unitId: string; slot: number };
type TestPayload = { kind: "ownedUnit"; unitId: string };
type TestTarget = { kind: "slot"; slot: number };

class FakeWindow implements PointerDragWindowTarget {
  listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function pointer(event: Partial<PointerEvent> & { clientX: number; clientY: number; pointerId?: number }) {
  return {
    pointerId: event.pointerId ?? 1,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button ?? 0,
    pointerType: event.pointerType ?? "mouse",
    preventDefault() {},
  };
}

function controllerHarness() {
  const fakeWindow = new FakeWindow();
  const dispatched: TestCommand[] = [];
  const controller = createPointerDragController<TestPayload, TestTarget, TestCommand>({
    windowTarget: fakeWindow,
    thresholdPx: 7,
    getDropTarget: () => ({ kind: "slot", slot: 2 }),
    buildCommand: (payload, target) => target ? { type: "move", unitId: payload.unitId, slot: target.slot } : null,
    preflight: () => ({ ok: true, messageZh: "ok" }),
    dispatch: (command) => dispatched.push(command),
  });
  return { controller, fakeWindow, dispatched };
}

describe("P3A pointer drag controller", () => {
  it("uses latest callbacks at release time instead of stale closures", () => {
    const { controller, fakeWindow, dispatched } = controllerHarness();
    controller.handlePointerDown(pointer({ clientX: 0, clientY: 0 }), { kind: "ownedUnit", unitId: "old" });
    fakeWindow.emit("pointermove", pointer({ clientX: 10, clientY: 0 }));
    controller.update({
      buildCommand: (payload, target) => target ? { type: "move", unitId: `${payload.unitId}:latest`, slot: target.slot } : null,
      dispatch: (command) => dispatched.push({ ...command, slot: 4 }),
    });
    fakeWindow.emit("pointerup", pointer({ clientX: 10, clientY: 0 }));
    expect(dispatched).toEqual([{ type: "move", unitId: "old:latest", slot: 4 }]);
  });

  it("dispatches when pointer is released outside the source element", () => {
    const { controller, fakeWindow, dispatched } = controllerHarness();
    controller.handlePointerDown(pointer({ clientX: 0, clientY: 0 }), { kind: "ownedUnit", unitId: "unit_a" });
    fakeWindow.emit("pointermove", pointer({ clientX: 0, clientY: 8 }));
    fakeWindow.emit("pointerup", pointer({ clientX: 40, clientY: 40 }));
    expect(dispatched).toEqual([{ type: "move", unitId: "unit_a", slot: 2 }]);
  });

  it("cancels without dispatch on pointercancel, Escape, or window blur", () => {
    for (const cancel of ["pointercancel", "keydown", "blur"] as const) {
      const { controller, fakeWindow, dispatched } = controllerHarness();
      controller.handlePointerDown(pointer({ clientX: 0, clientY: 0 }), { kind: "ownedUnit", unitId: cancel });
      fakeWindow.emit("pointermove", pointer({ clientX: 8, clientY: 0 }));
      fakeWindow.emit(cancel, cancel === "keydown" ? { key: "Escape" } : {});
      fakeWindow.emit("pointerup", pointer({ clientX: 8, clientY: 0 }));
      expect(dispatched, cancel).toEqual([]);
      expect(controller.getDragState().phase).toBe("idle");
    }
  });

  it("dispatches at most one command per gesture and suppresses one trailing click", () => {
    const { controller, fakeWindow, dispatched } = controllerHarness();
    controller.handlePointerDown(pointer({ clientX: 0, clientY: 0 }), { kind: "ownedUnit", unitId: "unit_a" });
    fakeWindow.emit("pointermove", pointer({ clientX: 8, clientY: 0 }));
    fakeWindow.emit("pointerup", pointer({ clientX: 8, clientY: 0 }));
    fakeWindow.emit("pointerup", pointer({ clientX: 8, clientY: 0 }));
    expect(dispatched).toHaveLength(1);
    expect(controller.consumeTrailingClickSuppression()).toBe(true);
    expect(controller.consumeTrailingClickSuppression()).toBe(false);
  });
});

describe("P3A drop registry", () => {
  it("returns the topmost registered target at a point and unregisters cleanly", () => {
    const registry = createDropRegistry<TestTarget>();
    const unregisterBottom = registry.register({
      id: "bottom",
      target: { kind: "slot", slot: 1 },
      getBounds: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    });
    const unregisterTop = registry.register({
      id: "top",
      target: { kind: "slot", slot: 2 },
      getBounds: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    });

    expect(registry.targetAt({ x: 10, y: 10 })).toEqual({ kind: "slot", slot: 2 });
    unregisterTop();
    expect(registry.targetAt({ x: 10, y: 10 })).toEqual({ kind: "slot", slot: 1 });
    unregisterBottom();
    expect(registry.targetAt({ x: 10, y: 10 })).toBeNull();
  });

  it("does not let stale unregister remove a newer entry with the same id", () => {
    const registry = createDropRegistry<TestTarget>();
    const unregisterOld = registry.register({
      id: "same-slot",
      target: { kind: "slot", slot: 1 },
      getBounds: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    });
    registry.register({
      id: "same-slot",
      target: { kind: "slot", slot: 2 },
      getBounds: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    });

    unregisterOld();

    expect(registry.targetAt({ x: 10, y: 10 })).toEqual({ kind: "slot", slot: 2 });
  });
});
