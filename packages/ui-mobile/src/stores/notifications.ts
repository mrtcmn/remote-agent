import { create } from 'zustand';

interface NotificationStore {
  unreadCount: number;
  inboxOpen: boolean;
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  setInboxOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  unreadCount: 0,
  inboxOpen: false,
  setUnreadCount: (count) => set({ unreadCount: count }),
  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  setInboxOpen: (open) => set({ inboxOpen: open }),
}));
