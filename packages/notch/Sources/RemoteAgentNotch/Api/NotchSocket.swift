//
//  NotchSocket.swift
//  Bidirectional websocket to the API's /ws/notifications endpoint.
//  Bearer machine-token auth, ping keepalive, auto-reconnect with backoff;
//  every reconnect re-fetches the snapshot so missed events self-heal.
//

import Foundation

@MainActor
final class NotchSocket {
    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
    }

    var onState: ((ConnectionState) -> Void)?
    var onSnapshot: (([NotificationRecord]) -> Void)?
    var onNotification: ((NotificationRecord, _ userActive: Bool) -> Void)?
    var onRemoved: ((_ id: String) -> Void)?

    private var task: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var reconnectWork: DispatchWorkItem?
    private var attempts = 0
    private var stopped = true
    /// Bumped on every (re)connect/disconnect so stale receive loops die.
    private var generation = 0

    func connect() {
        stopped = false
        reconnectWork?.cancel()

        guard let url = Self.websocketURL(from: AppSettings.serverURL),
              let token = AppSettings.machineToken else {
            onState?(.disconnected)
            return
        }

        generation += 1
        let gen = generation
        onState?(.connecting)

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.webSocketTask(with: request)
        self.task = task
        task.resume()
        receive(on: task, generation: gen)
        startPing()
    }

    func disconnect() {
        stopped = true
        generation += 1
        reconnectWork?.cancel()
        pingTimer?.invalidate()
        pingTimer = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        onState?(.disconnected)
    }

    static func websocketURL(from base: String) -> URL? {
        guard var components = URLComponents(string: base), components.host != nil else { return nil }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws/notifications"
        components.query = nil
        return components.url
    }

    // MARK: - Outbound

    func respond(id: String, action: String, text: String? = nil) {
        var payload: [String: Any] = ["type": "respond", "id": id, "action": action]
        if let text { payload["text"] = text }
        send(payload)
    }

    func dismiss(id: String) {
        send(["type": "dismiss", "id": id])
    }

    private func send(_ payload: [String: Any]) {
        guard let task,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    // MARK: - Inbound

    private func receive(on task: URLSessionWebSocketTask, generation gen: Int) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, gen == self.generation else { return }
                switch result {
                case .failure:
                    self.scheduleReconnect()
                case .success(let message):
                    if case .string(let text) = message {
                        self.handle(text)
                    }
                    self.receive(on: task, generation: gen)
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        let decoder = JSONDecoder()
        guard let head = try? decoder.decode(FrameHead.self, from: data) else { return }

        switch head.type {
        case "snapshot":
            attempts = 0
            onState?(.connected)
            if let frame = try? decoder.decode(SnapshotFrame.self, from: data) {
                onSnapshot?(frame.data)
            }
        case "notification":
            if let frame = try? decoder.decode(NotificationFrame.self, from: data) {
                onNotification?(frame.data, frame.userActive ?? false)
            }
        case "resolved", "dismissed":
            if let id = head.id {
                onRemoved?(id)
            }
        default:
            break // pong, respond_result, error
        }
    }

    // MARK: - Keepalive / reconnect

    private func startPing() {
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.send(["type": "ping"])
            }
        }
    }

    private func scheduleReconnect() {
        guard !stopped else { return }
        pingTimer?.invalidate()
        pingTimer = nil
        onState?(.disconnected)

        attempts += 1
        let delay = min(30.0, pow(2.0, Double(min(attempts, 5))))
        let work = DispatchWorkItem { [weak self] in
            self?.connect()
        }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }
}
