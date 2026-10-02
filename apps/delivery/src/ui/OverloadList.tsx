import { capacityPercentSteps, formatSteps } from '../application/figures';
import type { OverloadEntry } from '../application/overload';
import type { EmployeeId, ProjectId } from '../domain/ids';
import { formatMonth } from './format';
import styles from './OverloadList.module.css';

interface Props {
  readonly entries: readonly OverloadEntry[];
  readonly project: ProjectId;
  readonly nameOf: (employee: EmployeeId) => string;
  /** False while the grid is not on screen, so there is nothing to show the month in. */
  readonly canShow: boolean;
  readonly onShow: (entry: OverloadEntry) => void;
}

/** The person-months above capacity that involve this project, each with a way to find it in the grid. */
export function OverloadList({ entries, project, nameOf, canShow, onShow }: Props) {
  if (entries.length === 0) {
    return <p className={styles.none}>No one is over capacity on this project.</p>;
  }
  return (
    <details className={styles.list}>
      <summary>
        Over capacity ({entries.length} {entries.length === 1 ? 'person-month' : 'person-months'})
      </summary>
      <ul>
        {entries.map((entry) => {
          const [latest] = entry.contributions;
          const others = entry.contributions.filter((each) => each !== latest);
          return (
            <li key={`${entry.employeeId}|${entry.month}`}>
              <span>
                <strong>{nameOf(entry.employeeId)}</strong>, {formatMonth(entry.month)}:{' '}
                {formatSteps(capacityPercentSteps(entry.personMonths), 'capacityPercent')} % of
                capacity.
                {latest ? (
                  <>
                    {' '}
                    Edited last: {latest.project.name} › {latest.path}
                    {others.length > 0
                      ? `; also ${others
                          .map(
                            (each) =>
                              `${each.project.id === project ? '' : `${each.project.name} › `}${each.path}`,
                          )
                          .join('; ')}`
                      : ''}
                    .
                  </>
                ) : null}
              </span>
              <button
                type="button"
                aria-label={`Show ${nameOf(entry.employeeId)}, ${formatMonth(entry.month)} in the grid`}
                disabled={!canShow}
                onClick={() => {
                  onShow(entry);
                }}
              >
                Show
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
