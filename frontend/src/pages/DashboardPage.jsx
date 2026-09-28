import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Columns3,
  Copy,
  FileText,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

function DashboardPage({ datasetInfo, datasetSummary, summaryLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [normalRows, setNormalRows] = useState(datasetInfo?.preview || []);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  const [loadingMoreRows, setLoadingMoreRows] = useState(false);
  const tableContainerRef = useRef(null);

  useEffect(() => {
    setSearchTerm("");
    setSearchResult(null);
    setSearchError("");
    setNormalRows(datasetInfo?.preview || []);
    setHasMoreRows(false);

    if (!datasetInfo) return undefined;

    const controller = new AbortController();

    const loadInitialRows = async () => {
      try {
        const response = await fetch(
          "http://127.0.0.1:8000/rows?offset=0&limit=100",
          { signal: controller.signal }
        );

        if (!response.ok) return;

        const data = await response.json();
        setNormalRows(data.rows || []);
        setHasMoreRows(Boolean(data.has_more));
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Could not load dashboard rows:", error);
        }
      }
    };

    loadInitialRows();

    return () => controller.abort();
  }, [datasetInfo?.filename]);

  useEffect(() => {
    if (!datasetInfo) return undefined;

    const query = searchTerm.trim();

    if (!query) {
      setSearchResult(null);
      setSearchError("");
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError("");

      try {
        const response = await fetch(
          `http://127.0.0.1:8000/search?query=${encodeURIComponent(query)}&limit=100`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.detail || "Could not search the dataset.");
        }

        const data = await response.json();
        setSearchResult(data);
      } catch (error) {
        if (error.name !== "AbortError") {
          setSearchResult(null);
          setSearchError(error.message || "Could not search the dataset.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, datasetInfo]);

  if (!datasetInfo) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-empty-state">
          <FileText size={42} />
          <h1>Dashboard</h1>
          <p>Please upload a dataset first.</p>
        </div>
      </div>
    );
  }

  const preview = datasetInfo.preview || [];
  const columns = datasetInfo.column_names || [];

  const displayRows = searchResult ? searchResult.rows || [] : normalRows;
  const displayColumns =
    searchResult?.matched_columns?.length > 0
      ? searchResult.matched_columns
      : columns;

  const clearSearch = () => {
    setSearchTerm("");
    setSearchResult(null);
    setSearchError("");
  };

  const getPreviewMessage = () => {
    if (searching) {
      return "Searching the full dataset...";
    }

    if (searchError) {
      return searchError;
    }

    if (searchResult) {
      if (searchResult.matched_columns?.length > 0) {
        return `Column match: ${searchResult.matched_columns.join(", ")}. Showing ${displayRows.length} rows.`;
      }

      if (searchResult.total_matches === 0) {
        return `No rows found for "${searchTerm.trim()}".`;
      }

      const shown = displayRows.length;
      return `Found ${searchResult.total_matches.toLocaleString()} matching rows. Showing ${shown.toLocaleString()}.`;
    }

    return `Showing 10 rows at a time. Scroll down to continue through all ${Number(datasetInfo.rows || 0).toLocaleString()} rows, or scroll sideways to view more columns.`;
  };

  const loadMoreRows = async () => {
    if (
      searchTerm.trim()
      || loadingMoreRows
      || !hasMoreRows
      || !datasetInfo
    ) {
      return;
    }

    setLoadingMoreRows(true);

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/rows?offset=${normalRows.length}&limit=100`
      );

      if (!response.ok) {
        throw new Error("Could not load more rows.");
      }

      const data = await response.json();

      setNormalRows((previous) => [
        ...previous,
        ...(data.rows || []),
      ]);

      setHasMoreRows(Boolean(data.has_more));
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingMoreRows(false);
    }
  };

  const handleTableScroll = (event) => {
    if (searchTerm.trim()) return;

    const element = event.currentTarget;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distanceFromBottom < 140) {
      loadMoreRows();
    }
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">Dataset workspace</span>
          <h1>Dashboard</h1>
          <p>Quick overview, quality signals and a searchable data preview.</p>
        </div>

        <div className="dashboard-ready">
          <span className="dashboard-ready-dot" />
          Dataset ready
        </div>
      </div>

      <div className="summary-cards">
        <div className="summary-card file-summary-card">
          <div className="summary-card-heading">
            <span className="summary-icon summary-icon-purple">
              <FileText size={19} />
            </span>
            <h3>File Name</h3>
          </div>
          <p className="summary-filename" title={datasetInfo.filename}>
            {datasetInfo.filename}
          </p>
        </div>

        <div className="summary-card rows-summary-card">
          <div className="summary-card-heading">
            <span className="summary-icon summary-icon-blue">
              <Rows3 size={19} />
            </span>
            <h3>Rows</h3>
          </div>
          <p>{Number(datasetInfo.rows || 0).toLocaleString()}</p>
        </div>

        <div className="summary-card columns-summary-card">
          <div className="summary-card-heading">
            <span className="summary-icon summary-icon-cyan">
              <Columns3 size={19} />
            </span>
            <h3>Columns</h3>
          </div>
          <p>{Number(datasetInfo.columns || 0).toLocaleString()}</p>
        </div>

        <div className="summary-card duplicates-summary-card">
          <div className="summary-card-heading">
            <span className="summary-icon summary-icon-amber">
              <Copy size={19} />
            </span>
            <h3>Duplicates</h3>
          </div>
          <p>{Number(datasetInfo.duplicate_rows || 0).toLocaleString()}</p>
        </div>

        <div className="summary-card missing-summary-card">
          <div className="summary-card-heading">
            <span className="summary-icon summary-icon-rose">
              <CircleAlert size={19} />
            </span>
            <h3>Missing Values</h3>
          </div>
          <p>{Number(datasetInfo.missing_values || 0).toLocaleString()}</p>
        </div>
      </div>

      <section className="dataset-summary-card">
        <div className="dataset-summary-heading">
          <span className="dataset-summary-badge">Insight</span>
          <h2>Dataset Summary</h2>
        </div>

        <div
          className={
            summaryLoading
              ? "dataset-summary-text streaming"
              : "dataset-summary-text"
          }
        >
          <ReactMarkdown>
            {datasetSummary ||
              (summaryLoading
                ? "Analysing the dataset..."
                : "Summary could not be generated for this dataset.")}
          </ReactMarkdown>
        </div>
      </section>

      <section className="preview-section">
        <div className="preview-toolbar">
          <div>
            <h2>Dataset Preview</h2>
            <p className={searchError ? "preview-message preview-message-error" : "preview-message"}>
              {getPreviewMessage()}
            </p>
          </div>

          <div className="dataset-search">
            <Search size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search any column or value..."
              aria-label="Search dataset"
            />

            {searchTerm && (
              <button
                type="button"
                className="dataset-search-clear"
                onClick={clearSearch}
                aria-label="Clear dataset search"
                title="Clear search"
              >
                <X size={17} />
              </button>
            )}
          </div>
        </div>

        {displayRows.length === 0 ? (
          <div className="dashboard-no-results">
            <Search size={30} />
            <p>
              {searchTerm.trim()
                ? "No matching data to display."
                : "No preview data available."}
            </p>
          </div>
        ) : (
          <div
            ref={tableContainerRef}
            className="dashboard-table-container"
            onScroll={handleTableScroll}
          >
            <table className="dashboard-preview-table">
              <thead>
                <tr>
                  {displayColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {displayRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {displayColumns.map((column) => (
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

            {!searchTerm.trim() && loadingMoreRows && (
              <div className="dashboard-loading-more">
                Loading more rows...
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default DashboardPage;
