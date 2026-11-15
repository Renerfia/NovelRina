# NovelRina Frontend

The frontend is a Vue 3 single-page application built with TypeScript and Vite. It provides the novel and chapter interface, Supabase authentication, chapter editing, AI summaries, and chat.

## Requirements

- Node.js `^22.18.0` or `>=24.12.0`
- npm

## Local development

From this directory:

```sh
npm ci
```

Create a `.env.local` file with the frontend's public configuration:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
VITE_SERVER_URL=http://localhost:8000
```

`VITE_SERVER_URL` is optional for local development; the app defaults to `http://localhost:8000`. The Supabase URL and publishable key are required. Do not put secret/service-role keys in frontend environment variables. Keep `.env.local` out of source control.

Start the development server:

```sh
npm run dev
```

## Checks and production build

```sh
npm run type-check
npm run test:unit
npm run lint
npm run build
```

The production files are written to `dist/`.

## Cloudflare Pages

Connect the repository to Cloudflare Pages and configure:

- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SERVER_URL`

Set `VITE_SERVER_URL` to the deployed backend's public URL, then redeploy the frontend after changing it. The backend must allow the Pages site's origin through its CORS configuration.
