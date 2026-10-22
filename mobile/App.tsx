import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
  ScrollView,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  authApi,
  tasksApi,
  getStoredToken,
  calculateClientUrgencyScore,
  getApiUrl,
  setApiUrl,
} from './api';
import { Task, TaskStats, User, TaskPriority, TaskCategory, StatusFilter, SortOption } from './types';

const CATEGORIES: TaskCategory[] = ['Work', 'Personal', 'Study', 'Health', 'Finance', 'Other'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState<string>('alex@example.com');
  const [authPassword, setAuthPassword] = useState<string>('password123');
  const [authName, setAuthName] = useState<string>('');
  const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);

  const [serverUrlInput, setServerUrlInput] = useState<string>(getApiUrl());
  const [showServerModal, setShowServerModal] = useState<boolean>(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [tasksLoading, setTasksLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [sortOption, setSortOption] = useState<SortOption>('smart');
  const [showSortModal, setShowSortModal] = useState<boolean>(false);

  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskDescription, setTaskDescription] = useState<string>('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('MEDIUM');
  const [taskCategory, setTaskCategory] = useState<TaskCategory>('Personal');
  const [taskDeadlineNumber, setTaskDeadlineNumber] = useState<number>(24);
  const [taskSubmitting, setTaskSubmitting] = useState<boolean>(false);

  useEffect(() => {
    checkAuthSession();
  }, []);

  const checkAuthSession = async () => {
    setAuthLoading(true);
    try {
      const token = await getStoredToken();
      if (token) {
        const currentUser = await authApi.getMe();
        setUser(currentUser);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const loadTasksData = useCallback(async () => {
    if (!user) return;
    try {
      setTasksLoading(true);
      const [fetchedTasks, fetchedStats] = await Promise.all([
        tasksApi.getTasks({
          status: statusFilter,
          category: categoryFilter,
          priority: priorityFilter,
          search: searchQuery,
          sortBy: sortOption,
        }),
        tasksApi.getStats(),
      ]);
      setTasks(fetchedTasks);
      setStats(fetchedStats);
    } catch (err: any) {
      console.log('Error fetching tasks:', err.message);
    } finally {
      setTasksLoading(false);
      setRefreshing(false);
    }
  }, [user, statusFilter, categoryFilter, priorityFilter, searchQuery, sortOption]);

  useEffect(() => {
    if (user) {
      loadTasksData();
    }
  }, [user, loadTasksData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadTasksData();
  };

  const handleAuthSubmit = async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }

    try {
      setAuthSubmitting(true);
      if (authMode === 'login') {
        const res = await authApi.login(authEmail.trim(), authPassword);
        setUser(res.user);
      } else {
        const res = await authApi.register(authName.trim(), authEmail.trim(), authPassword);
        setUser(res.user);
      }
    } catch (err: any) {
      Alert.alert('Sign in error', err.message || 'Please check your email and password.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await authApi.logout();
          setUser(null);
          setTasks([]);
          setStats(null);
        },
      },
    ]);
  };

  const openCreateModal = () => {
    setEditingTask(null);
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriority('MEDIUM');
    setTaskCategory('Personal');
    setTaskDeadlineNumber(24);
    setShowTaskModal(true);
  };

  const openEditModal = (task: Task) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDescription(task.description);
    setTaskPriority(task.priority);
    setTaskCategory(task.category);
    const hoursLeft = Math.max(1, Math.round((new Date(task.deadline).getTime() - Date.now()) / (1000 * 60 * 60)));
    setTaskDeadlineNumber(hoursLeft);
    setShowTaskModal(true);
  };

  const handleSaveTask = async () => {
    if (!taskTitle.trim()) {
      Alert.alert('Title required', 'Please enter a title for this task.');
      return;
    }

    const calculatedDeadline = new Date(Date.now() + taskDeadlineNumber * 60 * 60 * 1000).toISOString();

    try {
      setTaskSubmitting(true);
      if (editingTask) {
        await tasksApi.updateTask(editingTask._id, {
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          priority: taskPriority,
          category: taskCategory,
          deadline: calculatedDeadline,
        });
      } else {
        await tasksApi.createTask({
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          priority: taskPriority,
          category: taskCategory,
          deadline: calculatedDeadline,
          dateTime: new Date().toISOString(),
        });
      }
      setShowTaskModal(false);
      loadTasksData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save task.');
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleToggleTask = async (task: Task) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._id === task._id ? { ...t, completed: !t.completed, urgencyScore: !t.completed ? -10000 : 200 } : t
      )
    );

    try {
      await tasksApi.toggleTask(task._id);
      loadTasksData();
    } catch {
      loadTasksData();
    }
  };

  const handleDeleteTask = (taskId: string, title: string) => {
    Alert.alert('Delete task', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setTasks((prev) => prev.filter((t) => t._id !== taskId));
            await tasksApi.deleteTask(taskId);
            loadTasksData();
          } catch {
            loadTasksData();
          }
        },
      },
    ]);
  };

  const processedTasks = useMemo(() => {
    let list = [...tasks];

    if (statusFilter === 'active') {
      list = list.filter((t) => !t.completed);
    } else if (statusFilter === 'completed') {
      list = list.filter((t) => t.completed);
    } else if (statusFilter === 'overdue') {
      const now = Date.now();
      list = list.filter((t) => !t.completed && new Date(t.deadline).getTime() < now);
    }

    if (categoryFilter !== 'ALL') {
      list = list.filter((t) => t.category === categoryFilter);
    }

    if (priorityFilter !== 'ALL') {
      list = list.filter((t) => t.priority === priorityFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
    }

    if (sortOption === 'smart') {
      list.sort(
        (a, b) =>
          calculateClientUrgencyScore({
            deadline: b.deadline,
            priority: b.priority,
            completed: b.completed,
            createdAt: b.createdAt,
          }) -
          calculateClientUrgencyScore({
            deadline: a.deadline,
            priority: a.priority,
            completed: a.completed,
            createdAt: a.createdAt,
          })
      );
    } else if (sortOption === 'deadline_asc') {
      list.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
    } else if (sortOption === 'deadline_desc') {
      list.sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime());
    } else if (sortOption === 'priority_desc') {
      const pWeights = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      list.sort((a, b) => pWeights[b.priority] - pWeights[a.priority]);
    } else if (sortOption === 'created_desc') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return list;
  }, [tasks, statusFilter, categoryFilter, priorityFilter, searchQuery, sortOption]);

  const formatDeadlineLabel = (deadlineStr: string, completed: boolean) => {
    if (completed) return 'Done';
    const diffHours = (new Date(deadlineStr).getTime() - Date.now()) / (1000 * 60 * 60);
    if (diffHours < 0) {
      const hrs = Math.round(Math.abs(diffHours));
      return hrs > 24 ? `Overdue ${Math.round(hrs / 24)}d` : `Overdue ${hrs}h`;
    } else if (diffHours <= 12) {
      return `Due in ${Math.round(diffHours)}h`;
    } else if (diffHours <= 24) {
      return 'Due today';
    } else {
      return `${Math.round(diffHours / 24)}d left`;
    }
  };

  if (authLoading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0C0D0E" />
        <ActivityIndicator size="small" color="#5E6AD2" />
      </SafeAreaView>
    );
  }

  // Auth Screen
  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0C0D0E" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.authContainer}
        >
          <ScrollView contentContainerStyle={styles.authScroll}>
            {/* ── Hero Logo Area ── */}
            <View style={styles.heroSection}>
              {/* Outer decorative ring */}
              <View style={styles.logoOuterRing}>
                {/* Middle ring */}
                <View style={styles.logoMiddleRing}>
                  {/* Core emblem */}
                  <View style={styles.logoCore}>
                    <Text style={styles.logoCheckmark}>✓</Text>
                  </View>
                </View>
                {/* Accent dots */}
                <View style={[styles.orbitDot, styles.orbitDot1]} />
                <View style={[styles.orbitDot, styles.orbitDot2]} />
                <View style={[styles.orbitDot, styles.orbitDot3]} />
              </View>

              {/* Brand name */}
              <View style={styles.brandNameRow}>
                <Text style={styles.brandNamePrimary}>Task</Text>
                <Text style={styles.brandNameAccent}>Flow</Text>
              </View>
              <Text style={styles.brandTagline}>Smart Task Management</Text>

              {/* Mini floating preview cards */}
              <View style={styles.previewCards}>
                <View style={styles.previewCard}>
                  <View style={styles.previewCardLeft}>
                    <View style={styles.previewDot} />
                  </View>
                  <View style={styles.previewCardBody}>
                    <Text style={styles.previewCardTitle}>Design review</Text>
                    <Text style={styles.previewCardMeta}>HIGH · Due in 2h</Text>
                  </View>
                  <View style={styles.previewHighBadge}>
                    <Text style={styles.previewHighBadgeText}>!</Text>
                  </View>
                </View>

                <View style={[styles.previewCard, styles.previewCardDone]}>
                  <View style={styles.previewCardLeft}>
                    <View style={styles.previewDotDone}>
                      <Text style={styles.previewDotCheck}>✓</Text>
                    </View>
                  </View>
                  <View style={styles.previewCardBody}>
                    <Text style={styles.previewCardTitleDone}>Morning standup</Text>
                    <Text style={styles.previewCardMeta}>Completed</Text>
                  </View>
                </View>
              </View>
            </View>

            <Text style={styles.authLead}>{authMode === 'login' ? 'Welcome back 👋' : 'Create your account'}</Text>
            <Text style={styles.authSub}>
              {authMode === 'login' ? 'Sign in to access your tasks' : 'Start organizing your life in seconds'}
            </Text>

            <View style={styles.card}>
              {authMode === 'register' && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Alex Morgan"
                    placeholderTextColor="#555A64"
                    value={authName}
                    onChangeText={setAuthName}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="alex@example.com"
                  placeholderTextColor="#555A64"
                  value={authEmail}
                  onChangeText={setAuthEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#555A64"
                  value={authPassword}
                  onChangeText={setAuthPassword}
                  secureTextEntry
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, authSubmitting && styles.disabledButton]}
                onPress={handleAuthSubmit}
                disabled={authSubmitting}
                activeOpacity={0.8}
              >
                {authSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {authMode === 'login' ? 'Sign in' : 'Create account'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.toggleAuthButton}
                onPress={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
              >
                <Text style={styles.toggleAuthText}>
                  {authMode === 'login' ? "Don't have an account? Sign up" : 'Already registered? Sign in'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.serverConfigLink} onPress={() => setShowServerModal(true)}>
              <Text style={styles.serverConfigText}>Server endpoint: {getApiUrl()}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal visible={showServerModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>API Server URL</Text>
              <TextInput
                style={styles.input}
                value={serverUrlInput}
                onChangeText={setServerUrlInput}
                placeholder="http://10.0.2.2:5000/api"
                placeholderTextColor="#555A64"
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowServerModal(false)}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => {
                    setApiUrl(serverUrlInput.trim());
                    setShowServerModal(false);
                  }}
                >
                  <Text style={styles.primaryButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // Dashboard View
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0C0D0E" />

      {/* Top Bar */}
      <View style={styles.appBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandHeading}>Tasks</Text>
        </View>
        <View style={styles.userSection}>
          <Text style={styles.userNameText}>{user.name || user.email.split('@')[0]}</Text>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
            <Text style={styles.logoutButtonText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Today's Progress</Text>
          <Text style={styles.summaryPct}>
            {stats ? `${stats.completed} of ${stats.total} done · ${stats.completionRate}%` : 'Loading...'}
          </Text>
        </View>

        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${stats ? stats.completionRate : 0}%` }]} />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statVal}>{stats?.total ?? 0}</Text>
            <Text style={styles.statLbl}>Total</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statVal, { color: '#10B981' }]}>{stats?.completed ?? 0}</Text>
            <Text style={styles.statLbl}>Done</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statVal, { color: '#5E6AD2' }]}>{stats?.active ?? 0}</Text>
            <Text style={styles.statLbl}>Pending</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statVal, { color: '#F43F5E' }]}>{stats?.overdue ?? 0}</Text>
            <Text style={styles.statLbl}>Overdue</Text>
          </View>
        </View>
      </View>

      {/* Search and Sort Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks..."
            placeholderTextColor="#555A64"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <TouchableOpacity style={styles.sortButton} onPress={() => setShowSortModal(true)}>
          <Text style={styles.sortButtonText}>{sortOption === 'smart' ? '⚡ Urgency' : 'Sort'}</Text>
        </TouchableOpacity>
      </View>

      {/* Status Segmented Control */}
      <View style={styles.segmentedControl}>
        {(['all', 'active', 'completed', 'overdue'] as StatusFilter[]).map((tab) => {
          const isActive = statusFilter === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.segButton, isActive && styles.segButtonActive]}
              onPress={() => setStatusFilter(tab)}
            >
              <Text style={[styles.segText, isActive && styles.segTextActive]}>
                {tab === 'all' ? 'All' : tab === 'active' ? 'Active' : tab === 'completed' ? 'Done' : 'Overdue'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Category Filter Chips */}
      <View style={styles.categoryChipsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
          <TouchableOpacity
            style={[styles.categoryChip, categoryFilter === 'ALL' && styles.categoryChipActive]}
            onPress={() => setCategoryFilter('ALL')}
          >
            <Text style={[styles.categoryChipText, categoryFilter === 'ALL' && styles.categoryChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {CATEGORIES.map((cat) => {
            const isCatActive = categoryFilter === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, isCatActive && styles.categoryChipActive]}
                onPress={() => setCategoryFilter(isCatActive ? 'ALL' : cat)}
              >
                <Text style={[styles.categoryChipText, isCatActive && styles.categoryChipTextActive]}>
                  #{cat.toLowerCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Task List */}
      <FlatList
        data={processedTasks}
        keyExtractor={(item) => item._id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5E6AD2" />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          tasksLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color="#5E6AD2" />
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>All clear for now</Text>
              <Text style={styles.emptySubtitle}>Tap the '+' button to capture a new task</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const deadlineText = formatDeadlineLabel(item.deadline, item.completed);
          const isOverdue = !item.completed && new Date(item.deadline).getTime() < Date.now();

          return (
            <View style={[styles.taskCard, item.completed && styles.taskCardCompleted]}>
              <TouchableOpacity
                style={[styles.tickBox, item.completed && styles.tickBoxChecked]}
                onPress={() => handleToggleTask(item)}
                activeOpacity={0.7}
              >
                {item.completed && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>

              <View style={styles.taskInfo}>
                <Text style={[styles.taskTitle, item.completed && styles.taskTitleCompleted]}>
                  {item.title}
                </Text>

                {item.description ? (
                  <Text style={[styles.taskDesc, item.completed && styles.taskDescCompleted]}>
                    {item.description}
                  </Text>
                ) : null}

                <View style={styles.pillRow}>
                  <Text style={styles.pillTag}>#{item.category.toLowerCase()}</Text>

                  <Text
                    style={[
                      styles.pillPriority,
                      item.priority === 'HIGH'
                        ? styles.pillHigh
                        : item.priority === 'MEDIUM'
                        ? styles.pillMed
                        : styles.pillLow,
                    ]}
                  >
                    ● {item.priority}
                  </Text>

                  <Text style={[styles.pillDeadline, isOverdue && styles.pillOverdue]}>
                    {deadlineText}
                  </Text>

                  {item.urgencyScore !== undefined && !item.completed && (
                    <Text style={styles.pillUrgency}>
                      {Math.round(item.urgencyScore)} priority score
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.taskActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEditModal(item)}>
                  <Text style={styles.actionBtnText}>✎</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleDeleteTask(item._id, item.title)}
                >
                  <Text style={styles.actionBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {/* Floating Add Button */}
      <TouchableOpacity style={styles.fab} onPress={openCreateModal} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* New Task Modal */}
      <Modal visible={showTaskModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.taskModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingTask ? 'Edit Task' : 'New Task'}</Text>
              <TouchableOpacity onPress={() => setShowTaskModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.taskModalScroll}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Refactor API endpoints"
                  placeholderTextColor="#555A64"
                  value={taskTitle}
                  onChangeText={setTaskTitle}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Notes</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  placeholder="Add context or details..."
                  placeholderTextColor="#555A64"
                  value={taskDescription}
                  onChangeText={setTaskDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Priority</Text>
                <View style={styles.segmentedRow}>
                  {(['LOW', 'MEDIUM', 'HIGH'] as TaskPriority[]).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.pSegment, taskPriority === p && styles.pSegmentActive]}
                      onPress={() => setTaskPriority(p)}
                    >
                      <Text style={[styles.pSegmentText, taskPriority === p && styles.pSegmentTextActive]}>
                        {p}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.catRow}>
                    {CATEGORIES.map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.catPill, taskCategory === cat && styles.catPillActive]}
                        onPress={() => setTaskCategory(cat)}
                      >
                        <Text style={[styles.catPillText, taskCategory === cat && styles.catPillTextActive]}>
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Due in</Text>
                <View style={styles.deadlineRow}>
                  {[
                    { label: '4h', hours: 4 },
                    { label: '12h', hours: 12 },
                    { label: 'Tomorrow', hours: 24 },
                    { label: '3 days', hours: 72 },
                    { label: '1 week', hours: 168 },
                  ].map((preset) => (
                    <TouchableOpacity
                      key={preset.hours}
                      style={[styles.dBtn, taskDeadlineNumber === preset.hours && styles.dBtnActive]}
                      onPress={() => setTaskDeadlineNumber(preset.hours)}
                    >
                      <Text style={[styles.dBtnText, taskDeadlineNumber === preset.hours && styles.dBtnTextActive]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, taskSubmitting && styles.disabledButton]}
                onPress={handleSaveTask}
                disabled={taskSubmitting}
                activeOpacity={0.8}
              >
                {taskSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>{editingTask ? 'Save Changes' : 'Create Task'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sort Options Modal */}
      <Modal visible={showSortModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Sort by</Text>
            {[
              { id: 'smart', label: '⚡ Urgency mix', desc: 'Combines priority, deadline proximity, and overdue weight' },
              { id: 'deadline_asc', label: 'Deadline (soonest)', desc: 'Tasks due closest to now' },
              { id: 'priority_desc', label: 'Priority (high to low)', desc: 'High priority tasks first' },
              { id: 'created_desc', label: 'Recently created', desc: 'Newest additions' },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[styles.sortRow, sortOption === opt.id && styles.sortRowActive]}
                onPress={() => {
                  setSortOption(opt.id as SortOption);
                  setShowSortModal(false);
                }}
              >
                <Text style={[styles.sortLabel, sortOption === opt.id && styles.sortLabelActive]}>
                  {opt.label}
                </Text>
                <Text style={styles.sortDesc}>{opt.desc}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={[styles.secondaryButton, { marginTop: 16 }]} onPress={() => setShowSortModal(false)}>
              <Text style={styles.secondaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0C0D0E' },
  centerContainer: { flex: 1, backgroundColor: '#0C0D0E', justifyContent: 'center', alignItems: 'center' },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5E6AD2' },
  brandHeading: { fontSize: 16, fontWeight: '700', color: '#F4F5F8', letterSpacing: -0.3 },

  authContainer: { flex: 1 },
  authScroll: { padding: 24, paddingTop: 32, justifyContent: 'center' },
  authLead: { fontSize: 24, fontWeight: '800', color: '#F4F5F8', marginTop: 20, letterSpacing: -0.6 },
  authSub: { fontSize: 13, color: '#737885', marginTop: 5, marginBottom: 22, lineHeight: 18 },

  // Hero logo section
  heroSection: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },

  logoOuterRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    borderColor: 'rgba(94,106,210,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  logoMiddleRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(94,106,210,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(94,106,210,0.05)',
  },
  logoCore: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#5E6AD2',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#5E6AD2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  logoCheckmark: { fontSize: 30, color: '#FFFFFF', fontWeight: '700' },

  orbitDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5E6AD2',
    position: 'absolute',
  },
  orbitDot1: { top: 8, right: 22 },
  orbitDot2: { bottom: 14, left: 14, width: 5, height: 5, borderRadius: 3, backgroundColor: '#10B981', opacity: 0.85 },
  orbitDot3: { top: 22, left: 8, width: 4, height: 4, borderRadius: 2, backgroundColor: '#F59E0B', opacity: 0.75 },

  brandNameRow: { flexDirection: 'row', marginTop: 16, alignItems: 'baseline' },
  brandNamePrimary: { fontSize: 28, fontWeight: '800', color: '#F4F5F8', letterSpacing: -1 },
  brandNameAccent: { fontSize: 28, fontWeight: '800', color: '#5E6AD2', letterSpacing: -1 },
  brandTagline: { fontSize: 11, color: '#686D78', marginTop: 3, letterSpacing: 1, textTransform: 'uppercase' },

  previewCards: { width: '100%', marginTop: 18, gap: 7 },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141518',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#22252A',
    gap: 10,
  },
  previewCardDone: { opacity: 0.5 },
  previewCardLeft: { width: 20, alignItems: 'center' },
  previewDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F43F5E' },
  previewDotDone: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewDotCheck: { fontSize: 8, color: '#fff', fontWeight: 'bold' },
  previewCardBody: { flex: 1 },
  previewCardTitle: { fontSize: 12, color: '#D0D4DC', fontWeight: '600' },
  previewCardTitleDone: { fontSize: 12, color: '#686D78', fontWeight: '500', textDecorationLine: 'line-through' },
  previewCardMeta: { fontSize: 10, color: '#686D78', marginTop: 1 },
  previewHighBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(244,63,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewHighBadgeText: { fontSize: 10, color: '#F43F5E', fontWeight: '800' },

  card: { backgroundColor: '#141518', borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#22252A' },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 11, color: '#7D828E', marginBottom: 6, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#191B1F', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#F4F5F8', fontSize: 13, borderWidth: 1, borderColor: '#282B31' },
  multilineInput: { height: 75, textAlignVertical: 'top' },

  primaryButton: { backgroundColor: '#5E6AD2', borderRadius: 8, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  disabledButton: { opacity: 0.6 },
  secondaryButton: { backgroundColor: '#191B1F', borderRadius: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#8F94A0', fontSize: 13, fontWeight: '500' },

  toggleAuthButton: { marginTop: 14, alignItems: 'center' },
  toggleAuthText: { color: '#7B85E2', fontSize: 12 },
  serverConfigLink: { marginTop: 20, alignItems: 'center' },
  serverConfigText: { color: '#525762', fontSize: 11 },

  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1A1C20' },
  userSection: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  userNameText: { color: '#8F94A0', fontSize: 12 },
  logoutButton: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#2B2F37' },
  logoutButtonText: { color: '#737885', fontSize: 11 },

  summaryCard: { marginHorizontal: 16, marginTop: 14, backgroundColor: '#141518', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#22252A' },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryTitle: { color: '#D0D4DC', fontSize: 13, fontWeight: '600' },
  summaryPct: { color: '#5E6AD2', fontSize: 12, fontWeight: '700' },
  progressBarTrack: { height: 4, backgroundColor: '#22252B', borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#5E6AD2', borderRadius: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1C1E23' },
  statBox: { alignItems: 'center', flex: 1 },
  statVal: { color: '#F4F5F8', fontSize: 14, fontWeight: '700' },
  statLbl: { color: '#686D78', fontSize: 10, marginTop: 2 },

  toolbar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, gap: 8 },
  searchBar: { flex: 1, backgroundColor: '#141518', borderRadius: 8, paddingHorizontal: 10, height: 38, borderWidth: 1, borderColor: '#22252A', justifyContent: 'center' },
  searchInput: { color: '#F4F5F8', fontSize: 12, paddingVertical: 0 },
  sortButton: { backgroundColor: '#141518', paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#22252A' },
  sortButtonText: { color: '#8F94A0', fontSize: 11, fontWeight: '600' },

  segmentedControl: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: '#141518', borderRadius: 8, padding: 2, borderWidth: 1, borderColor: '#202227' },
  segButton: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6 },
  segButtonActive: { backgroundColor: '#22252B' },
  segText: { color: '#686D78', fontSize: 11, fontWeight: '600' },
  segTextActive: { color: '#F4F5F8' },

  categoryChipsContainer: { marginTop: 8 },
  categoryScroll: { paddingHorizontal: 16, gap: 6 },
  categoryChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#141518', borderWidth: 1, borderColor: '#22252A' },
  categoryChipActive: { backgroundColor: '#22252B', borderColor: '#5E6AD2' },
  categoryChipText: { color: '#737885', fontSize: 11 },
  categoryChipTextActive: { color: '#F4F5F8', fontWeight: '600' },

  listContent: { padding: 16, paddingBottom: 85 },
  taskCard: { flexDirection: 'row', backgroundColor: '#141518', borderRadius: 10, padding: 12, marginBottom: 8, alignItems: 'flex-start', borderWidth: 1, borderColor: '#202227' },
  taskCardCompleted: { opacity: 0.45 },
  tickBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: '#3F4450', alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1 },
  tickBoxChecked: { backgroundColor: '#10B981', borderColor: '#10B981' },
  checkmark: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  taskInfo: { flex: 1 },
  taskTitle: { color: '#EDEDF0', fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },
  taskTitleCompleted: { textDecorationLine: 'line-through', color: '#686D78' },
  taskDesc: { color: '#848995', fontSize: 11, marginTop: 3 },
  taskDescCompleted: { textDecorationLine: 'line-through', color: '#4E535E' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' },
  pillTag: { color: '#7D828E', fontSize: 10 },
  pillPriority: { fontSize: 10, fontWeight: '500' },
  pillHigh: { color: '#F43F5E' },
  pillMed: { color: '#F59E0B' },
  pillLow: { color: '#10B981' },
  pillDeadline: { color: '#686D78', fontSize: 10 },
  pillOverdue: { color: '#F43F5E' },
  pillUrgency: { color: '#7B85E2', fontSize: 10, backgroundColor: 'rgba(94,106,210,0.1)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },

  taskActions: { flexDirection: 'row', gap: 4, marginLeft: 6 },
  actionBtn: { padding: 4 },
  actionBtnText: { color: '#555A64', fontSize: 11 },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 45 },
  emptyTitle: { color: '#8F94A0', fontSize: 13, fontWeight: '500' },
  emptySubtitle: { color: '#555A64', fontSize: 11, marginTop: 3 },

  fab: { position: 'absolute', bottom: 20, right: 20, width: 48, height: 48, borderRadius: 24, backgroundColor: '#5E6AD2', alignItems: 'center', justifyContent: 'center', elevation: 6 },
  fabText: { color: '#FFFFFF', fontSize: 24, fontWeight: '300', marginTop: -2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'flex-end' },
  taskModalContent: { backgroundColor: '#141518', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '88%', borderWidth: 1, borderColor: '#262930' },
  taskModalScroll: { paddingBottom: 20 },
  modalContent: { backgroundColor: '#141518', borderRadius: 14, padding: 18, margin: 18, borderWidth: 1, borderColor: '#262930' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { color: '#F4F5F8', fontSize: 15, fontWeight: '700' },
  modalCloseText: { color: '#737885', fontSize: 16, padding: 4 },

  segmentedRow: { flexDirection: 'row', gap: 6 },
  pSegment: { flex: 1, paddingVertical: 8, borderRadius: 6, backgroundColor: '#191B1F', alignItems: 'center', borderWidth: 1, borderColor: '#25282F' },
  pSegmentActive: { backgroundColor: '#22252B', borderColor: '#5E6AD2' },
  pSegmentText: { color: '#737885', fontSize: 11, fontWeight: '500' },
  pSegmentTextActive: { color: '#F4F5F8', fontWeight: '600' },

  catRow: { flexDirection: 'row', gap: 6 },
  catPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#191B1F', borderWidth: 1, borderColor: '#25282F' },
  catPillActive: { backgroundColor: '#22252B', borderColor: '#5E6AD2' },
  catPillText: { color: '#737885', fontSize: 11 },
  catPillTextActive: { color: '#F4F5F8', fontWeight: '600' },

  deadlineRow: { flexDirection: 'row', gap: 6 },
  dBtn: { flex: 1, paddingVertical: 7, borderRadius: 6, backgroundColor: '#191B1F', alignItems: 'center', borderWidth: 1, borderColor: '#25282F' },
  dBtnActive: { backgroundColor: '#22252B', borderColor: '#5E6AD2' },
  dBtnText: { color: '#737885', fontSize: 10 },
  dBtnTextActive: { color: '#F4F5F8', fontWeight: '600' },

  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  sortRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E2025' },
  sortRowActive: { backgroundColor: 'rgba(94, 106, 210, 0.08)', borderRadius: 6, paddingHorizontal: 6 },
  sortLabel: { color: '#D0D4DC', fontSize: 13, fontWeight: '500' },
  sortLabelActive: { color: '#7B85E2', fontWeight: '600' },
  sortDesc: { color: '#686D78', fontSize: 11, marginTop: 2 },
});
