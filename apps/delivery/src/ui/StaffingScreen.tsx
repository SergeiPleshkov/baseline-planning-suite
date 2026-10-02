import type { DisplayCurrency } from '@baseline/host-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explainCell } from '../application/calculation';
import { personMonthsFromEntry } from '../application/cellEntry';
import type { DeliveryStore } from '../application/deliveryStore';
import {
  buildGrid,
  conversionFor,
  personKey,
  REPORTING_YEAR,
  shiftHorizon,
  type Assignment,
  type GridCell,
  type PersonLine,
} from '../application/gridView';
import { cellInProject, overloads, type OverloadEntry } from '../application/overload';
import { byKey, byName } from '../application/sorting';
import type { StaffStore } from '../application/staffStore';
import { expandPathTo, leafOptions } from '../application/treeView';
import type { MonthSpan, YearMonth } from '../domain/calendar';
import type { BreakdownItemId, EmployeeId } from '../domain/ids';
import { projectMonths, type Plan, type Project } from '../domain/plan';
import { DISPLAY_UNITS, isPlainUnit, type DisplayUnit } from '../domain/units';
import { AssignDialog } from './AssignDialog';
import { formatMonth, formatMonthShort } from './format';
import { CalculationPanel } from './CalculationPanel';
import { OverloadList } from './OverloadList';
import { StaffingGrid, type InspectedCell } from './StaffingGrid';
import styles from './StaffingScreen.module.css';
import { useStaffView } from './useDeliveryStore';

interface Props {
  readonly plan: Plan;
  readonly project: Project;
  readonly store: DeliveryStore;
  readonly staff: StaffStore;
  readonly currency: DisplayCurrency;
}

const unitLabel = (unit: DisplayUnit, currency: DisplayCurrency): string => {
  switch (unit) {
    case 'personMonths':
      return 'Person-months';
    case 'hours':
      return 'Hours';
    case 'capacityPercent':
      return '% of capacity';
    case 'cost':
      return `Cost (${currency.code})`;
  }
};

const rangeLabel = ({ first, last }: MonthSpan): string =>
  `${formatMonthShort(first)} – ${formatMonthShort(last)}`;

const sameHorizon = (a: MonthSpan, b: MonthSpan): boolean =>
  a.first === b.first && a.last === b.last;

export function StaffingScreen({ plan, project, store, staff, currency }: Props) {
  const people = useStaffView(staff);
  const [unit, setUnit] = useState<DisplayUnit>('personMonths');
  const [chosen, setChosen] = useState<MonthSpan | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<BreakdownItemId>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const unitsGroup = useRef<HTMLFieldSetElement>(null);
  const refocusUnits = useRef(false);
  const [assigned, setAssigned] = useState<readonly Assignment[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [reveal, setReveal] = useState<{ key: string; month: YearMonth | null } | null>(null);
  const [inspected, setInspected] = useState<InspectedCell | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Text left in a cell that could not be saved, named by its cell; it goes with the next saved figure.
  const [dropped, setDropped] = useState<string | null>(null);

  const ownSpan = useMemo(() => projectMonths(project), [project]);
  const horizon = chosen ?? ownSpan;
  const known = people.status === 'ready' ? people : null;
  const built = useMemo(
    () =>
      buildGrid({
        plan,
        project,
        horizon,
        unit,
        currencyPerEur: currency.ratePerEur,
        staff: known?.staff ?? null,
        rates: known?.rates ?? null,
        assigned,
      }),
    [plan, project, horizon, unit, currency.ratePerEur, known, assigned],
  );

  const waitingForPeople = people.status === 'loading' && !isPlainUnit(unit);
  // Only a grid that is on screen can take the focus: a request to reveal must not wait for one.
  const gridShown = !waitingForPeople && built.status === 'ready';

  const assign = (item: BreakdownItemId, employee: EmployeeId) => {
    setAssigned((current) =>
      current.some((each) => each.item === item && each.employee === employee)
        ? current
        : [...current, { item, employee }],
    );
  };

  const edit = (line: PersonLine, cell: GridCell, text: string): string | null => {
    const entered = personMonthsFromEntry(
      text,
      { unit, currency: currency.code },
      conversionFor(line.employeeId, cell.month, {
        staff: known?.staff ?? null,
        rates: known?.rates ?? null,
        currencyPerEur: currency.ratePerEur,
      }),
    );
    if (!entered.ok) return entered.error;
    // A row stays after its last figure is cleared, so that the person can enter another.
    assign(line.item.id, line.employeeId);
    setRefusal(null);
    setDropped(null);
    void store
      .setAllocation(
        { breakdownItemId: line.item.id, employeeId: line.employeeId, month: cell.month },
        entered.value,
      )
      .then((outcome) => {
        if (!outcome.ok) setRefusal(outcome.message);
      });
    return null;
  };

  const assignPerson = (item: BreakdownItemId, employee: EmployeeId) => {
    assign(item, employee);
    // The new row has to be on screen: open the items above it, and the leaf itself.
    setCollapsed((current) => {
      const next = new Set(expandPathTo(plan, item, current));
      next.delete(item);
      return next;
    });
    if (gridShown) setReveal({ key: personKey(item, employee), month: null });
  };

  const nameOf = (employee: EmployeeId): string => known?.staff.get(employee)?.name ?? employee;

  const overloaded = useMemo(
    () =>
      overloads(plan)
        .filter((entry) => entry.contributions.some((each) => each.project.id === project.id))
        .sort(
          (a, b) =>
            byName(
              known?.staff.get(a.employeeId)?.name ?? a.employeeId,
              known?.staff.get(b.employeeId)?.name ?? b.employeeId,
            ) || byKey(a.month, b.month),
        ),
    [plan, project, known],
  );

  const showOverload = (entry: OverloadEntry) => {
    const target = cellInProject(entry, project.id);
    if (!target || !gridShown) return;
    if (entry.month < horizon.first || entry.month > horizon.last) setChosen(null);
    setCollapsed((current) => {
      const next = new Set(expandPathTo(plan, target.item, current));
      next.delete(target.item);
      return next;
    });
    setReveal({ key: personKey(target.item, target.employee), month: target.month });
  };

  const refused = (line: PersonLine, cell: GridCell, reason: string) => {
    setDropped(`A figure for ${line.name}, ${formatMonth(cell.month)} was not saved: ${reason}`);
  };

  const inspect = useCallback((cell: InspectedCell | null) => {
    setInspected((current) =>
      current?.item === cell?.item &&
      current?.employee === cell?.employee &&
      current?.month === cell?.month
        ? current
        : cell,
    );
  }, []);

  const calculation = useMemo(
    () =>
      inspected === null || !plan.items.has(inspected.item)
        ? null
        : explainCell({
            plan,
            item: inspected.item,
            employee: inspected.employee,
            month: inspected.month,
            staff: known?.staff ?? null,
            rates: known?.rates ?? null,
            currencyPerEur: currency.ratePerEur,
          }),
    [plan, inspected, known, currency.ratePerEur],
  );

  const revealed = useCallback(() => {
    setReveal(null);
  }, []);

  const outOfDate = Boolean(known?.stale);
  useEffect(() => {
    if (outOfDate || !refocusUnits.current) return;
    refocusUnits.current = false;
    unitsGroup.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, [outOfDate]);

  const toggle = (id: BreakdownItemId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  // The banner stays while a retry is under way, so that the Retry button the person pressed is
  // still there and keeps the focus.
  const showBanner = people.status === 'failed' || (people.status === 'loading' && retrying);

  return (
    <div className={styles.staffing}>
      {showBanner ? (
        <div role="alert" className={styles.banner}>
          <p>
            {people.status === 'failed'
              ? `People could not be read: ${people.message} Hours and cost are unavailable, and people are shown by id.`
              : 'Reading People again…'}
          </p>
          <button
            type="button"
            aria-disabled={people.status === 'loading'}
            onClick={() => {
              if (people.status === 'loading') return;
              setRetrying(true);
              void staff.load();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {known?.stale ? (
        <div role="status" className={styles.stale}>
          <p>Hours and cost use what People last sent, which may be out of date: {known.stale}</p>
          <button
            type="button"
            aria-disabled={refreshing}
            onClick={() => {
              if (refreshing) return;
              setRefreshing(true);
              void staff.load().finally(() => {
                // The banner goes with a good read, and the button that had the focus with it.
                const view = staff.getSnapshot();
                refocusUnits.current = view.status === 'ready' && view.stale === null;
                setRefreshing(false);
              });
            }}
          >
            {refreshing ? 'Reading People…' : 'Refresh'}
          </button>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <fieldset ref={unitsGroup} className={styles.units}>
          <legend>Unit</legend>
          {DISPLAY_UNITS.map((each) => (
            <label key={each} className={each === unit ? styles.unitOn : styles.unit}>
              <input
                type="radio"
                name="staffing-unit"
                value={each}
                checked={each === unit}
                onChange={() => {
                  setUnit(each);
                }}
              />
              {unitLabel(each, currency)}
            </label>
          ))}
        </fieldset>

        <div role="group" aria-label="Months shown" className={styles.horizon}>
          <button
            type="button"
            aria-label="Show one month earlier"
            onClick={() => {
              setChosen(shiftHorizon(horizon, -1));
            }}
          >
            ‹
          </button>
          <span className={styles.range} role="status">
            {rangeLabel(horizon)}
          </span>
          <button
            type="button"
            aria-label="Show one month later"
            onClick={() => {
              setChosen(shiftHorizon(horizon, 1));
            }}
          >
            ›
          </button>
          <button
            type="button"
            aria-pressed={sameHorizon(horizon, ownSpan)}
            onClick={() => {
              setChosen(null);
            }}
          >
            Project span
          </button>
          <button
            type="button"
            aria-pressed={sameHorizon(horizon, REPORTING_YEAR)}
            onClick={() => {
              setChosen(REPORTING_YEAR);
            }}
          >
            {rangeLabel(REPORTING_YEAR)}
          </button>
        </div>

        <button
          type="button"
          disabled={known === null}
          onClick={() => {
            setAssigning(true);
          }}
        >
          Assign person…
        </button>
      </div>

      {refusal === null ? null : (
        <p role="alert" className={styles.unavailable}>
          A figure was not saved: {refusal}
        </p>
      )}
      {dropped === null ? null : (
        <p role="alert" className={styles.unavailable}>
          {dropped}
        </p>
      )}

      <OverloadList
        entries={overloaded}
        canShow={gridShown}
        project={project.id}
        nameOf={nameOf}
        onShow={showOverload}
      />
      {waitingForPeople ? (
        <p role="status" className={styles.message}>
          Loading people…
        </p>
      ) : built.status === 'unavailable' ? (
        <p role="alert" className={styles.unavailable}>
          {built.message} Show person-months or percent of capacity instead.
        </p>
      ) : built.grid.lines.length === 0 ? (
        <p className={styles.empty}>
          This project has no work breakdown yet. Add items on the Breakdown view first.
        </p>
      ) : (
        <StaffingGrid
          label={`Staffing of ${project.name}, ${unitLabel(unit, currency)}`}
          grid={built.grid}
          unit={unit}
          currency={currency.code}
          collapsed={collapsed}
          onToggle={toggle}
          onEdit={edit}
          onRefused={refused}
          reveal={reveal}
          onRevealed={revealed}
          onInspect={inspect}
        />
      )}
      <CalculationPanel calculation={calculation} currency={currency} />
      <p className={styles.legend}>
        † marks the allocation edited last in a month over capacity, and the other contributions to
        that month are tinted; ◇ marks a cost with days that have no rate. Enter or F2 edits a
        person’s cell, typing starts a new figure (a unit may stand before or after it: 88 h, 50 %,
        €7,880), Delete clears it; Enter saves and moves down, Tab moves along, Escape drops the
        text. Figures are rounded together, so every total is the sum of the figures it covers.
        Shaded months are outside the project.
      </p>

      {assigning && known !== null ? (
        <AssignDialog
          leaves={leafOptions(plan, project.id)}
          people={[...known.staff.values()]
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => byName(a.name, b.name))}
          onSubmit={assignPerson}
          onClose={() => {
            setAssigning(false);
          }}
        />
      ) : null}
    </div>
  );
}
