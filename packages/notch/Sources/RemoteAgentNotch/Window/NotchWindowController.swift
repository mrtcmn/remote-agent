//
//  NotchWindowController.swift
//  Adapted from vibe-notch (https://github.com/farouqaldori/vibe-notch), Apache-2.0.
//

import AppKit
import Combine
import SwiftUI

final class NotchWindowController: NSWindowController {
    let viewModel: NotchViewModel
    private let screen: NSScreen
    private var cancellables = Set<AnyCancellable>()

    init(screen: NSScreen, store: NotificationStore, animateOnLaunch: Bool = true) {
        self.screen = screen

        let screenFrame = screen.frame

        // The window must hold the opened panel. It is centred on the bottom edge,
        // and the panel inside it rests on the Dock.
        let width = min(560, screenFrame.width)
        let height = min(600, screenFrame.height)
        let windowFrame = NSRect(
            x: screenFrame.midX - width / 2,
            y: screenFrame.minY,
            width: width,
            height: height
        )

        self.viewModel = NotchViewModel(
            geometry: NotchGeometry(
                pillSize: CGSize(width: 320, height: 64),
                screenRect: screenFrame,
                windowFrame: windowFrame,
                dockHeight: screen.bottomDockHeight
            )
        )

        let notchWindow = NotchPanel(
            contentRect: windowFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        super.init(window: notchWindow)

        let hostingController = NotchViewController(viewModel: viewModel, store: store)
        notchWindow.contentViewController = hostingController
        notchWindow.setFrame(windowFrame, display: true)

        // Toggle mouse handling with the notch state:
        //  - closed: clicks pass through to the menu bar / apps behind
        //  - opened: buttons inside the panel work
        viewModel.$status
            .receive(on: DispatchQueue.main)
            .sink { [weak notchWindow, weak viewModel] status in
                switch status {
                case .opened:
                    notchWindow?.ignoresMouseEvents = false
                    // Don't steal focus when opened by an incoming notification —
                    // you're mid-task in another app.
                    if viewModel?.openReason != .notification {
                        NSApp.activate(ignoringOtherApps: false)
                        notchWindow?.makeKey()
                    }
                case .closed, .popping:
                    notchWindow?.ignoresMouseEvents = true
                }
            }
            .store(in: &cancellables)

        notchWindow.ignoresMouseEvents = true

        if animateOnLaunch {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.viewModel.performBootAnimation()
            }
        }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}
