//
//  NotificationListView.swift
//  Notification rows with inline review actions (approve/deny/options/reply),
//  in the style of vibe-notch's instance list.
//

import AppKit
import SwiftUI

struct NotificationListView: View {
    @ObservedObject var store: NotificationStore

    /// Most-urgent first. Empty groups are dropped.
    private static let groupOrder: [StatusKind] = [.review, .error, .running, .done]

    private var groups: [(kind: StatusKind, items: [NotificationRecord])] {
        Self.groupOrder.compactMap { kind in
            let items = store.notifications.filter { $0.statusKind == kind }
            return items.isEmpty ? nil : (kind, items)
        }
    }

    var body: some View {
        if store.notifications.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "moon.zzz")
                    .font(.system(size: 22))
                    .foregroundColor(.white.opacity(0.25))
                Text("No active sessions")
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
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(groups, id: \.kind) { group in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(group.kind.groupLabel)
                                .font(.system(size: 9, weight: .bold))
                                .tracking(0.6)
                                .foregroundColor(.white.opacity(0.35))
                                .padding(.horizontal, 12)
                            ForEach(group.items) { record in
                                NotificationRow(record: record, store: store)
                            }
                        }
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
    @State private var hovering = false
    @FocusState private var replyFocused: Bool

    /// Collapsed by default; body + actions reveal on hover (or while replying).
    /// A needs-you prompt is always expanded — its answer buttons must be one click
    /// away, not hidden behind a hover.
    private var expanded: Bool { hovering || isReplying || record.needsReview }

    private var titleText: String {
        if let project = record.projectName, !project.isEmpty {
            return "\(project) · \(record.title)"
        }
        return record.title
    }

    private var hasActions: Bool {
        record.needsReview || record.freeformAllowed || !(record.actions ?? []).isEmpty
    }

    /// A completed task can still carry an optional follow-up question — show its
    /// options under a "what's next?" caption instead of as a blocking prompt.
    private var isFollowup: Bool {
        record.statusKind == .done && buttonActions.contains { $0.action != "open" }
    }

    /// Actions rendered as buttons; 'reply' gets the inline text field instead.
    /// No fabricated approve/deny — the server always sends a real action set
    /// (real options, a genuine permission's Approve/Deny, or just Open).
    private var buttonActions: [NotificationAction] {
        (record.actions ?? []).filter { $0.action != "reply" }
    }

    var body: some View {
        let kind = record.statusKind
        VStack(alignment: .leading, spacing: 6) {
            headerLine(kind)

            // Live session detail — always visible while working, so the list reads
            // like a vibe-island status board at a glance (no hover needed).
            if kind == .running { runningDetail }

            if expanded {
                // The "Working…" placeholder body carries no signal — the detail
                // lines above already say what's happening.
                if !record.body.isEmpty && record.type != "session_started" {
                    Text(record.body)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.65))
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if hasActions {
                    if isFollowup && !isReplying {
                        Text("WHAT'S NEXT?")
                            .font(.system(size: 9, weight: .bold))
                            .tracking(0.5)
                            .foregroundColor(.white.opacity(0.4))
                    }
                    if isReplying { replyBar } else { actionsRow }
                }
                if record.extraQuestionCount > 0 {
                    Button(action: openSession) {
                        Text("＋\(record.extraQuestionCount) more — open")
                            .font(.system(size: 10))
                            .foregroundColor(.white.opacity(0.5))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(expanded ? 0.09 : 0.06)))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(kind == .review ? Palette.amber.opacity(0.35) : .clear, lineWidth: 1)
        )
        .padding(.horizontal, 2)
        .onHover { h in
            withAnimation(.smooth(duration: 0.2)) { hovering = h }
        }
    }

    // MARK: - Pieces

    /// Badge · project · title, with the status word (or a dismiss ✕ when open).
    @ViewBuilder
    private func headerLine(_ kind: StatusKind) -> some View {
        HStack(spacing: 6) {
            if kind == .running {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.7)
                    .frame(width: 14, height: 14)
                    .tint(kind.color)
            } else {
                Image(systemName: kind.symbol)
                    .font(.system(size: 12))
                    .foregroundColor(kind.color)
                    .frame(width: 14)
            }

            if record.isRemote, let machine = record.machineName, !machine.isEmpty {
                Text(machine)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Color.white.opacity(0.1)))
                    .layoutPriority(1)
            }

            Text(titleText)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.9))
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 4)

            if expanded {
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
            } else {
                HStack(spacing: 5) {
                    Text(kind.label)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(kind.color.opacity(0.9))
                        .lineLimit(1)
                    if let elapsed = record.elapsedLabel {
                        Text(elapsed)
                            .font(.system(size: 10, weight: .regular, design: .monospaced))
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
            }
        }
    }

    /// Two dim lines under the header for a working session: what it's doing +
    /// todo progress, then model + context fill. Only the parts we actually have
    /// render, so a session with no todos/model just shows less.
    @ViewBuilder
    private var runningDetail: some View {
        let hasLine1 = record.activity != nil || record.todoLabel != nil || record.isStalled
        let hasLine2 = record.model != nil || record.contextPct != nil
        if hasLine1 || hasLine2 {
            VStack(alignment: .leading, spacing: 3) {
                if hasLine1 {
                    HStack(spacing: 6) {
                        if record.isStalled {
                            detailChip("hourglass", "stalled", tint: Palette.amber)
                        }
                        if let activity = record.activity {
                            HStack(spacing: 4) {
                                Image(systemName: "hammer.fill").font(.system(size: 8))
                                Text(activity).lineLimit(1).truncationMode(.middle)
                            }
                            .font(.system(size: 10))
                            .foregroundColor(.white.opacity(0.55))
                        }
                        if let todos = record.todoLabel {
                            detailChip("checklist", todos, tint: .white.opacity(0.5))
                        }
                    }
                }
                if hasLine2 {
                    HStack(spacing: 8) {
                        if let model = record.model {
                            Text(model)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.white.opacity(0.5))
                        }
                        if let ctx = record.contextPct {
                            Text("ctx \(ctx)%")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(.white.opacity(ctx >= 80 ? 0.75 : 0.4))
                        }
                    }
                }
            }
            .padding(.leading, 20) // align under the title, past the status icon
        }
    }

    private func detailChip(_ symbol: String, _ text: String, tint: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: symbol).font(.system(size: 8))
            Text(text).font(.system(size: 10, weight: .medium))
        }
        .foregroundColor(tint)
        .padding(.horizontal, 5)
        .padding(.vertical, 1)
        .background(Capsule().fill(Color.white.opacity(0.08)))
    }

    @ViewBuilder
    private var actionsRow: some View {
        // Multiple-choice (AskUserQuestion) → stack full-width so long labels aren't
        // clipped in the narrow panel. Up to 3 buttons → compact row; 4+ → column.
        if buttonActions.count > 3 {
            VStack(spacing: 6) {
                ForEach(buttonActions, id: \.action) { action in
                    actionButton(action).frame(maxWidth: .infinity, alignment: .leading)
                }
                if record.freeformAllowed {
                    replyPill.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else {
            HStack(spacing: 6) {
                ForEach(buttonActions, id: \.action) { action in
                    actionButton(action)
                }
                if record.freeformAllowed {
                    replyPill
                }
            }
        }
    }

    private var replyPill: some View {
        pillButton("Reply", systemImage: "arrowshape.turn.up.left.fill", tint: .white.opacity(0.7)) {
            isReplying = true
            replyFocused = true
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
                openSession()
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

    /// Jump to the session. Packaged host app → deep-link into it (focuses the
    /// window + routes there); standalone notch → open the web UI in the browser.
    /// Uses the bare `/sessions/<id>` form, which the web app resolves to the
    /// machine-scoped route.
    private func openSession() {
        guard let sessionId = record.sessionId else { return }
        // Machine-scoped route (/sessions/:machineId/:id) so a remote session opens
        // against the machine that owns it; "self" for this machine.
        let machine = record.machineId ?? "self"
        let path = "/sessions/\(machine)/\(sessionId)"
        if let scheme = AppSettings.deepLinkScheme,
           let url = URL(string: "\(scheme)://open\(path)") {
            NSWorkspace.shared.open(url)
        } else if let url = URL(string: AppSettings.serverURL + path) {
            NSWorkspace.shared.open(url)
        }
    }
}
