# NovelRina Backend

The backend is a FastAPI service that provides authenticated endpoints for AI-generated chapter summaries, chapter summary embeddings, and novel chat.

## Requirements

- Python 3.13 or newer
- pip

Install dependencies from this directory:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, activate the environment with:

```powershell
.venv\Scripts\Activate.ps1
```

Set the required environment variables before starting the API:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLIC_KEY=your-supabase-publishable-key
GOOGLE_API_KEY=your-google-ai-api-key
GROQ_API_KEY=your-groq-api-key
```

The Supabase values are used to verify user tokens and access the database. Google credentials are used by the Gemini response and embedding models; Groq credentials are used for chapter summaries. Keep credentials private and never commit them.

## Run locally

From this directory, with the environment activated:

```sh
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

The API documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs).

Main endpoints:

- `POST /get-summary` — generate a chapter summary.
- `POST /get-summary-embedding` — generate and save an embedding for a chapter summary.
- `POST /novels/{novel_id}/chat` — chat about a novel.

The endpoints require a valid Supabase access token.

## Render deployment

Create a Render **Web Service** connected to this repository and configure:

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Environment variables: `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY`, `GOOGLE_API_KEY`, and `GROQ_API_KEY`

Before deploying, add the deployed frontend's origin to `allow_origins` in `app.py`. The current CORS configuration only allows `http://localhost:5173`. After deployment, set the backend's public URL as the frontend's `VITE_SERVER_URL` and redeploy the frontend.