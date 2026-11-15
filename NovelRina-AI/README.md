# NovelRina AI

A standalone Vue 3 writing workspace for Cloudflare Pages. The app talks directly to Supabase for authentication and data, and directly to Google AI for summaries, embeddings, and story chat. It does not call or require the NovelRina FastAPI backend and does not modify the sibling `frontend` or `backend` projects.

## Features

- Supabase email/password sign-up, sign-in, session persistence, and sign-out.
- Per-user novel library with create, edit, search, and delete.
- Supabase-backed chapter list and editor with explicit save, word counts, and chapter CRUD.
- Google AI chapter summaries saved to `chapters.chapter_content_summary`.
- Google AI embeddings saved to `chapters.chapter_content_embedding`.
- Story chat using the existing `match_chapters_novelrina` Supabase RPC for vector retrieval and Google AI for answers.
- Optional author display name saved to Supabase Auth user metadata.

Chat history is held in memory for the current page session. Novel, chapter, summary, embedding, and account data use the connected services.

## Local development

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
cp .env.example .env.local
```

Set the public Supabase configuration in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Use the Supabase **publishable/anon key** only. Never put a Supabase service-role key or a shared Google AI key in a `VITE_` variable. Each writer adds their own Google AI Studio API key in account settings; it is kept in tab memory only, and must be re-entered after a refresh or sign-out. The key is sent from the browser directly to Google, so use a restricted key and your own quota. Only enter a key if you trust the deployed site.

```sh
npm run dev
npm run type-check
npm run build
```

## Supabase setup

This app uses the existing `novels` and `chapters` tables:

- `novels`: `novel_id`, `novel_name`, `description`, `author_id`
- `chapters`: `chapter_id`, `novel_id`, `chapter_name`, `chapter_content`, `chapter_content_summary`, `chapter_content_embedding`

Configure Supabase Auth for email/password sign-up. Set the Supabase **Site URL** to the deployed Pages URL and add local and deployed app URLs to its **Redirect URLs**. Enable Row Level Security and policies that restrict novel operations to `author_id = auth.uid()` and chapter operations to chapters whose parent novel belongs to `auth.uid()`. Frontend filters do not replace RLS.

The database must have the `match_chapters_novelrina` RPC used by the existing NovelRina backend, accepting `query_embedding`, `match_count`, `filter_novel_id`, and `filter_user_id`, and returning `chapter_content` and `similarity`. Story chat reports an error if that RPC is unavailable. Novel deletion requires the chapter foreign key to cascade on delete (or an equivalent server-side procedure). Updating chapter text clears its stored summary and embedding so stale memory is not used.

## AI key and privacy

Create a personal key in Google AI Studio, then add it under the account menu in the app. It is not written to Supabase, local storage, session storage, or the compiled app. Clearing it, signing out, or refreshing removes it from the app's memory. Summary and chat prompts, plus text for embeddings, are sent directly from the browser to Google's API; summaries and embeddings are saved in the user's Supabase database.

This is a backend-free deployment, not a way to hide a shared provider credential: the browser must use the personal key to make AI requests, and browser users can inspect their own requests. Restrict the key and monitor its quota in Google AI Studio.

## Cloudflare Pages

Configure the Pages project:

- **Root directory:** `NovelRina-AI`
- **Build command:** `npm run build`
- **Build output directory:** `dist`

Set these Pages environment variables for both preview and production deployments:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Redeploy after changing build-time variables. They are public browser configuration; Row Level Security must protect user data. Do not configure a service-role key or shared AI provider secret in Pages frontend variables. No FastAPI deployment or CORS change is required.
