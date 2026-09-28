import re
import pandas as pd

CATEGORY_TOKENS = (
    "department", "gender", "region", "city", "category", "status",
    "type", "channel", "role", "segment", "class", "country",
)
NUMERIC_TOKENS = (
    "salary", "experience", "revenue", "sales", "amount", "price",
    "rate", "cost", "profit", "score", "age", "quantity",
)
DATE_TOKENS = ("date", "joining", "created", "time")


def _humanize(value):
    return str(value).replace("_", " ").strip().title()


def _is_identifier(column):
    name = str(column).lower()
    return (
        name == "id"
        or name.endswith("_id")
        or name.startswith("id_")
        or any(token in name for token in ("code", "phone", "postal", "zip"))
    )


def _priority(column, tokens):
    name = str(column).lower()
    for index, token in enumerate(tokens):
        if token in name:
            return index
    return len(tokens)


def _normalized_category(series):
    values = series.fillna("Missing").astype(str).str.strip()
    values = values.mask(values.eq(""), "Missing")
    return values.str.lower().str.replace(r"\s+", " ", regex=True).str.title()


def _categorical_columns(dataframe):
    sample = dataframe.head(5000)
    candidates = []

    for column in dataframe.columns:
        if _is_identifier(column):
            continue

        series = sample[column]
        if not (
            pd.api.types.is_object_dtype(series)
            or pd.api.types.is_string_dtype(series)
            or pd.api.types.is_bool_dtype(series)
        ):
            continue

        non_null = series.dropna()
        if non_null.empty:
            continue

        unique_count = int(non_null.astype(str).nunique())
        if 2 <= unique_count <= 20:
            candidates.append((column, unique_count))

    return sorted(
        candidates,
        key=lambda item: (
            _priority(item[0], CATEGORY_TOKENS),
            abs(item[1] - 6),
            str(item[0]),
        ),
    )


def _numeric_columns(dataframe):
    sample = dataframe.head(5000)
    columns = []

    for column in dataframe.select_dtypes(include="number").columns:
        if _is_identifier(column):
            continue
        if sample[column].dropna().nunique() > 1:
            columns.append(column)

    return sorted(
        columns,
        key=lambda column: (_priority(column, NUMERIC_TOKENS), str(column)),
    )


def _date_format_from_sample(series):
    values = series.dropna().astype(str).str.strip().head(40)
    if values.empty:
        return None

    patterns = (
        (r"^\d{1,2}-\d{1,2}-\d{4}$", "%d-%m-%Y"),
        (r"^\d{4}-\d{1,2}-\d{1,2}$", "%Y-%m-%d"),
        (r"^\d{1,2}/\d{1,2}/\d{4}$", "%d/%m/%Y"),
        (r"^\d{4}/\d{1,2}/\d{1,2}$", "%Y/%m/%d"),
    )

    for pattern, date_format in patterns:
        matches = values.str.match(pattern)
        if matches.mean() >= 0.8:
            return date_format

    return None


def _find_date_column(dataframe):
    candidates = [
        column
        for column in dataframe.columns
        if not pd.api.types.is_numeric_dtype(dataframe[column])
        and not _is_identifier(column)
        and any(token in str(column).lower() for token in DATE_TOKENS)
    ]

    candidates.sort(key=lambda column: (_priority(column, DATE_TOKENS), str(column)))

    for column in candidates:
        date_format = _date_format_from_sample(dataframe[column])
        if not date_format:
            continue

        converted = pd.to_datetime(
            dataframe[column],
            format=date_format,
            errors="coerce",
        )
        if converted.notna().sum() >= 3:
            return column, converted

    return None


def _category_counts(dataframe, column):
    return _normalized_category(dataframe[column]).value_counts(dropna=False)


def _category_distribution_chart(dataframe, column, chart_type="bar"):
    counts = _category_counts(dataframe, column)
    total = int(counts.sum())
    missing = int(counts.get("Missing", 0))
    recorded = max(total - missing, 0)
    recorded_counts = [
        (str(name), int(count))
        for name, count in counts.items()
        if str(name) != "Missing"
    ]

    sentences = []
    if recorded_counts and recorded:
        leader, leader_count = recorded_counts[0]
        sentences.append(
            f"{leader} has the largest share, with {leader_count:,} of "
            f"{recorded:,} recorded values ({leader_count / recorded * 100:.1f}%)."
        )

        if len(recorded_counts) > 1:
            followers = ", ".join(
                f"{name} {count:,} ({count / recorded * 100:.1f}%)"
                for name, count in recorded_counts[1:4]
            )
            sentences.append(f"It is followed by {followers}.")

    if missing:
        sentences.append(
            f"{missing:,} record{'s' if missing != 1 else ''} have missing "
            f"{_humanize(column).lower()} information."
        )

    return {
        "chart_type": chart_type,
        "title": f"{_humanize(column)} Distribution",
        "subtitle": f"Distribution of records by {_humanize(column).lower()}",
        "x_column": column,
        "y_column": None,
        "groups": [],
        "data": [
            {"name": str(name), "value": int(count)}
            for name, count in counts.items()
        ],
        "insight": " ".join(sentences) or (
            f"This chart shows how records are distributed across {_humanize(column)}."
        ),
    }


def _average_by_category_chart(dataframe, category, numeric):
    working = pd.DataFrame({
        "category": _normalized_category(dataframe[category]),
        "value": pd.to_numeric(dataframe[numeric], errors="coerce"),
    }).dropna(subset=["value"])

    working = working[working["category"] != "Missing"]
    if working.empty or working["category"].nunique() < 2:
        return None

    grouped = (
        working.groupby("category")["value"]
        .mean()
        .sort_values(ascending=False)
        .head(12)
    )
    if grouped.empty:
        return None

    leader_name = str(grouped.index[0])
    leader_value = float(grouped.iloc[0])
    lowest_name = str(grouped.index[-1])
    lowest_value = float(grouped.iloc[-1])

    return {
        "chart_type": "bar",
        "title": f"{_humanize(category)}-wise {_humanize(numeric)} Comparison",
        "subtitle": f"Average {_humanize(numeric).lower()} across {_humanize(category).lower()} categories",
        "x_column": category,
        "y_column": numeric,
        "groups": [],
        "data": [
            {"name": str(name), "value": round(float(value), 2)}
            for name, value in grouped.items()
        ],
        "insight": (
            f"{leader_name} has the highest average {_humanize(numeric).lower()} "
            f"at {leader_value:,.2f}. {lowest_name} has the lowest average at "
            f"{lowest_value:,.2f}. This comparison highlights how "
            f"{_humanize(numeric).lower()} varies across {_humanize(category).lower()} categories."
        ),
    }


def _choose_scatter_pair(columns):
    lowered = {str(column).lower(): column for column in columns}
    preferred = (
        ("experience", "salary"),
        ("age", "salary"),
        ("quantity", "revenue"),
        ("price", "rating"),
        ("cost", "profit"),
    )

    for left_token, right_token in preferred:
        left = next((value for name, value in lowered.items() if left_token in name), None)
        right = next((value for name, value in lowered.items() if right_token in name), None)
        if left is not None and right is not None and left != right:
            return left, right

    return columns[0], columns[1]


def _scatter_chart(dataframe, x_column, y_column):
    values = dataframe[[x_column, y_column]].apply(
        pd.to_numeric, errors="coerce"
    ).dropna()
    if len(values) < 3:
        return None

    correlation = values[x_column].corr(values[y_column])
    correlation = 0.0 if pd.isna(correlation) else float(correlation)
    magnitude = abs(correlation)

    if magnitude < 0.2:
        strength = "little to no clear linear relationship"
    elif magnitude < 0.5:
        strength = "a moderate linear relationship"
    else:
        strength = "a strong linear relationship"

    direction = (
        "positive" if correlation > 0
        else "negative" if correlation < 0
        else "neutral"
    )

    plot_rows = values if len(values) <= 800 else values.sample(800, random_state=42)

    return {
        "chart_type": "scatter",
        "title": f"{_humanize(y_column)} vs {_humanize(x_column)}",
        "subtitle": f"Relationship between {_humanize(x_column).lower()} and {_humanize(y_column).lower()}",
        "x_column": x_column,
        "y_column": y_column,
        "groups": [],
        "data": [
            {"x": float(row[x_column]), "y": float(row[y_column])}
            for _, row in plot_rows.iterrows()
        ],
        "insight": (
            f"The chart compares {_humanize(x_column)} and {_humanize(y_column)} "
            f"across {len(values):,} complete records. The correlation is {correlation:.2f}, "
            f"indicating {strength} with a {direction} direction. This shows association "
            "between the two fields and does not by itself establish causation."
        ),
    }


def _line_chart(dataframe, column, converted):
    valid = converted.dropna()
    if valid.empty:
        return None

    if valid.nunique() > 36:
        periods = valid.dt.to_period("M").astype(str)
        label = "month"
    else:
        periods = valid.dt.strftime("%Y-%m-%d")
        label = "date"

    grouped = periods.value_counts().sort_index()
    data = [
        {"name": str(period), "value": int(count)}
        for period, count in grouped.items()
    ]
    if not data:
        return None

    peak = max(data, key=lambda item: item["value"])
    return {
        "chart_type": "line",
        "title": f"Records over {_humanize(column)}",
        "subtitle": f"Record activity by {label}",
        "x_column": column,
        "y_column": None,
        "groups": [],
        "data": data,
        "insight": (
            f"The chart tracks record activity using {_humanize(column)}. "
            f"The highest activity occurs in {peak['name']} with {peak['value']:,} records. "
            f"The series begins at {data[0]['value']:,} records in {data[0]['name']} "
            f"and ends at {data[-1]['value']:,} in {data[-1]['name']}."
        ),
    }


def _histogram_chart(dataframe, column):
    values = pd.to_numeric(dataframe[column], errors="coerce").dropna()
    if values.empty:
        return None

    bins = min(10, max(5, int(values.nunique() ** 0.5)))
    histogram = pd.cut(values, bins=bins).value_counts().sort_index()

    return {
        "chart_type": "histogram",
        "title": f"{_humanize(column)} Distribution",
        "subtitle": f"Frequency distribution of {_humanize(column).lower()}",
        "x_column": column,
        "y_column": None,
        "groups": [],
        "data": [
            {"name": str(interval), "value": int(count)}
            for interval, count in histogram.items()
        ],
        "insight": (
            f"{_humanize(column)} ranges from {float(values.min()):,.2f} to "
            f"{float(values.max()):,.2f}, with a median of {float(values.median()):,.2f} "
            f"and an average of {float(values.mean()):,.2f}. The histogram shows where "
            "values are most concentrated across that range."
        ),
    }


def _completeness_chart(dataframe):
    counts = dataframe.notna().sum().sort_values(ascending=False).head(12)
    return {
        "chart_type": "horizontal-bar",
        "title": "Data Completeness by Column",
        "subtitle": "Non-missing records across key fields",
        "x_column": "column",
        "y_column": None,
        "groups": [],
        "data": [
            {"name": str(column), "value": int(count)}
            for column, count in counts.items()
        ],
        "insight": (
            "Longer bars represent more complete fields, while shorter bars identify "
            "columns with more missing information and may deserve closer review."
        ),
    }


def _make_suggestion(chart):
    return {
        "chart_type": chart["chart_type"],
        "label": chart["title"],
        "reason": chart["subtitle"],
        "columns": [
            column
            for column in (chart.get("x_column"), chart.get("y_column"))
            if column
        ],
    }


def build_visualization_recommendations(dataframe):
    categorical = _categorical_columns(dataframe)
    numeric = _numeric_columns(dataframe)
    date_info = _find_date_column(dataframe)

    charts = []
    used_titles = set()

    def add(chart):
        if not chart or chart["title"] in used_titles or len(charts) >= 4:
            return
        charts.append(chart)
        used_titles.add(chart["title"])

    # 1. Prefer a meaningful category-vs-number comparison when possible.
    if categorical and numeric:
        add(_average_by_category_chart(dataframe, categorical[0][0], numeric[0]))

    # 2. Prefer a compact categorical distribution, especially Gender.
    if categorical:
        pie_candidates = [item for item in categorical if 2 <= item[1] <= 6]
        if pie_candidates:
            pie_column = sorted(
                pie_candidates,
                key=lambda item: (
                    0 if "gender" in str(item[0]).lower() else 1,
                    _priority(item[0], CATEGORY_TOKENS),
                ),
            )[0][0]
            add(_category_distribution_chart(dataframe, pie_column, "pie"))
        else:
            add(_category_distribution_chart(dataframe, categorical[0][0], "bar"))

    # 3. Numeric relationship.
    if len(numeric) >= 2:
        x_column, y_column = _choose_scatter_pair(numeric)
        add(_scatter_chart(dataframe, x_column, y_column))

    # 4. Time trend when a clearly formatted date field exists.
    if date_info:
        add(_line_chart(dataframe, date_info[0], date_info[1]))

    # Fill remaining slots only when needed.
    if categorical and len(charts) < 2:
        for column, unique_count in categorical:
            add(
                _category_distribution_chart(
                    dataframe,
                    column,
                    "horizontal-bar" if unique_count > 7 else "bar",
                )
            )
            if len(charts) >= 2:
                break

    if numeric and len(charts) < 2:
        add(_histogram_chart(dataframe, numeric[0]))

    if len(charts) < 2:
        add(_completeness_chart(dataframe))

    # Last-resort second chart for extremely small/simple datasets.
    if len(charts) < 2:
        charts.append({
            "chart_type": "bar",
            "title": "Dataset Structure Overview",
            "subtitle": "Rows and columns in the uploaded dataset",
            "x_column": "metric",
            "y_column": None,
            "groups": [],
            "data": [
                {"name": "Rows", "value": int(len(dataframe))},
                {"name": "Columns", "value": int(len(dataframe.columns))},
            ],
            "insight": (
                f"The uploaded dataset contains {len(dataframe):,} rows across "
                f"{len(dataframe.columns):,} columns."
            ),
        })

    suggestions = [_make_suggestion(chart) for chart in charts]
    return {"suggestions": suggestions, "auto_charts": charts[:4]}
