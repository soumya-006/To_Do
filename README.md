# React Native To-Do App with Authentication & Node.js API

A full-stack To-Do list mobile application built with React Native CLI (TypeScript) and a Node.js/Express backend using MongoDB.

## Overview

This project satisfies all requirements for the assignment, including user authentication, full task CRUD, state management, and bonus features (urgency ranking algorithm, categories, status filtering, and live search).

- **Mobile Client**: React Native CLI with TypeScript, responsive dark UI, and offline token management.
- **Backend API**: Node.js + Express with TypeScript, JWT authentication, bcrypt password hashing, and MongoDB support (Atlas or local) with an automatic in-memory fallback for local testing.
- **Web Preview**: A browser-accessible interface served directly on `http://localhost:5000` for quick testing without launching an emulator.

---

## Features

### Authentication
- User registration with validation and bcrypt hashing.
- Login returning a signed JWT token.
- Protected `/api/auth/me` endpoint.
- Session persistence via token storage.

### Task Management
- Create tasks with title, description, date-time, deadline, priority (`LOW`, `MEDIUM`, `HIGH`), and category (`Work`, `Personal`, `Study`, `Health`, `Finance`, `Other`).
- Toggle task completion status with timestamps.
- Update task details.
- Delete tasks with confirmation.
- Filter by status (`All`, `Active`, `Done`, `Overdue`), priority, and category.
- Search tasks in real-time by title or notes.

### Bonus: Urgency Mix Sorting Algorithm
Tasks can be sorted using an urgency score that blends three factors:
1. **Base Priority Weight**: `HIGH` (300), `MEDIUM` (200), `LOW` (100).
2. **Deadline Proximity**: Tasks due within 12h or 24h receive an exponential time bonus.
3. **Overdue Penalty**: Overdue tasks receive a +600 urgency boost proportional to hours overdue, pushing them to the top of the list.
4. **Completion Sink**: Completed tasks receive `-10,000` points, sinking them below active work.

The algorithm runs on both backend and frontend clients for responsive ordering.

---

## Project Structure

```text
To-do_app/
├── backend/
│   ├── .env              # Environment config (PORT, MONGODB_URI, JWT_SECRET)
│   ├── package.json      # Dependencies (express, mongoose, bcryptjs, jsonwebtoken, tsx)
│   ├── tsconfig.json     # TypeScript settings
│   └── server.ts         # Backend API, models, auth, and web interface
├── mobile/
│   ├── App.tsx           # Mobile application UI, state, and interaction handlers
│   ├── api.ts            # API client and client-side urgency algorithm
│   ├── types.ts          # TypeScript interfaces (User, Task, Stats, Filters)
│   ├── package.json      # React Native dependencies
│   ├── app.json          # Application configuration
│   ├── index.js          # AppRegistry entry point
│   ├── tsconfig.json     # Mobile TypeScript settings
│   ├── babel.config.js   # Babel configuration
│   └── metro.config.js   # Metro bundler config
└── README.md
```

---

## Getting Started

### 1. Backend Server

```bash
cd backend
npm install
npm run dev
```

The API will start on `http://localhost:5000`.

- **MongoDB Setup**: In `backend/.env`, set `MONGODB_URI` to your MongoDB Atlas connection string (or local MongoDB). If no database is detected, the server runs an in-memory store so you can test immediately.
- **Web Interface**: Open `http://localhost:5000` in any web browser to test the full interface.

### 2. React Native Mobile App

```bash
cd mobile
npm install
npm start
```

In a second terminal:

```bash
npm run android
```

> **Note on Emulator vs Device**:
> - Android Emulator connects to `http://10.0.2.2:5000/api` by default.
> - Physical devices can change the endpoint URL by tapping "Server endpoint" on the login screen.

---

## API Endpoints

### Auth
- `POST /api/auth/register` — Create account (`email`, `password`, optional `name`)
- `POST /api/auth/login` — Sign in (`email`, `password`)
- `GET /api/auth/me` — Get current user (Bearer token required)

### Tasks (Bearer token required)
- `GET /api/tasks` — List tasks (query params: `status`, `category`, `priority`, `search`, `sortBy`)
- `GET /api/tasks/stats` — Summary counts (total, completed, active, overdue, rate %)
- `POST /api/tasks` — Create new task
- `PUT /api/tasks/:id` — Update task
- `PATCH /api/tasks/:id/toggle` — Flip completion status
- `DELETE /api/tasks/:id` — Remove task
