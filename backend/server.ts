import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import mongoose, { Document, Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/todoapp';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_in_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

let isMongoConnected = false;

// Database connection with fallback
export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    isMongoConnected = true;
    console.log(`[db] Connected to MongoDB: ${conn.connection.host}`);
  } catch (err) {
    isMongoConnected = false;
    console.error('[db] MongoDB connection failed:', err);
    throw err;
  }
};

// In-memory store for local development without MongoDB service
interface MemoryUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

interface MemoryTask {
  _id: string;
  user: string;
  title: string;
  description: string;
  dateTime: string;
  deadline: string;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string;
  category: TaskCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const memoryUsers: MemoryUser[] = [];
const memoryTasks: MemoryTask[] = [];

// Mongoose Models
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskCategory = 'Work' | 'Personal' | 'Study' | 'Health' | 'Finance' | 'Other';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, trim: true, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },
  },
  { timestamps: true }
);

UserSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err: any) {
    next(err);
  }
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

export const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);

export interface ITask extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  title: string;
  description: string;
  dateTime: Date;
  deadline: Date;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: Date;
  category: TaskCategory;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    dateTime: { type: Date, default: Date.now },
    deadline: { type: Date, required: true, index: true },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM', index: true },
    completed: { type: Boolean, default: false, index: true },
    completedAt: { type: Date },
    category: {
      type: String,
      enum: ['Work', 'Personal', 'Study', 'Health', 'Finance', 'Other'],
      default: 'Personal',
      index: true,
    },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const Task: Model<ITask> = mongoose.model<ITask>('Task', TaskSchema);

// Urgency calculation: combines priority, deadline proximity, and overdue weight
const PRIORITY_SCORES: Record<TaskPriority, number> = {
  HIGH: 300,
  MEDIUM: 200,
  LOW: 100,
};

export function calculateUrgencyScore(task: {
  deadline: Date | string;
  priority: TaskPriority;
  completed: boolean;
  createdAt?: Date | string;
}): number {
  if (task.completed) return -10000;

  const now = Date.now();
  const deadlineTime = new Date(task.deadline).getTime();
  const diffHours = (deadlineTime - now) / (1000 * 60 * 60);
  const basePriority = PRIORITY_SCORES[task.priority] || 100;

  let deadlineScore = 0;
  if (diffHours < 0) {
    deadlineScore = 600 + Math.min(Math.abs(diffHours) * 10, 400);
  } else if (diffHours <= 12) {
    deadlineScore = 400 + (12 - diffHours) * 15;
  } else if (diffHours <= 24) {
    deadlineScore = 250 + (24 - diffHours) * 8;
  } else if (diffHours <= 72) {
    deadlineScore = 100 + (72 - diffHours) * 3;
  } else if (diffHours <= 168) {
    deadlineScore = 40 + (168 - diffHours) * 0.5;
  } else {
    deadlineScore = Math.max(0, 20 - diffHours / 24);
  }

  const createdTime = task.createdAt ? new Date(task.createdAt).getTime() : now;
  const tieBreaker = (createdTime % 1000000) / 1000000;

  return Math.round((basePriority + deadlineScore + tieBreaker) * 100) / 100;
}

// Authentication Helpers
export interface AuthenticatedRequest extends Request {
  user?: {
    _id: string;
    id: string;
    name: string;
    email: string;
    createdAt?: any;
  };
}

export const signToken = (userId: string, email: string): string => {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Please log in to continue' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };

    if (isMongoConnected) {
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) {
        res.status(401).json({ success: false, message: 'Account not found' });
        return;
      }
      req.user = {
        _id: user._id.toString(),
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      };
    } else {
      const memUser = memoryUsers.find((u) => u.id === decoded.userId);
      if (!memUser) {
        res.status(401).json({ success: false, message: 'Account not found' });
        return;
      }
      req.user = {
        _id: memUser.id,
        id: memUser.id,
        name: memUser.name,
        email: memUser.email,
        createdAt: memUser.createdAt,
      };
    }

    next();
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  }
};

// Express App Setup
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Web App Interface (Linear / Things 3 style)
app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tasks</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
    body { background: #0c0d0e; color: #e1e4ea; display: flex; justify-content: center; min-height: 100vh; padding: 24px 12px; }
    .shell { width: 100%; max-width: 520px; background: #131416; border: 1px solid #232528; border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; min-height: 840px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    
    .nav { padding: 18px 22px; border-bottom: 1px solid #202226; display: flex; justify-content: space-between; align-items: center; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 10px; height: 10px; border-radius: 50%; background: #5e6ad2; box-shadow: 0 0 12px #5e6ad2; }
    .brand-title { font-size: 15px; font-weight: 700; color: #f4f5f8; letter-spacing: -0.3px; }
    .user-pill { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #9297a0; }
    .btn-signout { background: transparent; border: 1px solid #2c2f35; color: #8a8f98; padding: 5px 12px; border-radius: 8px; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
    .btn-signout:hover { background: #1e2024; color: #f43f5e; border-color: #3b2227; }

    .summary-card { margin: 18px 20px; background: #191b1f; border-radius: 14px; padding: 16px 18px; border: 1px solid #26292e; }
    .summary-row { display: flex; justify-content: space-between; align-items: center; }
    .summary-title { font-size: 13px; font-weight: 600; color: #d0d4dc; }
    .summary-pct { font-size: 13px; font-weight: 700; color: #5e6ad2; }
    .meter { height: 4px; background: #262930; border-radius: 2px; margin: 12px 0 14px; overflow: hidden; }
    .meter-fill { height: 100%; background: #5e6ad2; width: 0%; transition: width 0.3s ease; }
    .metrics { display: flex; justify-content: space-between; font-size: 11px; }
    .metric { text-align: center; flex: 1; }
    .metric-val { font-size: 15px; font-weight: 700; color: #f4f5f8; }
    .metric-lbl { color: #70757e; margin-top: 2px; }

    .toolbar { padding: 0 20px; margin-bottom: 12px; }
    .search-bar { display: flex; gap: 8px; margin-bottom: 12px; }
    .search-input { flex: 1; background: #18191d; border: 1px solid #282b31; border-radius: 10px; padding: 9px 12px; color: #e1e4ea; font-size: 13px; outline: none; }
    .search-input:focus { border-color: #5e6ad2; }
    .sort-dropdown { background: #18191d; color: #a0a6b5; border: 1px solid #282b31; border-radius: 10px; padding: 0 10px; font-size: 11px; font-weight: 600; outline: none; cursor: pointer; }

    .segmented { display: flex; background: #18191d; border-radius: 10px; padding: 3px; border: 1px solid #24272c; }
    .seg-btn { flex: 1; padding: 6px; border: none; background: transparent; color: #757a84; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 7px; transition: all 0.15s; }
    .seg-btn.active { background: #262930; color: #f4f5f8; }

    .content-list { flex: 1; overflow-y: auto; padding: 6px 20px 90px; }
    .task-item { background: #181a1e; border: 1px solid #24272d; border-radius: 12px; padding: 13px 15px; margin-bottom: 10px; display: flex; align-items: flex-start; gap: 12px; transition: border-color 0.2s, background 0.2s; }
    .task-item:hover { border-color: #31353e; background: #1b1d22; }
    .task-item.done { opacity: 0.45; background: #141518; }
    .tick { width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid #434854; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; transition: all 0.2s; }
    .tick.checked { background: #10b981; border-color: #10b981; color: #fff; font-size: 11px; font-weight: 700; }
    .task-body { flex: 1; }
    .task-name { font-size: 14px; font-weight: 600; color: #ededf0; letter-spacing: -0.2px; line-height: 1.4; }
    .task-item.done .task-name { text-decoration: line-through; color: #6b7280; }
    .task-note { font-size: 12px; color: #878c96; margin-top: 3px; line-height: 1.4; }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; font-size: 10px; align-items: center; }
    .pill { padding: 2px 7px; border-radius: 5px; font-weight: 500; font-size: 11px; }
    .pill-tag { background: #20232a; color: #8f95a3; border: 1px solid #2d313b; }
    .dot-high { color: #f43f5e; }
    .dot-med { color: #f59e0b; }
    .dot-low { color: #10b981; }
    .pill-score { background: rgba(94, 106, 210, 0.12); color: #828df0; border: 1px solid rgba(94, 106, 210, 0.25); font-weight: 600; }
    .btn-trash { background: transparent; border: none; color: #525866; cursor: pointer; padding: 4px; font-size: 13px; border-radius: 4px; transition: color 0.15s; }
    .btn-trash:hover { color: #f43f5e; }

    .add-fab { position: fixed; bottom: 32px; right: calc(50% - 230px); width: 48px; height: 48px; border-radius: 24px; background: #5e6ad2; color: #fff; font-size: 24px; border: none; cursor: pointer; box-shadow: 0 10px 24px rgba(94,106,210,0.4); display: flex; align-items: center; justify-content: center; transition: transform 0.15s; }
    .add-fab:hover { transform: scale(1.05); }
    @media (max-width: 540px) { .add-fab { right: 24px; } }

    .auth-view { padding: 40px 28px; display: flex; flex-direction: column; justify-content: center; flex: 1; }
    .brand-hero-logo { display: flex; flex-direction: column; align-items: center; margin-bottom: 24px; }
    .logo-box { width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #1c1e24, #121316); border: 1px solid #2d313a; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 24px rgba(94, 106, 210, 0.18); margin-bottom: 12px; }
    .brand-name-tag { font-size: 11px; font-weight: 700; color: #8F94A0; letter-spacing: 2px; text-transform: uppercase; }
    .auth-lead { font-size: 22px; font-weight: 700; margin-bottom: 6px; text-align: center; color: #f4f5f8; letter-spacing: -0.4px; }
    .auth-subhead { font-size: 13px; color: #6d7380; text-align: center; margin-bottom: 28px; }
    .field { margin-bottom: 14px; }
    .label { font-size: 11px; color: #878c96; margin-bottom: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .input-box { width: 100%; background: #18191d; border: 1px solid #282b31; border-radius: 10px; padding: 11px 14px; color: #f4f5f8; font-size: 13px; outline: none; }
    .input-box:focus { border-color: #5e6ad2; }
    .submit-btn { width: 100%; background: #5e6ad2; color: white; padding: 11px; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; margin-top: 8px; font-size: 13px; transition: background 0.15s; }
    .submit-btn:hover { background: #4f5bc4; }
    .toggle-link { background: transparent; border: none; color: #7f89e8; font-size: 12px; cursor: pointer; margin-top: 16px; text-align: center; width: 100%; }

    .overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); align-items: flex-end; justify-content: center; }
    .overlay.active { display: flex; }
    .sheet { background: #16181b; width: 100%; max-width: 520px; border-radius: 20px 20px 0 0; padding: 22px; border-top: 1px solid #2c2f36; box-shadow: 0 -20px 40px rgba(0,0,0,0.5); }
    .sheet-title { font-size: 16px; font-weight: 700; color: #f4f5f8; }
  </style>
</head>
<body>
  <div class="shell" id="app"></div>

  <!-- Create Modal -->
  <div class="overlay" id="taskModal">
    <div class="sheet">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div class="sheet-title">New Task</div>
        <span onclick="closeModal()" style="cursor: pointer; color: #737883; font-size: 16px;">✕</span>
      </div>
      <div class="field">
        <div class="label">Task Title</div>
        <input class="input-box" id="newTitle" placeholder="e.g. Update API schema for authentication">
      </div>
      <div class="field">
        <div class="label">Notes / Description</div>
        <textarea class="input-box" id="newDesc" rows="2" placeholder="Context, links, or subtasks..."></textarea>
      </div>
      <div class="field" style="display: flex; gap: 10px;">
        <div style="flex: 1;">
          <div class="label">Priority</div>
          <select class="input-box" id="newPriority">
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM" selected>Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
        <div style="flex: 1;">
          <div class="label">Category</div>
          <select class="input-box" id="newCategory">
            <option value="Work">Work</option>
            <option value="Personal">Personal</option>
            <option value="Study">Study</option>
            <option value="Health">Health</option>
            <option value="Finance">Finance</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div class="field">
        <div class="label">Due Date</div>
        <select class="input-box" id="newDeadline">
          <option value="4">Today in 4 hours</option>
          <option value="12">Tonight</option>
          <option value="24" selected>Tomorrow</option>
          <option value="72">In 3 days</option>
          <option value="168">Next week</option>
        </select>
      </div>
      <button class="submit-btn" onclick="createTask()">Create Task</button>
    </div>
  </div>

  <script>
    let token = localStorage.getItem('token') || '';
    let user = JSON.parse(localStorage.getItem('user') || 'null');
    let isRegisterMode = false;
    let currentTab = 'all';
    let currentSort = 'smart';
    let searchQuery = '';

    async function api(path, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) };
      const res = await fetch('/api' + path, { ...options, headers });
      return res.json();
    }

    function renderAuth() {
      document.getElementById('app').innerHTML = \`
        <div class="auth-view">
          <div class="brand-hero-logo">
            <div class="logo-box">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2.5" y="2.5" width="19" height="19" rx="6" stroke="#383D4A" stroke-width="1.5" fill="#181A20"/>
                <path d="M7.5 12.5L10.5 15.5L16.5 8.5" stroke="#5E6AD2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="16.5" cy="8.5" r="1.5" fill="#38BDF8"/>
              </svg>
            </div>
            <div class="brand-name-tag">Tasks</div>
          </div>
          <div class="auth-lead">\${isRegisterMode ? 'Create your account' : 'Welcome back'}</div>
          <div class="auth-subhead">\${isRegisterMode ? 'Get started by creating your workspace' : 'Sign in to access your task list'}</div>
          
          \${isRegisterMode ? \`
            <div class="field">
              <div class="label">Name</div>
              <input class="input-box" id="authName" placeholder="Alex Morgan">
            </div>
          \` : ''}
          <div class="field">
            <div class="label">Email</div>
            <input class="input-box" id="authEmail" placeholder="alex@example.com" value="alex@example.com">
          </div>
          <div class="field">
            <div class="label">Password</div>
            <input class="input-box" type="password" id="authPass" placeholder="••••••••" value="password123">
          </div>
          <button class="submit-btn" onclick="handleAuth()">\${isRegisterMode ? 'Sign up' : 'Sign in'}</button>
          <button class="toggle-link" onclick="toggleAuthMode()">\${isRegisterMode ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        </div>
      \`;
    }

    function toggleAuthMode() {
      isRegisterMode = !isRegisterMode;
      renderAuth();
    }

    async function handleAuth() {
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPass').value;
      if (!email || !password) return alert('Email and password required');
      
      const endpoint = isRegisterMode ? '/auth/register' : '/auth/login';
      const name = isRegisterMode ? document.getElementById('authName').value.trim() : '';
      
      const data = await api(endpoint, { method: 'POST', body: JSON.stringify({ email, password, name }) });
      if (!data.success) return alert(data.message || 'Authentication error');
      
      token = data.token;
      user = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      loadDashboard();
    }

    function logout() {
      token = '';
      user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      renderAuth();
    }

    async function loadDashboard() {
      if (!token) return renderAuth();
      const [tasksRes, statsRes] = await Promise.all([
        api(\`/tasks?status=\${currentTab}&sortBy=\${currentSort}&search=\${encodeURIComponent(searchQuery)}\`),
        api('/tasks/stats')
      ]);

      const tasks = tasksRes.tasks || [];
      const stats = statsRes.stats || { total: 0, completed: 0, active: 0, overdue: 0, completionRate: 0 };

      document.getElementById('app').innerHTML = \`
        <div class="nav">
          <div class="brand">
            <div class="brand-mark"></div>
            <div class="brand-title">Tasks</div>
          </div>
          <div class="user-pill">
            <span>\${user?.name || user?.email?.split('@')[0] || 'User'}</span>
            <button class="btn-signout" onclick="logout()">Sign out</button>
          </div>
        </div>

        <div class="summary-card">
          <div class="summary-row">
            <div class="summary-title">Today's Progress</div>
            <div class="summary-pct">\${stats.completed} / \${stats.total} done · \${stats.completionRate}%</div>
          </div>
          <div class="meter">
            <div class="meter-fill" style="width: \${stats.completionRate}%;"></div>
          </div>
          <div class="metrics">
            <div class="metric"><div class="metric-val">\${stats.total}</div><div class="metric-lbl">Total</div></div>
            <div class="metric"><div class="metric-val" style="color: #10b981;">\${stats.completed}</div><div class="metric-lbl">Completed</div></div>
            <div class="metric"><div class="metric-val" style="color: #5e6ad2;">\${stats.active}</div><div class="metric-lbl">Pending</div></div>
            <div class="metric"><div class="metric-val" style="color: #f43f5e;">\${stats.overdue}</div><div class="metric-lbl">Overdue</div></div>
          </div>
        </div>

        <div class="toolbar">
          <div class="search-bar">
            <input class="search-input" placeholder="Search tasks..." value="\${searchQuery}" oninput="searchQuery=this.value; loadDashboard()">
            <select class="sort-dropdown" onchange="currentSort=this.value; loadDashboard()">
              <option value="smart" \${currentSort==='smart'?'selected':''}>⚡ Urgency mix</option>
              <option value="deadline_asc" \${currentSort==='deadline_asc'?'selected':''}>Deadline (soonest)</option>
              <option value="priority_desc" \${currentSort==='priority_desc'?'selected':''}>Priority (high to low)</option>
              <option value="created_desc" \${currentSort==='created_desc'?'selected':''}>Recently added</option>
            </select>
          </div>
          <div class="segmented">
            <button class="seg-btn \${currentTab==='all'?'active':''}" onclick="setTab('all')">All</button>
            <button class="seg-btn \${currentTab==='active'?'active':''}" onclick="setTab('active')">Active</button>
            <button class="seg-btn \${currentTab==='completed'?'active':''}" onclick="setTab('completed')">Done</button>
            <button class="seg-btn \${currentTab==='overdue'?'active':''}" onclick="setTab('overdue')">Overdue</button>
          </div>
        </div>

        <div class="content-list">
          \${tasks.length === 0 ? \`
            <div style="text-align: center; padding: 48px 16px; color: #626773;">
              <div style="font-size: 14px; font-weight: 500; color: #a4aab5;">All clear for now</div>
              <div style="font-size: 12px; margin-top: 4px;">Click the '+' button to capture a new task</div>
            </div>
          \` : tasks.map(t => {
            const priorityDot = t.priority === 'HIGH' ? '<span class="dot-high">● High</span>' : t.priority === 'MEDIUM' ? '<span class="dot-med">● Med</span>' : '<span class="dot-low">● Low</span>';
            const dueStr = new Date(t.deadline).toLocaleDateString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
            return \`
              <div class="task-item \${t.completed ? 'done' : ''}">
                <div class="tick \${t.completed ? 'checked' : ''}" onclick="toggleTask('\${t._id}')">
                  \${t.completed ? '✓' : ''}
                </div>
                <div class="task-body">
                  <div class="task-name">\${t.title}</div>
                  \${t.description ? \`<div class="task-note">\${t.description}</div>\` : ''}
                  <div class="pills">
                    <span class="pill pill-tag">#\${t.category.toLowerCase()}</span>
                    <span class="pill" style="color: #9da3af;">\${priorityDot}</span>
                    <span class="pill" style="color: #7b818c;">Due \${dueStr}</span>
                    \${!t.completed && t.urgencyScore ? \`<span class="pill pill-score">\${Math.round(t.urgencyScore)} priority score</span>\` : ''}
                  </div>
                </div>
                <button class="btn-trash" onclick="deleteTask('\${t._id}')">✕</button>
              </div>
            \`;
          }).join('')}
        </div>

        <button class="add-fab" onclick="openModal()">+</button>
      \`;
    }

    function setTab(tab) { currentTab = tab; loadDashboard(); }

    async function toggleTask(id) {
      await api('/tasks/' + id + '/toggle', { method: 'PATCH' });
      loadDashboard();
    }

    async function deleteTask(id) {
      if (!confirm('Delete this task?')) return;
      await api('/tasks/' + id, { method: 'DELETE' });
      loadDashboard();
    }

    function openModal() { document.getElementById('taskModal').classList.add('active'); }
    function closeModal() { document.getElementById('taskModal').classList.remove('active'); }

    async function createTask() {
      const title = document.getElementById('newTitle').value.trim();
      const description = document.getElementById('newDesc').value.trim();
      const priority = document.getElementById('newPriority').value;
      const category = document.getElementById('newCategory').value;
      const hours = parseInt(document.getElementById('newDeadline').value);
      if (!title) return alert('Please enter a task title');

      const deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, description, priority, category, deadline })
      });
      closeModal();
      document.getElementById('newTitle').value = '';
      document.getElementById('newDesc').value = '';
      loadDashboard();
    }

    if (token) loadDashboard(); else renderAuth();
  </script>
</body>
</html>`);
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    database: isMongoConnected ? 'mongodb' : 'memory',
    timestamp: new Date().toISOString(),
  });
});

// Authentication Routes
app.post('/api/auth/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();

    if (isMongoConnected) {
      const existing = await User.findOne({ email: cleanEmail });
      if (existing) {
        res.status(400).json({ success: false, message: 'An account with this email already exists' });
        return;
      }

      const user = await User.create({
        name: name?.trim() || '',
        email: cleanEmail,
        password,
      });

      const token = signToken(user._id.toString(), user.email);
      res.status(201).json({
        success: true,
        message: 'Account created',
        token,
        user: { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt },
      });
    } else {
      const existing = memoryUsers.find((u) => u.email === cleanEmail);
      if (existing) {
        res.status(400).json({ success: false, message: 'An account with this email already exists' });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const newId = 'usr_' + Math.random().toString(36).substring(2, 9);
      const newUser: MemoryUser = {
        id: newId,
        name: name?.trim() || '',
        email: cleanEmail,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      memoryUsers.push(newUser);

      const token = signToken(newUser.id, newUser.email);
      res.status(201).json({
        success: true,
        message: 'Account created',
        token,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, createdAt: newUser.createdAt },
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Registration error' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();

    if (isMongoConnected) {
      const user = await User.findOne({ email: cleanEmail }).select('+password');
      if (!user || !(await user.comparePassword(password))) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      const token = signToken(user._id.toString(), user.email);
      res.status(200).json({
        success: true,
        message: 'Logged in',
        token,
        user: { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt },
      });
    } else {
      const user = memoryUsers.find((u) => u.email === cleanEmail);
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      const token = signToken(user.id, user.email);
      res.status(200).json({
        success: true,
        message: 'Logged in',
        token,
        user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Login error' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    user: {
      id: req.user?.id,
      name: req.user?.name,
      email: req.user?.email,
      createdAt: req.user?.createdAt,
    },
  });
});

// Task Routes
app.get('/api/tasks/stats', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    let tasks: any[] = [];

    if (isMongoConnected) {
      tasks = await Task.find({ user: userId }).lean();
    } else {
      tasks = memoryTasks.filter((t) => t.user === userId);
    }

    const now = Date.now();
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const active = total - completed;
    const overdue = tasks.filter((t) => !t.completed && new Date(t.deadline).getTime() < now).length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({
      success: true,
      stats: { total, completed, active, overdue, completionRate },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/tasks', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { status, priority, category, search, sortBy = 'smart' } = req.query;

    let tasks: any[] = [];

    if (isMongoConnected) {
      const filter: Record<string, any> = { user: userId };
      if (status === 'completed') filter.completed = true;
      else if (status === 'active') filter.completed = false;

      if (priority && priority !== 'ALL') filter.priority = priority;
      if (category && category !== 'ALL') filter.category = category;

      if (search && typeof search === 'string' && search.trim() !== '') {
        const reg = new RegExp(search.trim(), 'i');
        filter.$or = [{ title: reg }, { description: reg }];
      }

      tasks = await Task.find(filter).lean();
    } else {
      tasks = memoryTasks.filter((t) => {
        if (t.user !== userId) return false;
        if (status === 'completed' && !t.completed) return false;
        if (status === 'active' && t.completed) return false;
        if (priority && priority !== 'ALL' && t.priority !== priority) return false;
        if (category && category !== 'ALL' && t.category !== category) return false;
        if (search && typeof search === 'string' && search.trim() !== '') {
          const q = search.trim().toLowerCase();
          const matches = t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
          if (!matches) return false;
        }
        return true;
      });
    }

    const tasksWithUrgency = tasks.map((t) => ({
      ...t,
      urgencyScore: calculateUrgencyScore({
        deadline: t.deadline,
        priority: t.priority as TaskPriority,
        completed: t.completed,
        createdAt: t.createdAt,
      }),
    }));

    if (sortBy === 'smart') {
      tasksWithUrgency.sort((a, b) => b.urgencyScore - a.urgencyScore);
    } else if (sortBy === 'deadline_asc') {
      tasksWithUrgency.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
    } else if (sortBy === 'deadline_desc') {
      tasksWithUrgency.sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime());
    } else if (sortBy === 'priority_desc') {
      const pWeights: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      tasksWithUrgency.sort((a, b) => (pWeights[b.priority] || 0) - (pWeights[a.priority] || 0));
    } else if (sortBy === 'created_desc') {
      tasksWithUrgency.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    res.json({ success: true, count: tasksWithUrgency.length, tasks: tasksWithUrgency });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/tasks', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { title, description = '', dateTime = new Date(), deadline, priority = 'MEDIUM', category = 'Personal', tags = [] } = req.body;
    if (!title || !deadline) {
      res.status(400).json({ success: false, message: 'Title and deadline are required' });
      return;
    }

    if (isMongoConnected) {
      const task = await Task.create({
        user: userId,
        title: title.trim(),
        description: description.trim(),
        dateTime: new Date(dateTime),
        deadline: new Date(deadline),
        priority,
        category,
        tags,
      });

      res.status(201).json({
        success: true,
        message: 'Task created',
        task: {
          ...task.toObject(),
          urgencyScore: calculateUrgencyScore({
            deadline: task.deadline,
            priority: task.priority,
            completed: task.completed,
            createdAt: task.createdAt,
          }),
        },
      });
    } else {
      const newTask: MemoryTask = {
        _id: 'task_' + Math.random().toString(36).substring(2, 9),
        user: userId!,
        title: title.trim(),
        description: description.trim(),
        dateTime: new Date(dateTime).toISOString(),
        deadline: new Date(deadline).toISOString(),
        priority,
        category,
        tags,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryTasks.push(newTask);

      res.status(201).json({
        success: true,
        message: 'Task created',
        task: {
          ...newTask,
          urgencyScore: calculateUrgencyScore({
            deadline: newTask.deadline,
            priority: newTask.priority,
            completed: newTask.completed,
            createdAt: newTask.createdAt,
          }),
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/tasks/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { title, description, dateTime, deadline, priority, category, tags, completed } = req.body;

    if (isMongoConnected) {
      const task = await Task.findOne({ _id: req.params.id, user: userId });
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }

      if (title !== undefined) task.title = title.trim();
      if (description !== undefined) task.description = description.trim();
      if (dateTime !== undefined) task.dateTime = new Date(dateTime);
      if (deadline !== undefined) task.deadline = new Date(deadline);
      if (priority !== undefined) task.priority = priority;
      if (category !== undefined) task.category = category;
      if (tags !== undefined) task.tags = tags;
      if (completed !== undefined) {
        task.completed = Boolean(completed);
        task.completedAt = task.completed ? new Date() : undefined;
      }

      await task.save();
      res.json({
        success: true,
        message: 'Task updated',
        task: {
          ...task.toObject(),
          urgencyScore: calculateUrgencyScore({
            deadline: task.deadline,
            priority: task.priority,
            completed: task.completed,
            createdAt: task.createdAt,
          }),
        },
      });
    } else {
      const task = memoryTasks.find((t) => t._id === req.params.id && t.user === userId);
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }

      if (title !== undefined) task.title = title.trim();
      if (description !== undefined) task.description = description.trim();
      if (dateTime !== undefined) task.dateTime = new Date(dateTime).toISOString();
      if (deadline !== undefined) task.deadline = new Date(deadline).toISOString();
      if (priority !== undefined) task.priority = priority;
      if (category !== undefined) task.category = category;
      if (tags !== undefined) task.tags = tags;
      if (completed !== undefined) {
        task.completed = Boolean(completed);
        task.completedAt = task.completed ? new Date().toISOString() : undefined;
      }
      task.updatedAt = new Date().toISOString();

      res.json({
        success: true,
        message: 'Task updated',
        task: {
          ...task,
          urgencyScore: calculateUrgencyScore({
            deadline: task.deadline,
            priority: task.priority,
            completed: task.completed,
            createdAt: task.createdAt,
          }),
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/tasks/:id/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (isMongoConnected) {
      const task = await Task.findOne({ _id: req.params.id, user: userId });
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }

      task.completed = !task.completed;
      task.completedAt = task.completed ? new Date() : undefined;
      await task.save();

      res.json({
        success: true,
        task: {
          ...task.toObject(),
          urgencyScore: calculateUrgencyScore({
            deadline: task.deadline,
            priority: task.priority,
            completed: task.completed,
            createdAt: task.createdAt,
          }),
        },
      });
    } else {
      const task = memoryTasks.find((t) => t._id === req.params.id && t.user === userId);
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }

      task.completed = !task.completed;
      task.completedAt = task.completed ? new Date().toISOString() : undefined;
      task.updatedAt = new Date().toISOString();

      res.json({
        success: true,
        task: {
          ...task,
          urgencyScore: calculateUrgencyScore({
            deadline: task.deadline,
            priority: task.priority,
            completed: task.completed,
            createdAt: task.createdAt,
          }),
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (isMongoConnected) {
      const task = await Task.findOneAndDelete({ _id: req.params.id, user: userId });
      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }
      res.json({ success: true, id: req.params.id });
    } else {
      const idx = memoryTasks.findIndex((t) => t._id === req.params.id && t.user === userId);
      if (idx === -1) {
        res.status(404).json({ success: false, message: 'Task not found' });
        return;
      }
      memoryTasks.splice(idx, 1);
      res.json({ success: true, id: req.params.id });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err.message);
  res.status(err.status || 500).json({ success: false, message: 'Server error' });
});

export const start = async () => {
  try {
    await connectDB();
  } catch {
    console.log('[db] Using in-memory storage for this run.');
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    console.error('[server] Startup failed:', err.message);
  });
}

export default app;
