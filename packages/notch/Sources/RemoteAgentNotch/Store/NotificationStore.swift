//
//  NotificationStore.swift
//  Single source of truth for pending notifications, fed by NotchSocket.
//

import Foundation

@MainActor
final class NotificationStore: ObservableObject {
    struct Incoming: Equatable {
        let record: NotificationRecord
        /// Server-side hint: the user is actively using the web UI right now.
        let userActive: Bool
        let at: Date
    }

    @Published private(set) var notifications: [NotificationRecord] = []
    @Published private(set) var connectionState: NotchSocket.ConnectionState = .disconnected
    /// Last pushed notification — drives popup/sound/bounce in NotchView.
    @Published private(set) var lastIncoming: Incoming?

    private let socket = NotchSocket()
    private var started = false

    func start() {
        guard !started else { return }
        started = true

        socket.onState = { [weak self] state in
            self?.connectionState = state
        }
        socket.onSnapshot = { [weak self] records in
            self?.notifications = records
        }
        socket.onNotification = { [weak self] record, userActive in
            guard let self else { return }
            self.notifications.removeAll { $0.id == record.id }
            self.notifications.insert(record, at: 0)
            self.lastIncoming = Incoming(record: record, userActive: userActive, at: Date())
        }
        socket.onRemoved = { [weak self] id in
            self?.remove(id)
        }
        socket.connect()
    }

    /// Reconnect after settings (server URL / token) change.
    func reconnect() {
        socket.disconnect()
        socket.connect()
    }

    func respond(_ record: NotificationRecord, action: String, text: String? = nil) {
        socket.respond(id: record.id, action: action, text: text)
        // Optimistic removal; the server's 'resolved' echo is idempotent.
        remove(record.id)
    }

    func dismiss(_ record: NotificationRecord) {
        socket.dismiss(id: record.id)
        remove(record.id)
    }

    private func remove(_ id: String) {
        notifications.removeAll { $0.id == id }
    }
}
