//
//  NotificationListView.swift
//  Notification rows with inline review actions (approve/deny/options/reply),
//  in the style of vibe-notch's instance list.
//

import AppKit
import SwiftUI

struct NotificationListView: View {
    @ObservedObject var store: NotificationStore

    var body: some View {
        if store.notifications.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "bell.slash")
                    .font(.system(size: 22))
                    .foregroundColor(.white.opacity(0.25))
                Text("No pending notifications")
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.45))
                if store.connectionState != .connected {
                    Button(AppSettings.machineToken == nil ? "Set up connection…" : "Reconnect") {
                        if AppSettings.machineToken == nil {
                            SettingsWindowController.shared.show(store: store)
                        } else {
                            store.reconnect()
                        }
                    }
                    .font(.system(size: 11))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 8) {
                    ForEach(store.notifications) { record in
                        NotificationRow(record: record, store: store)
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }
}

struct NotificationRow: View {
    let record: NotificationRecord
    let store: NotificationStore

    @State private var replyText = ""
    @State private var isReplying = false
    @FocusState private var replyFocused: Bool

    /// Actions rendered as buttons; 'reply' gets the inline text field instead.
    private var buttonActions: [NotificationAction] {
        let actions = record.actions ?? []
        if actions.isEmpty && record.needsReview {
            // ponytail: server always sends actions today; default pair is a fallback
            return [
                NotificationAction(label: "Allow", action: "approve"),
                NotificationAction(label: "Deny", action: "deny"),
            ]
        }
        return actions.filter { $0.action != "reply" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: iconName)
                    .font(.system(size: 11))
                    .foregroundColor(iconColor)

                Text(record.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
                    .lineLimit(1)

                if let project = record.projectName {
                    Text(project)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(.white.opacity(0.5))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.white.opacity(0.08)))
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                Button {
                    store.dismiss(record)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white.opacity(0.35))
                        .frame(width: 18, height: 18)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            Text(record.body)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.65))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if isReplying {
                replyBar
            } else {
                actionsRow
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.06)))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(record.needsReview ? Palette.amber.opacity(0.35) : .clear, lineWidth: 1)
        )
        .padding(.horizontal, 2)
    }

    // MARK: - Pieces

    private var actionsRow: some View {
        HStack(spacing: 6) {
            ForEach(buttonActions, id: \.action) { action in
                actionButton(action)
            }
            if record.freeformAllowed {
                pillButton("Reply", systemImage: "arrowshape.turn.up.left.fill", tint: .white.opacity(0.7)) {
                    isReplying = true
                    replyFocused = true
                }
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ action: NotificationAction) -> some View {
        switch action.action {
        case "approve":
            pillButton(action.label, systemImage: "checkmark", tint: Palette.green) {
                store.respond(record, action: "approve")
            }
        case "deny":
            pillButton(action.label, systemImage: "xmark", tint: Palette.red) {
                store.respond(record, action: "deny")
            }
        case "open":
            pillButton("Open", systemImage: "arrow.up.forward.app", tint: .white.opacity(0.7)) {
                openInBrowser()
            }
        default:
            pillButton(action.label, systemImage: nil, tint: .white.opacity(0.85)) {
                store.respond(record, action: action.action)
            }
        }
    }

    private func pillButton(_ label: String, systemImage: String?, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 9, weight: .bold))
                }
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundColor(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(tint.opacity(0.15)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var replyBar: some View {
        HStack(spacing: 6) {
            TextField("Type a reply…", text: $replyText)
                .textFieldStyle(.plain)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.9))
                .focused($replyFocused)
                .onSubmit(sendReply)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.white.opacity(0.08)))

            Button("Send", action: sendReply)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(replyText.isEmpty ? .white.opacity(0.3) : Palette.green)
                .disabled(replyText.isEmpty)

            Button {
                isReplying = false
                replyText = ""
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.white.opacity(0.35))
            }
            .buttonStyle(.plain)
        }
    }

    private func sendReply() {
        let text = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.respond(record, action: "reply", text: text)
    }

    private func openInBrowser() {
        var path = "/sessions/\(record.sessionId ?? "")"
        if let terminalId = record.terminalId {
            path += "/\(terminalId)"
        }
        if let url = URL(string: AppSettings.serverURL + path) {
            NSWorkspace.shared.open(url)
        }
    }

    private var iconName: String {
        switch record.type {
        case "permission_request": return "lock.shield"
        case "user_input_required": return "questionmark.bubble"
        case "error": return "exclamationmark.triangle"
        case "task_complete": return "checkmark.circle"
        default: return "bell"
        }
    }

    private var iconColor: Color {
        switch record.type {
        case "permission_request", "user_input_required": return Palette.amber
        case "error": return Palette.red
        case "task_complete": return Palette.green
        default: return .white.opacity(0.6)
        }
    }
}
