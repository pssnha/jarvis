import type { Circle } from '../lib/types';

/** Page heading that names the active circle — "Vacations — Passanha Family".
 *  When the user belongs to more than one circle the name is a dropdown to
 *  switch; otherwise it's plain text. */
export function CircleTitle({
  label,
  circles,
  circleId,
  onChange,
}: {
  label: string;
  circles: Circle[];
  circleId: string | null;
  onChange: (id: string) => void;
}) {
  const circle = circles.find((c) => c.id === circleId) ?? null;
  return (
    <h2 className="page-title">
      {label}
      {circle && <span className="page-title-sep">—</span>}
      {circle &&
        (circles.length > 1 ? (
          <select
            className="title-circle"
            value={circle.id}
            onChange={(e) => onChange(e.target.value)}
          >
            {circles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="title-circle-name">{circle.name}</span>
        ))}
    </h2>
  );
}
