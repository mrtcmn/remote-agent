//
//  NotchApp.swift
//  App entry: accessory app with the notch overlay window, a status item,
//  and the notifications websocket.
//

import AppKit
import SwiftUI

@main
struct NotchApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = NotificationStore()
    private var windowManager: WindowManager?
    private var screenObserver: ScreenObserver?
    private var anchorObserver: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        windowManager = WindowManager(store: store)
        windowManager?.setupNotchWindow()

        screenObserver = ScreenObserver { [weak self] in
            self?.windowManager?.setupNotchWindow()
        }

        anchorObserver = NotificationCenter.default.addObserver(
            forName: .notchAnchorChanged, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.windowManager?.setupNotchWindow(force: true) }
        }

        store.start()

        // First run on a standalone install: needs pairing, so open settings.
        // Embedded (desktop) mode connects tokenless — never auto-open there.
        if AppSettings.machineToken == nil && !AppSettings.isEmbedded {
            SettingsWindowController.shared.show(store: store)
        }
    }
}

/// Owns the notch window; rebuilds it when the screen layout changes.
@MainActor
final class WindowManager {
    private(set) var controller: NotchWindowController?
    /// Screen frame plus visible frame: the visible frame moves when the Dock changes.
    private var currentLayout: String?
    private let store: NotificationStore

    init(store: NotificationStore) {
        self.store = store
    }

    func setupNotchWindow(force: Bool = false) {
        guard let screen = NSScreen.builtin ?? NSScreen.main else { return }
        let layout = "\(screen.frame)|\(screen.visibleFrame)"
        if !force, controller != nil, currentLayout == layout { return }

        let isFirstLaunch = controller == nil
        controller?.close()
        controller = NotchWindowController(screen: screen, store: store, animateOnLaunch: isFirstLaunch)
        controller?.showWindow(nil)
        currentLayout = layout
    }
}
