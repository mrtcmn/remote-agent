import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const SIDEBAR_WIDTH_KEY = 'sidebar-width';
const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 400;

export function useSidebar() {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return stored ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(stored))) : DEFAULT_WIDTH;
  });

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });

  const resize = useCallback((newWidth: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
    setWidth(clamped);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  const { data: sidebarData, isLoading } = useQuery({
    queryKey: ['sidebar-data'],
    queryFn: api.getSidebarData,
    refetchInterval: 5000,
  });

  return {
    width,
    collapsed,
    resize,
    toggleCollapsed,
    sidebarData,
    isLoading,
    MIN_WIDTH,
    MAX_WIDTH,
  };
}
