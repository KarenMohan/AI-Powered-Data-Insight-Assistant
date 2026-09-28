import {
  BarChart3,
  ChevronRight,
  Lightbulb,
  LineChart,
  PieChart,
  ScatterChart,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import VisualizationChart from "../components/VisualizationChart";

const API_BASE = "http://127.0.0.1:8000";

const suggestionIcon = (type) => {
  if (type === "pie") return <PieChart size={18} />;
  if (type === "line") return <LineChart size={18} />;
  if (type === "scatter") return <ScatterChart size={18} />;
  return <BarChart3 size={18} />;
};

function DataVisualizationPage({
  datasetInfo,
  visualizationState,
  setVisualizationState,
}) {
  const {
    chartType,
    xColumn,
    yColumn,
    groupColumn,
    chartData,
    groups,
    error,
  } = visualizationState;

  const updateVisualization = (updates) => {
    setVisualizationState((previous) => ({ ...previous, ...updates }));
  };

  if (!datasetInfo) {
    return (
      <div className="visualization-page">
        <div className="visualization-empty-state">
          <BarChart3 size={42} />
          <h1>Data Visualization</h1>
          <p>Please upload a dataset first.</p>
        </div>
      </div>
    );
  }

  const numericColumns = datasetInfo.column_names.filter((column) => {
    const type = datasetInfo.data_types?.[column] || "";
    return type.includes("int") || type.includes("float");
  });

  const visualizationOverview = datasetInfo.visualization_overview || {};
  const chartSuggestions = visualizationOverview.suggestions || [];
  const autoCharts = visualizationOverview.auto_charts || [];

  const changeChartType = (newChartType) => {
    updateVisualization({
      chartType: newChartType,
      xColumn: "",
      yColumn: "",
      groupColumn: "",
      chartData: [],
      groups: [],
      error: "",
    });
  };

  const fetchVisualization = async () => {
    if (!xColumn) {
      updateVisualization({ error: "Please select an X-axis column." });
      return;
    }

    let url =
      `${API_BASE}/visualization?chart_type=${chartType}` +
      `&x_column=${encodeURIComponent(xColumn)}`;

    if (yColumn) url += `&y_column=${encodeURIComponent(yColumn)}`;
    if (groupColumn) {
      url += `&group_column=${encodeURIComponent(groupColumn)}`;
    }

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        updateVisualization({
          error: data.detail || "Could not generate chart.",
        });
        return;
      }

      updateVisualization({
        chartData: data.data || [],
        groups: data.groups || [],
        error: "",
      });
    } catch (requestError) {
      console.error(requestError);
      updateVisualization({ error: "Could not connect to the backend." });
    }
  };

  return (
    <div className="visualization-page">
      <div className="visualization-heading">
        <div>
          <span className="visualization-eyebrow">Visual analytics</span>
          <h1>Data Visualization</h1>
          <p>Explore useful patterns automatically, then build your own chart.</p>
        </div>

        <div className="visualization-dataset-badge">
          <Sparkles size={15} />
          {datasetInfo.filename}
        </div>
      </div>

      <section className="chart-suggestions-panel">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker">Recommended</span>
            <h2>Suitable charts for this dataset</h2>
            <p>Recommendations selected from the actual columns and values.</p>
          </div>
          <Lightbulb size={24} />
        </div>

        {chartSuggestions.length ? (
          <div className="chart-suggestion-grid">
            {chartSuggestions.map((suggestion, index) => (
              <div
                className="chart-suggestion-item"
                key={`${suggestion.label}-${index}`}
              >
                <span className="chart-suggestion-icon">
                  {suggestionIcon(suggestion.chart_type)}
                </span>

                <div className="chart-suggestion-copy">
                  <strong>{suggestion.label}</strong>
                  <p>{suggestion.reason}</p>
                </div>

                <ChevronRight className="chart-suggestion-arrow" size={17} />
              </div>
            ))}
          </div>
        ) : (
          <div className="visualization-inline-note">
            Re-upload the dataset once after updating the backend to generate
            recommendations instantly.
          </div>
        )}
      </section>

      <section className="auto-chart-section">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker">Auto insights</span>
            <h2>Key visualizations</h2>
            
          </div>
          <WandSparkles size={24} />
        </div>

        {autoCharts.length ? (
          <div className="auto-chart-grid">
            {autoCharts.map((chart, index) => (
              <article className="auto-chart-card" key={`${chart.title}-${index}`}>
                <div className="auto-chart-card-header">
                  <span className="auto-chart-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <div>
                    <h3>{chart.title}</h3>
                    <p>{chart.subtitle}</p>
                  </div>
                </div>

                <div className="auto-chart-graphic">
                  <VisualizationChart
                    chartType={chart.chart_type}
                    data={chart.data}
                    groups={chart.groups}
                    xColumn={chart.x_column}
                    yColumn={chart.y_column}
                    compact
                  />
                </div>

                <div className="auto-chart-insight">
                  <Sparkles size={16} />
                  <p>{chart.insight}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="visualization-inline-note">
            Automatic charts will appear here immediately after the dataset is
            uploaded with the updated backend.
          </div>
        )}
      </section>

      <section className="custom-chart-section">
        <div className="section-heading-row custom-chart-heading">
          <div>
            <span className="section-kicker">Create your own</span>
            <h2>Build a visualization</h2>
            <p>Choose a chart type and columns to analyse manually.</p>
          </div>
          <BarChart3 size={24} />
        </div>

        <div className="chart-controls">
          <div className="control-group">
            <label>Chart Type</label>
            <select
              value={chartType}
              onChange={(event) => changeChartType(event.target.value)}
            >
              <option value="bar">Bar Chart</option>
              <option value="horizontal-bar">Horizontal Bar Chart</option>
              <option value="stacked-horizontal-bar">
                Horizontal Stacked Bar Chart
              </option>
              <option value="line">Line Chart</option>
              <option value="pie">Pie Chart</option>
              <option value="scatter">Scatter Plot</option>
              <option value="histogram">Histogram</option>
            </select>
          </div>

          <div className="control-group">
            <label>
              {chartType === "histogram" ? "Numeric Column" : "X-axis / Category"}
            </label>
            <select
              value={xColumn}
              onChange={(event) =>
                updateVisualization({ xColumn: event.target.value })
              }
            >
              <option value="">Select column</option>
              {(chartType === "histogram"
                ? numericColumns
                : datasetInfo.column_names
              ).map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </div>

          {chartType !== "histogram" && (
            <div className="control-group">
              <label>Y-axis / Value</label>
              <select
                value={yColumn}
                onChange={(event) =>
                  updateVisualization({ yColumn: event.target.value })
                }
              >
                <option value="">Count rows</option>
                {numericColumns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </div>
          )}

          {chartType === "stacked-horizontal-bar" && (
            <div className="control-group">
              <label>Group By</label>
              <select
                value={groupColumn}
                onChange={(event) =>
                  updateVisualization({ groupColumn: event.target.value })
                }
              >
                <option value="">Select group column</option>
                {datasetInfo.column_names.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button className="generate-chart-button" onClick={fetchVisualization}>
            <WandSparkles size={17} />
            Generate Chart
          </button>
        </div>

        {error && <p className="chart-error">{error}</p>}

        <div className="chart-container">
          <VisualizationChart
            chartType={chartType}
            data={chartData}
            groups={groups}
            xColumn={xColumn}
            yColumn={yColumn}
          />
        </div>
      </section>
    </div>
  );
}

export default DataVisualizationPage;
