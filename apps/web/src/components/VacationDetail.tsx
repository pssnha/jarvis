import { useCallback, useEffect, useState } from 'react';
import { getVacation } from '../lib/api';
import type { ItineraryItem, VacationDetail as VacationDetailT, VacationItemType } from '../lib/types';
import { HOUR_PX, hourLabel, layoutColumns, minutesOf } from '../lib/timegrid';
import { VacationItemModal } from './VacationItemModal';
import { VacationModal } from './VacationModal';

// Default itinerary timeline window: 7:00 AM → 9:00 PM. The grid expands beyond
// this when a day has events that start earlier or end later (see hoursWin below).
const DAY_START = 7;
const DAY_END = 21;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_COLOR: Record<VacationItemType, string> = {
  flight: '#2563eb',
  hotel: '#7c3aed',
  activity: '#16a34a',
  transport: '#0d9488',
  meal: '#d97706',
  note: '#64748b',
};
const TYPE_ICON: Record<VacationItemType, string> = {
  flight: '✈️',
  hotel: '🏨',
  activity: '🎟',
  transport: '🚗',
  meal: '🍽',
  note: '📝',
};

function color(i: ItineraryItem): string {
  return i.color || TYPE_COLOR[i.type] || '#64748b';
}
function textOn(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#fff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}
function tabLabel(dateKey: string): { dow: string; d: number; mon: string } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return { dow: DOW[dt.getUTCDay()]!, d: d!, mon: MON[m! - 1]! };
}

interface Props {
  circleId: string;
  vacationId: string;
  onBack: () => void;
}

export function VacationDetail({ circleId, vacationId, onBack }: Props) {
  const [v, setV] = useState<VacationDetailT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [editTrip, setEditTrip] = useState(false);
  const [itemModal, setItemModal] = useState<{
    dateKey: string;
    existing?: ItineraryItem;
    initialType?: VacationItemType;
  } | null>(null);

  const load = useCallback(() => {
    getVacation(circleId, vacationId)
      .then((d) => {
        setV(d);
        setActiveDay((cur) => Math.min(cur, Math.max(0, d.itinerary.length - 1)));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [circleId, vacationId]);

  useEffect(() => load(), [load]);

  // Refetch the itinerary when the chat assistant reports a change.
  useEffect(() => {
    const h = () => load();
    window.addEventListener('jarvis:refresh', h);
    return () => window.removeEventListener('jarvis:refresh', h);
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!v) return <p className="empty">Loading…</p>;

  const day = v.itinerary[activeDay];
  const dayKey = day?.dateKey ?? '';

  // Items for the active day: timed (non-hotel) on the timeline; all-day +
  // spanning hotels in the all-day strip.
  const dayItems = day?.items ?? [];
  const timed = dayItems.filter((i) => !i.allDay && i.type !== 'hotel');
  const allDayItems = dayItems.filter((i) => i.allDay && i.type !== 'hotel');
  const hotelsToday = v.hotels
    .map((h) => {
      const startKey = h.startLocal.slice(0, 10);
      const endKey = (h.endLocal ?? h.startLocal).slice(0, 10);
      if (dayKey < startKey || dayKey > endKey) return null;
      const label =
        dayKey === startKey
          ? `Check-in${h.timeLabel !== 'all day' ? ` ${h.timeLabel}` : ''}`
          : dayKey === endKey
            ? 'Check-out'
            : 'Staying';
      return { h, label, faded: dayKey !== startKey };
    })
    .filter((x): x is { h: ItineraryItem; label: string; faded: boolean } => x !== null);

  const blocks = layoutColumns(
    timed.map((i) => {
      const s = minutesOf(i.startLocal);
      let e = i.endLocal ? minutesOf(i.endLocal) : s + 60;
      if (e <= s) e = s + 60;
      return { o: i, startMin: s, endMin: Math.min(e, 1440) };
    }),
  );

  // Expand the timeline window to fit any events outside the default hours, so a
  // late dinner or early flight is never clipped.
  const dayStartH = blocks.reduce((m, b) => Math.min(m, Math.floor(b.startMin / 60)), DAY_START);
  const dayEndH = blocks.reduce((m, b) => Math.max(m, Math.ceil(b.endMin / 60) - 1), DAY_END);
  const hoursWin = Array.from({ length: dayEndH - dayStartH + 1 }, (_, i) => dayStartH + i);
  const gridPx = hoursWin.length * HOUR_PX;

  const cities = (v.destinations ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const travelers = v.travelers.filter((t) => t.name);

  return (
    <div className="vac-detail">
      <div className="vac-detail-head">
        <button className="link" onClick={onBack}>
          ‹ All trips
        </button>
        <div className="vac-detail-title">
          <h2>{v.title}</h2>
          <div className="muted">
            {v.dateRangeLabel} · {v.timezone}
          </div>
        </div>
        <button onClick={() => setEditTrip(true)}>Edit trip</button>
      </div>

      <div className="vac-summary">
        <div className="vac-sum-section">
          <h3>🧑‍🤝‍🧑 Travelers</h3>
          {travelers.length > 0 ? (
            <div className="vac-chips">
              {travelers.map((t) => (
                <span key={t.id} className="chip cat-appointment">
                  {t.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="vac-sum-meta">No travelers added.</p>
          )}
        </div>

        <div className="vac-sum-section">
          <h3>📍 Cities</h3>
          {cities.length > 0 ? (
            <div className="vac-chips">
              {cities.map((c) => (
                <span key={c} className="chip cat-vacation">
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <p className="vac-sum-meta">No cities set.</p>
          )}
        </div>
      </div>

      <div className="vac-summary">
        <div className="vac-sum-section">
          <div className="vac-sum-head">
            <h3>✈️ Flights</h3>
            <button
              className="btn-quiet sm"
              onClick={() =>
                setItemModal({ dateKey: dayKey || v.startDateLocal, initialType: 'flight' })
              }
            >
              + Flight
            </button>
          </div>
          {v.flights.length === 0 ? (
            <p className="conn-sub">No flights yet.</p>
          ) : (
            v.flights.map((it) => (
              <button
                key={it.id}
                className="vac-sum-row"
                onClick={() => setItemModal({ dateKey: it.startLocal.slice(0, 10), existing: it })}
              >
                <span className="vac-sum-main">
                  {it.provider ? `${it.provider} ` : ''}
                  {it.number ?? it.title}
                  {it.fromLabel && it.toLabel ? ` · ${it.fromLabel} → ${it.toLabel}` : ''}
                </span>
                <span className="vac-sum-meta">
                  {it.departLabel && it.arriveLabel
                    ? `${it.departLabel} → ${it.arriveLabel}`
                    : it.timeLabel}
                  {it.seat ? ` · seat ${it.seat}` : ''}
                  {it.confirmation ? ` · ${it.confirmation}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="vac-sum-section">
          <div className="vac-sum-head">
            <h3>🏨 Hotels</h3>
            <button
              className="btn-quiet sm"
              onClick={() =>
                setItemModal({ dateKey: dayKey || v.startDateLocal, initialType: 'hotel' })
              }
            >
              + Hotel
            </button>
          </div>
          {v.hotels.length === 0 ? (
            <p className="conn-sub">No hotels yet.</p>
          ) : (
            v.hotels.map((it) => (
              <button
                key={it.id}
                className="vac-sum-row"
                onClick={() => setItemModal({ dateKey: it.startLocal.slice(0, 10), existing: it })}
              >
                <span className="vac-sum-main">{it.title}</span>
                <span className="vac-sum-meta">
                  {it.startLocal.slice(0, 10)} → {(it.endLocal ?? it.startLocal).slice(0, 10)}
                  {it.seat ? ` · room ${it.seat}` : ''}
                  {it.confirmation ? ` · ${it.confirmation}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="vac-daytabs">
        {v.itinerary.map((d, i) => {
          const l = tabLabel(d.dateKey);
          return (
            <button
              key={d.dateKey}
              className={i === activeDay ? 'vac-daytab on' : 'vac-daytab'}
              onClick={() => setActiveDay(i)}
            >
              <span className="vd-dow">{l.dow}</span>
              <span className="vd-num">{l.d}</span>
              <span className="vd-mon">{l.mon}</span>
            </button>
          );
        })}
      </div>

      <div className="vac-day-actions">
        <button className="primary" onClick={() => setItemModal({ dateKey: dayKey })}>
          + Add item
        </button>
      </div>

      <div className="tg tg-single">
        <div className="tg-scroll">
          <div className="tg-topstick">
            <div className="tg-allday">
              <div className="tg-gutter-label">all-day</div>
              <div className="tg-allday-col" onClick={() => setItemModal({ dateKey: dayKey })}>
                {allDayItems.map((i) => {
                  const c = color(i);
                  return (
                    <button
                      key={i.id}
                      className="tg-allday-pill"
                      style={{ background: c, color: textOn(c) }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setItemModal({ dateKey: dayKey, existing: i });
                      }}
                    >
                      {TYPE_ICON[i.type]} {i.title}
                    </button>
                  );
                })}
                {hotelsToday.map(({ h, label, faded }) => {
                  const c = color(h);
                  return (
                    <button
                      key={`hotel-${h.id}`}
                      className={faded ? 'tg-allday-pill faded' : 'tg-allday-pill'}
                      style={{ background: c, color: textOn(c) }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setItemModal({ dateKey: h.startLocal.slice(0, 10), existing: h });
                      }}
                    >
                      🏨 {h.title} · {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="tg-body">
            <div className="tg-gutter" style={{ height: gridPx }}>
              {hoursWin.map((h) => (
                <div key={h} className="tg-hour" style={{ height: HOUR_PX }}>
                  <span>{hourLabel(h)}</span>
                </div>
              ))}
            </div>
            <div
              className="tg-col"
              style={{
                height: gridPx,
                backgroundImage: `repeating-linear-gradient(to bottom, #eef0f2 0, #eef0f2 1px, transparent 1px, transparent ${HOUR_PX}px)`,
              }}
              onClick={() => setItemModal({ dateKey: dayKey })}
            >
              {blocks.map((b, idx) => {
                const c = color(b.o);
                // Position relative to the window start; clamp into view.
                const rawTop = ((b.startMin - dayStartH * 60) / 60) * HOUR_PX;
                const top = Math.max(0, Math.min(rawTop, gridPx - 18));
                const rawH = Math.max(((b.endMin - b.startMin) / 60) * HOUR_PX - 2, 18);
                const height = Math.max(14, Math.min(rawH, gridPx - top));
                return (
                  <button
                    key={`${b.o.id}-${idx}`}
                    className="tg-event"
                    style={{
                      top,
                      height,
                      left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                      width: `calc(${100 / b.cols}% - 4px)`,
                      background: c,
                      color: textOn(c),
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setItemModal({ dateKey: dayKey, existing: b.o });
                    }}
                  >
                    <span className="tg-ev-title">
                      {TYPE_ICON[b.o.type]} {b.o.title}
                    </span>
                    <span className="tg-ev-time">
                      {b.o.departLabel && b.o.arriveLabel
                        ? `${b.o.departLabel} → ${b.o.arriveLabel}`
                        : `${b.o.timeLabel}${b.o.location ? ` · ${b.o.location}` : ''}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {itemModal && (
        <VacationItemModal
          circleId={circleId}
          vacationId={vacationId}
          initialDateKey={itemModal.dateKey}
          initialType={itemModal.initialType}
          existing={itemModal.existing}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null);
            load();
          }}
        />
      )}
      {editTrip && (
        <VacationModal
          circleId={circleId}
          circleTimezone={v.timezone}
          existing={v}
          onClose={() => setEditTrip(false)}
          onSaved={() => {
            setEditTrip(false);
            load();
          }}
          onDeleted={() => {
            setEditTrip(false);
            onBack();
          }}
        />
      )}
    </div>
  );
}
