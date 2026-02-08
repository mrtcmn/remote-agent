/**
 * Projects screen - Lists projects with git status, CRUD, fetch/pull/push.
 * Mirrors web Projects.tsx adapted for mobile.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, borderRadius, shadows } from '../lib/theme';
import { formatRelativeTime } from '../lib/format';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { useProjects } from '../hooks/useProjects';
import type { Project, CreateProjectInput } from '../types';

interface ProjectsScreenProps {
  onOpenProject: (projectId: string) => void;
}

function ProjectCard({
  project,
  onOpen,
  onFetch,
  onPull,
}: {
  project: Project;
  onOpen: () => void;
  onFetch: () => void;
  onPull: () => void;
}) {
  return (
    <Card style={styles.projectCard}>
      <CardContent style={styles.projectContent}>
        <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
          <View style={styles.projectHeader}>
            <View style={styles.projectInfo}>
              <Ionicons name="folder-outline" size={20} color={colors.primary} />
              <Text style={styles.projectName} numberOfLines={1}>
                {project.name}
              </Text>
            </View>
          </View>

          {project.repoUrl && (
            <Text style={styles.repoUrl} numberOfLines={1}>
              {project.repoUrl}
            </Text>
          )}

          {project.branch && (
            <View style={styles.branchRow}>
              <Ionicons name="git-branch-outline" size={14} color={colors.mutedForeground} />
              <Text style={styles.branchText}>{project.branch}</Text>
            </View>
          )}

          {project.gitStatus && (
            <View style={styles.gitStatusRow}>
              {(project.gitStatus.ahead ?? 0) > 0 && (
                <Badge variant="success">
                  {`${project.gitStatus.ahead} ahead`}
                </Badge>
              )}
              {(project.gitStatus.behind ?? 0) > 0 && (
                <Badge variant="warning">
                  {`${project.gitStatus.behind} behind`}
                </Badge>
              )}
              {(project.gitStatus.modified ?? 0) > 0 && (
                <Badge variant="outline">
                  {`${project.gitStatus.modified} modified`}
                </Badge>
              )}
            </View>
          )}

          <Text style={styles.timeText}>
            {formatRelativeTime(project.updatedAt)}
          </Text>
        </TouchableOpacity>

        <View style={styles.projectActions}>
          <Button variant="default" size="sm" onPress={onOpen}>
            Open
          </Button>
          <Button variant="outline" size="sm" onPress={onFetch}>
            Fetch
          </Button>
          <Button variant="outline" size="sm" onPress={onPull}>
            Pull
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}

function AddProjectModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: CreateProjectInput) => void;
}) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Project name is required');
      return;
    }
    onSubmit({
      name: name.trim(),
      repoUrl: repoUrl.trim() || undefined,
      branch: branch.trim() || undefined,
    });
    setName('');
    setRepoUrl('');
    setBranch('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalContainer}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Add Project</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Input
              label="Project Name"
              placeholder="My Project"
              value={name}
              onChangeText={setName}
            />
            <Input
              label="Repository URL (optional)"
              placeholder="git@github.com:user/repo.git"
              value={repoUrl}
              onChangeText={setRepoUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Input
              label="Branch (optional)"
              placeholder="main"
              value={branch}
              onChangeText={setBranch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button onPress={handleSubmit}>Add Project</Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ProjectsScreen({ onOpenProject }: ProjectsScreenProps) {
  const { projects, isLoading, refetch, createProject, gitFetch, gitPull } =
    useProjects();
  const [showAddModal, setShowAddModal] = useState(false);

  const handleOpen = useCallback(
    (project: Project) => {
      onOpenProject(project.id);
    },
    [onOpenProject]
  );

  const handleFetch = useCallback(
    async (projectId: string) => {
      try {
        await gitFetch(projectId);
        Alert.alert('Success', 'Fetch complete');
        refetch();
      } catch {
        Alert.alert('Error', 'Fetch failed');
      }
    },
    [gitFetch, refetch]
  );

  const handlePull = useCallback(
    async (projectId: string) => {
      try {
        await gitPull({ projectId });
        Alert.alert('Success', 'Pull complete');
        refetch();
      } catch {
        Alert.alert('Error', 'Pull failed');
      }
    },
    [gitPull, refetch]
  );

  const handleCreate = useCallback(
    async (data: CreateProjectInput) => {
      try {
        await createProject(data);
      } catch {
        Alert.alert('Error', 'Failed to create project');
      }
    },
    [createProject]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Projects</Text>
        <Button size="sm" onPress={() => setShowAddModal(true)}>
          <View style={styles.addButton}>
            <Ionicons name="add" size={18} color={colors.primaryForeground} />
            <Text style={styles.addText}>Add</Text>
          </View>
        </Button>
      </View>

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            onOpen={() => handleOpen(item)}
            onFetch={() => handleFetch(item.id)}
            onPull={() => handlePull(item.id)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="folder-open-outline"
                size={48}
                color={colors.mutedForeground}
              />
              <Text style={styles.emptyTitle}>No projects</Text>
              <Text style={styles.emptyText}>
                Add a project to get started
              </Text>
            </View>
          ) : null
        }
      />

      <AddProjectModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  projectCard: {
    marginBottom: spacing.md,
  },
  projectContent: {
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  projectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  projectName: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: '600',
    flex: 1,
  },
  repoUrl: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  branchText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  gitStatusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  timeText: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  projectActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: spacing.lg,
  },
  form: {
    gap: spacing.lg,
  },
  // Empty
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing['4xl'],
    gap: spacing.md,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
});
