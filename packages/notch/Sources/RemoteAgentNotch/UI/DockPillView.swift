//
//  DockPillView.swift
//  The collapsed panel beside the Dock: one wide banner card for the session
//  that needs attention most, with the rest counted on the icon.
//

import SwiftUI

struct DockPillView: View {
    @ObservedObject var store: NotificationStore
    let size: CGSize

    private var record: NotificationRecord? { store.mostUrgent }
    private var kind: StatusKind { record?.statusKind ?? .running }

    /// Small line above the title: the project, or the machine it runs on.
    private var label: String {
        guard let record else { return "Remote Agent" }
        if let project = record.projectName, !project.isEmpty { return project }
        if let machine = record.machineName, record.isRemote { return machine }
        return "Remote Agent"
    }

    private var title: String {
        record?.title ?? "No active sessions"
    }

    private var statusLine: String {
        guard let record else { return "Idle" }
        switch record.statusKind {
        case .review: return "Needs you"
        case .error:  return "Failed"
        case .done:   return record.elapsedLabel.map { "Done · \($0)" } ?? "Done"
        case .running:
            let base = record.isStalled ? "Stalled" : (record.activity ?? "Working")
            if let todo = record.todoLabel { return "\(base) · \(todo)" }
            return base
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.45))
                    .lineLimit(1)

                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .truncationMode(.tail)

                HStack(spacing: 5) {
                    StatusDot(color: kind.color, pulse: kind == .review, size: 6)
                    Text(statusLine)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(kind.color)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            icon
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .frame(width: size.width, height: size.height)
    }

    /// Rounded-square badge at the right, the way an app icon sits on a banner.
    private var icon: some View {
        RoundedRectangle(cornerRadius: 13, style: .continuous)
            .fill(kind.color.opacity(0.16))
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            )
            .overlay(
                Image(systemName: kind.symbol)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(kind.color)
            )
            .frame(width: 42, height: 42)
            .overlay(alignment: .topTrailing) {
                // Sessions beyond the one on show.
                if store.notifications.count > 1 {
                    Text("\(store.notifications.count - 1)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(.black)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Circle().fill(.white))
                        .offset(x: 6, y: -6)
                }
            }
    }
}
