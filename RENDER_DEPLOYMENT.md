# Deploying Sodo Player Backend to Render.com

This guide provides step-by-step instructions for hosting the **Sodo Player Backend** on [Render.com](https://render.com).

---

## Option 1: Automatic Blueprint Deployment (Recommended)

1. Push your repository to **GitHub** or **GitLab**.
2. Log in to [dashboard.render.com](https://dashboard.render.com).
3. Click **New +** > **Blueprint**.
4. Connect your repository.
5. Render will detect the included `render.yaml` configuration:
   - **Service Name**: `sodo-player-backend`
   - **Runtime**: Python 3.11
   - **Root Directory**: `backend`
   - **Build Command**: `./render-build.sh` (installs dependencies + static FFmpeg binary)
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Health Check**: `/api/health`
6. Under **Environment Variables**:
   - Provide your `DATABASE_URL` (Neon PostgreSQL, Render PostgreSQL, or Supabase connection string).
   - `SECRET_KEY` is generated automatically.
   - `CORS_ORIGINS` defaults to `*` (or set your frontend URL, e.g., `https://your-frontend.vercel.app`).
7. Click **Apply**. Render will build and deploy your backend automatically!

---

## Option 2: Manual Web Service Deployment

If you prefer to configure the Web Service manually in Render dashboard:

1. Click **New +** > **Web Service**.
2. Connect your Git repository.
3. Configure the settings:
   - **Name**: `sodo-player-backend`
   - **Language / Runtime**: `Python 3`
   - **Region**: Any (e.g., `Oregon (US West)` or `Frankfurt (EU)`)
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Build Command**: `./render-build.sh`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Expand **Advanced** > **Health Check Path**:
   - Set to `/api/health`
5. Under **Environment Variables**, add:
   | Key | Value | Description |
   |---|---|---|
   | `PYTHON_VERSION` | `3.11.9` | Recommended Python version |
   | `DATABASE_URL` | `postgresql://user:pass@host/dbname` | Neon / Supabase / Render Postgres |
   | `SECRET_KEY` | *(Click 'Generate' or random 64-char string)* | JWT encryption key |
   | `CORS_ORIGINS` | `*` or `https://your-site.vercel.app` | Allowed origins |
   | `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Token expiry in minutes |
6. Click **Create Web Service**.

---

## Option 3: Deploy with Docker on Render

If you prefer containerized deployment:

1. Click **New +** > **Web Service**.
2. Connect your Git repository.
3. Set **Runtime** to **Docker**.
4. Set **Dockerfile Path** to `Dockerfile` (in root).
5. Add the environment variables:
   - `DATABASE_URL`
   - `SECRET_KEY`
   - `CORS_ORIGINS`
6. Click **Create Web Service**. (The Dockerfile automatically installs Debian `ffmpeg`, dependencies, and starts Uvicorn).

---

## Connecting the Frontend to Your Render Backend

Once your Render backend is live (e.g., `https://sodo-player-backend.onrender.com`):

### In Development:
Create or edit `frontend/.env.local`:
```env
VITE_API_URL=https://sodo-player-backend.onrender.com
```

### In Production (Vercel / Netlify / Render Static Site):
Add the environment variable in your frontend hosting dashboard:
- **Variable**: `VITE_API_URL`
- **Value**: `https://sodo-player-backend.onrender.com`

---

## Verifying Deployment

Visit:
- Health check: `https://<your-render-service>.onrender.com/api/health` (should return `{"status":"ok","version":"1.0.0"}`)
- Root endpoint: `https://<your-render-service>.onrender.com/`
- Interactive API Docs: `https://<your-render-service>.onrender.com/docs`
