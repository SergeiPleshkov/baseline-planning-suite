import type { DisplayCurrency } from '@baseline/host-contract';
import { useCallback, useMemo, useState } from 'react';
import { personMonthsFromEntry } from '../application/cellEntry';
import type { DeliveryStore } from '../application/deliveryStore';
import {
  buildGrid,
  byText,
  conversionFor,
  personKey,
  projectHorizon,
  REPORTING_YEAR,
  shiftHorizon,
  type Assignment,
  type GridCell,
  type Horizon,
  type PersonLine,
} from '../application/gridView';
import type { StaffStore } from '../application/staffStore';
import { expandPathTo, leafOptions } from '../application/treeView';
import type { BreakdownItemId, EmployeeId } from '../domain/ids';
import type { Plan, Project } from '../domain/plan';
import { DISPLAY_UNITS, isPlainUnit, type DisplayUnit } from '../domain/units';
import { AssignDialog } from './AssignDialog';
import { formatMonthShort } from './format';
import { StaffingGrid } from './StaffingGrid';
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

const rangeLabel = ({ first, last }: Horizon): string =>
  `${formatMonthShort(first)} – ${formatMonthShort(last)}`;

const sameHorizon = (a: Horizon, b: Horizon): boolean => a.first === b.first && a.last === b.last;

export function StaffingScreen({ plan, project, store, staff, currency }: Props) {
  const people = useStaffView(staff);
  const [unit, setUnit] = useState<DisplayUnit>('personMonths');
  const [chosen, setChosen] = useState<Horizon | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<BreakdownItemId>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [assigned, setAssigned] = useState<readonly Assignment[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const ownSpan = useMemo(() => projectHorizon(project), [project]);
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
      unit,
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
    setReveal(personKey(item, employee));
  };

  const revealed = useCallback(() => {
    setReveal(null);
  }, []);

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
  const waitingForPeople = people.status === 'loading' && !isPlainUnit(unit);

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

      <div className={styles.toolbar}>
        <fieldset className={styles.units}>
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
          collapsed={collapsed}
          onToggle={toggle}
          onEdit={edit}
          reveal={reveal}
          onRevealed={revealed}
        />
      )}
      <p className={styles.legend}>
        Enter or F2 edits a person’s cell, a digit starts a new figure, Delete clears it; Enter
        saves and moves down, Tab moves along, Escape drops the text. Figures are rounded together,
        so every total is the sum of the figures it covers. Shaded months are outside the project.
      </p>

      {assigning && known !== null ? (
        <AssignDialog
          leaves={leafOptions(plan, project.id)}
          people={[...known.staff.values()]
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => byText(a.name, b.name))}
          onSubmit={assignPerson}
          onClose={() => {
            setAssigning(false);
          }}
        />
      ) : null}
    </div>
  );
}
