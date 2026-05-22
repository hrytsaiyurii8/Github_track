# GitHub Contact Explorer API (Supabase)

The API stores contacts in **Supabase PostgreSQL** and profile photos in **Supabase Storage**.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the script: `supabase/schema.sql`.
3. In **Storage**, create a public bucket named `avatars` (or set `SUPABASE_AVATAR_BUCKET` in `.env`).
4. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API)
   - `PUBLIC_HOST` — your server’s public IP or domain when deployed online
5. Install and start:

```bash
npm install
npm start
```

## Online deployment

Deploy the **`server/` directory** as the app root (it includes `lib/` for shared helpers — do not deploy only `src/`). Set the same environment variables in the host dashboard. Point the extension API URL to your public base URL (e.g. `https://your-app.example.com`).

## Archive upload

`POST /api/archive/save` accepts `multipart/form-data` with fields: `email`, `name`, `company`, `country`, `website`, `githubLogin`, and optional `avatar` image file (JPEG/PNG/GIF/WebP, max 2MB).
