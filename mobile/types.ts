export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskCategory = 'Work' | 'Personal' | 'Study' | 'Health' | 'Finance' | 'Other';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Task {
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
  urgencyScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStats {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  completionRate: number;
}

export type StatusFilter = 'all' | 'active' | 'completed' | 'overdue';
export type SortOption = 'smart' | 'deadline_asc' | 'deadline_desc' | 'priority_desc' | 'created_desc';

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}
