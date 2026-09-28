from google import genai
from dotenv import load_dotenv

import io
import os
import re
import time

import pandas as pd

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise RuntimeError("GEMINI_API_KEY was not found in the .env file.")

client = genai.Client(api_key=api_key)


class GeminiDatasetChat:

    MAX_OVERVIEW_CHARS = 45000
    MAX_QUESTION_CONTEXT_CHARS = 22000
    MAX_HISTORY_TURNS = 3

    # Try a lightweight model first, then fall back to other current Flash
    # models if one is temporarily busy or rate limited.
    MODEL_CANDIDATES = [
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.6-flash",
    ]

    def __init__(self):

        self.dataframe = None
        self.filename = None
        self.dataset_overview = ""
        self.chat_history = []

        # Kept only for compatibility with the rest of the project.
        self.uploaded_file = None
        self.previous_interaction_id = None

    def _safe_value(self, value):

        if pd.isna(value):
            return "Missing"

        text = str(value)

        if len(text) > 120:
            return text[:117] + "..."

        return text

    def _normalize(self, value):

        return re.sub(
            r"[^a-z0-9]+",
            " ",
            str(value).lower(),
        ).strip()

    def _find_mentioned_columns(self, question):

        if self.dataframe is None:
            return []

        normalized_question = self._normalize(question)
        question_tokens = set(normalized_question.split())

        ignored_tokens = {
            "id",
            "eur",
            "usd",
            "gbp",
            "the",
            "of",
            "and",
            "per",
        }

        matches = []

        for column in self.dataframe.columns:

            normalized_column = self._normalize(column)

            if not normalized_column:
                continue

            # Exact/full column phrase, e.g. "salary eur".
            if normalized_column in normalized_question:
                matches.append(column)
                continue

            # Friendly alias matching, e.g. user says "salary" for Salary_EUR.
            useful_tokens = [
                token
                for token in normalized_column.split()
                if len(token) >= 4 and token not in ignored_tokens
            ]

            if useful_tokens and any(
                token in question_tokens
                for token in useful_tokens
            ):
                matches.append(column)

        return list(dict.fromkeys(matches))

    def _numeric_stats(self, series):

        clean = pd.to_numeric(series, errors="coerce").dropna()

        if clean.empty:
            return None

        modes = clean.mode().head(5).tolist()

        return {
            "count": int(clean.count()),
            "sum": float(clean.sum()),
            "mean": float(clean.mean()),
            "median": float(clean.median()),
            "mode": [float(value) for value in modes],
            "minimum": float(clean.min()),
            "maximum": float(clean.max()),
            "std_dev": float(clean.std()) if len(clean) > 1 else 0.0,
        }

    def _build_dataset_overview(self):

        dataframe = self.dataframe

        if dataframe is None:
            return ""

        rows, columns = dataframe.shape

        lines = [
            "DATASET OVERVIEW",
            f"File name: {self.filename}",
            f"Rows: {rows}",
            f"Columns: {columns}",
            f"Exact duplicate rows: {int(dataframe.duplicated().sum())}",
            "",
            "COLUMN PROFILES",
        ]

        numeric_columns = []

        for column in dataframe.columns:

            series = dataframe[column]
            missing = int(series.isna().sum())
            unique = int(series.nunique(dropna=True))
            dtype = str(series.dtype)

            lines.append(
                f"- {column}: dtype={dtype}, missing={missing}, unique={unique}"
            )

            if pd.api.types.is_numeric_dtype(series):

                numeric_columns.append(column)

                stats = self._numeric_stats(series)

                if stats:

                    lines.append(
                        "  numeric statistics: "
                        f"count={stats['count']}, "
                        f"sum={stats['sum']:.6g}, "
                        f"mean={stats['mean']:.6g}, "
                        f"median={stats['median']:.6g}, "
                        f"mode={stats['mode']}, "
                        f"min={stats['minimum']:.6g}, "
                        f"max={stats['maximum']:.6g}, "
                        f"std={stats['std_dev']:.6g}"
                    )

            else:

                value_counts = (
                    series
                    .dropna()
                    .astype(str)
                    .value_counts()
                    .head(8)
                )

                if not value_counts.empty:

                    values_text = ", ".join(
                        f"{self._safe_value(value)}={int(count)}"
                        for value, count in value_counts.items()
                    )

                    lines.append(
                        f"  most common values: {values_text}"
                    )

        if len(numeric_columns) >= 2:

            numeric_frame = (
                dataframe[numeric_columns]
                .apply(pd.to_numeric, errors="coerce")
            )

            correlation = numeric_frame.corr()

            pairs = []

            for left_index, left in enumerate(numeric_columns):

                for right in numeric_columns[left_index + 1:]:

                    value = correlation.loc[left, right]

                    if pd.notna(value):

                        pairs.append(
                            (
                                abs(float(value)),
                                left,
                                right,
                                float(value),
                            )
                        )

            pairs.sort(reverse=True)

            if pairs:

                lines.extend([
                    "",
                    "STRONGEST NUMERIC CORRELATIONS",
                ])

                for _, left, right, value in pairs[:15]:

                    lines.append(
                        f"- {left} vs {right}: correlation={value:.4f}"
                    )

        lines.extend([
            "",
            "SAMPLE ROWS",
        ])

        sample = (
            dataframe
            .head(5)
            .fillna("")
            .to_dict(orient="records")
        )

        for index, row in enumerate(sample, start=1):

            row_text = "; ".join(
                f"{column}={self._safe_value(value)}"
                for column, value in row.items()
            )

            lines.append(f"Row {index}: {row_text}")

        overview = "\n".join(lines)

        return overview[:self.MAX_OVERVIEW_CHARS]

    def _build_question_context(self, question):

        if self.dataframe is None:
            return ""

        dataframe = self.dataframe
        mentioned = self._find_mentioned_columns(question)

        numeric_mentioned = [
            column
            for column in mentioned
            if pd.api.types.is_numeric_dtype(dataframe[column])
        ]

        categorical_mentioned = [
            column
            for column in mentioned
            if column not in numeric_mentioned
        ]

        lines = []

        if mentioned:

            lines.append(
                "QUESTION-SPECIFIC EXACT PANDAS RESULTS"
            )

        for column in numeric_mentioned:

            stats = self._numeric_stats(dataframe[column])

            if not stats:
                continue

            lines.extend([
                f"",
                f"Numeric column: {column}",
                f"Count: {stats['count']}",
                f"Sum: {stats['sum']}",
                f"Average/Mean: {stats['mean']}",
                f"Median: {stats['median']}",
                f"Mode: {stats['mode']}",
                f"Minimum: {stats['minimum']}",
                f"Maximum: {stats['maximum']}",
                f"Standard deviation: {stats['std_dev']}",
            ])

        for column in categorical_mentioned:

            counts = (
                dataframe[column]
                .fillna("Missing")
                .astype(str)
                .value_counts()
                .head(25)
            )

            lines.extend([
                "",
                f"Value counts for {column}:",
            ])

            for value, count in counts.items():

                lines.append(
                    f"- {self._safe_value(value)}: {int(count)}"
                )

        # If the question names both a category and a numeric field,
        # compute exact group-level summaries with Pandas.
        for category in categorical_mentioned:

            for numeric in numeric_mentioned:

                temp = dataframe[[category, numeric]].copy()

                temp[numeric] = pd.to_numeric(
                    temp[numeric],
                    errors="coerce",
                )

                temp[category] = (
                    temp[category]
                    .fillna("Missing")
                    .astype(str)
                )

                temp = temp.dropna(subset=[numeric])

                if temp.empty:
                    continue

                grouped = (
                    temp
                    .groupby(category)[numeric]
                    .agg(
                        count="count",
                        sum="sum",
                        mean="mean",
                        median="median",
                        min="min",
                        max="max",
                    )
                    .sort_values("count", ascending=False)
                    .head(25)
                )

                lines.extend([
                    "",
                    f"Grouped statistics: {numeric} by {category}",
                    grouped.to_string(),
                ])

        normalized_question = self._normalize(question)

        asks_extremes = any(
            phrase in normalized_question
            for phrase in [
                "highest",
                "lowest",
                "top",
                "bottom",
                "largest",
                "smallest",
                "maximum",
                "minimum",
            ]
        )

        if asks_extremes and numeric_mentioned:

            display_columns = list(dict.fromkeys(
                mentioned
                + [
                    column
                    for column in dataframe.columns
                    if any(
                        word in self._normalize(column)
                        for word in [
                            "name",
                            "id",
                            "department",
                            "region",
                            "category",
                            "status",
                        ]
                    )
                ]
            ))

            display_columns = display_columns[:10]

            for numeric in numeric_mentioned:

                temp = dataframe.copy()

                temp[numeric] = pd.to_numeric(
                    temp[numeric],
                    errors="coerce",
                )

                temp = temp.dropna(subset=[numeric])

                if temp.empty:
                    continue

                lines.extend([
                    "",
                    f"Top rows by {numeric}:",
                    (
                        temp
                        .nlargest(10, numeric)[display_columns]
                        .fillna("")
                        .to_string(index=False)
                    ),
                    "",
                    f"Bottom rows by {numeric}:",
                    (
                        temp
                        .nsmallest(10, numeric)[display_columns]
                        .fillna("")
                        .to_string(index=False)
                    ),
                ])

        # For broad insight questions, add useful exact aggregate information
        # without sending all dataset rows to Gemini.
        broad_insight = any(
            phrase in normalized_question
            for phrase in [
                "insight",
                "pattern",
                "trend",
                "interesting",
                "explore",
                "analyze",
                "analyse",
            ]
        )

        if broad_insight and not mentioned:

            low_cardinality = []

            for column in dataframe.columns:

                unique = dataframe[column].nunique(dropna=True)

                if (
                    not pd.api.types.is_numeric_dtype(dataframe[column])
                    and 2 <= unique <= 15
                ):

                    low_cardinality.append(column)

            numeric_columns = [
                column
                for column in dataframe.columns
                if pd.api.types.is_numeric_dtype(dataframe[column])
            ]

            # Keep this bounded: only a few useful cross-column summaries.
            for category in low_cardinality[:4]:

                for numeric in numeric_columns[:4]:

                    temp = dataframe[[category, numeric]].copy()

                    temp[numeric] = pd.to_numeric(
                        temp[numeric],
                        errors="coerce",
                    )

                    temp[category] = (
                        temp[category]
                        .fillna("Missing")
                        .astype(str)
                    )

                    temp = temp.dropna(subset=[numeric])

                    if temp.empty:
                        continue

                    grouped = (
                        temp
                        .groupby(category)[numeric]
                        .agg(["count", "mean", "median"])
                        .sort_values("count", ascending=False)
                        .head(12)
                    )

                    lines.extend([
                        "",
                        f"Insight table: {numeric} by {category}",
                        grouped.to_string(),
                    ])

        return "\n".join(lines)[:self.MAX_QUESTION_CONTEXT_CHARS]

    def _history_text(self):

        if not self.chat_history:
            return "No previous chatbot turns."

        lines = []

        for item in self.chat_history[-self.MAX_HISTORY_TURNS * 2:]:

            role = item["role"].upper()
            content = item["content"][:1800]

            lines.append(f"{role}: {content}")

        return "\n".join(lines)

    def _is_retryable_api_error(self, error):

        text = str(error).lower()

        return any(
            marker in text
            for marker in [
                "429",
                "503",
                "resource_exhausted",
                "unavailable",
                "high demand",
                "rate limit",
                "quota",
            ]
        )

    def _generate_text_with_fallback(self, prompt):

        last_error = None

        for model in self.MODEL_CANDIDATES:

            try:

                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                )

                text = (response.text or "").strip()

                if text:
                    return text

            except Exception as error:

                last_error = error

                print(
                    f"Gemini model {model} failed: {error}"
                )

                if not self._is_retryable_api_error(error):
                    raise

                # Move quickly to another model instead of making the user
                # repeatedly wait on one overloaded endpoint.
                time.sleep(0.35)

        if last_error:
            raise last_error

        raise RuntimeError("Gemini returned an empty response.")

    def _stream_text_with_fallback(self, prompt):

        last_error = None

        for model in self.MODEL_CANDIDATES:

            chunks = []

            try:

                stream = client.models.generate_content_stream(
                    model=model,
                    contents=prompt,
                )

                for chunk in stream:

                    chunk_text = getattr(chunk, "text", None)

                    if chunk_text:
                        chunks.append(chunk_text)

                answer = "".join(chunks).strip()

                if answer:

                    # We buffer one model attempt so a failed model cannot leave
                    # a half-answer in the UI. Once successful, emit small chunks
                    # and preserve the frontend's continuous typing effect.
                    chunk_size = 90

                    for index in range(0, len(answer), chunk_size):
                        yield answer[index:index + chunk_size]

                    return

            except Exception as error:

                last_error = error

                print(
                    f"Gemini stream model {model} failed: {error}"
                )

                if not self._is_retryable_api_error(error):
                    raise

                time.sleep(0.35)

        if last_error:
            raise last_error

        raise RuntimeError("Gemini returned an empty streamed response.")

    def _local_summary(self):

        dataframe = self.dataframe

        if dataframe is None:
            return "No dataset is currently loaded."

        rows, columns = dataframe.shape

        friendly_labels = []

        label_map = {
            "employee": "employee details",
            "department": "departments",
            "job": "job roles",
            "region": "locations",
            "salary": "compensation",
            "bonus": "bonuses",
            "performance": "performance",
            "training": "training",
            "satisfaction": "employee satisfaction",
            "attrition": "employee retention",
            "remote": "remote working",
            "promotion": "promotions",
        }

        for column in dataframe.columns:

            normalized = self._normalize(column)

            for key, label in label_map.items():

                if key in normalized and label not in friendly_labels:

                    friendly_labels.append(label)

        if not friendly_labels:

            friendly_labels = [
                str(column).replace("_", " ").lower()
                for column in dataframe.columns[:5]
            ]

        topic_text = ", ".join(friendly_labels[:6])

        return (
            f"This dataset contains **{rows:,} employee records** and gives a broad "
            f"view of the workforce. It brings together information about {topic_text}, "
            "so users can look at both employee characteristics and workplace outcomes "
            "in one place. The data is useful for comparing different employee groups, "
            "spotting patterns in areas such as pay and performance, and exploring factors "
            "that may be linked with satisfaction or retention. Overall, it provides a "
            "well-rounded dataset for workforce analysis without focusing on just one metric.\n\n"
            "**Key insights:**\n"
            "- Covers both employee background information and workplace performance.\n"
            "- Supports comparisons across teams, locations and job roles.\n"
            "- Useful for exploring patterns in compensation, satisfaction and employee retention."
        )

    def _local_fallback_answer(self, user_input):

        dataframe = self.dataframe

        if dataframe is None:
            return "No dataset is currently loaded."

        normalized = self._normalize(user_input)
        mentioned = self._find_mentioned_columns(user_input)

        summary_request = any(
            phrase in normalized
            for phrase in [
                "summarize",
                "summary",
                "overview",
                "what is this dataset about",
                "what is the dataset about",
            ]
        )

        if summary_request:
            return self._local_summary()

        if "advantage" in normalized or "strength" in normalized:

            missing = int(dataframe.isna().sum().sum())
            numeric_count = sum(
                pd.api.types.is_numeric_dtype(dataframe[column])
                for column in dataframe.columns
            )

            return (
                f"This dataset has **{len(dataframe):,} rows** across "
                f"**{len(dataframe.columns)} columns**, giving it a substantial "
                "sample for exploration. It includes both categorical and numeric "
                f"information (**{numeric_count} numeric columns**), so it supports "
                "group comparisons, statistical summaries and visualization. "
                f"Across the whole table there are **{missing:,} missing cells**, "
                "which also makes it useful for demonstrating data-quality checks."
            )

        if mentioned:

            sections = []

            for column in mentioned[:4]:

                series = dataframe[column]

                if pd.api.types.is_numeric_dtype(series):

                    stats = self._numeric_stats(series)

                    if stats:

                        mode_text = ", ".join(
                            f"{value:,.6g}"
                            for value in stats["mode"]
                        )

                        sections.append(
                            f"**{column}**\n\n"
                            f"| Statistic | Value |\n"
                            f"|---|---:|\n"
                            f"| Sum | {stats['sum']:,.6g} |\n"
                            f"| Average (Mean) | {stats['mean']:,.6g} |\n"
                            f"| Median | {stats['median']:,.6g} |\n"
                            f"| Mode | {mode_text} |\n"
                            f"| Minimum | {stats['minimum']:,.6g} |\n"
                            f"| Maximum | {stats['maximum']:,.6g} |"
                        )

                else:

                    counts = (
                        series
                        .fillna("Missing")
                        .astype(str)
                        .value_counts()
                        .head(10)
                    )

                    rows = "\n".join(
                        f"| {self._safe_value(value)} | {int(count):,} |"
                        for value, count in counts.items()
                    )

                    sections.append(
                        f"**{column} — most common values**\n\n"
                        f"| Value | Count |\n"
                        f"|---|---:|\n"
                        f"{rows}"
                    )

            if sections:
                return "\n\n".join(sections)

        if any(
            word in normalized
            for word in [
                "insight",
                "pattern",
                "trend",
                "explore",
                "analyse",
                "analyze",
            ]
        ):

            insights = []

            for column in dataframe.columns:

                if pd.api.types.is_numeric_dtype(dataframe[column]):
                    stats = self._numeric_stats(dataframe[column])

                    if stats:
                        insights.append(
                            f"- **{column}** ranges from "
                            f"{stats['minimum']:,.6g} to {stats['maximum']:,.6g} "
                            f"with an average of {stats['mean']:,.6g}."
                        )

                else:

                    counts = (
                        dataframe[column]
                        .dropna()
                        .astype(str)
                        .value_counts()
                    )

                    if 1 < len(counts) <= 20 and not counts.empty:

                        insights.append(
                            f"- **{column}** is led by "
                            f"**{self._safe_value(counts.index[0])}** "
                            f"with **{int(counts.iloc[0]):,} rows**."
                        )

                if len(insights) >= 6:
                    break

            if insights:
                return (
                    "Here are several dataset-grounded observations:\n\n"
                    + "\n".join(insights)
                )

        return (
            "The dataset is loaded correctly, but the external AI model is "
            "temporarily busy. I can still answer exact questions about specific "
            "columns, statistics, distributions, summaries and comparisons from "
            "the local Pandas analysis."
        )

    def load_dataset(self, file_bytes, filename="dataset.csv"):

        try:

            print("Preparing compact dataset context for Gemini...")

            dataframe = pd.read_csv(io.BytesIO(file_bytes))

            self.dataframe = dataframe.copy()
            self.filename = filename
            self.dataset_overview = self._build_dataset_overview()
            self.chat_history = []

            # We deliberately do NOT upload the full CSV to Gemini.
            # Sending 15k+ rows on every question can exceed both the
            # per-minute free-tier input-token quota and the model context limit.
            self.uploaded_file = None
            self.previous_interaction_id = None

            print(
                "Dataset context ready! "
                f"Rows: {len(dataframe):,}, "
                f"Columns: {len(dataframe.columns)}, "
                f"Context chars: {len(self.dataset_overview):,}"
            )

            return True

        except Exception as error:

            print("ERROR preparing dataset context:", error)

            raise

    def build_prompt(self, user_input):

        question_context = self._build_question_context(user_input)
        normalized_question = self._normalize(user_input)

        is_summary_request = any(
            phrase in normalized_question
            for phrase in [
                "summarize",
                "summary",
                "overview",
                "what is this dataset about",
                "what is the dataset about",
            ]
        )

        if is_summary_request:
            response_style = """
SPECIAL STYLE FOR DATASET SUMMARY:
- Write for a normal user, not a data analyst.
- Start with ONE natural paragraph of about 4 to 6 sentences.
- Explain what the dataset is about, what kinds of information it contains,
  and what it can be useful for.
- After the paragraph, include only 2 or 3 short bullet points under
  **Key insights:**.
- Keep the language simple, natural and conversational.
- Translate technical column names into human-friendly wording.
  For example:
  Salary_EUR -> salary or compensation
  Satisfaction_Score -> employee satisfaction
  Attrition_Status -> employee retention / whether employees stayed or left
  Performance_Score -> performance
  Remote_Days_Per_Week -> remote working
- Do NOT list every column, category, average, range or statistic.
- Do NOT turn the answer into a metrics report.
- Mention only 1 or 2 numbers if they genuinely help explain the dataset.
- Avoid raw column names unless the user explicitly asks for them.
"""
        else:
            response_style = """
RESPONSE STYLE:
- Answer the user's exact question directly.
- Prefer plain-language wording.
- Use calculations and tables when they are useful.
"""

        return f"""
You are the AI data assistant for one uploaded CSV dataset.

Answer ONLY from the dataset context and exact Pandas results supplied below.

IMPORTANT:
- Do not invent values.
- Treat the supplied Pandas calculations as authoritative.
- If exact Pandas results are supplied for the user's question, use those numbers.
- Do not answer unrelated general knowledge questions.
- Do not provide programming or coding help.
- If the question is unrelated to the dataset, reply exactly:
I can only answer questions about the uploaded dataset.
- Keep answers clear and concise.
- Use Markdown tables when useful.
- Never use HTML tags.
- If information needed to answer is not present in the supplied context, say that the available dataset context is insufficient rather than guessing.

{response_style}

DATASET CONTEXT:
{self.dataset_overview}

QUESTION-SPECIFIC CONTEXT:
{question_context if question_context else "No additional exact calculation was needed."}

RECENT CHAT CONTEXT:
{self._history_text()}

USER QUESTION:
{user_input}
"""

    def summarize_dataset(self, filename, rows, columns):

        if self.dataframe is None:

            raise RuntimeError("No dataset has been loaded.")

        prompt = f"""
Create one concise natural-language overview of the uploaded CSV dataset.

Use ONLY the dataset context below.

File name: {filename}
Rows: {rows}
Columns: {columns}

DATASET CONTEXT:
{self.dataset_overview}

Write ONE paragraph of about 4 to 6 sentences.
Explain what the dataset appears to contain, the main kinds of fields,
and useful analysis it could support.

Do not focus on missing values or duplicates.
Do not use headings, bullet points, tables, HTML, or Markdown.
Do not invent anything.
Return only the paragraph.
"""

        try:

            return self._generate_text_with_fallback(prompt)

        except Exception as error:

            print("DATASET SUMMARY MODEL ERROR:", error)

            return self._local_summary()

    def summarize_dataset_stream(
        self,
        filename,
        rows,
        columns,
        column_profile,
    ):

        if self.dataframe is None:

            raise RuntimeError("No dataset has been loaded.")

        prompt = f"""
Create one concise natural-language overview of a CSV dataset for a dashboard.

Use ONLY the compact dataset information supplied below.

File name: {filename}
Rows: {rows}
Columns: {columns}

COMPACT DATASET CONTEXT:
{self.dataset_overview}

Write ONE natural paragraph of about 4 to 6 sentences.
Explain what the dataset appears to contain, describe the main types of
information represented by the columns, and mention useful analysis,
comparisons, or visualizations the data could support.

Do not focus on missing values, duplicates, or data-quality problems.
Do not use headings, bullets, tables, HTML, or Markdown.
Do not invent facts.
Return only the paragraph.
"""

        try:

            for chunk in self._stream_text_with_fallback(prompt):
                yield chunk

        except Exception as error:

            print("========== DATASET SUMMARY STREAM ERROR ==========")
            print(error)
            print("==================================================")

            fallback = self._local_summary()

            for index in range(0, len(fallback), 90):
                yield fallback[index:index + 90]

    def ask(self, user_input):

        user_input = user_input.strip()

        if not user_input:

            return ""

        if self.dataframe is None:

            raise RuntimeError("No dataset has been loaded.")

        prompt = self.build_prompt(user_input)

        try:

            answer = self._generate_text_with_fallback(prompt)

        except Exception as error:

            print("CHAT MODEL FALLBACK:", error)

            answer = self._local_fallback_answer(user_input)

        self.chat_history.extend([
            {
                "role": "user",
                "content": user_input,
            },
            {
                "role": "assistant",
                "content": answer,
            },
        ])

        return answer

    def ask_stream(self, user_input):

        user_input = user_input.strip()

        if not user_input:

            return

        if self.dataframe is None:

            raise RuntimeError("No dataset has been loaded.")

        prompt = self.build_prompt(user_input)

        answer_parts = []

        try:

            for chunk in self._stream_text_with_fallback(prompt):

                answer_parts.append(chunk)

                yield chunk

        except Exception as error:

            print("========== GEMINI STREAM FALLBACK ==========")
            print(error)
            print("============================================")

            fallback = self._local_fallback_answer(user_input)

            answer_parts = []

            for index in range(0, len(fallback), 90):

                chunk = fallback[index:index + 90]

                answer_parts.append(chunk)

                yield chunk

        answer = "".join(answer_parts).strip()

        if answer:

            self.chat_history.extend([
                {
                    "role": "user",
                    "content": user_input,
                },
                {
                    "role": "assistant",
                    "content": answer,
                },
            ])

    def reset_chat(self):

        self.chat_history = []
        self.previous_interaction_id = None


gemini_chat = GeminiDatasetChat()
