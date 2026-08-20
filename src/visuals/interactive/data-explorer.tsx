import { useMemo, useState } from "react";
import { useStrings } from "../language-context";
import type { Interactive } from "@/lib/schema";
import { formatNumber } from "../chart";

type Explorer = Extract<Interactive, { kind: "dataset-explorer" }>;

export function DataExplorerView({ explorer }: { explorer: Explorer }) {
  const t = useStrings();
  const [sort, setSort] = useState(
    explorer.defaultSort ?? { columnId: explorer.columns[0].id, direction: "asc" as const },
  );
  const [query, setQuery] = useState("");

  const sortIndex = explorer.columns.findIndex((column) => column.id === sort.columnId);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(t.locale);
    const filtered = needle
      ? explorer.rows.filter((row) =>
          row.cells.some((cell) => String(cell).toLocaleLowerCase(t.locale).includes(needle)),
        )
      : explorer.rows;

    if (sortIndex < 0) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = a.cells[sortIndex];
      const right = b.cells[sortIndex];
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), t.locale) * direction;
    });
  }, [explorer.rows, query, sort, sortIndex, t.locale]);

  return (
    <section className="interactive explorer" aria-label={explorer.title}>
      <header className="interactive-head">
        <div>
          <span className="interactive-kind">{t.explorerKind}</span>
          <h4>{explorer.title}</h4>
          <p>{explorer.description}</p>
        </div>
        <input
          type="search"
          className="explorer-search"
          placeholder={t.filterPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t.filterAria}
        />
      </header>

      <div className="explorer-scroll">
        <table className="explorer-table">
          <thead>
            <tr>
              {explorer.columns.map((column) => {
                const isSorted = column.id === sort.columnId;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={column.type === "number" ? "is-number" : ""}
                    aria-sort={isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((previous) =>
                          previous.columnId === column.id
                            ? { columnId: column.id, direction: previous.direction === "asc" ? "desc" : "asc" }
                            : { columnId: column.id, direction: "asc" },
                        )
                      }
                    >
                      {column.label}
                      {column.unit ? <small> ({column.unit})</small> : null}
                      <i aria-hidden="true">{isSorted ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}</i>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={row.highlight ? "is-highlight" : ""}>
                {row.cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={explorer.columns[cellIndex]?.type === "number" ? "is-number" : ""}
                  >
                    {typeof cell === "number" ? formatNumber(cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={explorer.columns.length} className="explorer-empty">
                  {t.emptyRows}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="interactive-foot">
        <details className="evidence-note">
          <summary>
            {t.sourceLabel}
            {explorer.sourceRef.page ? ` · ${t.page(explorer.sourceRef.page)}` : ""}
          </summary>
          <blockquote>{explorer.sourceRef.excerpt}</blockquote>
        </details>
      </footer>
    </section>
  );
}
