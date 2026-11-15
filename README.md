# NovelRina

NovelRina is a web app for writers to manage novels and chapters, generate chapter summaries, and chat with an AI assistant about novel content.

## Project structure

- [`frontend/`](./frontend/README.md) — Vue 3 and TypeScript web application.
- [`backend/`](./backend/README.md) — FastAPI API for AI summaries, embeddings, and novel chat.

The frontend uses Supabase for authentication and data access. The backend verifies Supabase user tokens and calls Supabase and AI providers for its features.

## Getting started

See the component guides for setup and environment variables:

- [Frontend setup and deployment](./frontend/README.md)
- [Backend setup and deployment](./backend/README.md)

Run the frontend and backend separately during local development. The frontend expects the API at `http://localhost:8000` by default.

## Deployment overview

Deploy the frontend as a static site (for example, Cloudflare Pages) and the FastAPI backend as a web service (for example, Render). Configure the frontend's `VITE_SERVER_URL` with the deployed API URL, set the backend's allowed CORS origin to the deployed frontend URL, and configure each service's environment variables in its hosting provider.
