import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Columns3,
  Copy,
  Download,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

const matchesSearch = (row, query) => {
  const value = query.trim().toLowerCase();
  if (!value) return true;

  return Object.values(row).some((cell) => {
    const text = Array.isArray(cell) ? cell.join(" ") : String(cell ?? "");
    return text.toLowerCase().includes(value);
  });
};

const escapeCsvValue = (value) => {
  const text = Array.isArray(value)
    ? value.join(" | ")
    : String(value ?? "");

  return `"${text.replace(/"/g, '""')}"`;
};

const exportRowsToCsv = (rows, columns, filename) => {
  const header = columns.map(escapeCsvValue).join(",");
  const body = rows
    .map((row) => columns.map((column) => escapeCsvValue(row[column])).join(","))
    .join("\n");

  const csv = body ? `${header}\n${body}` : `${header}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

function QualitySearch({ value, onChange, placeholder }) {
  return (
    <div className="quality-search">
      <Search size={16} />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />

      {value && (
        <button
          type="button"
          className="quality-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
          title="Clear search"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function ExportButton({ onClick, disabled = false }) {
  return (
    <button
      type="button"
      className="quality-export-button"
      onClick={onClick}
      disabled={disabled}
    >
      <Download size={16} />
      Export CSV
    </button>
  );
}

function DataQualityPage({ datasetInfo }) {
  const [missingSearch, setMissingSearch] = useState("");
  const [typeSearch, setTypeSearch] = useState("");
  const [inconsistentSearch, setInconsistentSearch] = useState("");
  const [duplicateSearch, setDuplicateSearch] = useState("");

  const [duplicateRows, setDuplicateRows] = useState([]);
  const [duplicateTotal, setDuplicateTotal] = useState(0);
  const [duplicateHasMore, setDuplicateHasMore] = useState(false);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");

  const missingByColumn = datasetInfo?.missing_by_column || {};
  const dataTypes = datasetInfo?.data_types || {};
  const inconsistentValues = datasetInfo?.inconsistent_values || [];
  const columnNames = datasetInfo?.column_names || [];

  const missingRows = useMemo(
    () =>
      columnNames.map((column) => ({
        column,
        missing_count: missingByColumn[column] || 0,
      })),
    [columnNames, missingByColumn]
  );

  const typeRows = useMemo(
    () =>
      columnNames.map((column) => ({
        column,
        data_type: dataTypes[column] || "",
      })),
    [columnNames, dataTypes]
  );

  const filteredMissingRows = useMemo(
    () => missingRows.filter((row) => matchesSearch(row, missingSearch)),
    [missingRows, missingSearch]
  );

  const filteredTypeRows = useMemo(
    () => typeRows.filter((row) => matchesSearch(row, typeSearch)),
    [typeRows, typeSearch]
  );

  const filteredInconsistentRows = useMemo(
    () =>
      inconsistentValues.filter((row) =>
        matchesSearch(
          {
            ...row,
            variants: row.variants || [],
          },
          inconsistentSearch
        )
      ),
    [inconsistentValues, inconsistentSearch]
  );

  useEffect(() => {
    setMissingSearch("");
    setTypeSearch("");
    setInconsistentSearch("");
    setDuplicateSearch("");
    setDuplicateRows([]);
    setDuplicateTotal(0);
    setDuplicateHasMore(false);
    setDuplicateError("");
  }, [datasetInfo?.filename]);

  useEffect(() => {
    if (!datasetInfo) return undefined;

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setDuplicateLoading(true);
      setDuplicateError("");

      try {
        const query = duplicateSearch.trim();
        const response = await fetch(
          `${API_BASE}/quality/duplicates?query=${encodeURIComponent(
            query
          )}&offset=0&limit=100`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(
            errorData?.detail || "Could not load exact duplicate rows."
          );
        }

        const data = await response.json();
        setDuplicateRows(data.rows || []);
        setDuplicateTotal(data.total_matches || 0);
        setDuplicateHasMore(Boolean(data.has_more));
      } catch (error) {
        if (error.name !== "AbortError") {
          setDuplicateRows([]);
          setDuplicateTotal(0);
          setDuplicateHasMore(false);
          setDuplicateError(
            error.message || "Could not load exact duplicate rows."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setDuplicateLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [duplicateSearch, datasetInfo?.filename]);

  const loadMoreDuplicates = async () => {
    if (
      !datasetInfo ||
      duplicateLoading ||
      !duplicateHasMore
    ) {
      return;
    }

    setDuplicateLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/quality/duplicates?query=${encodeURIComponent(
          duplicateSearch.trim()
        )}&offset=${duplicateRows.length}&limit=100`
      );

      if (!response.ok) {
        throw new Error("Could not load more duplicate rows.");
      }

      const data = await response.json();

      setDuplicateRows((previous) => [
        ...previous,
        ...(data.rows || []),
      ]);
      setDuplicateTotal(data.total_matches || 0);
      setDuplicateHasMore(Boolean(data.has_more));
    } catch (error) {
      setDuplicateError(
        error.message || "Could not load more duplicate rows."
      );
    } finally {
      setDuplicateLoading(false);
    }
  };

  const handleDuplicateScroll = (event) => {
    const element = event.currentTarget;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distanceFromBottom < 120) {
      loadMoreDuplicates();
    }
  };

  const exportDuplicateRows = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/quality/duplicates/export?query=${encodeURIComponent(
          duplicateSearch.trim()
        )}`
      );

      if (!response.ok) {
        throw new Error("Could not export duplicate rows.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = duplicateSearch.trim()
        ? "exact_duplicates_filtered.csv"
        : "exact_duplicates.csv";

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setDuplicateError(error.message || "Could not export duplicate rows.");
    }
  };

  if (!datasetInfo) {
    return (
      <div className="data-quality-page">
        <div className="quality-empty-state">
          <ShieldCheck size={42} />
          <h1>Data Quality</h1>
          <p>Please upload a dataset first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="data-quality-page">
      <div className="quality-page-heading">
        <div>
          <span className="quality-eyebrow">Data health</span>
          <h1>Data Quality</h1>
          <p>
            Review completeness, structure, consistency and exact duplicates
            across the uploaded dataset.
          </p>
        </div>

        <div className="quality-ready">
          <span />
          Quality scan complete
        </div>
      </div>

      <div className="quality-summary">
        <div className="quality-card quality-card-missing">
          <div className="quality-card-icon">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3>Total Missing Values</h3>
            <p>{Number(datasetInfo.missing_values || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="quality-card quality-card-duplicates">
          <div className="quality-card-icon">
            <Copy size={20} />
          </div>
          <div>
            <h3>Duplicate Rows</h3>
            <p>{Number(datasetInfo.duplicate_rows || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="quality-card quality-card-columns">
          <div className="quality-card-icon">
            <Columns3 size={20} />
          </div>
          <div>
            <h3>Total Columns</h3>
            <p>{Number(datasetInfo.columns || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="quality-card quality-card-inconsistent">
          <div className="quality-card-icon">
            <Braces size={20} />
          </div>
          <div>
            <h3>Inconsistent Values</h3>
            <p>{Number(inconsistentValues.length).toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="quality-two-column-grid">
        <section className="quality-table-card quality-table-card-missing">
          <div className="quality-table-card-header">
            <div>
              <div className="quality-table-title-row">
                <AlertTriangle size={19} />
                <h2>Missing Values</h2>
              </div>
              <p>Missing values detected in each column.</p>
            </div>
          </div>

          <div className="quality-table-actions">
            <QualitySearch
              value={missingSearch}
              onChange={setMissingSearch}
              placeholder="Search columns..."
            />
            <ExportButton
              onClick={() =>
                exportRowsToCsv(
                  filteredMissingRows,
                  ["column", "missing_count"],
                  "missing_values.csv"
                )
              }
              disabled={filteredMissingRows.length === 0}
            />
          </div>

          <div className="quality-table-scroll quality-table-five">
            <table className="quality-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Missing Count</th>
                </tr>
              </thead>
              <tbody>
                {filteredMissingRows.length === 0 ? (
                  <tr>
                    <td colSpan="2" className="quality-empty-row">
                      No matching columns found.
                    </td>
                  </tr>
                ) : (
                  filteredMissingRows.map((row) => (
                    <tr key={row.column}>
                      <td>{row.column}</td>
                      <td>{Number(row.missing_count).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="quality-table-footer">
            {filteredMissingRows.length.toLocaleString()} result
            {filteredMissingRows.length === 1 ? "" : "s"}
          </div>
        </section>

        <section className="quality-table-card quality-table-card-types">
          <div className="quality-table-card-header">
            <div>
              <div className="quality-table-title-row">
                <Columns3 size={19} />
                <h2>Data Types</h2>
              </div>
              <p>Detected data type for every dataset column.</p>
            </div>
          </div>

          <div className="quality-table-actions">
            <QualitySearch
              value={typeSearch}
              onChange={setTypeSearch}
              placeholder="Search columns or types..."
            />
            <ExportButton
              onClick={() =>
                exportRowsToCsv(
                  filteredTypeRows,
                  ["column", "data_type"],
                  "data_types.csv"
                )
              }
              disabled={filteredTypeRows.length === 0}
            />
          </div>

          <div className="quality-table-scroll quality-table-five">
            <table className="quality-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Data Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredTypeRows.length === 0 ? (
                  <tr>
                    <td colSpan="2" className="quality-empty-row">
                      No matching columns or data types found.
                    </td>
                  </tr>
                ) : (
                  filteredTypeRows.map((row) => (
                    <tr key={row.column}>
                      <td>{row.column}</td>
                      <td>
                        <span className="quality-type-pill">
                          {row.data_type}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="quality-table-footer">
            {filteredTypeRows.length.toLocaleString()} result
            {filteredTypeRows.length === 1 ? "" : "s"}
          </div>
        </section>
      </div>

      <section className="quality-table-card quality-table-card-inconsistencies">
        <div className="quality-table-card-header quality-wide-header">
          <div>
            <div className="quality-table-title-row">
              <Braces size={19} />
              <h2>Inconsistent Values</h2>
            </div>
            <p>
              Possible inconsistencies caused by capitalization, spacing or
              formatting differences.
            </p>
          </div>
        </div>

        <div className="quality-table-actions">
          <QualitySearch
            value={inconsistentSearch}
            onChange={setInconsistentSearch}
            placeholder="Search inconsistencies..."
          />
          <ExportButton
            onClick={() =>
              exportRowsToCsv(
                filteredInconsistentRows.map((row) => ({
                  ...row,
                  variants: row.variants || [],
                })),
                [
                  "column",
                  "normalized_value",
                  "variants",
                  "variant_count",
                  "row_count",
                ],
                "inconsistent_values.csv"
              )
            }
            disabled={filteredInconsistentRows.length === 0}
          />
        </div>

        {inconsistentValues.length === 0 ? (
          <div className="quality-good">
            <ShieldCheck size={18} />
            No obvious inconsistent categorical values found.
          </div>
        ) : (
          <div className="quality-table-scroll quality-table-seven">
            <table className="quality-table quality-wide-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Normalized Value</th>
                  <th>Detected Variants</th>
                  <th>Variant Count</th>
                  <th>Rows Affected</th>
                </tr>
              </thead>
              <tbody>
                {filteredInconsistentRows.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="quality-empty-row">
                      No matching inconsistencies found.
                    </td>
                  </tr>
                ) : (
                  filteredInconsistentRows.map((item, index) => (
                    <tr key={`${item.column}-${item.normalized_value}-${index}`}>
                      <td>{item.column}</td>
                      <td>{item.normalized_value}</td>
                      <td>{(item.variants || []).join(", ")}</td>
                      <td>{item.variant_count}</td>
                      <td>{item.row_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="quality-table-footer">
          {filteredInconsistentRows.length.toLocaleString()} result
          {filteredInconsistentRows.length === 1 ? "" : "s"}
        </div>
      </section>

      <section className="quality-table-card quality-table-card-exact">
        <div className="quality-table-card-header quality-wide-header">
          <div>
            <div className="quality-table-title-row">
              <Copy size={19} />
              <h2>Exact Duplicates</h2>
            </div>
            <p>
              Duplicate records detected across the complete uploaded dataset.
            </p>
          </div>
        </div>

        <div className="quality-table-actions">
          <QualitySearch
            value={duplicateSearch}
            onChange={setDuplicateSearch}
            placeholder="Search duplicate rows..."
          />
          <ExportButton
            onClick={exportDuplicateRows}
            disabled={duplicateTotal === 0}
          />
        </div>

        {duplicateError && (
          <div className="quality-error">{duplicateError}</div>
        )}

        {!duplicateLoading && duplicateTotal === 0 ? (
          <div className="quality-good">
            <ShieldCheck size={18} />
            {duplicateSearch.trim()
              ? "No duplicate rows match this search."
              : "No exact duplicate rows found."}
          </div>
        ) : (
          <div
            className="quality-table-scroll quality-table-seven"
            onScroll={handleDuplicateScroll}
          >
            <table className="quality-table quality-wide-table">
              <thead>
                <tr>
                  {columnNames.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {duplicateRows.map((row, index) => (
                  <tr key={index}>
                    {columnNames.map((column) => (
                      <td key={column}>
                        {row[column] === "" ||
                        row[column] === null ||
                        row[column] === undefined
                          ? "—"
                          : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {duplicateLoading && (
              <div className="quality-loading-more">
                Loading duplicate rows...
              </div>
            )}
          </div>
        )}

        <div className="quality-table-footer">
          {duplicateTotal.toLocaleString()} matching duplicate record
          {duplicateTotal === 1 ? "" : "s"}
        </div>
      </section>
    </div>
  );
}

export default DataQualityPage;
