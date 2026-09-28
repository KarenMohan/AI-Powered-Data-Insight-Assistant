import { useEffect, useRef, useState } from "react";
import { BarChart3, Bot, Database, List, Maximize2, MessageCircle, Minus, Send, Sparkles, User, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line, ScatterChart, Scatter } from "recharts";
// TEXT NORMALIZATION
const normalizeText = (value) => {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};
// CHECK NUMERIC DATA TYPE
const isNumericType = (dtype) => {
  const value = String(dtype || "")
    .toLowerCase();
  return (value.includes("int")
    || value.includes("float")
    || value.includes("double")
    || value.includes("number")
    || value.includes("decimal"));
};
// CHECK DATE-LIKE COLUMN
const isDateLikeColumn = (column, dtype) => {
  const name = normalizeText(column);
  const type = String(dtype || "")
    .toLowerCase();
  return (type.includes("date")
    || type.includes("time")
    || name.includes("date")
    || name.includes("month")
    || name.includes("year")
    || name.includes("time"));
};
// CHECK IF USER IS ASKING FOR A CHART
const isChartRequest = (text) => {
  const value = normalizeText(text);
  return (value.includes("chart")
    || value.includes("graph")
    || value.includes("plot")
    || value.includes("histogram")
    || value.includes("scatter"));
};
// CHECK IF USER WANTS EXISTING CHART EXPLAINED
const isChartExplanationRequest = (text) => {
  const value = normalizeText(text);

  const explicitlyMentionsChart = value.includes("chart")
    || value.includes("graph")
    || value.includes("plot")
    || value.includes("visualization")
    || value.includes("visualisation");

  const refersToCurrentVisual = value.includes("what does this show")
    || value.includes("what is this showing")
    || value.includes("explain this")
    || value.includes("interpret this")
    || value.includes("describe this");

  const explanationIntent = value.includes("explain")
    || value.includes("explanation")
    || value.includes("interpret")
    || value.includes("describe")
    || value.includes("summarize")
    || value.includes("summary")
    || value.includes("what does")
    || value.includes("tell me about");

  // Do not treat a normal dataset summary request as a request to explain
  // the most recent chart. "Summarize this dataset" must go to normal chat.
  return (explicitlyMentionsChart && explanationIntent)
    || refersToCurrentVisual;
};

const isDatasetSummaryRequest = (text) => {
  const value = normalizeText(text);

  const summaryIntent = value.includes("summarize")
    || value.includes("summary")
    || value.includes("overview")
    || value.includes("what is this dataset about")
    || value.includes("what is the dataset about");

  const datasetIntent = value.includes("dataset")
    || value.includes("data");

  return summaryIntent && datasetIntent;
};
// DETECT CHART TYPE
const detectChartType = (text) => {
  const value = normalizeText(text);
  if (value.includes("pie")) {
    return "pie";
  }
  if (value.includes("stacked")) {
    return "stacked-horizontal-bar";
  }
  if (value.includes("horizontal")
    && value.includes("bar")) {
    return "horizontal-bar";
  }
  if (value.includes("line")) {
    return "line";
  }
  if (value.includes("scatter")) {
    return "scatter";
  }
  if (value.includes("histogram")) {
    return "histogram";
  }
  return "bar";
};
// PIE / CHART COLOURS
const PIE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

const RADIAN = Math.PI / 180;

const QUICK_PROMPTS = [
  {
    label: "Summarize dataset",
    prompt: "Can you summarize this dataset?",
    icon: Sparkles,
  },
  {
    label: "Show column names",
    prompt: "What are the column names?",
    icon: List,
  },
  {
    label: "Create a chart",
    prompt: "Create a useful bar chart from this dataset.",
    icon: BarChart3,
  },
  {
    label: "Explore the data",
    prompt: "What useful insights can you find in this dataset?",
    icon: Database,
  },
];

const createPieLabelRenderer = (data, colors, radius, formatLabel) => {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  let currentAngle = 90;

  const points = data.map((item, index) => {
    const percent = total ? Number(item.value || 0) / total : 0;
    const sweep = percent * 360;
    const midAngle = currentAngle - sweep / 2;
    currentAngle -= sweep;

    return {
      index,
      side: Math.cos(-midAngle * RADIAN) >= 0 ? 1 : -1,
      rawY: Math.sin(-midAngle * RADIAN) * (radius + 38),
    };
  });

  const positions = new Map();

  [-1, 1].forEach((side) => {
    const items = points
      .filter((point) => point.side === side)
      .sort((a, b) => a.rawY - b.rawY);

    const gap = 25;
    const minY = -(radius + 65);
    const maxY = radius + 65;
    let previousY = minY - gap;

    items.forEach((item) => {
      item.y = Math.max(item.rawY, previousY + gap);
      previousY = item.y;
    });

    if (items.length && items[items.length - 1].y > maxY) {
      const overflow = items[items.length - 1].y - maxY;
      items.forEach((item) => {
        item.y -= overflow;
      });
    }

    for (let i = items.length - 2; i >= 0; i -= 1) {
      items[i].y = Math.min(items[i].y, items[i + 1].y - gap);
    }

    if (items.length && items[0].y < minY) {
      const shift = minY - items[0].y;
      items.forEach((item) => {
        item.y += shift;
      });
    }

    items.forEach((item) => positions.set(item.index, item));
  });

  return ({ cx, cy, midAngle, outerRadius, index, name, value, percent }) => {
    const position = positions.get(index);
    if (!position) return null;

    const side = position.side;
    const sliceX = cx + (outerRadius + 3) * Math.cos(-midAngle * RADIAN);
    const sliceY = cy + (outerRadius + 3) * Math.sin(-midAngle * RADIAN);
    const elbowX = cx + side * (outerRadius + 28);
    const endX = cx + side * (outerRadius + 78);
    const labelY = cy + position.y;
    const textX = endX + side * 7;
    const color = colors[index % colors.length];

    return (
      <g>
        <polyline
          points={`${sliceX},${sliceY} ${elbowX},${labelY} ${endX},${labelY}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
        <circle cx={endX} cy={labelY} r={3.5} fill={color} />
        <text
          x={textX}
          y={labelY}
          fill={color}
          textAnchor={side === 1 ? "start" : "end"}
          dominantBaseline="central"
          fontSize={14}
        >
          {formatLabel({ name, value, percent })}
        </text>
      </g>
    );
  };
};

// CHATBOT PAGE
function ChatbotPage({ datasetInfo, messages, setMessages, mode = "page", setActivePage }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [floatingMinimized, setFloatingMinimized] = useState(false);
  const bottomRef = useRef(null);
  // AUTO SCROLL
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading, mode, floatingOpen, floatingMinimized]);

  // GET DATASET COLUMNS
  const getColumns = () => {
    return (datasetInfo?.column_names
      || []);
  };
  // GET NUMERIC COLUMNS
  const getNumericColumns = () => {
    const columns = getColumns();
    const dataTypes = datasetInfo?.data_types
      || {};
    return columns.filter((column) => isNumericType(dataTypes[column]));
  };
  // GET CATEGORICAL COLUMNS
  const getCategoricalColumns = () => {
    const columns = getColumns();
    const numericColumns = getNumericColumns();
    return columns.filter((column) => !numericColumns.includes(column));
  };
  // FIND COLUMNS MENTIONED BY USER
  const getMentionedColumns = (userText) => {
    const normalizedQuestion = normalizeText(userText);
    return getColumns().filter((column) => {
      const normalizedColumn = normalizeText(column);
      return normalizedColumn && normalizedQuestion.includes(normalizedColumn);
    });
  };

  const getExcludedColumns = (userText) => {
    const value = normalizeText(userText);
    const phrases = ["other than", "except", "excluding", "exclude", "without", "not", "anything but"];

    return getColumns().filter((column) => {
      const name = normalizeText(column);
      return phrases.some((phrase) => value.includes(`${phrase} ${name}`));
    });
  };

  const wantsDifferentChart = (text) => {
    const value = normalizeText(text);
    return value.includes("another")
      || value.includes("different chart")
      || value.includes("different graph")
      || value.includes("different plot");
  };

  const isColumnListRequest = (text) => {
    const value = normalizeText(text);
    return value === "columns"
      || value === "column names"
      || value === "list columns"
      || value === "list the columns"
      || value.includes("show me the columns")
      || value.includes("show column names")
      || value.includes("show me the column names")
      || value.includes("what columns are")
      || value.includes("what are the columns")
      || value.includes("what are the column names");
  };

  const isFilenameRequest = (text) => {
    const value = normalizeText(text);
    return value === "dataset name"
      || value.includes("what is the dataset name")
      || value.includes("whats the dataset name")
      || value.includes("dataset file name")
      || value.includes("dataset filename")
      || value === "file name"
      || value === "filename"
      || value.includes("what is the file name")
      || value.includes("what is the filename")
      || value.includes("what file did i upload")
      || value.includes("which file did i upload")
      || value.includes("what csv is uploaded")
      || value.includes("uploaded file name");
  };

  const isSimpleGreeting = (text) => {
    const value = normalizeText(text);
    return ["hi", "hello", "hey", "hi there", "hello there", "hey there"].includes(value);
  };

  const isDatasetHelpOpening = (text) => {
    const value = normalizeText(text);
    const mentionsDataset = value.includes("dataset") || value.includes("data");
    const asksForHelp = value.includes("doubt")
      || value.includes("question")
      || value.includes("help")
      || value.includes("assist");
    return mentionsDataset && asksForHelp;
  };

  // SCORE CATEGORICAL COLUMN
  const scoreCategoricalColumn = (column) => {
    const name = normalizeText(column);
    let score = 0;
    const preferredWords = [
      "category",
      "region",
      "branch",
      "city",
      "payment",
      "department",
      "segment",
      "customer type",
      "gender",
      "status",
      "product",
      "country",
      "type",
    ];
    preferredWords.forEach((word) => {
      if (name.includes(word)) {
        score += 20;
      }
    });
    if (name.includes("id")
      || name.includes("code")
      || name.includes("reference")) {
      score -= 30;
    }
    if (name.includes("date")
      || name.includes("time")) {
      score -= 5;
    }
    // Prefer repeated category values
    const preview = datasetInfo?.preview
      || [];
    if (preview.length > 0) {
      const values = preview
        .map((row) => row[column])
        .filter((value) => value !== null
        && value !== undefined
        && value !== "");
      if (values.length > 0) {
        const uniqueValues = new Set(values);
        const uniqueness = uniqueValues.size
          / values.length;
        score +=
          (1 - uniqueness)
            * 10;
      }
    }
    return score;
  };
  // BEST CATEGORICAL COLUMN
  const getBestCategoricalColumn = (excluded = []) => {
    const columns = getCategoricalColumns()
      .filter((column) => !excluded.includes(column));
    if (columns.length === 0) {
      return null;
    }
    const sorted = [...columns].sort((a, b) => scoreCategoricalColumn(b)
      - scoreCategoricalColumn(a));
    return sorted[0];
  };
  // SCORE NUMERIC COLUMN
  const scoreNumericColumn = (column) => {
    const name = normalizeText(column);
    let score = 0;
    const preferredWords = [
      "sales",
      "amount",
      "revenue",
      "profit",
      "quantity",
      "price",
      "total",
      "score",
      "rating",
      "income",
      "salary",
    ];
    preferredWords.forEach((word) => {
      if (name.includes(word)) {
        score += 20;
      }
    });
    if (name.includes("id")
      || name.includes("code")) {
      score -= 30;
    }
    return score;
  };
  // BEST NUMERIC COLUMN
  const getBestNumericColumn = (excluded = []) => {
    const columns = getNumericColumns()
      .filter((column) => !excluded.includes(column));
    if (columns.length === 0) {
      return null;
    }
    const sorted = [...columns].sort((a, b) => scoreNumericColumn(b)
      - scoreNumericColumn(a));
    return sorted[0];
  };
  // BEST DATE COLUMN
  const getBestDateColumn = (excluded = []) => {
    const dataTypes = datasetInfo?.data_types || {};
    return getColumns().find(
      (column) => !excluded.includes(column) && isDateLikeColumn(column, dataTypes[column])
    ) || null;
  };

  // DETERMINE CHART COLUMNS
  const getChartSetup = (userText, chartType, extraExcluded = []) => {
    const excluded = [...new Set([...getExcludedColumns(userText), ...extraExcluded])];
    const mentioned = getMentionedColumns(userText).filter((column) => !excluded.includes(column));
    const numericColumns = getNumericColumns();
    const mentionedNumeric = mentioned.filter((column) => numericColumns.includes(column));
    const mentionedCategorical = mentioned.filter((column) => !numericColumns.includes(column));

    if (["pie", "bar", "horizontal-bar"].includes(chartType)) {
      let xColumn = mentionedCategorical[0] || getBestCategoricalColumn(excluded);
      let yColumn = mentionedNumeric[0] || null;

      if (!xColumn) {
        xColumn = mentionedNumeric[0] || getBestNumericColumn(excluded);
        yColumn = null;
      }

      return { xColumn, yColumn, groupColumn: null };
    }

    if (chartType === "line") {
      const dataTypes = datasetInfo?.data_types || {};
      const mentionedDate = mentioned.find(
        (column) => isDateLikeColumn(column, dataTypes[column])
      );
      const xColumn = mentionedDate
        || mentionedCategorical[0]
        || getBestDateColumn(excluded)
        || getBestCategoricalColumn(excluded);
      const yColumn = mentionedNumeric[0] || getBestNumericColumn(excluded);
      return { xColumn, yColumn, groupColumn: null };
    }

    if (chartType === "histogram") {
      const xColumn = mentionedNumeric[0] || getBestNumericColumn(excluded);
      return { xColumn, yColumn: null, groupColumn: null };
    }

    if (chartType === "scatter") {
      const xColumn = mentionedNumeric[0] || getBestNumericColumn(excluded);
      const yColumn = mentionedNumeric[1]
        || getBestNumericColumn([...excluded, ...(xColumn ? [xColumn] : [])]);
      return { xColumn, yColumn, groupColumn: null };
    }

    if (chartType === "stacked-horizontal-bar") {
      const xColumn = mentionedCategorical[0] || getBestCategoricalColumn(excluded);
      const groupColumn = mentionedCategorical[1]
        || getBestCategoricalColumn([...excluded, ...(xColumn ? [xColumn] : [])]);
      const yColumn = mentionedNumeric[0] || getBestNumericColumn(excluded);
      return { xColumn, yColumn, groupColumn };
    }

    return { xColumn: null, yColumn: null, groupColumn: null };
  };

  // CHART DESCRIPTION
  const getChartDescription = (chartType, xColumn, yColumn) => {
    const names = {
      bar: "bar chart",
      "horizontal-bar": "horizontal bar chart",
      pie: "pie chart",
      line: "line chart",
      scatter: "scatter plot",
      histogram: "histogram",
      "stacked-horizontal-bar": "stacked bar chart",
    };
    const chartName = names[chartType]
      || "chart";
    if (chartType === "scatter"
      && xColumn
      && yColumn) {
      return (`Here is your ${chartName} of `
        + `${xColumn} vs ${yColumn}.`);
    }
    if (chartType === "histogram") {
      return (`Here is your histogram for `
        + `${xColumn}.`);
    }
    if (yColumn) {
      return (`Here is your ${chartName} showing `
        + `${yColumn} by ${xColumn}.`);
    }
    return (`Here is your ${chartName} for `
      + `${xColumn}.`);
  };
  // GENERATE CHART
  const generateChart = async (userText, lastChartMessage = null) => {
    const chartType = detectChartType(userText);
    const extraExcluded = wantsDifferentChart(userText) && lastChartMessage?.xColumn
      ? [lastChartMessage.xColumn]
      : [];
    const { xColumn, yColumn, groupColumn } = getChartSetup(
      userText,
      chartType,
      extraExcluded
    );
    // VALIDATE REQUIRED COLUMNS
    if (!xColumn) {
      throw new Error("I could not find a suitable column for this chart.");
    }
    if ((chartType === "line"
      || chartType === "scatter"
      || chartType
        === "stacked-horizontal-bar")
      && !yColumn) {
      throw new Error("This chart requires a numeric column, but I could not find one.");
    }
    if (chartType
      === "stacked-horizontal-bar"
      && !groupColumn) {
      throw new Error("A stacked chart needs another category column for grouping.");
    }
    // BUILD REQUEST
    const params = new URLSearchParams();
    params.set("chart_type", chartType);
    params.set("x_column", xColumn);
    if (yColumn) {
      params.set("y_column", yColumn);
    }
    if (groupColumn) {
      params.set("group_column", groupColumn);
    }
    // CALL EXISTING VISUALIZATION ENDPOINT
    const response = await fetch(`http://127.0.0.1:8000/visualization?${params.toString()}`);
    if (!response.ok) {
      let errorMessage = "Could not generate the chart.";
      try {
        const errorData = await response.json();
        if (errorData?.detail) {
          errorMessage = errorData.detail;
        }
      }
      catch {
        // Keep default error
      }
      throw new Error(errorMessage);
    }
    const chartResponse = await response.json();
    const chartMessage = {
      role: "assistant",
      type: "chart",
      text: getChartDescription(chartType, xColumn, yColumn),
      chartType: chartResponse.chart_type,
      chartData: chartResponse.data,
      groups: chartResponse.groups || [],
      xColumn,
      yColumn,
      groupColumn,
    };

    setMessages((previous) => [...previous, chartMessage]);
    return chartMessage;
  };
  // RENDER CHART
  const renderChart = (chatMessage) => {
    const chartData = chatMessage.chartData
      || [];
    // BAR
    if (chatMessage.chartType
      === "bar") {
      return (<ResponsiveContainer width="100%" height={350}>

     <BarChart data={chartData}>

      <CartesianGrid strokeDasharray="3 3"/>

      <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={80}/>

      <YAxis />

      <Tooltip />

      <Legend />

      <Bar dataKey="value" name={chatMessage.yColumn
          || "Count"} fill="#2563eb"/>

     </BarChart>

    </ResponsiveContainer>);
    }
    // HORIZONTAL BAR
    if (chatMessage.chartType
      === "horizontal-bar") {
      return (<ResponsiveContainer width="100%" height={380}>

     <BarChart data={chartData} layout="vertical">

      <CartesianGrid strokeDasharray="3 3"/>

      <XAxis type="number"/>

      <YAxis dataKey="name" type="category" width={140}/>

      <Tooltip />

      <Legend />

      <Bar dataKey="value" name={chatMessage.yColumn
          || "Count"} fill="#2563eb"/>

     </BarChart>

    </ResponsiveContainer>);
    }
    // PIE
    if (chatMessage.chartType === "pie") {
      const pieLabel = createPieLabelRenderer(
        chartData,
        PIE_COLORS,
        120,
        ({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`
      );

      return (
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="42%"
              cy="50%"
              outerRadius={120}
              label={pieLabel}
              labelLine={false}
              startAngle={90}
              endAngle={-270}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`pie-${index}`}
                  fill={PIE_COLORS[index % PIE_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend layout="vertical" verticalAlign="middle" align="right" />
          </PieChart>
        </ResponsiveContainer>
      );
    }
    // LINE
    if (chatMessage.chartType
      === "line") {
      return (<ResponsiveContainer width="100%" height={350}>

     <LineChart data={chartData}>

      <CartesianGrid strokeDasharray="3 3"/>

      <XAxis dataKey="name"/>

      <YAxis />

      <Tooltip />

      <Legend />

      <Line type="monotone" dataKey="value" name={chatMessage.yColumn
          || "Value"} stroke="#2563eb" strokeWidth={3} dot={false}/>

     </LineChart>

    </ResponsiveContainer>);
    }
    // HISTOGRAM
    if (chatMessage.chartType
      === "histogram") {
      return (<ResponsiveContainer width="100%" height={350}>

     <BarChart data={chartData}>

      <CartesianGrid strokeDasharray="3 3"/>

      <XAxis dataKey="name"/>

      <YAxis />

      <Tooltip />

      <Bar dataKey="value" name="Frequency" fill="#2563eb"/>

     </BarChart>

    </ResponsiveContainer>);
    }
    // SCATTER
    if (chatMessage.chartType
      === "scatter") {
      return (<ResponsiveContainer width="100%" height={350}>

     <ScatterChart>

      <CartesianGrid />

      <XAxis type="number" dataKey="x" name={chatMessage.xColumn}/>

      <YAxis type="number" dataKey="y" name={chatMessage.yColumn}/>

      <Tooltip cursor={{
          strokeDasharray: "3 3",
        }}/>

      <Scatter name={`${chatMessage.xColumn} vs ${chatMessage.yColumn}`} data={chartData} fill="#2563eb"/>

     </ScatterChart>

    </ResponsiveContainer>);
    }
    // STACKED HORIZONTAL BAR
    if (chatMessage.chartType
      === "stacked-horizontal-bar") {
      return (<ResponsiveContainer width="100%" height={400}>

     <BarChart data={chartData} layout="vertical">

      <CartesianGrid strokeDasharray="3 3"/>

      <XAxis type="number"/>

      <YAxis dataKey={chatMessage.xColumn} type="category" width={140}/>

      <Tooltip />

      <Legend />

      {chatMessage.groups.map((group, index) => (<Bar key={group} dataKey={group} stackId="stack" fill={PIE_COLORS[index
            % PIE_COLORS.length]}/>))}

     </BarChart>

    </ResponsiveContainer>);
    }
    return (<p>
    Chart could not be displayed.
   </p>);
  };
  // SEND MESSAGE
  const sendMessage = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage
      || loading) {
      return;
    }
    if (!datasetInfo) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: "Please upload a dataset before using the chatbot.",
        },
      ]);
      return;
    }
    // ADD USER MESSAGE
    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        text: trimmedMessage,
      },
    ]);
    setMessage("");
    setLoading(true);
    try {
      // FIND THE MOST RECENT GENERATED CHART
      const lastChartMessage = [...messages]
        .reverse()
        .find((item) => item.type === "chart");
      let questionForAI = trimmedMessage;

      if (isFilenameRequest(trimmedMessage)) {
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: `The uploaded dataset file is: **${datasetInfo.filename}**`,
          },
        ]);
        return;
      }

      if (isSimpleGreeting(trimmedMessage)) {
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: "Hello! How can I help you with your dataset?",
          },
        ]);
        return;
      }

      if (isDatasetHelpOpening(trimmedMessage)) {
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: "Of course — I’m here to assist you with any questions about the uploaded dataset.",
          },
        ]);
        return;
      }

      if (isColumnListRequest(trimmedMessage)) {
        const columns = getColumns();
        const columnList = columns.map((column, index) => `${index + 1}. \`${column}\``).join("\n");
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: `The dataset contains **${columns.length} columns**:\n\n${columnList}`,
          },
        ]);
        return;
      }

      const asksForDatasetSummary = isDatasetSummaryRequest(trimmedMessage);
      const asksForChart = isChartRequest(trimmedMessage);
      const asksForExplanation = isChartExplanationRequest(trimmedMessage);
      let chartToExplain = null;

      // Dataset summaries always go to the normal dataset chatbot even when
      // a chart happens to be the most recent assistant message.
      if (!asksForDatasetSummary) {
        // NEW CHART + EXPLANATION IN THE SAME QUESTION
        if (asksForChart && asksForExplanation) {
          chartToExplain = await generateChart(trimmedMessage, lastChartMessage);
        }
        // EXPLAIN EXISTING CHART
        else if (lastChartMessage && asksForExplanation) {
          chartToExplain = lastChartMessage;
        }
        // NEW CHART REQUEST
        else if (asksForChart) {
          await generateChart(trimmedMessage, lastChartMessage);
          return;
        }
      }

      if (chartToExplain) {
        questionForAI = `
The user is asking you to explain a chart that was generated from the uploaded CSV dataset.

Use ONLY the uploaded dataset and the dataset-derived chart information below.

Do NOT generate another chart.

Do NOT say that you cannot see the chart.

Explain the existing chart in simple terms.

Chart type:
${chartToExplain.chartType}

X column:
${chartToExplain.xColumn || "None"}

Y column:
${chartToExplain.yColumn || "Count"}

Group column:
${chartToExplain.groupColumn || "None"}

Chart data:
${JSON.stringify(chartToExplain.chartData)}

When explaining the chart:

- Explain what the chart represents.
- Mention the largest category or highest value where relevant.
- Mention the smallest category or lowest value where relevant.
- Compare the important categories.
- Mention missing values if a "Missing" category exists.
- Point out any obvious pattern.
- Only make observations supported by the chart data.
- Keep the explanation clear and concise.

Original user question:
${trimmedMessage}
`;
      }
      // KEEP CHATBOT ANSWERS DISTINCT FROM THE DASHBOARD SUMMARY.
      // ALL CHATBOT QUESTIONS USE THE NORMAL DATASET-GROUNDED CHAT STREAM.
      const response = await fetch("http://127.0.0.1:8000/chat-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: questionForAI,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Something went wrong.");
      }

      if (!response.body) {
        throw new Error("Streaming response was not available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      // ADD EMPTY AI MESSAGE FIRST SO THE TYPING INDICATOR CAN APPEAR.
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: "",
        },
      ]);

      const updateAssistantMessage = (text) => {
        setMessages((previous) => {
          const updated = [...previous];
          updated[updated.length - 1] = {
            role: "assistant",
            text,
          };
          return updated;
        });
      };

      // Gemini can sometimes send a larger text chunk at once.
      // Breaking only those larger chunks into small pieces gives a smooth,
      // continuous typing effect without noticeably slowing the answer.
      const appendStreamChunk = async (chunk) => {
        const pieceSize = 24;

        for (let index = 0; index < chunk.length; index += pieceSize) {
          assistantText += chunk.slice(index, index + pieceSize);
          updateAssistantMessage(assistantText);

          if (chunk.length > pieceSize) {
            await new Promise((resolve) => setTimeout(resolve, 6));
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (chunk) {
          await appendStreamChunk(chunk);
        }
      }

      const finalChunk = decoder.decode();

      if (finalChunk) {
        await appendStreamChunk(finalChunk);
      }
    }
    catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: error.message
            || "Unable to contact the AI assistant.",
        },
      ]);
    }
    finally {
      setLoading(false);
    }
  };
  // ENTER TO SEND
  // SHIFT + ENTER FOR NEW LINE
  const handleKeyDown = (event) => {
    if (event.key === "Enter"
      && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const handleQuickPrompt = (prompt) => {
    if (!loading) {
      setMessage(prompt);
    }
  };
  const renderChatContent = (compact = false) => (
    <div
      className={
        compact
          ? "chatbot-container chatbot-container-floating"
          : "chatbot-container"
      }
    >
      {!compact && (
        <div className="chatbot-toolbar">
          <div className="chatbot-toolbar-title">
            <span className="chatbot-toolbar-icon">
              <Sparkles size={17} />
            </span>

            <div>
              <strong>Ask your data</strong>
              <span>Answers are grounded in the uploaded CSV</span>
            </div>
          </div>

          <div className="chatbot-live-status">
            <span />
            Ready
          </div>
        </div>
      )}

      <div className="chatbot-quick-prompts">
        <div className="quick-prompt-heading">
          <Sparkles size={15} />
          <span>Try asking</span>
        </div>

        <div className="quick-prompt-grid">
          {QUICK_PROMPTS.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.label}
                type="button"
                className="quick-prompt-chip"
                onClick={() => handleQuickPrompt(item.prompt)}
                disabled={loading}
              >
                <span className="quick-prompt-icon">
                  <Icon size={15} />
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((chatMessage, index) => (
          <div
            key={index}
            className={
              chatMessage.role === "user"
                ? "chat-message user-message"
                : "chat-message assistant-message"
            }
          >
            <div className="chat-avatar">
              {chatMessage.role === "user"
                ? <User size={19} />
                : <Bot size={19} />}
            </div>

            <div className="chat-message-content">
              <span className="chat-message-label">
                {chatMessage.role === "user" ? "You" : "AI Assistant"}
              </span>

              <div
                className={[
                  "chat-bubble",
                  loading
                  && index === messages.length - 1
                  && chatMessage.role === "assistant"
                  && chatMessage.type !== "chart"
                    ? "chat-streaming-response"
                    : "",
                  chatMessage.role === "user"
                  && String(chatMessage.text || "").length <= 24
                    ? "short-user-bubble"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {chatMessage.role === "assistant" ? (
                  chatMessage.type === "chart" ? (
                    <>
                      <p>{chatMessage.text}</p>
                      <div className="chat-chart-box">
                        {renderChart(chatMessage)}
                      </div>
                    </>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ node, ...props }) => (
                          <div className="chat-table-scroll">
                            <table {...props} />
                          </div>
                        ),
                      }}
                    >
                      {chatMessage.text}
                    </ReactMarkdown>
                  )
                ) : (
                  chatMessage.text
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="chat-message assistant-message">
            <div className="chat-avatar">
              <Bot size={19} />
            </div>

            <div className="chat-message-content">
              <span className="chat-message-label">AI Assistant</span>
              <div className="chat-bubble chatbot-thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-shell">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your dataset..."
            rows={1}
          />

          <div className="chat-input-footer">
            <span>Enter to send · Shift + Enter for a new line</span>
            <span>{message.length} characters</span>
          </div>
        </div>

        <button
          type="button"
          onClick={sendMessage}
          disabled={loading || !message.trim()}
          className="chat-send-button"
        >
          <Send size={18} />
          <span>Send</span>
        </button>
      </div>
    </div>
  );

  // Keep this component mounted on every page so chat state, input state,
  // resize state and an active streaming response are not interrupted.
  if (mode === "hidden") {
    return null;
  }

  if (mode === "floating") {
    if (!datasetInfo) {
      return null;
    }

    if (!floatingOpen) {
      return (
        <button
          type="button"
          className="floating-chatbot-launcher"
          onClick={() => {
            setFloatingOpen(true);
            setFloatingMinimized(false);
          }}
          aria-label="Open AI Data Assistant"
          title="Open AI Data Assistant"
        >
          <MessageCircle size={24} />
          <span>AI</span>
        </button>
      );
    }

    return (
      <div
        className={
          floatingMinimized
            ? "floating-chatbot-window minimized"
            : "floating-chatbot-window"
        }
      >
        <div className="floating-chatbot-header">
          <div className="floating-chatbot-title">
            <span className="floating-chatbot-logo">
              <Sparkles size={17} />
            </span>

            <div>
              <strong>AI Data Assistant</strong>
              <span title={datasetInfo.filename}>{datasetInfo.filename}</span>
            </div>
          </div>

          <div className="floating-chatbot-controls">
            <button
              type="button"
              onClick={() => setActivePage?.("Chatbot")}
              title="Open full chatbot page"
              aria-label="Open full chatbot page"
            >
              <Maximize2 size={16} />
            </button>

            <button
              type="button"
              onClick={() => setFloatingMinimized((previous) => !previous)}
              title={floatingMinimized ? "Restore chat" : "Minimize chat"}
              aria-label={floatingMinimized ? "Restore chat" : "Minimize chat"}
            >
              {floatingMinimized
                ? <MessageCircle size={16} />
                : <Minus size={16} />}
            </button>

            <button
              type="button"
              onClick={() => setFloatingOpen(false)}
              title="Close chat"
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {!floatingMinimized && renderChatContent(true)}

      </div>
    );
  }

  return (
    <div className="chatbot-page">
      <div className="chatbot-header">
        <div>
          <span className="chatbot-eyebrow">AI workspace</span>
          <h1>AI Data Assistant</h1>
          <p>
            Ask questions, discover insights and create charts from your
            uploaded dataset.
          </p>
        </div>

        {datasetInfo && (
          <div className="chatbot-dataset-card">
            <span className="chatbot-dataset-icon">
              <Database size={18} />
            </span>

            <div className="chatbot-dataset-copy">
              <span>Connected dataset</span>
              <strong title={datasetInfo.filename}>
                {datasetInfo.filename}
              </strong>
            </div>

            <span className="chatbot-connected-dot" />
          </div>
        )}
      </div>

      {!datasetInfo ? (
        <div className="chatbot-no-data">
          <div className="chatbot-no-data-icon">
            <Bot size={34} />
          </div>

          <span className="chatbot-eyebrow">AI assistant</span>
          <h2>No dataset uploaded</h2>
          <p>
            Upload a CSV dataset first, then return here to start exploring it
            with the assistant.
          </p>
        </div>
      ) : (
        renderChatContent(false)
      )}
    </div>
  );
}

export default ChatbotPage;
