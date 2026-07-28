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

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        windowManager = WindowManager(store: store)
        windowManager?.setupNotchWindow()

        screenObserver = ScreenObserver { [weak self] in
            self?.windowManager?.setupNotchWindow()
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
    private var currentScreenFrame: NSRect?
    private let store: NotificationStore

    init(store: NotificationStore) {
        self.store = store
    }

    func setupNotchWindow() {
        guard let screen = NSScreen.builtin ?? NSScreen.main else { return }
        if controller != nil, currentScreenFrame == screen.frame { return }

        let isFirstLaunch = controller == nil
        controller?.close()
        controller = NotchWindowController(screen: screen, store: store, animateOnLaunch: isFirstLaunch)
        controller?.showWindow(nil)
        currentScreenFrame = screen.frame
    }
}
