# AI-Powered Data Insight Assistant

A full-stack web application for uploading CSV datasets, exploring data quality, creating visualizations, and asking dataset-grounded analytical questions through an AI-assisted interface.

## Features

- User registration and sign-in
- CSV upload and validation
- Saved datasets with MySQL persistence
- Recent uploads with the ability to reopen a previous dataset
- Dashboard with dataset overview, statistics, and data preview
- Data-quality analysis for missing values, duplicates, inconsistent values, and data types
- Interactive data visualizations
- Suggested charts generated from the uploaded dataset
- AI-assisted dataset questions
- Streaming chatbot responses
- Dataset-grounded calculations using Pandas
- Graceful handling of unsupported or unrelated questions
- Local analytical fallback when the external AI service is temporarily unavailable

## Technology Stack

### Frontend
- React
- Vite
- JavaScript
- CSS
- Recharts
- Lucide React
- React Markdown

### Backend
- Python
- FastAPI
- Pandas
- SQLAlchemy
- PyMySQL
- bcrypt
- JWT authentication
- Google Gemini API (`google-genai`)

### Database
- MySQL

## Architecture

```text
React / Vite Frontend
        |
        | HTTP / JSON
        v
FastAPI Backend
        |
        +------------------+
        |                  |
        v                  v
      Pandas             MySQL
  Data processing     Users + saved CSVs
        |
        v
 Compact grounded context
        |
        v
   Gemini AI API
```

The frontend is responsible for the user interface, navigation, charts, and chatbot experience.

The FastAPI backend handles authentication, CSV processing, data-quality checks, visualization data, saved datasets, and AI requests.

Pandas performs the factual dataset calculations. Gemini is primarily used to explain and summarize grounded results in natural language.

MySQL stores user accounts and uploaded CSV files so users can reopen datasets without uploading them again.

## Project Structure

```text
AI/
|
|-- backend/
|   |-- auth.py
|   |-- database.py
|   |-- gemini_chat.py
|   |-- main.py
|   |-- models.py
|   |-- requirements.txt
|   |-- visualization_recommendations.py
|   `-- .env                 # local only - DO NOT COMMIT
|
|-- frontend/
|   |-- src/
|   |   |-- components/
|   |   |   |-- Sidebar.jsx
|   |   |   `-- VisualizationChart.jsx
|   |   |
|   |   |-- pages/
|   |   |   |-- LoginPage.jsx
|   |   |   |-- UploadPage.jsx
|   |   |   |-- DashboardPage.jsx
|   |   |   |-- DataQualityPage.jsx
|   |   |   |-- DataVisualizationPage.jsx
|   |   |   `-- ChatbotPage.jsx
|   |   |
|   |   |-- App.jsx
|   |   |-- App.css
|   |   `-- main.jsx
|   |
|   |-- package.json
|   `-- vite.config.js
|
|-- AI_FLOW_AND_HALLUCINATION_MITIGATION.md
|-- .gitignore
`-- README.md
```

## Setup Instructions

### Prerequisites

Install:

- Python 3.10+
- Node.js and npm
- MySQL 8+
- A Google Gemini API key

## 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_REPOSITORY_FOLDER>
```

## 2. Create the MySQL database

Open MySQL and run:

```sql
CREATE DATABASE IF NOT EXISTS ai_data_insight
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
```

The backend uses SQLAlchemy to create the required tables when it starts.

The application uses two main tables:

```text
users
- id
- username
- password_hash
- created_at

datasets
- id
- user_id
- filename
- csv_data
- row_count
- column_count
- uploaded_at
```

## 3. Backend setup

Open a terminal in the `backend` folder:

```bash
cd backend
python -m venv venv
```

### Windows

```bash
venv\Scripts\activate
```

### macOS / Linux

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create:

```text
backend/.env
```

Add:

```env
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=mysql+pymysql://root:your_mysql_password@localhost:3306/ai_data_insight
JWT_SECRET_KEY=replace_with_a_long_random_secret
```

A JWT secret can be generated with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Start the backend:

```bash
uvicorn main:app --reload
```

Backend:

```text
http://127.0.0.1:8000
```

## 4. Frontend setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

## Application Flow

1. Register or sign in.
2. Upload a CSV file or reopen a saved dataset.
3. The backend reads the file using Pandas.
4. Basic dataset metadata and data-quality information are calculated.
5. The Dashboard presents an overview and preview.
6. Data Quality highlights missing values, duplicates, inconsistent values, and data types.
7. Data Visualization generates chart data using the actual dataset.
8. The chatbot receives compact dataset-grounded context and exact Pandas calculations.
9. Gemini converts this grounded information into a natural-language response.

## Major Technical Decisions

### React + Vite

React was selected for a component-based frontend, while Vite provides a lightweight and fast development environment.

### FastAPI

FastAPI provides a simple API structure, validation, clear endpoints, and good integration with Python data-processing libraries.

### Pandas for calculations

Pandas is used as the main analytical engine. Statistical calculations and aggregations are performed from the actual uploaded dataset rather than asking the language model to estimate values.

### Recharts

Recharts was selected because it integrates naturally with React and supports the main chart types required by the application.

### MySQL

MySQL was added to persist user accounts and uploaded datasets. This allows users to sign in and reopen previous CSV files without uploading them again.

### JWT authentication

After a successful login, the backend returns a JWT token. Protected API requests use this token to identify the current user and ensure saved datasets belong to that user.

### Compact AI context instead of sending every row

Large CSV files can contain too many tokens to send to an LLM for every question. The backend therefore uses Pandas to build a compact dataset profile and question-specific calculations.

This improves reliability, response speed, token usage, scalability, and grounding of numerical answers.

More detail is available in `AI_FLOW_AND_HALLUCINATION_MITIGATION.md`.

## Assumptions

- Input files are CSV files readable by Pandas.
- MySQL is running locally or is available through the configured `DATABASE_URL`.
- A valid Gemini API key is supplied by the user.
- The application is intended as a technical demonstration rather than a production multi-tenant analytics platform.
- The active dataset is kept in backend memory while the application is running, while the original CSV is persisted in MySQL.

## Limitations

- Very unusual CSV encodings or malformed files may fail validation.
- AI availability and response time depend on the external Gemini service.
- The chatbot receives a compact representation of large datasets rather than every raw row.
- Some highly specific row-level questions may require additional analytical routing.
- Authentication is intentionally simple for the scope of the assignment.
- The current application is primarily designed for desktop use.
- Backend in-memory active dataset state is suitable for this demonstration but would need a different architecture for horizontally scaled production deployment.
- MySQL stores uploaded CSV files as binary data; object storage would be more appropriate for very large production datasets.

## Security Notes

- Passwords are hashed before being stored.
- `.env` is excluded from Git and must never be committed.
- API keys, MySQL passwords, and JWT secrets must remain local.
- Users can access only datasets associated with their authenticated account.

## Demonstration

A typical demonstration can show:

1. Registering a new user.
2. Uploading a CSV dataset.
3. Viewing the Dashboard.
4. Reviewing missing values, duplicates, and inconsistent values.
5. Generating suggested and manual visualizations.
6. Asking the chatbot analytical questions.
7. Logging out and signing in again.
8. Reopening the saved dataset from Recent Uploads.

## Example Chatbot Questions

```text
Can you summarize this dataset?
```

```text
What is the average salary?
```

```text
Give me the sum, average, median and mode of salary.
```

```text
Compare average salary by department.
```

```text
What useful insights can you find in this dataset?
```

```text
Create a bar chart of employees by department.
```



## Working Demonstration

The application was tested locally across the main user workflow. The following demonstrations show each core feature in action.

### 1. Upload Page
Upload and validate a CSV dataset, with access to previously saved datasets.

[View Upload Page Demo](https://github.com/user-attachments/assets/4ce6a1ed-ee6b-4d62-95f4-b49084f1b907)

### 2. Dashboard
View a summary of the uploaded dataset, key metrics, and a searchable data preview.

[View Dashboard Demo](https://github.com/user-attachments/assets/a5dcea21-ed9f-4ccc-90b4-f34380db3331)

### 3. Data Quality
Review missing values, duplicate rows, inconsistent values, and detected data types.

[View Data Quality Demo](https://github.com/user-attachments/assets/8a5d3027-f969-4363-b42f-46d87d67eafa)

### 4. Data Visualization
Generate suggested and manual visualizations using the uploaded dataset.

[View Data Visualization Demo](https://github.com/user-attachments/assets/8df19941-8e5b-4ca4-ab2a-4f634beeec9b)

### 5. AI Chatbot
Ask natural-language questions about the uploaded dataset and receive dataset-grounded analytical responses.

[View Chatbot Demo](https://github.com/user-attachments/assets/5082c115-c29f-4321-b4e3-4dc36b1e87f6)

