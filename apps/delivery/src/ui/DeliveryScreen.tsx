import type { DisplayCurrency } from '@baseline/host-contract';
import { useEffect, useRef, useState } from 'react';
import type { DeliveryStore } from '../application/deliveryStore';
import type { StaffStore } from '../application/staffStore';
import {
  canHaveChildren,
  expandPathTo,
  isAncestor,
  moveTargets,
  pathOf,
  treeRows,
  type MoveTarget,
} from '../application/treeView';
import { breakdownItemId, type BreakdownItemId, type ProjectId } from '../domain/ids';
import { allocationsOn, childrenOf, depthOf } from '../domain/plan';
import { BreakdownTree } from './BreakdownTree';
import styles from './DeliveryScreen.module.css';
import { DeleteDialog } from './DeleteDialog';
import { ItemPanel } from './ItemPanel';
import { MoveDialog } from './MoveDialog';
import { NameDialog } from './NameDialog';
import { StaffingScreen } from './StaffingScreen';
import { useDeliverySnapshot } from './useDeliveryStore';

/** What a dialog is about is fixed when it opens: the plan may change under it (optimistically). */
interface Subject {
  readonly id: BreakdownItemId;
  readonly name: string;
}

type Dialog =
  | { readonly kind: 'add'; readonly parent: Subject | null }
  | { readonly kind: 'rename'; readonly item: Subject }
  | { readonly kind: 'move'; readonly item: Subject; readonly targets: readonly MoveTarget[] }
  | { readonly kind: 'delete'; readonly item: Subject };

interface Props {
  readonly store: DeliveryStore;
  readonly staff: StaffStore;
  readonly currency: DisplayCurrency;
}

const MODES = [
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'staffing', label: 'Staffing' },
] as const;

export function DeliveryScreen({ store, staff, currency }: Props) {
  const { plan: view } = useDeliverySnapshot(store);
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('breakdown');
  const [chosenProject, setChosenProject] = useState<ProjectId | null>(null);
  const [selected, setSelected] = useState<BreakdownItemId | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<BreakdownItemId>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState('');
  const treeArea = useRef<HTMLDivElement>(null);
  const dialogWasOpen = useRef(false);

  // A closing dialog hands the focus back to what opened it. If that is gone (a deleted item, a
  // panel rebuilt by a rollback) the focus would be lost, so it goes to the tree.
  useEffect(() => {
    if (dialog !== null) {
      dialogWasOpen.current = true;
      return;
    }
    if (!dialogWasOpen.current) return;
    dialogWasOpen.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) treeArea.current?.focus();
  }, [dialog]);

  if (view.status === 'loading') {
    return (
      <p role="status" className={styles.message}>
        Loading the plan…
      </p>
    );
  }
  if (view.status === 'failed') {
    return (
      <div role="alert" className={styles.message}>
        <p>The plan could not be loaded: {view.message}</p>
        <button
          type="button"
          onClick={() => {
            void store.load();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const { plan } = view;
  const projects = [...plan.projects.values()];
  const project = projects.find((each) => each.id === chosenProject) ?? projects[0];
  if (!project) return <p className={styles.message}>There are no projects yet.</p>;

  const item = selected === null ? undefined : plan.items.get(selected);
  const chosen = item?.projectId === project.id ? item : undefined;
  // The selected item is always on screen, wherever it has just been added or moved to.
  const open = chosen ? expandPathTo(plan, chosen.id, collapsed) : collapsed;
  const rows = treeRows(plan, project.id, open);

  const toggle = (id: BreakdownItemId) => {
    const closing = !open.has(id);
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    // Closing an item that holds the selection would hide it: the selection moves up to it.
    if (closing && selected !== null && isAncestor(plan, id, selected)) setSelected(id);
  };
  const ask = (next: Dialog) => {
    setNotice('');
    setDialog(next);
  };
  const subjectOf = (found: { id: BreakdownItemId; name: string }): Subject => ({
    id: found.id,
    name: found.name,
  });
  const closeDialog = () => {
    setDialog(null);
  };

  return (
    <div className={styles.screen}>
      {view.stale === null ? null : (
        <div role="alert" className={styles.stale}>
          <p>The plan could not be refreshed, so it may be out of date: {view.stale}</p>
          <button
            type="button"
            onClick={() => {
              void store.load();
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="delivery-project">Project</label>
          <select
            id="delivery-project"
            value={project.id}
            onChange={(event) => {
              setChosenProject(projects.find((each) => each.id === event.target.value)?.id ?? null);
              setSelected(null);
            }}
          >
            {projects.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label="View" className={styles.modes}>
          {MODES.map((each) => (
            <button
              key={each.id}
              type="button"
              aria-pressed={each.id === mode}
              onClick={() => {
                setMode(each.id);
              }}
            >
              {each.label}
            </button>
          ))}
        </div>
        {mode === 'breakdown' ? (
          <button
            type="button"
            onClick={() => {
              ask({ kind: 'add', parent: null });
            }}
          >
            Add a top-level item
          </button>
        ) : null}
        <span className={styles.saving} role="status">
          {view.saving ? 'Saving…' : ''}
        </span>
      </div>

      {/* Kept mounted while hidden: unit, months and open rows survive a visit to Breakdown. */}
      <div hidden={mode !== 'staffing'}>
        <StaffingScreen
          key={project.id}
          plan={plan}
          project={project}
          store={store}
          staff={staff}
          currency={currency}
        />
      </div>
      {mode === 'breakdown' ? (
        <>
          <p className={styles.notice} role="status">
            {notice}
          </p>

          <div className={styles.layout}>
            <div ref={treeArea} tabIndex={-1} className={styles.treeArea}>
              {rows.length === 0 ? (
                <p className={styles.empty}>
                  This project has no work breakdown yet. Add a top-level item to start.
                </p>
              ) : (
                <BreakdownTree
                  label={`Work breakdown of ${project.name}`}
                  rows={rows}
                  selected={chosen?.id ?? null}
                  onSelect={setSelected}
                  onToggle={toggle}
                />
              )}
            </div>

            {chosen ? (
              <ItemPanel
                name={chosen.name}
                path={pathOf(plan, chosen.id)}
                depth={depthOf(plan, chosen.id)}
                childCount={childrenOf(plan, chosen.id).length}
                allocationCount={allocationsOn(plan, chosen.id).length}
                canAddChild={canHaveChildren(plan, chosen.id)}
                onAddChild={() => {
                  ask({ kind: 'add', parent: subjectOf(chosen) });
                }}
                onRename={() => {
                  ask({ kind: 'rename', item: subjectOf(chosen) });
                }}
                onMove={() => {
                  ask({
                    kind: 'move',
                    item: subjectOf(chosen),
                    targets: moveTargets(plan, chosen.id),
                  });
                }}
                onDelete={() => {
                  ask({ kind: 'delete', item: subjectOf(chosen) });
                }}
              />
            ) : (
              <p className={styles.hint}>Select an item to add to it, rename, move or delete it.</p>
            )}
          </div>
        </>
      ) : null}

      {dialog?.kind === 'add' ? (
        <NameDialog
          title={
            dialog.parent === null
              ? `Add a top-level item to ${project.name}`
              : `Add an item under “${dialog.parent.name}”`
          }
          submitLabel="Add"
          initialName=""
          onClose={closeDialog}
          onSubmit={async (name) => {
            const result = await store.addItem(project.id, dialog.parent?.id ?? null, name);
            if (!result.ok) return result;
            setSelected(result.itemId);
            setNotice(result.notice ?? `Added “${name.trim()}”.`);
            return result;
          }}
        />
      ) : null}

      {dialog?.kind === 'rename' ? (
        <NameDialog
          title={`Rename “${dialog.item.name}”`}
          submitLabel="Rename"
          initialName={dialog.item.name}
          onClose={closeDialog}
          onSubmit={async (name) => {
            const result = await store.renameItem(dialog.item.id, name);
            if (result.ok) setNotice(`Renamed to “${name.trim()}”.`);
            return result;
          }}
        />
      ) : null}

      {dialog?.kind === 'move' ? (
        <MoveDialog
          itemName={dialog.item.name}
          targets={dialog.targets}
          onClose={closeDialog}
          onSubmit={async (parent) => {
            const result = await store.moveItem(dialog.item.id, parent);
            if (result.ok) {
              setSelected(dialog.item.id);
              setNotice(
                `Moved “${dialog.item.name}” ${parent === null ? 'to the top level' : `under “${plan.items.get(parent)?.name ?? ''}”`}.`,
              );
            }
            return result;
          }}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteDialog
          itemId={dialog.item.id}
          itemName={dialog.item.name}
          store={store}
          namesOf={(ids) => ids.map((id) => plan.items.get(breakdownItemId(id))?.name ?? id)}
          onClose={closeDialog}
          onDeleted={() => {
            setNotice(`Deleted “${dialog.item.name}”.`);
            setSelected(null);
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
