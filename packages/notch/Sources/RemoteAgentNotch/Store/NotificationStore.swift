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

    /// The most urgent live status, for the collapsed pill's dot.
    /// review > error > running > done; nil when idle.
    var worstStatus: StatusKind? {
        if notifications.isEmpty { return nil }
        if notifications.contains(where: { $0.statusKind == .review }) { return .review }
        if notifications.contains(where: { $0.statusKind == .error }) { return .error }
        if notifications.contains(where: { $0.statusKind == .running }) { return .running }
        return .done
    }

    /// The session the collapsed pill speaks for: review > error > running > done.
    var mostUrgent: NotificationRecord? {
        notifications.min { $0.statusKind.rank < $1.statusKind.rank }
    }

    /// Where a dictated transcript goes: the newest session waiting on free-form
    /// text, else any session that accepts it. nil → clipboard only.
    var replyTarget: NotificationRecord? {
        notifications.first { $0.needsReview && $0.freeformAllowed }
            ?? notifications.first { $0.freeformAllowed }
    }

    private let socket = NotchSocket()
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        if ProcessInfo.processInfo.environment["RA_NOTCH_DEMO"] != nil { seedDemo() }

        socket.onState = { [weak self] state in
            self?.connectionState = state
        }
        socket.onSnapshot = { [weak self] records in
            self?.notifications = records
        }
        socket.onNotification = { [weak self] record, userActive in
            guard let self else { return }
            // One live notification per terminal, scoped to its machine (terminals
            // from different machines mustn't collide). The server already supersedes
            // the previous one; this drops it locally too in case the incoming frame
            // beats the server's 'dismissed'.
            self.notifications.removeAll {
                $0.id == record.id
                    || ($0.terminalId != nil && $0.terminalId == record.terminalId
                        && ($0.machineId ?? "self") == (record.machineId ?? "self"))
            }
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
        socket.respond(id: record.id, action: action, text: text, machineId: record.machineId)
        // Optimistic removal; the server's 'resolved' echo is idempotent.
        remove(record.id)
    }

    func dismiss(_ record: NotificationRecord) {
        socket.dismiss(id: record.id, machineId: record.machineId)
        remove(record.id)
    }

    private func remove(_ id: String) {
        notifications.removeAll { $0.id == id }
    }
}

// MARK: - Demo (RA_NOTCH_DEMO=1) — temporary, for design screenshots.
extension NotificationStore {
    func seedDemo() {
        let json = """
        [
          {"id":"1","sessionId":"s1","terminalId":null,"type":"permission_request",
           "title":"Edit mcp-server.ts","body":"Allow the edit?",
           "metadata":{"projectName":"remote-agent","activity":"Editing mcp-server.ts","todosDone":3,"todosTotal":5},
           "actions":[{"action":"approve","label":"Approve"},{"action":"deny","label":"Deny"}],
           "priority":"high","status":"pending","createdAt":null,"machineId":null,"machineName":null},
          {"id":"2","sessionId":"s2","terminalId":null,"type":"session_started",
           "title":"Refactor tunnel client","body":"Working…",
           "metadata":{"projectName":"remote-agent","activity":"Running bun test"},
           "actions":[],"priority":"normal","status":"running","createdAt":null,"machineId":null,"machineName":null}
        ]
        """
        if let data = json.data(using: .utf8),
           let records = try? JSONDecoder().decode([NotificationRecord].self, from: data) {
            notifications = records
        }
    }
}
