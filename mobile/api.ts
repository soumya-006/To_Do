import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Task, TaskStats, User, TaskPriority } from './types';

// For Android emulator, localhost is 10.0.2.2. For physical devices, use LAN IP.
export const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:5000/api' : 'http://localhost:5000/api';

let currentApiUrl = DEFAULT_API_URL;
let memoryToken: string | null = null;

export const setApiUrl = (url: string) => {
  currentApiUrl = url;
};

export const getApiUrl = () => currentApiUrl;

export const getStoredToken = async (): Promise<string | null> => {
  try {
    const token = await AsyncStorage.getItem('@auth_token');
    if (token) return token;
  } catch {
    // fallback to memory
  }
  return memoryToken;
};

export const setStoredToken = async (token: string | null): Promise<void> => {
  memoryToken = token;
  try {
    if (token) {
      await AsyncStorage.setItem('@auth_token', token);
    } else {
      await AsyncStorage.removeItem('@auth_token');
    }
  } catch {}
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${currentApiUrl}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({ message: 'Invalid response from server' }));

  if (!response.ok) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }

  return data as T;
}

// Authentication API
export const authApi = {
  register: async (name: string, email: string, password: string): Promise<{ token: string; user: User }> => {
    const res = await request<{ success: boolean; token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    await setStoredToken(res.token);
    return res;
  },

  login: async (email: string, password: string): Promise<{ token: string; user: User }> => {
    const res = await request<{ success: boolean; token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await setStoredToken(res.token);
    return res;
  },

  getMe: async (): Promise<User> => {
    const res = await request<{ success: boolean; user: User }>('/auth/me');
    return res.user;
  },

  logout: async (): Promise<void> => {
    await setStoredToken(null);
  },
};

// Tasks API
export const tasksApi = {
  getTasks: async (params?: {
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
    sortBy?: string;
  }): Promise<Task[]> => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'all') query.append('status', params.status);
    if (params?.priority && params.priority !== 'ALL') query.append('priority', params.priority);
    if (params?.category && params.category !== 'ALL') query.append('category', params.category);
    if (params?.search) query.append('search', params.search);
    if (params?.sortBy) query.append('sortBy', params.sortBy);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    const res = await request<{ success: boolean; tasks: Task[] }>(`/tasks${queryString}`);
    return res.tasks;
  },

  getStats: async (): Promise<TaskStats> => {
    const res = await request<{ success: boolean; stats: TaskStats }>('/tasks/stats');
    return res.stats;
  },

  createTask: async (taskData: Partial<Task>): Promise<Task> => {
    const res = await request<{ success: boolean; task: Task }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
    return res.task;
  },

  updateTask: async (id: string, taskData: Partial<Task>): Promise<Task> => {
    const res = await request<{ success: boolean; task: Task }>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(taskData),
    });
    return res.task;
  },

  toggleTask: async (id: string): Promise<Task> => {
    const res = await request<{ success: boolean; task: Task }>(`/tasks/${id}/toggle`, {
      method: 'PATCH',
    });
    return res.task;
  },

  deleteTask: async (id: string): Promise<void> => {
    await request<{ success: boolean; id: string }>(`/tasks/${id}`, {
      method: 'DELETE',
    });
  },
};

// Client-side urgency score calculation for live sorting
const PRIORITY_SCORES: Record<TaskPriority, number> = {
  HIGH: 300,
  MEDIUM: 200,
  LOW: 100,
};

export function calculateClientUrgencyScore(task: {
  deadline: string;
  priority: TaskPriority;
  completed: boolean;
  createdAt?: string;
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
