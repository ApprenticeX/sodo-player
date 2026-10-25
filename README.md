# Sodo Player

Modern, clean full-stack authentication system built with **FastAPI (Python)** and **React + Vite**.

---

## Project Structure

```
sodo-player/
├── backend/
│   ├── .venv/               # Isolated Python Virtual Environment
│   ├── main.py              # FastAPI application entrypoint & CORS
│   ├── database.py          # MongoDB sododb.auth backend with seamless local fallback
│   ├── auth.py              # Authentication routes (/login, /register, /me, /logout)
│   ├── security.py          # Bcrypt hashing & PyJWT token management
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── config.py            # Environment configuration
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # Environment variables (MONGO_URI, SECRET_KEY, etc.)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── LoginForm.jsx    # Handcrafted login/signup form
│   │   │   └── Dashboard.jsx    # Post-login session view
│   │   ├── api.js               # Clean API client & JWT persistence
│   │   ├── App.jsx              # Session hydration & root state
│   │   ├── index.css            # Vanilla CSS design system
│   │   └── main.jsx
│   ├── vite.config.js       # Vite dev server with /api proxy to port 8000
│   └── package.json
└── README.md
```

---

## Quick Start

### 1. Backend (Python Virtual Environment)

```powershell
cd backend

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Run server
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Backend API will be live at `http://127.0.0.1:8000`.

### 2. Frontend (Vite)

```powershell
cd frontend

# Run dev server
npm run dev
```

Frontend will be live at `http://localhost:5173`.

---

## Authentication Features

- **Standard Industry AAA Quality**:
  - Secure password hashing using `bcrypt` (12 rounds)
  - RFC 7519 compliant JSON Web Tokens (`PyJWT`) with HS256 signatures
  - Bearer token authentication via HTTP headers
  - Session verification endpoint (`/api/auth/me`) for seamless page refresh persistence
  - Password reveal toggle (inline SVG icon)
  - Instant 1-click test credentials fill
  - Dual Sign In / Sign Up modes
- **Database Configuration**:
  - Targets MongoDB database `sododb` and collection `auth`.
  - Configured via `MONGO_URI` in `backend/.env`.
  - Zero-downtime persistent fallback if MongoDB cluster is unreachable or firewall-restricted.

---

## Default Test Credentials

- **Email**: `demo@example.com`
- **Username**: `demo`
- **Password**: `password123`
