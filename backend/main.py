import io

import pandas as pd
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database import Base, engine, get_db
from gemini_chat import gemini_chat
from models import Dataset, User
from visualization_recommendations import build_visualization_recommendations

Base.metadata.create_all(bind=engine)

app = FastAPI()

# Keeps each logged-in user's currently opened dataset in memory so the
# existing dashboard, data-quality, visualization and chatbot endpoints
# can continue using Pandas exactly as before.
active_datasets = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str


class AuthRequest(BaseModel):
    username: str
    password: str


def validate_credentials(username: str, password: str):
    clean_username = username.strip()

    if len(clean_username) < 3 or len(clean_username) > 50:
        raise HTTPException(
            status_code=400,
            detail="Username must be between 3 and 50 characters.",
        )

    if len(password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least 6 characters.",
        )

    if len(password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=400,
            detail="Password is too long. Please use 72 bytes or fewer.",
        )

    return clean_username


def auth_response(user: User):
    return {
        "access_token": create_access_token(user.id, user.username),
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
        },
    }


def set_active_dataset(user_id: int, dataframe: pd.DataFrame, filename: str):
    active_datasets[user_id] = {
        "dataframe": dataframe.copy(),
        "filename": filename,
    }


def require_active_dataset(user_id: int):
    active = active_datasets.get(user_id)

    if active is None:
        raise HTTPException(
            status_code=400,
            detail="No dataset is currently open. Upload or open a saved dataset first.",
        )

    return active["dataframe"], active["filename"]


def build_dataset_response(
    dataframe: pd.DataFrame,
    filename: str,
    dataset_id: int | None = None,
):
    rows, columns = dataframe.shape
    missing_values = int(dataframe.isnull().sum().sum())
    missing_by_column = dataframe.isnull().sum().astype(int).to_dict()
    data_types = {column: str(dtype) for column, dtype in dataframe.dtypes.items()}
    inconsistent_values = []

    for column in dataframe.columns:
        if not (
            pd.api.types.is_object_dtype(dataframe[column])
            or pd.api.types.is_string_dtype(dataframe[column])
        ):
            continue

        original_series = dataframe[column].dropna().astype(str)
        if original_series.empty:
            continue

        normalized_series = (
            original_series.str.strip()
            .str.lower()
            .str.replace(r"\s+", " ", regex=True)
        )

        comparison_df = pd.DataFrame(
            {
                "original": original_series.values,
                "normalized": normalized_series.values,
            }
        )

        grouped = comparison_df.groupby("normalized")["original"].unique()

        for normalized_value, variants in grouped.items():
            variants = [str(value) for value in variants]
            if len(variants) <= 1:
                continue

            total_count = int(
                (comparison_df["normalized"] == normalized_value).sum()
            )
            inconsistent_values.append(
                {
                    "column": column,
                    "normalized_value": normalized_value,
                    "variants": variants,
                    "variant_count": len(variants),
                    "row_count": total_count,
                }
            )

    duplicate_rows = int(dataframe.duplicated().sum())
    visualization_overview = build_visualization_recommendations(dataframe)

    exact_duplicates = (
        dataframe[dataframe.duplicated(keep=False)]
        .copy()
        .fillna("")
        .head(50)
        .to_dict(orient="records")
    )

    response = {
        "filename": filename,
        "rows": rows,
        "columns": columns,
        "missing_values": missing_values,
        "missing_by_column": missing_by_column,
        "duplicate_rows": duplicate_rows,
        "exact_duplicates": exact_duplicates,
        "data_types": data_types,
        "column_names": dataframe.columns.tolist(),
        "inconsistent_values": inconsistent_values,
        "preview": dataframe.head(10).fillna("").to_dict(orient="records"),
        "visualization_overview": visualization_overview,
    }

    if dataset_id is not None:
        response["dataset_id"] = dataset_id

    return response


@app.get("/")
def home():
    return {"message": "AI Data Insight backend is running"}


@app.post("/auth/register")
def register(request: AuthRequest, db: Session = Depends(get_db)):
    username = validate_credentials(request.username, request.password)

    existing_user = (
        db.query(User)
        .filter(func.lower(User.username) == username.lower())
        .first()
    )

    if existing_user:
        raise HTTPException(status_code=409, detail="That username already exists.")

    user = User(
        username=username,
        password_hash=hash_password(request.password),
    )

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username already exists.")

    return auth_response(user)


@app.post("/auth/login")
def login(request: AuthRequest, db: Session = Depends(get_db)):
    username = request.username.strip()

    user = (
        db.query(User)
        .filter(func.lower(User.username) == username.lower())
        .first()
    )

    if user is None or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    return auth_response(user)


@app.get("/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
    }


@app.post("/upload")
async def upload_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filename = file.filename or "dataset.csv"

    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")

    contents = await file.read()

    try:
        dataframe = pd.read_csv(io.BytesIO(contents))
    except Exception as error:
        print("PANDAS ERROR:", error)
        raise HTTPException(status_code=400, detail="The CSV file could not be read.")

    try:
        gemini_chat.load_dataset(contents, filename)
    except Exception as error:
        print("GEMINI UPLOAD ERROR:", error)
        raise HTTPException(
            status_code=500,
            detail="The CSV was loaded locally, but could not be uploaded to Gemini.",
        )

    dataset_response = build_dataset_response(dataframe, filename)

    dataset_record = Dataset(
        user_id=current_user.id,
        filename=filename,
        csv_data=contents,
        row_count=int(dataframe.shape[0]),
        column_count=int(dataframe.shape[1]),
    )

    try:
        db.add(dataset_record)
        db.commit()
        db.refresh(dataset_record)
    except Exception as error:
        db.rollback()
        print("DATABASE SAVE ERROR:", error)
        raise HTTPException(
            status_code=500,
            detail="The CSV was analysed but could not be saved to MySQL.",
        )

    set_active_dataset(current_user.id, dataframe, filename)
    dataset_response["dataset_id"] = dataset_record.id

    return dataset_response


@app.get("/datasets")
def get_recent_datasets(
    limit: int = 8,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 25))

    records = (
        db.query(
            Dataset.id,
            Dataset.filename,
            Dataset.row_count,
            Dataset.column_count,
            Dataset.uploaded_at,
        )
        .filter(Dataset.user_id == current_user.id)
        .order_by(Dataset.uploaded_at.desc(), Dataset.id.desc())
        .limit(limit)
        .all()
    )

    return {
        "datasets": [
            {
                "id": record.id,
                "filename": record.filename,
                "rows": record.row_count,
                "columns": record.column_count,
                "uploaded_at": (
                    record.uploaded_at.isoformat()
                    if record.uploaded_at
                    else None
                ),
            }
            for record in records
        ]
    }


@app.post("/datasets/{dataset_id}/open")
def open_saved_dataset(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset = (
        db.query(Dataset)
        .filter(
            Dataset.id == dataset_id,
            Dataset.user_id == current_user.id,
        )
        .first()
    )

    if dataset is None:
        raise HTTPException(status_code=404, detail="Saved dataset was not found.")

    contents = bytes(dataset.csv_data)

    try:
        dataframe = pd.read_csv(io.BytesIO(contents))
    except Exception as error:
        print("SAVED DATASET READ ERROR:", error)
        raise HTTPException(
            status_code=500,
            detail="The saved CSV could not be reopened.",
        )

    try:
        gemini_chat.load_dataset(contents, dataset.filename)
    except Exception as error:
        print("GEMINI REOPEN ERROR:", error)
        raise HTTPException(
            status_code=500,
            detail="The saved CSV was found, but could not be loaded into Gemini.",
        )

    set_active_dataset(current_user.id, dataframe, dataset.filename)

    return build_dataset_response(
        dataframe,
        dataset.filename,
        dataset_id=dataset.id,
    )


@app.get("/dataset-summary")
def get_dataset_summary(current_user: User = Depends(get_current_user)):
    uploaded_dataframe, uploaded_filename = require_active_dataset(current_user.id)
    dataframe = uploaded_dataframe.copy()
    rows, columns = dataframe.shape
    filename = uploaded_filename or "dataset.csv"

    try:
        summary = gemini_chat.summarize_dataset(
            filename=filename,
            rows=rows,
            columns=columns,
        )

        if summary:
            return {"summary": summary}

    except Exception as error:
        print("DATASET SUMMARY ERROR:", error)

    readable_columns = [
        str(column).replace("_", " ").strip()
        for column in dataframe.columns[:10]
    ]

    if len(readable_columns) == 1:
        column_text = readable_columns[0]
    elif len(readable_columns) == 2:
        column_text = " and ".join(readable_columns)
    else:
        column_text = ", ".join(readable_columns[:-1]) + f", and {readable_columns[-1]}"

    extra_columns = columns - len(readable_columns)
    if extra_columns > 0:
        column_text += f", along with {extra_columns} additional fields"

    fallback_summary = (
        f"The {filename} file contains {rows:,} records across {columns:,} columns. "
        f"It includes information such as {column_text}. "
        "The dataset can be used to explore patterns, compare values across categories, "
        "create visualizations, and investigate relationships between the available fields. "
        "Overall, it provides a structured collection of data that can support further analysis "
        "based on the information captured in its columns."
    )

    return {"summary": fallback_summary}


@app.get("/dataset-summary-stream")
def stream_dataset_summary(current_user: User = Depends(get_current_user)):
    uploaded_dataframe, uploaded_filename = require_active_dataset(current_user.id)
    dataframe = uploaded_dataframe.copy()
    rows, columns = dataframe.shape
    filename = uploaded_filename or "dataset.csv"
    column_profile = []

    for column in dataframe.columns:
        series = dataframe[column].dropna()

        samples = (
            series.astype(str)
            .drop_duplicates()
            .head(3)
            .tolist()
        )

        profile = {
            "column": str(column),
            "data_type": str(dataframe[column].dtype),
            "sample_values": samples,
        }

        if pd.api.types.is_numeric_dtype(dataframe[column]) and not series.empty:
            profile["minimum"] = float(series.min())
            profile["maximum"] = float(series.max())

        column_profile.append(profile)

    if len(column_profile) > 40:
        hidden_columns = len(column_profile) - 40
        column_profile = column_profile[:40]
        column_profile.append(
            {
                "note": (
                    f"{hidden_columns} additional columns are present but omitted "
                    "from this compact summary context."
                )
            }
        )

    def generate():
        try:
            for chunk in gemini_chat.summarize_dataset_stream(
                filename=filename,
                rows=rows,
                columns=columns,
                column_profile=column_profile,
            ):
                yield chunk

        except Exception as error:
            print("DATASET SUMMARY STREAM ERROR:", error)

            readable_columns = [
                str(column).replace("_", " ").strip()
                for column in dataframe.columns[:8]
            ]

            fields = ", ".join(readable_columns)

            yield (
                f"The {filename} file contains {rows:,} records across "
                f"{columns:,} columns. "
                + (f"It includes information such as {fields}. " if fields else "")
                + "The dataset provides structured information that can be "
                "explored through comparisons, visualizations, and analysis "
                "of the available fields."
            )

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/rows")
def get_dataset_rows(
    offset: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
):
    uploaded_dataframe, _ = require_active_dataset(current_user.id)
    offset = max(0, offset)
    limit = max(1, min(limit, 500))
    total_rows = int(len(uploaded_dataframe))
    end = min(offset + limit, total_rows)

    rows = (
        uploaded_dataframe.iloc[offset:end]
        .fillna("")
        .to_dict(orient="records")
    )

    return {
        "offset": offset,
        "limit": limit,
        "total_rows": total_rows,
        "has_more": end < total_rows,
        "rows": rows,
    }


@app.get("/search")
def search_dataset(
    query: str,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
):
    uploaded_dataframe, _ = require_active_dataset(current_user.id)
    search_text = query.strip()

    if not search_text:
        raise HTTPException(status_code=400, detail="Please enter a search value.")

    limit = max(1, min(limit, 200))
    dataframe = uploaded_dataframe.copy()
    normalized_query = search_text.lower()

    matched_columns = [
        column
        for column in dataframe.columns
        if normalized_query in str(column).lower()
    ]

    if matched_columns:
        rows = (
            dataframe[matched_columns]
            .head(limit)
            .fillna("")
            .to_dict(orient="records")
        )

        return {
            "query": search_text,
            "total_matches": int(len(dataframe)),
            "matched_columns": matched_columns,
            "rows": rows,
        }

    mask = pd.Series(False, index=dataframe.index)

    for column in dataframe.columns:
        values = dataframe[column].fillna("").astype(str)
        mask = mask | values.str.contains(
            search_text,
            case=False,
            regex=False,
            na=False,
        )

    matches = dataframe[mask]

    return {
        "query": search_text,
        "total_matches": int(len(matches)),
        "matched_columns": [],
        "rows": (
            matches.head(limit)
            .fillna("")
            .to_dict(orient="records")
        ),
    }


@app.get("/quality/duplicates")
def get_quality_duplicates(
    query: str = "",
    offset: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
):
    uploaded_dataframe, _ = require_active_dataset(current_user.id)
    dataframe = uploaded_dataframe.copy()
    duplicates = dataframe[dataframe.duplicated(keep=False)].copy()
    search_text = query.strip()

    if search_text:
        mask = pd.Series(False, index=duplicates.index)

        for column in duplicates.columns:
            values = duplicates[column].fillna("").astype(str)
            mask = mask | values.str.contains(
                search_text,
                case=False,
                regex=False,
                na=False,
            )

        duplicates = duplicates[mask]

    offset = max(0, offset)
    limit = max(1, min(limit, 500))
    total_matches = int(len(duplicates))
    end = min(offset + limit, total_matches)

    rows = (
        duplicates.iloc[offset:end]
        .fillna("")
        .to_dict(orient="records")
    )

    return {
        "query": search_text,
        "offset": offset,
        "limit": limit,
        "total_matches": total_matches,
        "has_more": end < total_matches,
        "columns": dataframe.columns.tolist(),
        "rows": rows,
    }


@app.get("/quality/duplicates/export")
def export_quality_duplicates(
    query: str = "",
    current_user: User = Depends(get_current_user),
):
    uploaded_dataframe, _ = require_active_dataset(current_user.id)
    dataframe = uploaded_dataframe.copy()
    duplicates = dataframe[dataframe.duplicated(keep=False)].copy()
    search_text = query.strip()

    if search_text:
        mask = pd.Series(False, index=duplicates.index)

        for column in duplicates.columns:
            values = duplicates[column].fillna("").astype(str)
            mask = mask | values.str.contains(
                search_text,
                case=False,
                regex=False,
                na=False,
            )

        duplicates = duplicates[mask]

    csv_buffer = io.StringIO()
    duplicates.fillna("").to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)

    filename = (
        "exact_duplicates_filtered.csv"
        if search_text
        else "exact_duplicates.csv"
    )

    return StreamingResponse(
        iter([csv_buffer.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@app.get("/columns")
def get_columns(current_user: User = Depends(get_current_user)):
    uploaded_dataframe, _ = require_active_dataset(current_user.id)
    columns_info = []

    for column in uploaded_dataframe.columns:
        series = uploaded_dataframe[column]
        dtype = str(series.dtype)

        if pd.api.types.is_numeric_dtype(series):
            column_type = "numeric"
        elif pd.api.types.is_datetime64_any_dtype(series):
            column_type = "datetime"
        else:
            column_type = "categorical"

        columns_info.append(
            {"name": column, "data_type": dtype, "type": column_type}
        )

    return {"columns": columns_info}


@app.get("/visualization")
def get_visualization_data(
    chart_type: str,
    x_column: str,
    y_column: str = None,
    group_column: str = None,
    current_user: User = Depends(get_current_user),
):
    uploaded_dataframe, _ = require_active_dataset(current_user.id)
    dataframe = uploaded_dataframe.copy()

    if x_column not in dataframe.columns:
        raise HTTPException(status_code=400, detail="Invalid X-axis column.")
    if y_column and y_column not in dataframe.columns:
        raise HTTPException(status_code=400, detail="Invalid Y-axis column.")
    if group_column and group_column not in dataframe.columns:
        raise HTTPException(status_code=400, detail="Invalid grouping column.")

    def normalize_category(series):
        return (
            series.fillna("Missing")
            .astype(str)
            .str.strip()
            .str.lower()
            .str.replace(r"\s+", " ", regex=True)
            .str.title()
        )

    if chart_type in ["bar", "horizontal-bar", "pie"]:
        dataframe[x_column] = normalize_category(dataframe[x_column])

        if y_column:
            if not pd.api.types.is_numeric_dtype(dataframe[y_column]):
                raise HTTPException(status_code=400, detail="Y-axis must be numeric.")

            grouped = (
                dataframe.groupby(x_column, dropna=False)[y_column]
                .sum()
                .reset_index()
            )
            result = [
                {"name": str(row[x_column]), "value": float(row[y_column])}
                for _, row in grouped.iterrows()
            ]
        else:
            grouped = dataframe[x_column].value_counts(dropna=False).reset_index()
            grouped.columns = ["name", "value"]
            result = [
                {"name": str(row["name"]), "value": int(row["value"])}
                for _, row in grouped.iterrows()
            ]

        return {"chart_type": chart_type, "data": result}

    if chart_type == "line":
        if not y_column:
            raise HTTPException(
                status_code=400, detail="Line chart requires a Y-axis."
            )
        if not pd.api.types.is_numeric_dtype(dataframe[y_column]):
            raise HTTPException(status_code=400, detail="Y-axis must be numeric.")

        converted_dates = pd.to_datetime(dataframe[x_column], errors="coerce")
        date_ratio = converted_dates.notna().mean()

        if date_ratio >= 0.8:
            dataframe[x_column] = converted_dates
            grouped = (
                dataframe.dropna(subset=[x_column])
                .groupby(x_column)[y_column]
                .sum()
                .reset_index()
                .sort_values(by=x_column)
            )
            result = [
                {
                    "name": row[x_column].strftime("%Y-%m-%d"),
                    "value": float(row[y_column]),
                }
                for _, row in grouped.iterrows()
            ]
        else:
            grouped = dataframe.groupby(x_column)[y_column].sum().reset_index()
            result = [
                {"name": str(row[x_column]), "value": float(row[y_column])}
                for _, row in grouped.iterrows()
            ]

        return {"chart_type": chart_type, "data": result}

    if chart_type == "stacked-horizontal-bar":
        if not y_column or not group_column:
            raise HTTPException(
                status_code=400,
                detail="Stacked bar requires X, Y and Group columns.",
            )
        if not pd.api.types.is_numeric_dtype(dataframe[y_column]):
            raise HTTPException(status_code=400, detail="Y-axis must be numeric.")

        dataframe[x_column] = normalize_category(dataframe[x_column])
        dataframe[group_column] = normalize_category(dataframe[group_column])

        pivot = (
            dataframe.pivot_table(
                index=x_column,
                columns=group_column,
                values=y_column,
                aggfunc="sum",
                fill_value=0,
            )
            .reset_index()
        )

        groups = [column for column in pivot.columns if column != x_column]
        data = []

        for _, row in pivot.iterrows():
            record = {x_column: str(row[x_column])}
            for group in groups:
                record[str(group)] = float(row[group])
            data.append(record)

        return {
            "chart_type": chart_type,
            "data": data,
            "groups": [str(group) for group in groups],
        }

    if chart_type == "scatter":
        if not y_column:
            raise HTTPException(
                status_code=400, detail="Scatter plot requires X and Y columns."
            )
        if not pd.api.types.is_numeric_dtype(dataframe[x_column]):
            raise HTTPException(
                status_code=400, detail="Scatter plot X-axis must be numeric."
            )
        if not pd.api.types.is_numeric_dtype(dataframe[y_column]):
            raise HTTPException(
                status_code=400, detail="Scatter plot Y-axis must be numeric."
            )

        scatter_dataframe = dataframe[[x_column, y_column]].dropna()
        result = [
            {"x": float(row[x_column]), "y": float(row[y_column])}
            for _, row in scatter_dataframe.iterrows()
        ]

        return {"chart_type": chart_type, "data": result}

    if chart_type == "histogram":
        if not pd.api.types.is_numeric_dtype(dataframe[x_column]):
            raise HTTPException(
                status_code=400,
                detail="Histogram requires a numeric column.",
            )

        values = dataframe[x_column].dropna()
        if values.empty:
            raise HTTPException(
                status_code=400,
                detail="Selected column does not contain numeric values.",
            )

        histogram = pd.cut(values, bins=10).value_counts().sort_index()
        result = [
            {"name": str(interval), "value": int(count)}
            for interval, count in histogram.items()
        ]

        return {"chart_type": chart_type, "data": result}

    raise HTTPException(status_code=400, detail="Unsupported chart type.")


@app.post("/chat")
def chat_with_data(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    require_active_dataset(current_user.id)
    question = request.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Please enter a message.")

    try:
        return {"answer": gemini_chat.ask(question)}
    except Exception as error:
        print("CHAT ERROR:", error)
        raise HTTPException(status_code=500, detail=str(error))


@app.post("/chat-stream")
def chat_stream(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
):
    require_active_dataset(current_user.id)
    question = request.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Please enter a message.")

    def generate():
        try:
            for chunk in gemini_chat.ask_stream(question):
                yield chunk
        except Exception as error:
            error_text = str(error)
            error_lower = error_text.lower()

            print("========== GEMINI STREAM ERROR ==========")
            print(error_text)
            print("=========================================")

            if (
                "429" in error_text
                or "rate limit" in error_lower
                or "too_many_requests" in error_lower
            ):
                yield "\n\nGemini rate limit reached. Please wait and try again."
                return

            if "timeout" in error_lower or "timed out" in error_lower:
                yield "\n\nGemini took too long to respond. Please try again."
                return

            if "503" in error_text or "unavailable" in error_lower:
                yield "\n\nGemini is temporarily unavailable. Please try again shortly."
                return

            yield (
                "\n\nGemini encountered an error. "
                "Please check the backend terminal."
            )

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/reset-chat")
def reset_chat(current_user: User = Depends(get_current_user)):
    require_active_dataset(current_user.id)
    gemini_chat.reset_chat()
    return {"message": "Conversation reset successfully."}
