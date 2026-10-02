"use client";

import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { focusColorStyle, type FocusColorId } from "@/lib/focus-colors";
import { addDaysLocal, dayDate, dayKey, heatmap, type HeatCell } from "@/lib/work-log";

export type CalendarRange = "recent" | number;

export function rangeDates(range: CalendarRange, today: Date) {
  if (range === "recent") return { from: addDaysLocal(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()), 1), to: today };
  return { from: new Date(range, 0, 1), to: new Date(range, 11, 31) };
}

/**
 * Çalışma takvimi: GitHub'ın katkı tablosu gibi, her kare bir gün. Ton günlük
 * hedefe göre, renk okuyucunun seçtiği. Kareler klavyeyle geziliyor (oklar),
 * seçilen günün oturumları altta.
 */
export function WorkCalendar({
  totals,
  range,
  color,
  weekStart,
  goalMinutes,
  today,
  selected,
  onSelect,
}: {
  totals: ReadonlyMap<string, number>;
  range: CalendarRange;
  color: FocusColorId;
  weekStart: 0 | 1;
  goalMinutes: number;
  today: Date;
  selected?: string;
  onSelect: (day: string) => void;
}) {
  const { common, focus } = useT();
  const t = focus.calendar;
  const locale = common.locale;
  // Tarih ve gün adları arayüzün dilinde.
  const { dateFormat, weekdayFormat } = useMemo(
    () => ({
      dateFormat: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      weekdayFormat: new Intl.DateTimeFormat(locale, { weekday: "short" }),
    }),
    [locale],
  );
  const todayKey = dayKey(today);
  const { from, to } = useMemo(() => rangeDates(range, dayDate(todayKey)), [range, todayKey]);
  const map = useMemo(() => heatmap(totals, { from, to, today: dayDate(todayKey), weekStart, goalMinutes, locale }), [totals, from, to, todayKey, weekStart, goalMinutes, locale]);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Dar ekranda takvim kayıyor: en yeni haftalar görünsün, bir yıl önce değil.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [range]);
  const cells = map.weeks.flat().filter((cell): cell is HeatCell => cell !== null);
  const focusable = selected && cells.some((cell) => cell.day === selected) ? selected : cells.some((cell) => cell.day === todayKey) ? todayKey : cells[0]?.day;
  const rows = Array.from({ length: 7 }, (_, row) => weekdayFormat.format(addDaysLocal(new Date(2026, 0, 4), (weekStart + row) % 7)));

  const move = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -366, End: 366 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    let target = dayKey(addDaysLocal(dayDate(day), step));
    if (target < dayKey(from)) target = dayKey(from);
    const last = dayKey(to) < todayKey ? dayKey(to) : todayKey;
    if (target > last) target = last;
    onSelect(target);
    window.requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus());
  };

  return (
    <div className="work-calendar" style={focusColorStyle(color)}>
      <div className="work-calendar-scroll" ref={scroller}>
        <div className="work-calendar-grid" ref={grid} style={{ gridTemplateColumns: `2.4rem repeat(${map.weeks.length}, var(--cell))` }} role="group" aria-label={t.grid}>
          <span className="work-calendar-corner" aria-hidden="true" />
          {map.weeks.map((_, week) => {
            const month = map.months.find((item) => item.week === week);
            return <span key={`m${week}`} className="work-calendar-month" aria-hidden="true">{month?.label ?? ""}</span>;
          })}
          {rows.map((label, row) => (
            <FragmentRow key={label} label={label} shown={[1, 3, 5].includes((weekStart + row) % 7)}>
              {map.weeks.map((week, column) => {
                const cell = week[row];
                if (!cell) return <span key={`${column}-${row}`} className="work-cell is-empty" aria-hidden="true" />;
                const spoken = t.day(dateFormat.format(dayDate(cell.day)), cell.seconds ? focus.duration(cell.seconds) : undefined, cell.future);
                return (
                  <button
                    key={cell.day}
                    type="button"
                    data-day={cell.day}
                    className={`work-cell level-${cell.level}${cell.future ? " is-future" : ""}${cell.day === todayKey ? " is-today" : ""}`}
                    aria-label={spoken}
                    aria-pressed={selected === cell.day}
                    title={spoken}
                    tabIndex={cell.day === focusable ? 0 : -1}
                    disabled={cell.future}
                    onClick={() => onSelect(cell.day)}
                    onKeyDown={(event) => move(event, cell.day)}
                  />
                );
              })}
            </FragmentRow>
          ))}
        </div>
      </div>
      <div className="work-calendar-legend">
        <span>{t.total(focus.duration(map.total), map.activeDays)}</span>
        <span className="work-calendar-scale" aria-label={t.scale}>
          {t.less}
          {[0, 1, 2, 3, 4].map((level) => <i key={level} className={`work-cell level-${level}`} aria-hidden="true" />)}
          {t.goalMet}
        </span>
      </div>
    </div>
  );
}

/** Satırın başındaki gün adı; ızgarada satır satır akıyor. */
function FragmentRow({ label, shown, children }: { label: string; shown: boolean; children: ReactNode }) {
  return (
    <>
      <span className="work-calendar-day" aria-hidden="true">{shown ? label : ""}</span>
      {children}
    </>
  );
}
