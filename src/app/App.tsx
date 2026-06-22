import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ANIMALS, ANIMAL_BY_ID } from "../content/animals";
import { ENVIRONMENT_BY_ID } from "../content/environments";
import { ITEM_BY_ID } from "../content/items";
import { applyCampCommand, computeCampRules, firstEmptyFormationSlot, firstEmptyReserveSlot, formationMembers, inventoryItems, memberLevel, reserveMembers } from "../domain/campEngine";
import { decodeChallengeCode, encodeChallengeCode } from "../domain/challengeCode";
import { completeSuccessResolution, createExpedition, finishBattleReport, prepareBattle, resolvePreparedBattle } from "../domain/expeditionEngine";
import { applyChallengeReward, applyRewardChoice, createRewardChoices } from "../domain/rewardEngine";
import type { AppSave, BattleEvent, BattleOutput, CampCommand, ExpeditionState, RegisteredTeam, RewardChoice, Side, SpeciesId, TeamMember, TeamSnapshotUnit, UnitSlotRef } from "../domain/types";
import { resolveBattle } from "../domain/battleEngine";
import { exportSave, importSaveJson, loadSave, saveAppSave, resetSave, stagingInfo, clearStaging } from "../storage/localRepository";

type Screen = "home" | "camp" | "battle" | "report" | "collection" | "champions" | "challenge" | "dev";

function nowSeed(): number {
  return Math.floor(performance.timeOrigin + performance.now()) >>> 0;
}

function commit(save: AppSave): AppSave {
  return saveAppSave(save);
}

export function App() {
  const [save, setSave] = useState<AppSave>(() => loadSave());
  const [screen, setScreen] = useState<Screen>(() => save.activeExpedition ? phaseToScreen(save.activeExpedition) : "home");
  const [message, setMessage] = useState("胜利带来传承，失败留下发现。");
  const expedition = save.activeExpedition;
  const battle = expedition?.pendingBattle?.output ?? null;

  useEffect(() => {
    if (!expedition?.pendingBattle || expedition.pendingBattle.output) return;
    if (expedition.phase !== "battlePreparing" && expedition.phase !== "battlePlayback") return;
    const resolved = resolvePreparedBattle(expedition);
    if (!resolved.ok) {
      setMessage(resolved.messageZh);
      return;
    }
    const nextSave = commit({ ...save, activeExpedition: resolved.state });
    setSave(nextSave);
    setScreen("battle");
    setMessage("已从固定的遭遇输入恢复并结算。");
  }, [expedition, save]);

  function update(mutator: (current: AppSave) => AppSave, msg?: string) {
    setSave((current) => {
      const next = commit(mutator(current));
      if (msg) setMessage(msg);
      return next;
    });
  }

  function startNew() {
    const activeExpedition = createExpedition(nowSeed());
    update((current) => markSeen({ ...current, activeExpedition }, activeExpedition), "新的探险开始了。");
    setScreen("camp");
  }

  function campAction(command: CampCommand) {
    if (!expedition) return;
    const result = applyCampCommand(expedition, command);
    if (!result.ok) {
      setMessage(result.messageZh);
      return;
    }
    update((current) => markSeen({ ...current, activeExpedition: result.state.state }, result.state.state), `${result.messageZh} 已保存`);
    setScreen(phaseToScreen(result.state.state));
  }

  function depart() {
    if (!expedition) return;
    const prepared = prepareBattle(expedition);
    if (!prepared.ok) {
      setMessage(prepared.messageZh);
      return;
    }
    const preparedSave = commit({ ...save, activeExpedition: prepared.state });
    setSave(preparedSave);
    const resolved = resolvePreparedBattle(prepared.state);
    if (!resolved.ok) {
      setMessage(resolved.messageZh);
      return;
    }
    setSave(commit({ ...preparedSave, activeExpedition: resolved.state }));
    setMessage("遭遇结果已固定并保存。");
    setScreen("battle");
  }

  function finishBattle() {
    if (!expedition) return;
    if (expedition.phase === "battlePlayback") {
      const next = structuredClone(expedition) as ExpeditionState;
      next.phase = "battleReport";
      update((current) => ({ ...current, activeExpedition: next }), "战斗报告已生成。");
      setScreen("report");
      return;
    }
    const next = finishBattleReport(expedition);
    update((current) => ({ ...current, activeExpedition: next }), "战斗报告已保存。");
    setScreen(phaseToScreen(next));
  }

  function finishReward(choice: RewardChoice) {
    update((current) => ({ ...applyRewardChoice(current, choice), activeExpedition: null }), `${choice.titleZh}已记录。`);
    setScreen("home");
  }

  function registerSuccess(speciesId: SpeciesId, name: string, rewards: RewardChoice[]) {
    if (!expedition) return;
    const completed = completeSuccessResolution({
      save,
      expedition,
      adoptedSpeciesId: speciesId,
      rewardChoices: rewards,
      teamName: name,
      createdAtIso: new Date().toISOString(),
    });
    if (!completed.ok) {
      setMessage(completed.messageZh);
      return;
    }
    update((current) => ({ ...current, ...completed.state.savePatch }), completed.messageZh);
    setScreen("champions");
  }

  return (
    <main className="landscapeShell">
      <div className="rotateOverlay">请旋转设备以继续探险</div>
      <header className="topbar">
        <button className="icon" onClick={() => setScreen("home")} title="首页">⌂</button>
        <strong>野迹 v0.2</strong>
        <span>{message}</span>
        <span className="revision">rev {save.saveRevision}</span>
      </header>
      {screen === "home" && <Home save={save} onStart={startNew} onScreen={setScreen} />}
      {screen === "camp" && expedition && <Camp expedition={expedition} onAction={campAction} onDepart={depart} />}
      {screen === "battle" && expedition && !battle && <BattleRecovery expedition={expedition} onResolve={(next) => { setSave(commit({ ...save, activeExpedition: next })); setScreen("battle"); }} />}
      {screen === "battle" && battle && <BattleView expedition={expedition!} battle={battle} onDone={finishBattle} settings={save.settings} updateSettings={(settings) => update((current) => ({ ...current, settings }))} />}
      {screen === "report" && expedition && <Report save={save} expedition={expedition} onReward={finishReward} onContinue={finishBattle} onRegister={registerSuccess} />}
      {screen === "collection" && <Collection save={save} />}
      {screen === "champions" && <Champions save={save} setSave={setSave} setMessage={setMessage} />}
      {screen === "challenge" && <Challenge save={save} setSave={setSave} setMessage={setMessage} />}
      {screen === "dev" && <DevTools save={save} setSave={setSave} setMessage={setMessage} />}
    </main>
  );
}

function phaseToScreen(expedition: ExpeditionState): Screen {
  switch (expedition.phase) {
    case "camp":
    case "upgradeDiscovery":
      return "camp";
    case "battlePreparing":
    case "battlePlayback":
      return "battle";
    case "battleReport":
    case "successResolution":
    case "returnResolution":
      return "report";
    case "completed":
      return "home";
    default: {
      const unreachable: never = expedition.phase;
      return unreachable;
    }
  }
}

function markSeen(save: AppSave, expedition: ExpeditionState): AppSave {
  const next = structuredClone(save) as AppSave;
  for (const member of [...presentMembers(formationMembers(expedition)), ...presentMembers(reserveMembers(expedition))]) next.collection[member.speciesId].seen = true;
  for (const slot of expedition.camp?.animalOffers ?? []) if (slot.offer) next.collection[slot.offer.speciesId].seen = true;
  return next;
}

function Home({ save, onStart, onScreen }: { save: AppSave; onStart: () => void; onScreen: (screen: Screen) => void }) {
  const continueText = save.activeExpedition?.pendingBattle?.output ? "查看已完成的遭遇" : save.activeExpedition ? "继续探险" : "继续探险";
  return <section className="screen homeGrid">
    <button className="primary" onClick={onStart}>新的探险</button>
    <button disabled={!save.activeExpedition} onClick={() => onScreen(save.activeExpedition ? phaseToScreen(save.activeExpedition) : "home")}>{continueText}</button>
    <button onClick={() => onScreen("collection")}>动物图鉴</button>
    <button onClick={() => onScreen("champions")}>冠军陈列</button>
    <button onClick={() => onScreen("challenge")}>挑战码</button>
    <button onClick={() => onScreen("dev")}>开发者工具</button>
    <div className="settings">
      <span>速度 {save.settings.battleSpeed}x</span><span>减少动画 {save.settings.reduceMotion ? "开" : "关"}</span><span>声音 {save.settings.soundEnabled ? "开" : "关"}</span>
    </div>
  </section>;
}

type SelectedFocus =
  | { kind: "member"; area: "team" | "reserve"; index: number; instanceId: string }
  | { kind: "animalOffer"; slotId: string }
  | { kind: "itemOffer"; slotId: string }
  | { kind: "slot"; area: "team" | "reserve"; index: number };

type DragPayload =
  | { kind: "member"; area: "team" | "reserve"; index: number; instanceId: string; speciesId: SpeciesId }
  | { kind: "animalOffer"; slotId: string; speciesId: SpeciesId }
  | { kind: "itemOffer"; slotId: string };

type DragHandleProps = {
  onContextMenu: (event: ReactMouseEvent) => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: () => void;
};

function presentMembers(members: readonly (TeamMember | null | undefined)[]): TeamMember[] {
  return members.filter((member): member is TeamMember => Boolean(member));
}

function toUnitSlotRef(area: "team" | "reserve", index: number): UnitSlotRef {
  return area === "team" ? { zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 } : { zone: "reserve", slot: index as 0 | 1 | 2 };
}

function Camp({ expedition, onAction, onDepart }: { expedition: ExpeditionState; onAction: (command: CampCommand) => void; onDepart: () => void }) {
  const rules = computeCampRules(expedition);
  const camp = expedition.camp!;
  const formation = formationMembers(expedition);
  const reserve = reserveMembers(expedition);
  const inventory = inventoryItems(expedition);
  const [selected, setSelected] = useState<SelectedFocus | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const draggingRef = useRef<DragPayload | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; payload: DragPayload } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const selectedMember = selected?.kind === "member" ? (selected.area === "team" ? formation : reserve)[selected.index] : undefined;
  const selectedAnimalOffer = selected?.kind === "animalOffer" ? camp.animalOffers.find((slot) => slot.offer?.offerInstanceId === selected.slotId) : undefined;
  const selectedItemOffer = selected?.kind === "itemOffer" ? camp.itemOffers.find((slot) => slot.offer?.offerInstanceId === selected.slotId) : undefined;
  const firstOpenTeamIndex = firstEmptyFormationSlot(expedition);
  const firstOpenReserveIndex = firstEmptyReserveSlot(expedition);
  const openFormationSlot = firstOpenTeamIndex >= 0 ? firstOpenTeamIndex as 0 | 1 | 2 | 3 | 4 : null;
  const openReserveSlot = firstOpenReserveIndex >= 0 ? firstOpenReserveIndex as 0 | 1 | 2 : null;

  function startDrag(payload: DragPayload) {
    draggingRef.current = payload;
    setDragging(payload);
  }

  function stopDrag() {
    draggingRef.current = null;
    pointerRef.current = null;
    pointerStartRef.current = null;
    setDragging(null);
  }

  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function dragHandle(payload: DragPayload): DragHandleProps {
    return {
      onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
      onPointerDown: (event: ReactPointerEvent) => {
        pointerRef.current = { x: event.clientX, y: event.clientY };
        pointerStartRef.current = { x: event.clientX, y: event.clientY, payload };
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        if (event.button === 2) {
          event.preventDefault();
          startDrag(payload);
          return;
        }
        if (event.pointerType === "touch" || event.button === 0) {
          cancelLongPress();
          longPressTimer.current = window.setTimeout(() => startDrag(payload), 260);
        }
      },
      onPointerMove: (event: ReactPointerEvent) => {
        pointerRef.current = { x: event.clientX, y: event.clientY };
        const start = pointerStartRef.current;
        if (!draggingRef.current && start) {
          const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
          if (distance >= 7) {
            cancelLongPress();
            startDrag(start.payload);
          }
        }
        if (draggingRef.current) event.preventDefault();
      },
      onPointerUp: (event: ReactPointerEvent) => {
        cancelLongPress();
        const payload = draggingRef.current;
        if (!payload) {
          pointerStartRef.current = null;
          return;
        }
        event.preventDefault();
        pointerRef.current = { x: event.clientX, y: event.clientY };
        const target = dropTargetFromPoint(event.clientX, event.clientY);
        handleDrop(payload, target);
        stopDrag();
      },
      onPointerCancel: () => {
        cancelLongPress();
        stopDrag();
      },
    };
  }

  useEffect(() => {
    if (!dragging) return;
    function onPointerUp(event: PointerEvent) {
      const payload = draggingRef.current;
      if (!payload) return;
      const point = pointerRef.current ?? { x: event.clientX, y: event.clientY };
      handleDrop(payload, dropTargetFromPoint(point.x, point.y));
      stopDrag();
    }
    function onCancel() {
      cancelLongPress();
      stopDrag();
    }
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onCancel);
    };
  }, [dragging]);

  function dropTargetFromPoint(x: number, y: number): HTMLElement | null {
    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
      const target = element.closest<HTMLElement>("[data-drop-kind]");
      if (target) return target;
    }
    return null;
  }

  function handleDrop(payload: DragPayload, target: HTMLElement | null) {
    if (!target) return;
    const dropKind = target.dataset.dropKind;
    if (dropKind === "slot") {
      const area = target.dataset.area as "team" | "reserve";
      const index = Number(target.dataset.index);
      const targetInstanceId = target.dataset.instanceId;
      if (payload.kind === "member") {
        if (targetInstanceId && targetInstanceId !== payload.instanceId && target.dataset.speciesId === payload.speciesId) {
          onAction({ type: "mergeUnits", sourceUnitId: payload.instanceId, targetUnitId: targetInstanceId });
        } else {
          onAction({ type: "moveUnit", unitId: payload.instanceId, to: toUnitSlotRef(area, index) });
        }
      }
      if (payload.kind === "animalOffer") {
        if (targetInstanceId && target.dataset.speciesId === payload.speciesId) onAction({ type: "recruitAndMerge", offerId: payload.slotId, targetUnitId: targetInstanceId });
        else onAction({ type: "recruitAnimal", offerId: payload.slotId, to: toUnitSlotRef(area, index) });
      }
      if (payload.kind === "itemOffer" && targetInstanceId) {
        onAction({ type: "purchaseAndApplyItem", offerId: payload.slotId, target: { kind: "units", unitIds: [targetInstanceId] } });
      }
    }
    if (dropKind === "inventory" && payload.kind === "itemOffer") {
      const slot = Number(target.dataset.index) as 0 | 1 | 2;
      onAction({ type: "purchaseItemToInventory", offerId: payload.slotId, to: { zone: "inventory", slot } });
    }
  }

  return <section className={`screen campLayout ${dragging ? "draggingCamp" : ""}`} onContextMenu={(event) => event.preventDefault()}>
    <aside className="sideRail">
      <h2>替补 Zzz</h2>
      <SlotList members={reserve} area="reserve" firstOpenTeamIndex={firstOpenTeamIndex} selected={selected} onSelect={setSelected} onAction={onAction} dragHandle={dragHandle} />
      <h2>仓库</h2>
      <div className="slotList">{Array.from({ length: rules.inventoryCapacity }).map((_, i) => {
        const item = inventory[i];
        return <article className="miniCard dropTarget" data-drop-kind="inventory" data-index={i} key={i}>{item ? <><strong>{ITEM_BY_ID[item.itemId].nameZh}</strong><small>{ITEM_BY_ID[item.itemId].descriptionZh}</small>{selectedMember && <button onClick={() => onAction({ type: "applyInventoryItem", itemInstanceId: item.instanceId, target: { kind: "units", unitIds: [selectedMember.instanceId] } })}>{ITEM_BY_ID[item.itemId].kind === "equipment" ? "装备" : "使用"}</button>}</> : "空仓库"}</article>;
      })}</div>
    </aside>
    <main className="campMain">
      <div className="statline"><span>站点 {expedition.round}</span><span>营地 Lv{camp.campLevel}</span><span>章 {expedition.badges}/10</span><span>士气 {expedition.morale}</span><span>补给 {camp.supply}</span><span>入营基础/上限 {rules.baseSupply}/{rules.supplyCap}</span><span>结转 {rules.carrySupplyLimit}</span></div>
      {expedition.pendingDiscoveries[0] && <Discovery discovery={expedition.pendingDiscoveries[0]} onAction={onAction} />}
      {expedition.pendingRecruit && <PendingRecruit expedition={expedition} member={expedition.pendingRecruit} onAction={onAction} />}
      <h2>战斗队：后排 → 前排（领域前排为索引 0）</h2>
      <SlotList members={formation} area="team" firstOpenTeamIndex={firstOpenTeamIndex} selected={selected} onSelect={setSelected} onAction={onAction} dragHandle={dragHandle} />
      <h2>动物邂逅</h2>
      <div className="offerGrid">{camp.animalOffers.map((slot) => <article key={slot.slotId} className={`offer ${slot.held ? "held" : ""} ${selected?.kind === "animalOffer" && selected.slotId === slot.offer?.offerInstanceId ? "selectedOffer" : ""} ${!slot.unlocked ? "locked" : ""}`} onClick={() => slot.offer && setSelected({ kind: "animalOffer", slotId: slot.offer.offerInstanceId })} {...(slot.offer ? dragHandle({ kind: "animalOffer", slotId: slot.offer.offerInstanceId, speciesId: slot.offer.speciesId }) : {})}>{slot.unlocked ? slot.offer ? <><AnimalAvatar speciesId={slot.offer.speciesId} /><span>价格 {rules.recruitCost}</span><button disabled={openFormationSlot === null} onClick={() => openFormationSlot !== null && onAction({ type: "recruitAnimal", offerId: slot.offer!.offerInstanceId, to: { zone: "formation", slot: openFormationSlot } })}>入队</button><button disabled={openReserveSlot === null} onClick={() => openReserveSlot !== null && onAction({ type: "recruitAnimal", offerId: slot.offer!.offerInstanceId, to: { zone: "reserve", slot: openReserveSlot } })}>替补</button>{selectedMember?.speciesId === slot.offer.speciesId && <button onClick={() => onAction({ type: "recruitAndMerge", offerId: slot.offer!.offerInstanceId, targetUnitId: selectedMember.instanceId })}>招募合成</button>}<button onClick={() => onAction({ type: "toggleHold", slotKind: "animal", offerId: slot.offer!.offerInstanceId })}>{slot.held ? "取消留意" : "留意"}</button></> : "空格，刷新补货" : "深入后开放"}</article>)}</div>
      <h2>道具发现</h2>
      <div className="offerGrid items">{camp.itemOffers.map((slot) => <article key={slot.slotId} className={`offer ${slot.held ? "held" : ""} ${selected?.kind === "itemOffer" && selected.slotId === slot.offer?.offerInstanceId ? "selectedOffer" : ""}`} onClick={() => slot.offer && setSelected({ kind: "itemOffer", slotId: slot.offer.offerInstanceId })} {...(slot.offer ? dragHandle({ kind: "itemOffer", slotId: slot.offer.offerInstanceId }) : {})}>{slot.offer ? <><strong>{ITEM_BY_ID[slot.offer.itemId].nameZh}</strong><small>{ITEM_BY_ID[slot.offer.itemId].descriptionZh}</small><span>价格 {ITEM_BY_ID[slot.offer.itemId].price}</span><button disabled={!inventory.includes(null)} onClick={() => { const empty = inventory.findIndex((item) => !item); if (empty >= 0) onAction({ type: "purchaseItemToInventory", offerId: slot.offer!.offerInstanceId, to: { zone: "inventory", slot: empty as 0 | 1 | 2 } }); }}>入仓</button>{selectedMember && <button onClick={() => onAction({ type: "purchaseAndApplyItem", offerId: slot.offer!.offerInstanceId, target: { kind: "units", unitIds: [selectedMember.instanceId] } })}>{ITEM_BY_ID[slot.offer.itemId].kind === "equipment" ? "直接装备" : "直接使用"}</button>}<button onClick={() => onAction({ type: "toggleHold", slotKind: "item", offerId: slot.offer!.offerInstanceId })}>{slot.held ? "取消留意" : "留意"}</button></> : "空格，刷新补货"}</article>)}</div>
    </main>
    <aside className="actionsPanel">
      <button onClick={() => onAction({ type: "refresh" })}>刷新</button>
      <button className="primary" onClick={onDepart}>出发</button>
      <SelectionDetails selected={selected} member={selectedMember ?? undefined} animalOffer={selectedAnimalOffer} itemOffer={selectedItemOffer} onAction={onAction} />
      <p>单击选中并查看详情；右键按住或触屏长按拖动，松开放置、换位、合成或使用。</p>
    </aside>
  </section>;
}

function SlotList({ members, area, firstOpenTeamIndex, selected, onSelect, onAction, dragHandle }: { members: Array<TeamMember | null>; area: "team" | "reserve"; firstOpenTeamIndex: number; selected: SelectedFocus | null; onSelect: (focus: SelectedFocus) => void; onAction: (command: CampCommand) => void; dragHandle: (payload: DragPayload) => DragHandleProps }) {
  const capacity = area === "team" ? 5 : 3;
  // Cause marker: domain position 0 is the front line, so team slots must render back-to-front.
  // Rendering 0..4 made the camp view look front-to-back while the label said back-to-front.
  const displayIndexes = area === "team" ? [4, 3, 2, 1, 0] : [0, 1, 2];
  return <div className="slotList">{displayIndexes.map((index) => {
    const member = members[index];
    const selectedMember = selected?.kind === "member" && selected.area === area && selected.index === index && selected.instanceId === member?.instanceId;
    const selectedSlot = selected?.kind === "slot" && selected.area === area && selected.index === index;
    const backTarget = index < capacity - 1 ? index + 1 : null;
    const frontTarget = index > 0 ? index - 1 : null;
    const positionLabel = area === "team" ? index === 0 ? "前排" : index === 4 ? "后排" : `${index + 1}位` : "替补";
    return <article key={index} data-drop-kind="slot" data-area={area} data-index={index} data-instance-id={member?.instanceId ?? ""} data-species-id={member?.speciesId ?? ""} className={`animalSlot dropTarget ${selectedMember ? "selectedMember" : ""} ${selectedSlot ? "selectedSlot" : ""}`}><small className="slotPositionLabel">{positionLabel}</small>{member ? <><button className="selectCard" onClick={() => onSelect({ kind: "member", area, index, instanceId: member.instanceId })} {...dragHandle({ kind: "member", area, index, instanceId: member.instanceId, speciesId: member.speciesId })}><AnimalAvatar speciesId={member.speciesId} member={member} reserve={area === "reserve"} /></button><div className="tinyActions">{area === "team" && backTarget !== null && <button title="向后排移动" onClick={() => onAction({ type: "moveUnit", unitId: member.instanceId, to: toUnitSlotRef(area, backTarget) })}>←</button>}{area === "team" && frontTarget !== null && <button title="向前排移动" onClick={() => onAction({ type: "moveUnit", unitId: member.instanceId, to: toUnitSlotRef(area, frontTarget) })}>→</button>}{area === "team" && <button onClick={() => onAction({ type: "moveUnit", unitId: member.instanceId, to: { zone: "reserve", slot: 0 } })}>下替补</button>}{area === "reserve" && <button onClick={() => onAction({ type: "moveUnit", unitId: member.instanceId, to: { zone: "formation", slot: firstOpenTeamIndex >= 0 ? firstOpenTeamIndex as 0 | 1 | 2 | 3 | 4 : 0 } })}>上场</button>}{selected?.kind === "member" && selected.instanceId !== member.instanceId && <button onClick={() => onAction({ type: "mergeUnits", sourceUnitId: selected.instanceId, targetUnitId: member.instanceId })}>合成到此</button>}<button onClick={() => onAction({ type: "releaseUnit", unitId: member.instanceId })}>告别</button></div></> : <button className="emptySlotButton" onClick={() => onSelect({ kind: "slot", area, index })}>空位</button>}</article>;
  })}</div>;
}

function SelectionDetails({ selected, member, animalOffer, itemOffer, onAction }: { selected: SelectedFocus | null; member?: TeamMember; animalOffer?: NonNullable<ExpeditionState["camp"]>["animalOffers"][number]; itemOffer?: NonNullable<ExpeditionState["camp"]>["itemOffers"][number]; onAction: (command: CampCommand) => void }) {
  if (!selected) return <div className="detailPanel"><strong>未选中</strong><p>单击动物、市场格或空位查看详情。</p></div>;
  if (member) {
    const animal = ANIMAL_BY_ID[member.speciesId];
    const level = memberLevel(member);
    return <div className="detailPanel selectedMemberPanel"><strong>{animal.nameZh} Lv{level}</strong><p>{animal.ability.nameZh}</p><p>{animal.ability.descriptionByLevel[level - 1]}</p><p>默契 {member.bondXp}/6 · 永久 ✊ {member.permanentAttackBonus} / ♥ {member.permanentHealthBonus}</p><p>{member.equipment ? `装备：${ITEM_BY_ID[member.equipment.itemId].nameZh}` : "未装备"}</p></div>;
  }
  if (animalOffer?.offer) {
    const animal = ANIMAL_BY_ID[animalOffer.offer.speciesId];
    return <div className="detailPanel selectedOfferPanel"><strong>{animal.nameZh}</strong><p>{animal.ability.nameZh}</p><p>{animal.ability.descriptionByLevel[0]}</p><button onClick={() => onAction({ type: "toggleHold", slotKind: "animal", offerId: animalOffer.offer!.offerInstanceId })}>{animalOffer.held ? "取消留意" : "留意"}</button></div>;
  }
  if (itemOffer?.offer) {
    const item = ITEM_BY_ID[itemOffer.offer.itemId];
    return <div className="detailPanel selectedOfferPanel"><strong>{item.nameZh}</strong><p>{item.descriptionZh}</p><p>价格 {item.price} · {item.kind === "food" ? "食物" : "装备"}</p><button onClick={() => onAction({ type: "toggleHold", slotKind: "item", offerId: itemOffer.offer!.offerInstanceId })}>{itemOffer.held ? "取消留意" : "留意"}</button></div>;
  }
  if (selected.kind === "slot") return <div className="detailPanel selectedSlotPanel"><strong>{selected.area === "team" ? "战斗队" : "替补"}空位</strong><p>把市场动物或己方动物拖到这里放置。拖到已有同种动物上会合成。</p></div>;
  return <div className="detailPanel"><strong>空内容</strong></div>;
}

function BattleRecovery({ expedition, onResolve }: { expedition: ExpeditionState; onResolve: (state: ExpeditionState) => void }) {
  function resolveLockedBattle() {
    const resolved = resolvePreparedBattle(expedition);
    if (resolved.ok) onResolve(resolved.state);
  }
  return <section className="screen"><h2>遭遇已固定</h2><p>战斗输入已经保存，正在从已固定的输入恢复结果。刷新或返回不会重掷。</p><button className="primary" onClick={resolveLockedBattle}>恢复遭遇</button></section>;
}

function AnimalAvatar({ speciesId, member, reserve }: { speciesId: SpeciesId; member?: TeamMember; reserve?: boolean }) {
  const animal = ANIMAL_BY_ID[speciesId];
  const level = member ? memberLevel(member) : 1;
  const attack = member ? animal.baseAttack + animal.levelAttackBonus[level - 1] + member.permanentAttackBonus : animal.baseAttack;
  const health = member ? animal.baseHealth + animal.levelHealthBonus[level - 1] + member.permanentHealthBonus : animal.baseHealth;
  return <div className="avatarBlock"><div className="glyph">{animal.visual.emoji || animal.visual.fallbackGlyph}</div><strong>{animal.nameZh} {["Ⅰ", "Ⅱ", "Ⅲ"][level - 1]}</strong><small>{animal.habitats.map((h) => h === "water" ? "水" : h === "land" ? "陆" : "空").join(" ")}</small>{member && <small>✊ {attack} <span className="heart">♥</span> {health} · {member.bondXp}/6 {member.equipment ? "· 装备" : ""} {reserve ? "· Zzz" : ""}</small>}</div>;
}

function Discovery({ discovery, onAction }: { discovery: ExpeditionState["pendingDiscoveries"][number]; onAction: (command: CampCommand) => void }) {
  return <div className="discovery"><strong>高级发现：选择 1 只 Tier {discovery.targetTier}</strong>{discovery.candidates.map((id) => <button key={id} onClick={() => onAction({ type: "chooseDiscovery", discoveryId: discovery.discoveryId, speciesId: id })}>{ANIMAL_BY_ID[id].nameZh}</button>)}</div>;
}

function PendingRecruit({ expedition, member, onAction }: { expedition: ExpeditionState; member: TeamMember; onAction: (command: CampCommand) => void }) {
  const formation = formationMembers(expedition);
  const reserve = reserveMembers(expedition);
  const teamSlot = firstEmptyFormationSlot(expedition);
  const reserveSlot = firstEmptyReserveSlot(expedition);
  const pendingFormationSlot = teamSlot >= 0 ? teamSlot as 0 | 1 | 2 | 3 | 4 : null;
  const pendingReserveSlot = reserveSlot >= 0 ? reserveSlot as 0 | 1 | 2 : null;
  const teamFull = teamSlot < 0;
  const reserveFull = reserveSlot < 0;
  return <div className="discovery pendingRecruit">
    <strong>待安置：{ANIMAL_BY_ID[member.speciesId].nameZh}</strong>
    <div className="pendingActions">
      <button disabled={teamFull} onClick={() => pendingFormationSlot !== null && onAction({ type: "placePendingRecruit", to: { zone: "formation", slot: pendingFormationSlot } })}>放入战斗队</button>
      <button disabled={reserveFull} onClick={() => pendingReserveSlot !== null && onAction({ type: "placePendingRecruit", to: { zone: "reserve", slot: pendingReserveSlot } })}>放入替补</button>
      <button onClick={() => onAction({ type: "discardPendingRecruit" })}>告别待安置</button>
    </div>
    {(teamFull || reserveFull) && <small>满员时可以先告别腾位，或直接替换指定位置。</small>}
    <div className="pendingReplaceGrid">
      <section>
        <strong>战斗队</strong>
        {formation.map((target, index) => target ? <div className="replaceRow" key={target.instanceId}>
          <span>{index + 1}. {ANIMAL_BY_ID[target.speciesId].nameZh} Lv{memberLevel(target)} · {target.bondXp}/6</span>
          <button onClick={() => onAction({ type: "placePendingRecruit", to: { zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 }, replaceUnitId: target.instanceId })}>替换</button>
          <button onClick={() => onAction({ type: "releaseUnit", unitId: target.instanceId })}>告别</button>
        </div> : null)}
      </section>
      <section>
        <strong>替补</strong>
        {presentMembers(reserve).length ? reserve.map((target, index) => target ? <div className="replaceRow" key={target.instanceId}>
          <span>{index + 1}. {ANIMAL_BY_ID[target.speciesId].nameZh} Lv{memberLevel(target)} · {target.bondXp}/6</span>
          <button onClick={() => onAction({ type: "placePendingRecruit", to: { zone: "reserve", slot: index as 0 | 1 | 2 }, replaceUnitId: target.instanceId })}>替换</button>
          <button onClick={() => onAction({ type: "releaseUnit", unitId: target.instanceId })}>告别</button>
        </div> : null) : <small>替补为空，可以直接放入。</small>}
      </section>
    </div>
  </div>;
}

function BattleView({ expedition, battle, onDone, settings, updateSettings }: { expedition: ExpeditionState; battle: BattleOutput; onDone: () => void; settings: AppSave["settings"]; updateSettings: (settings: AppSave["settings"]) => void }) {
  const [cursor, setCursor] = useState(expedition.pendingBattle?.playbackCursor ?? 0);
  const [playing, setPlaying] = useState(true);
  const event = battle.events[cursor] ?? battle.events[0];
  const env = expedition.pendingBattle?.input.environmentId ?? "meadow";
  const input = expedition.pendingBattle?.input;
  const atResult = cursor >= battle.events.length - 1;
  const sourceId = event?.sourceUnitId;
  const targetId = event?.targetUnitId;
  const cueEnd = useMemo(() => battleCueEndIndex(battle.events, cursor), [battle.events, cursor]);
  const frameById = useMemo(() => buildBattleFrame(input?.playerTeam.units ?? [], input?.opponentTeam.units ?? [], battle.events.slice(0, cueEnd + 1)), [battle.events, cueEnd, input?.opponentTeam.units, input?.playerTeam.units]);
  const activeMoveById = useMemo(() => activeMovementEventsByUnitId(battle.events, cursor), [battle.events, cursor]);

  useEffect(() => {
    if (!playing || atResult) return;
    const delay = Math.max(90, 700 / settings.battleSpeed);
    const timer = window.setTimeout(() => {
      setCursor((current) => Math.min(battle.events.length - 1, current + 1));
    }, settings.reduceMotion ? Math.min(delay, 120) : delay);
    return () => window.clearTimeout(timer);
  }, [playing, atResult, battle.events.length, settings.battleSpeed, settings.reduceMotion, cursor]);

  useEffect(() => {
    if (atResult) setPlaying(false);
  }, [atResult]);

  return <section className="screen battleScreen">
    <div className="battleHud">
      <div className="envBadge"><strong>{ENVIRONMENT_BY_ID[env].nameZh}</strong><span>{ENVIRONMENT_BY_ID[env].ruleZh}</span></div>
      <div className="toolbar battleControls"><button onClick={() => setPlaying((value) => !value)}>{playing ? "暂停" : "播放"}</button><button onClick={() => { setPlaying(false); setCursor((i) => Math.min(battle.events.length - 1, i + 1)); }}>单步</button><button onClick={() => { setPlaying(false); setCursor(battle.events.length - 1); }}>跳到结果</button>{[0.5, 1, 2, 4].map((speed) => <button className={settings.battleSpeed === speed ? "selected" : ""} key={speed} onClick={() => updateSettings({ ...settings, battleSpeed: speed as 0.5 | 1 | 2 | 4 })}>{speed}x</button>)}<button onClick={() => updateSettings({ ...settings, reduceMotion: !settings.reduceMotion })}>减少动画</button></div>
    </div>
    <div className={`battleStage scenicBattleStage ${settings.reduceMotion ? "reduceMotion" : ""}`}>
      <div className="mountainLayer" />
      <div className="treeLayer" />
      <div className="roadLayer" />
      <BattleQueue side="player" units={input?.playerTeam.units ?? []} frameById={frameById} sourceId={sourceId} targetId={targetId} activeMoveById={activeMoveById} />
      <div className="centerLine"><span>前排交锋</span></div>
      <BattleQueue side="opponent" units={input?.opponentTeam.units ?? []} frameById={frameById} sourceId={sourceId} targetId={targetId} activeMoveById={activeMoveById} />
    </div>
    <p className="currentEvent">{event?.messageZh}</p>
    <div className={`resultDock ${atResult ? "ready" : ""}`}>
      <span>{atResult ? "遭遇回放已结束，可以查看报告继续探险。" : `回放进度 ${cursor + 1}/${battle.events.length}`}</span>
      <button className="primary" disabled={!atResult} onClick={onDone}>查看报告 / 继续</button>
    </div>
    <ol className="log">{battle.events.slice(Math.max(0, cursor - 7), cursor + 1).map((item) => <li className={`log-${item.type}`} key={item.eventId}>{eventDelta(item)}{item.messageZh}</li>)}</ol>
    <details><summary>完整日志</summary><ol>{battle.events.map((item) => <li key={item.eventId}>{item.messageZh}</li>)}</ol></details>
  </section>;
}

type BattleFrameUnit = {
  unitId: string;
  snapshot: TeamSnapshotUnit;
  attack: number;
  health: number;
  maxHealth: number;
  shield: number;
  position: number;
  retreated: boolean;
};

function buildBattleFrame(playerUnits: readonly TeamSnapshotUnit[], opponentUnits: readonly TeamSnapshotUnit[], events: readonly BattleEvent[]): Map<string, BattleFrameUnit> {
  const frame = new Map<string, BattleFrameUnit>();
  for (const [side, units] of [["player", playerUnits], ["opponent", opponentUnits]] as const) {
    for (const unit of units) {
      const unitId = `${side}_${unit.snapshotUnitId}`;
      frame.set(unitId, { unitId, snapshot: unit, attack: unit.initialAttack, health: unit.initialMaxHealth, maxHealth: unit.initialMaxHealth, shield: 0, position: unit.position, retreated: false });
    }
  }
  for (const event of events) {
    const target = event.targetUnitId ? frame.get(event.targetUnitId) : undefined;
    const source = event.sourceUnitId ? frame.get(event.sourceUnitId) : undefined;
    if (event.type === "shieldAbsorbed" && target && typeof event.after === "number") target.shield = event.after;
    if (event.type === "damageApplied" && target && typeof event.after === "number") target.health = event.after;
    if (event.type === "statModified" && target && typeof event.after === "number") {
      if (event.metadata.stat === "attack" || event.metadata.stat === "attackReduced") target.attack = event.after;
      if (event.metadata.stat === "health") {
        const before = typeof event.before === "number" ? event.before : target.health;
        const delta = event.after - before;
        target.health = event.after;
        target.maxHealth = Math.max(1, target.maxHealth + delta);
      }
      if (event.metadata.stat === "shield") target.shield = event.after;
    }
    if (event.type === "unitMoved" && source && typeof event.after === "number") source.position = event.after;
    if (event.type === "unitRetreated" && source) {
      source.retreated = true;
      source.health = Math.min(0, source.health);
    }
  }
  return frame;
}

function movementCause(event: BattleEvent | undefined): unknown {
  return event?.type === "unitMoved" ? event.metadata.causeUnitId ?? event.sourceUnitId : undefined;
}

function battleCueEndIndex(events: readonly BattleEvent[], cursor: number): number {
  const cause = movementCause(events[cursor]);
  if (!cause) return cursor;
  let end = cursor;
  while (end + 1 < events.length && events[end + 1].type === "unitMoved" && movementCause(events[end + 1]) === cause) end += 1;
  return end;
}

function activeMovementEventsByUnitId(events: readonly BattleEvent[], cursor: number): Map<string, BattleEvent> {
  const cause = movementCause(events[cursor]);
  const active = new Map<string, BattleEvent>();
  if (!cause) return active;
  let start = cursor;
  while (start - 1 >= 0 && events[start - 1].type === "unitMoved" && movementCause(events[start - 1]) === cause) start -= 1;
  const end = battleCueEndIndex(events, cursor);
  for (let index = start; index <= end; index += 1) {
    const event = events[index];
    if (event.sourceUnitId) active.set(event.sourceUnitId, event);
  }
  return active;
}

function eventDelta(event: BattleEvent): string {
  if (event.type === "damageApplied" && typeof event.amount === "number") return `-${event.amount} `;
  if (event.type === "shieldAbsorbed" && typeof event.amount === "number") return `盾-${event.amount} `;
  if (event.type === "statModified" && typeof event.before === "number" && typeof event.after === "number") {
    const delta = event.after - event.before;
    if (delta !== 0) return `${delta > 0 ? "+" : ""}${delta} `;
  }
  if (event.type === "unitRetreated") return "退场 ";
  if (event.type === "unitMoved") return "移位 ";
  return "";
}

function BattleQueue({ side, units, frameById, sourceId, targetId, activeMoveById }: { side: Side; units: readonly TeamSnapshotUnit[]; frameById: Map<string, BattleFrameUnit>; sourceId?: string; targetId?: string; activeMoveById: Map<string, BattleEvent> }) {
  const byPosition = new Map<number, { unit: TeamSnapshotUnit; frame?: BattleFrameUnit; unitId: string }>();
  for (const unit of units) {
    const unitId = `${side}_${unit.snapshotUnitId}`;
    const frame = frameById.get(unitId);
    // Movement events mutate frame.position; snapshot position is only the initial battle layout.
    byPosition.set(frame?.position ?? unit.position, { unit, frame, unitId });
  }
  // Cause marker: position 0 is the front line. Player side renders 4..0 so the centerline-facing unit is front.
  const positions = side === "player" ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return <div className={`battleQueue ${side}`}>
    <div className="teamTag">{side === "player" ? "玩家：后排 → 前排" : "对手：前排 ← 后排"}</div>
    {positions.map((position) => {
      const entry = byPosition.get(position);
      if (!entry) return <article className="battleSlot emptyBattleSlot" key={position}><span>{position + 1}</span></article>;
      const { unit, frame, unitId } = entry;
      const highlighted = sourceId === unitId || targetId === unitId;
      const source = sourceId === unitId;
      const target = targetId === unitId;
      return <BattlePet key={unit.snapshotUnitId} unit={unit} frame={frame} side={side} highlighted={highlighted} source={source} target={target} moveEvent={activeMoveById.get(unitId)} />;
    })}
  </div>;
}

function BattlePet({ unit, frame, side, highlighted, source, target, moveEvent }: { unit: TeamSnapshotUnit; frame?: BattleFrameUnit; side: Side; highlighted: boolean; source: boolean; target: boolean; moveEvent?: BattleEvent }) {
  const animal = ANIMAL_BY_ID[unit.speciesId];
  const shownAttack = frame?.attack ?? unit.initialAttack;
  const shownHealth = Math.max(0, frame?.health ?? unit.initialMaxHealth);
  const maxHealth = frame?.maxHealth ?? unit.initialMaxHealth;
  const shield = frame?.shield ?? 0;
  const retreated = frame?.retreated;
  const before = typeof moveEvent?.before === "number" ? moveEvent.before : undefined;
  const after = typeof moveEvent?.after === "number" ? moveEvent.after : undefined;
  const moveClass = before !== undefined && after !== undefined ? after > before ? "movedBack" : after < before ? "movedForward" : "" : "";
  return <article className={`battlePet battleSlot ${side} ${highlighted ? "highlighted" : ""} ${source ? "source" : ""} ${target ? "target" : ""} ${moveEvent ? "moved" : ""} ${moveClass} ${retreated ? "retreated" : ""}`}>
    <div className="levelPip">Lv{unit.level}</div>
    {unit.equipmentEffect && <div className="equipPip">装</div>}
    <div className="petGlyph">{animal.visual.emoji || animal.visual.fallbackGlyph}</div>
    <strong>{animal.nameZh}</strong>
    <div className="statChips"><span className="attackChip">✊ {shownAttack}</span><span className="healthChip">♥ {shownHealth}/{maxHealth}</span>{shield > 0 && <span className="shieldChip">◆ {shield}</span>}</div>
    {retreated && <span className="retreatLabel">退场</span>}
  </article>;
}

function Report({ save, expedition, onReward, onContinue, onRegister }: { save: AppSave; expedition: ExpeditionState; onReward: (choice: RewardChoice) => void; onContinue: () => void; onRegister: (speciesId: SpeciesId, name: string, rewards: RewardChoice[]) => void }) {
  const rewards = useMemo(() => createRewardChoices(expedition, save, expedition.expeditionSeed), [expedition, save]);
  const [name, setName] = useState("");
  const [adopt, setAdopt] = useState<SpeciesId>(expedition.finalVictoryRecord?.playerPreBattleSnapshot.units[0]?.speciesId ?? formationMembers(expedition).find(Boolean)?.speciesId ?? "frog");
  const [selectedRewards, setSelectedRewards] = useState<string[]>([]);
  if (expedition.phase === "successResolution") {
    const chosen = rewards.filter((reward) => selectedRewards.includes(reward.id)).slice(0, 2);
    return <section className="screen"><h2>成功报告</h2><p>{expedition.stats.highlight}</p><select value={adopt} onChange={(e) => setAdopt(e.target.value as SpeciesId)}>{expedition.finalVictoryRecord?.playerPreBattleSnapshot.units.map((u) => <option key={u.snapshotUnitId} value={u.speciesId}>{ANIMAL_BY_ID[u.speciesId].nameZh}</option>)}</select><input value={name} onChange={(e) => setName(e.target.value)} placeholder="队伍名称" /><div className="offerGrid">{rewards.map((r) => <article className={`offer ${selectedRewards.includes(r.id) ? "held" : ""}`} key={r.id}><strong>{r.titleZh}</strong><p>{r.descriptionZh}</p><button disabled={!selectedRewards.includes(r.id) && selectedRewards.length >= 2} onClick={() => setSelectedRewards((ids) => ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id])}>选择</button></article>)}</div><button className="primary" disabled={chosen.length < 2} onClick={() => onRegister(adopt, name, chosen)}>领养并登记最终战前快照</button><p>习性变体将在后续版本开放。</p></section>;
  }
  if (expedition.phase === "returnResolution") {
    return <section className="screen"><h2>提前返程报告</h2><p>探险队士气不足，本次提前返程。你仍然可以带走一份发现。</p><div className="offerGrid">{rewards.map((r) => <article className="offer" key={r.id}><strong>{r.titleZh}</strong><p>{r.descriptionZh}</p><button onClick={() => onReward(r)}>选择</button></article>)}</div></section>;
  }
  return <section className="screen"><h2>战斗报告</h2><p>{expedition.stats.highlight}</p><p>章 {expedition.badges}/10 · 士气 {expedition.morale} · 胜/负/平 {expedition.stats.battlesWon}/{expedition.stats.battlesLost}/{expedition.stats.battlesDrawn}</p><button className="primary" onClick={onContinue}>下一营地</button></section>;
}

function Collection({ save }: { save: AppSave }) {
  return <section className="screen"><h2>动物图鉴</h2><div className="collectionGrid">{ANIMALS.map((animal) => { const entry = save.collection[animal.id]; return <article className="offer" key={animal.id}><AnimalAvatar speciesId={animal.id} /><p>{entry.adopted ? "已领养" : entry.journalUnlocked ? "图鉴解锁" : entry.seen ? "见过" : "未见"}</p><p>印记 {entry.memory} · 踪迹 {entry.traceProgress}/3</p><p>{animal.ability.descriptionByLevel[0]}</p></article>; })}</div></section>;
}

function Champions({ save, setSave, setMessage }: { save: AppSave; setSave: (save: AppSave) => void; setMessage: (m: string) => void }) {
  return <section className="screen"><h2>冠军陈列</h2><div className="collectionGrid">{save.registeredTeams.map((team) => <ChampionCard key={team.teamId} team={team} onDelete={() => { setSave(commit({ ...save, registeredTeams: save.registeredTeams.filter((t) => t.teamId !== team.teamId) })); setMessage("已删除登记队伍。"); }} />)}</div></section>;
}

function ChampionCard({ team, onDelete }: { team: RegisteredTeam; onDelete: () => void }) {
  const code = useMemo(() => encodeChallengeCode(team), [team]);
  return <article className="offer"><strong>{team.name}</strong><p>{team.highlight}</p><p>{team.lineupSnapshot.units.map((u) => ANIMAL_BY_ID[u.speciesId].nameZh).join(" / ")}</p><small>最终遭遇：{team.sourceBattleId} · {team.finalBattleEnvironmentId}</small><textarea readOnly value={code} /><button onClick={() => navigator.clipboard?.writeText(code)}>复制挑战码</button><button onClick={onDelete}>删除</button></article>;
}

function Challenge({ save, setSave, setMessage }: { save: AppSave; setSave: (save: AppSave) => void; setMessage: (m: string) => void }) {
  const [code, setCode] = useState("");
  const decoded = code ? decodeChallengeCode(code) : { ok: false as const };
  function challenge(team: RegisteredTeam) {
    const challenger = save.activeExpedition?.formation.some(Boolean) ? save.activeExpedition.pendingBattle?.input.playerTeam ?? team.lineupSnapshot : team.lineupSnapshot;
    const output = resolveBattle({ battleId: `challenge_${team.teamId}`, playerTeam: challenger, opponentTeam: team.lineupSnapshot, environmentId: team.finalBattleEnvironmentId, seed: team.finalBattleSeed, engineVersion: team.engineVersion, contentVersion: team.contentVersion });
    setSave(commit(applyChallengeReward(save, team.teamId, output.result, new Date().toISOString())));
    setMessage(`挑战结束：${output.result === "win" ? "胜利" : output.result === "loss" ? "失利" : "平局"}。`);
  }
  return <section className="screen"><h2>挑战码</h2><textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="粘贴 WT2 挑战码" />{decoded.ok && decoded.team ? <article className="offer"><strong>{decoded.team.name}</strong><p>{decoded.museumOnly ? "博物馆队伍：版本不兼容，只允许查看。" : "版本兼容，可挑战。"}</p><p>{decoded.team.lineupSnapshot.units.map((u) => ANIMAL_BY_ID[u.speciesId].nameZh).join(" / ")}</p><button disabled={decoded.museumOnly} onClick={() => challenge(decoded.team!)}>开始挑战</button></article> : code && <p>{decoded.errorZh}</p>}</section>;
}

function DevTools({ save, setSave, setMessage }: { save: AppSave; setSave: (save: AppSave) => void; setMessage: (m: string) => void }) {
  const [json, setJson] = useState(exportSave(save));
  return <section className="screen"><h2>开发者工具</h2><div className="toolbar"><button onClick={() => setJson(exportSave(save))}>导出 JSON</button><button onClick={() => { const result = importSaveJson(json); if (result.ok) setSave(commit(result.save)); setMessage(result.messageZh); }}>导入 JSON</button><button onClick={() => setSave(resetSave())}>重置存档</button><button onClick={() => navigator.clipboard?.writeText(String(save.activeExpedition?.expeditionSeed ?? "no-seed"))}>复制当前种子</button><button onClick={() => setJson(stagingInfo())}>查看 staging</button><button onClick={() => { clearStaging(); setMessage("staging 已清理。"); }}>清理 staging</button></div><textarea value={json} onChange={(e) => setJson(e.target.value)} /></section>;
}
