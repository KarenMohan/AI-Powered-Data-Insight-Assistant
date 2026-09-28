import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = [
  "#2563eb",
  "#7c3aed",
  "#06b6d4",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#ea580c",
  "#4f46e5",
];
const RADIAN = Math.PI / 180;

const createPieLabelRenderer = (data, radius) => {
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

    for (let index = items.length - 2; index >= 0; index -= 1) {
      items[index].y = Math.min(items[index].y, items[index + 1].y - gap);
    }

    if (items.length && items[0].y < minY) {
      const shift = minY - items[0].y;
      items.forEach((item) => {
        item.y += shift;
      });
    }

    items.forEach((item) => positions.set(item.index, item));
  });

  return ({ cx, cy, midAngle, outerRadius, index, name, value }) => {
    const position = positions.get(index);
    if (!position) return null;

    const side = position.side;
    const sliceX = cx + (outerRadius + 3) * Math.cos(-midAngle * RADIAN);
    const sliceY = cy + (outerRadius + 3) * Math.sin(-midAngle * RADIAN);
    const elbowX = cx + side * (outerRadius + 28);
    const endX = cx + side * (outerRadius + 78);
    const labelY = cy + position.y;
    const color = COLORS[index % COLORS.length];

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
          x={endX + side * 7}
          y={labelY}
          fill={color}
          textAnchor={side === 1 ? "start" : "end"}
          dominantBaseline="central"
          fontSize={14}
        >
          {`${name}: ${value}`}
        </text>
      </g>
    );
  };
};

function VisualizationChart({
  chartType,
  data,
  groups = [],
  xColumn = "",
  yColumn = "",
  compact = false,
}) {
  const height = compact ? 280 : 450;
  const seriesLabel = yColumn || "Count";

  if (!data?.length) {
    return (
      <div className="chart-placeholder">
        Select your columns and click Generate Chart.
      </div>
    );
  }

  if (chartType === "bar" || chartType === "histogram") {
    const angled = data.length > 7;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: compact ? 10 : 12 }}
            interval={0}
            angle={angled ? -25 : 0}
            textAnchor={angled ? "end" : "middle"}
            height={angled ? 70 : 35}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {!compact && <Legend />}
          <Bar
            dataKey="value"
            name={chartType === "histogram" ? "Frequency" : seriesLabel}
            fill="#2563eb"
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "horizontal-bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis
            dataKey="name"
            type="category"
            width={compact ? 110 : 140}
            tick={{ fontSize: compact ? 10 : 12 }}
          />
          <Tooltip />
          {!compact && <Legend />}
          <Bar
            dataKey="value"
            name={seriesLabel}
            fill="#2563eb"
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "pie") {
    if (compact) {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="42%"
              cy="50%"
              outerRadius={92}
              label={({ percent }) => `${(percent * 100).toFixed(1)}%`}
              labelLine={false}
            >
              {data.map((_, index) => (
                <Cell
                  key={`auto-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend
              layout="vertical"
              verticalAlign="middle"
              align="right"
              wrapperStyle={{ fontSize: 11 }}
            />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={500}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="43%"
            cy="50%"
            outerRadius={150}
            label={createPieLabelRenderer(data, 150)}
            labelLine={false}
            startAngle={90}
            endAngle={-270}
          >
            {data.map((_, index) => (
              <Cell
                key={`manual-${index}`}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip />
          <Legend layout="vertical" verticalAlign="middle" align="right" />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: compact ? 10 : 12 }}
            minTickGap={18}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {!compact && <Legend />}
          <Line
            type="monotone"
            dataKey="value"
            name={seriesLabel}
            stroke="#7c3aed"
            strokeWidth={2.5}
            dot={{ r: compact ? 2 : 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "stacked-horizontal-bar") {
    return (
      <ResponsiveContainer width="100%" height={compact ? 320 : 500}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" />
          <YAxis dataKey={xColumn} type="category" width={140} />
          <Tooltip />
          <Legend />
          {groups.map((group, index) => (
            <Bar
              key={group}
              dataKey={group}
              name={group}
              stackId="a"
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "scatter") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" dataKey="x" name={xColumn} />
          <YAxis type="number" dataKey="y" name={yColumn} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          {!compact && <Legend />}
          <Scatter
            name={`${xColumn} vs ${yColumn}`}
            data={data}
            fill="#06b6d4"
          />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return null;
}

export default VisualizationChart;
