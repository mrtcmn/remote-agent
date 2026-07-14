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
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        windowManager = WindowManager(store: store)
        windowManager?.setupNotchWindow()

        screenObserver = ScreenObserver { [weak self] in
            self?.windowManager?.setupNotchWindow()
        }

        setupStatusItem()
        store.start()

        // First run: nothing configured yet — open the settings window
        if AppSettings.machineToken == nil {
            SettingsWindowController.shared.show(store: store)
        }
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(
            systemSymbolName: "bell.badge",
            accessibilityDescription: "Remote Agent Notch"
        )

        let menu = NSMenu()
        menu.addItem(withTitle: "Open Notifications", action: #selector(openNotch), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu

        statusItem = item
    }

    @objc private func openNotch() {
        windowManager?.controller?.viewModel.notchOpen(reason: .click)
    }

    @objc private func openSettings() {
        SettingsWindowController.shared.show(store: store)
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
