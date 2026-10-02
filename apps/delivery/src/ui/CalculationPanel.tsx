import type { DisplayCurrency } from '@baseline/host-contract';
import { useId } from 'react';
import type { CalculationError, CellCalculation } from '../application/calculation';
import { formatSteps } from '../application/figures';
import type { Result } from '../domain/result';
import { formatDay, formatDecimal, formatEuroRate, formatMonth } from './format';
import styles from './CalculationPanel.module.css';

interface Props {
  /** `null` while no person's cell has the focus. */
  readonly calculation: Result<CellCalculation, CalculationError> | null;
  readonly currency: DisplayCurrency;
}

const REASONS: Record<CalculationError, string> = {
  'people-unavailable': 'This needs the People register, which cannot be read now.',
  'rates-unavailable': 'This needs the rate history from People, which cannot be read now.',
  'unknown-person': 'The People register has no record of this person.',
};

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? '' : 's'}`;

/**
 * How the figures of the person's cell that has the focus are worked out, laid out as figure 4 of
 * the case study does: the month split by rate, hours and cost per slice, the blended rate, and
 * what else makes up the person's load in that month.
 */
export function CalculationPanel({ calculation, currency }: Props) {
  const titleId = useId();

  if (calculation === null) {
    return (
      <p className={styles.hint}>
        Focus a person’s cell to see how its hours and cost are worked out.
      </p>
    );
  }
  if (!calculation.ok) {
    return (
      <p role="status" className={styles.hint}>
        {REASONS[calculation.error]}
      </p>
    );
  }

  const figure = calculation.value;
  const { employee, month, allocation, slices, load } = figure;
  const money = (steps: number | null) => (steps === null ? '–' : formatSteps(steps, 'cost'));
  const hours = (steps: number | null) => (steps === null ? '–' : formatSteps(steps, 'hours'));

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        Calculation: {employee.name}, {formatMonth(month)}
      </h3>

      <dl className={styles.facts}>
        <dt>Working days</dt>
        <dd>{figure.workingDays}</dd>
        <dt>One person-month</dt>
        <dd>
          {formatDecimal(figure.hoursPerPersonMonth)} h ({employee.weeklyHours} h a week ×{' '}
          {figure.workingDays} days ÷ 5)
        </dd>
        {allocation ? (
          <>
            <dt>Allocated</dt>
            <dd>
              {formatDecimal(allocation.personMonths, 2)} person-months ={' '}
              {formatSteps(allocation.capacityPercentSteps, 'capacityPercent')} % of capacity
            </dd>
            <dt>Hours a working day</dt>
            <dd>{formatDecimal(allocation.hoursPerWorkingDay)} h</dd>
          </>
        ) : (
          <>
            <dt>Allocated</dt>
            <dd>nothing in this cell</dd>
          </>
        )}
        <dt>Blended rate</dt>
        <dd>
          {formatEuroRate(figure.blendedRateEur, 4)} an hour, the average over the working days
          {figure.unpricedWorkingDays > 0
            ? `, ${plural(figure.unpricedWorkingDays, 'day')} without a rate counting as zero`
            : ''}
        </dd>
      </dl>

      <table className={styles.table}>
        <caption>The month split by rate</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Working days</th>
            <th scope="col">Rate (EUR/h)</th>
            <th scope="col">Hours</th>
            <th scope="col">Cost ({currency.code})</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.firstDay}>
              <th scope="row">
                {formatDay(slice.firstDay)} – {formatDay(slice.lastDay)}
              </th>
              <td>{slice.workingDays}</td>
              <td>
                {slice.hourlyRateEur === null ? 'no rate' : formatEuroRate(slice.hourlyRateEur)}
              </td>
              <td>{hours(slice.hoursSteps)}</td>
              <td>{money(slice.costSteps)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{figure.workingDays}</td>
            <td />
            <td>{hours(allocation?.totalHoursSteps ?? null)}</td>
            <td>{money(allocation?.totalCostSteps ?? null)}</td>
          </tr>
        </tfoot>
      </table>

      {load.contributions.length > 0 ? (
        <table className={styles.table}>
          <caption>
            Load in {formatMonth(month)}, all projects
            {load.over ? ' — over capacity' : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">Project and work item</th>
              <th scope="col">Edit order</th>
              <th scope="col">Person-months</th>
            </tr>
          </thead>
          <tbody>
            {load.contributions.map((each) => (
              <tr
                key={each.allocation.id}
                className={load.over && each.isLatestEdit ? styles.blamed : undefined}
              >
                <th scope="row">
                  {each.project.name} › {each.path}
                  {load.over && each.isLatestEdit ? ' †' : ''}
                </th>
                <td>#{each.allocation.revision}</td>
                <td>{formatSteps(each.personMonthsSteps, 'personMonths')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td />
              <td>
                {formatSteps(load.totalPersonMonthsSteps, 'personMonths')} (
                {formatSteps(load.totalCapacityPercentSteps, 'capacityPercent')} %)
              </td>
            </tr>
          </tfoot>
        </table>
      ) : null}
      {load.over ? (
        <p className={styles.note}>
          † marks the allocation edited last, which the over-allocation is blamed on. The data
          records neither who made an edit nor when, so edits are ordered by their sequence.
        </p>
      ) : null}
    </section>
  );
}
