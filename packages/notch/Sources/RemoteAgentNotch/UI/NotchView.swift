//
//  NotchView.swift
//  Adapted from vibe-notch (https://github.com/farouqaldori/vibe-notch), Apache-2.0.
//
//  The dynamic-island view: collapsed pill with a badge while notifications
//  are pending, expanding to the notification list. Pops open on incoming
//  notifications unless the Remote Agent desktop app is frontmost or the user
//  is already active in the web UI.
//

import AppKit
import SwiftUI

private let cornerRadiusInsets = (
    opened: (top: CGFloat(19), bottom: CGFloat(24)),
    closed: (top: CGFloat(6), bottom: CGFloat(14))
)

enum Palette {
    static let amber = Color(red: 0.85, green: 0.47, blue: 0.34)
    static let green = Color(red: 0.36, green: 0.78, blue: 0.46)
    static let red = Color(red: 0.88, green: 0.38, blue: 0.36)
}

struct NotchView: View {
    @ObservedObject var viewModel: NotchViewModel
    @ObservedObject var store: NotificationStore

    @State private var isVisible: Bool = false
    @State private var isHovering: Bool = false
    @State private var isBouncing: Bool = false

    private let openAnimation = Animation.spring(response: 0.42, dampingFraction: 0.8, blendDuration: 0)
    private let closeAnimation = Animation.spring(response: 0.45, dampingFraction: 1.0, blendDuration: 0)

    // MARK: - Derived state

    private var pendingCount: Int { store.notifications.count }
    private var hasActivity: Bool { pendingCount > 0 }
    private var needsReview: Bool { store.notifications.contains { $0.needsReview } }

    // MARK: - Sizing

    private var closedNotchSize: CGSize {
        CGSize(width: viewModel.deviceNotchRect.width, height: viewModel.deviceNotchRect.height)
    }

    /// Extra width for the collapsed pill while notifications are pending
    private var expansionWidth: CGFloat {
        guard hasActivity else { return 0 }
        return 2 * max(0, closedNotchSize.height - 12) + 20 + (needsReview ? 18 : 0)
    }

    private var notchSize: CGSize {
        switch viewModel.status {
        case .closed, .popping:
            return closedNotchSize
        case .opened:
            return viewModel.openedSize
        }
    }

    private var topCornerRadius: CGFloat {
        viewModel.status == .opened ? cornerRadiusInsets.opened.top : cornerRadiusInsets.closed.top
    }

    private var bottomCornerRadius: CGFloat {
        viewModel.status == .opened ? cornerRadiusInsets.opened.bottom : cornerRadiusInsets.closed.bottom
    }

    // MARK: - Body

    var body: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                notchLayout
                    .frame(
                        maxWidth: viewModel.status == .opened ? notchSize.width : nil,
                        alignment: .top
                    )
                    .padding(
                        .horizontal,
                        viewModel.status == .opened
                            ? cornerRadiusInsets.opened.top
                            : cornerRadiusInsets.closed.bottom
                    )
                    .padding([.horizontal, .bottom], viewModel.status == .opened ? 12 : 0)
                    .background(.black)
                    .clipShape(NotchShape(topCornerRadius: topCornerRadius, bottomCornerRadius: bottomCornerRadius))
                    .overlay(alignment: .top) {
                        Rectangle()
                            .fill(.black)
                            .frame(height: 1)
                            .padding(.horizontal, topCornerRadius)
                    }
                    .shadow(
                        color: (viewModel.status == .opened || isHovering) ? .black.opacity(0.7) : .clear,
                        radius: 6
                    )
                    .frame(
                        maxWidth: viewModel.status == .opened ? notchSize.width : nil,
                        maxHeight: viewModel.status == .opened ? notchSize.height : nil,
                        alignment: .top
                    )
                    .animation(viewModel.status == .opened ? openAnimation : closeAnimation, value: viewModel.status)
                    .animation(.smooth, value: hasActivity)
                    .animation(.smooth, value: needsReview)
                    .animation(.spring(response: 0.3, dampingFraction: 0.5), value: isBouncing)
                    .contentShape(Rectangle())
                    .onHover { hovering in
                        withAnimation(.spring(response: 0.38, dampingFraction: 0.8)) {
                            isHovering = hovering
                        }
                    }
                    .onTapGesture {
                        if viewModel.status != .opened {
                            viewModel.notchOpen(reason: .click)
                        }
                    }
            }
        }
        .opacity(isVisible ? 1 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .preferredColorScheme(.dark)
        .onAppear {
            // On non-notched displays keep a visible target to interact with
            if !viewModel.hasPhysicalNotch {
                isVisible = true
            }
        }
        .onChange(of: viewModel.status) { _, newStatus in
            handleStatusChange(newStatus)
        }
        .onChange(of: store.notifications) { _, _ in
            refreshVisibility()
        }
        .onChange(of: store.lastIncoming) { _, incoming in
            handleIncoming(incoming)
        }
    }

    // MARK: - Layout

    @ViewBuilder
    private var notchLayout: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
                .frame(height: max(24, closedNotchSize.height))

            if viewModel.status == .opened {
                NotificationListView(store: store)
                    .frame(width: notchSize.width - 24)
                    .frame(maxHeight: .infinity)
                    .transition(
                        .asymmetric(
                            insertion: .scale(scale: 0.8, anchor: .top)
                                .combined(with: .opacity)
                                .animation(.smooth(duration: 0.35)),
                            removal: .opacity.animation(.easeOut(duration: 0.15))
                        )
                    )
            }
        }
    }

    @ViewBuilder
    private var headerRow: some View {
        HStack(spacing: 0) {
            // Left side — status icon while collapsed-with-activity or opened
            if hasActivity || viewModel.status == .opened {
                HStack(spacing: 4) {
                    Image(systemName: needsReview ? "exclamationmark.bubble.fill" : "bell.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(needsReview ? Palette.amber : .white.opacity(0.85))
                }
                .frame(width: viewModel.status == .opened ? nil : sideWidth + (needsReview ? 18 : 0))
                .padding(.leading, viewModel.status == .opened ? 8 : 0)
            }

            // Center
            if viewModel.status == .opened {
                openedHeaderContent
            } else if !hasActivity {
                Rectangle()
                    .fill(.clear)
                    .frame(width: closedNotchSize.width - 20)
            } else {
                Rectangle()
                    .fill(.black)
                    .frame(width: closedNotchSize.width - cornerRadiusInsets.closed.top + (isBouncing ? 16 : 0))
            }

            // Right side — pending count while collapsed
            if hasActivity && viewModel.status != .opened {
                Text("\(pendingCount)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(needsReview ? Palette.amber : .white.opacity(0.85))
                    .frame(width: sideWidth)
                    .padding(.trailing, 4)
            }
        }
        .frame(height: closedNotchSize.height)
    }

    private var sideWidth: CGFloat {
        max(0, closedNotchSize.height - 12) + 10
    }

    @ViewBuilder
    private var openedHeaderContent: some View {
        HStack(spacing: 8) {
            Text("Remote Agent")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.7))

            Circle()
                .fill(connectionColor)
                .frame(width: 6, height: 6)

            Spacer()

            Button {
                SettingsWindowController.shared.show(store: store)
                viewModel.notchClose()
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.white.opacity(0.4))
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var connectionColor: Color {
        switch store.connectionState {
        case .connected: return Palette.green
        case .connecting: return Palette.amber
        case .disconnected: return Palette.red
        }
    }

    // MARK: - Event handling

    private func handleIncoming(_ incoming: NotificationStore.Incoming?) {
        guard let incoming, Date().timeIntervalSince(incoming.at) < 5 else { return }

        isVisible = true

        // Bounce to catch the eye even when suppressed
        isBouncing = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            isBouncing = false
        }

        // Suppress popup + sound while the user is already looking at
        // remote-agent (desktop app frontmost, or active in the web UI).
        let suppressed = FrontmostDetector.isRemoteAgentActive() || incoming.userActive
        guard !suppressed else { return }

        if AppSettings.notificationSound != "None" {
            NSSound(named: AppSettings.notificationSound)?.play()
        }

        if viewModel.status == .closed {
            viewModel.notchOpen(reason: .notification)
        }
    }

    private func handleStatusChange(_ newStatus: NotchStatus) {
        switch newStatus {
        case .opened, .popping:
            isVisible = true
        case .closed:
            refreshVisibility()
        }
    }

    private func refreshVisibility() {
        if hasActivity || viewModel.status != .closed || !viewModel.hasPhysicalNotch {
            isVisible = true
            return
        }
        // Delay hiding until the close animation completes
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            if viewModel.status == .closed && store.notifications.isEmpty && viewModel.hasPhysicalNotch {
                isVisible = false
            }
        }
    }
}
