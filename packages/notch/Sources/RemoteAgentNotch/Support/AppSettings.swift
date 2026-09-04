//
//  AppSettings.swift
//  UserDefaults-backed settings; the machine token lives in the Keychain.
//

import Foundation

enum AppSettings {
    private static let defaults = UserDefaults.standard

    /// Base URL of the remote-agent API (http/https). Until the user saves one,
    /// RA_SERVER_URL wins — the desktop dev shell sets it when auto-launching us.
    static var serverURL: String {
        get {
            defaults.string(forKey: "serverURL")
                ?? ProcessInfo.processInfo.environment["RA_SERVER_URL"]
                ?? "http://localhost:5100"
        }
        set { defaults.set(newValue, forKey: "serverURL") }
    }

    /// Where the panel sits: hanging from the notch, or beside the Dock.
    static var anchor: NotchAnchor {
        get { NotchAnchor(rawValue: defaults.string(forKey: "anchor") ?? "") ?? .dock }
        set { defaults.set(newValue.rawValue, forKey: "anchor") }
    }

    /// Don't pop the notch open while the Remote Agent desktop app is frontmost.
    static var suppressWhenDesktopActive: Bool {
        get { defaults.object(forKey: "suppressWhenDesktopActive") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "suppressWhenDesktopActive") }
    }

    /// Bundle id of the desktop app whose focus suppresses popups.
    static var desktopBundleId: String {
        get { defaults.string(forKey: "desktopBundleId") ?? "com.remote-agent.app" }
        set { defaults.set(newValue, forKey: "desktopBundleId") }
    }

    /// System sound played on new notifications; "None" disables.
    static var notificationSound: String {
        get { defaults.string(forKey: "notificationSound") ?? "Pop" }
        set { defaults.set(newValue, forKey: "notificationSound") }
    }

    static let soundNames = ["None", "Pop", "Ping", "Tink", "Glass", "Hero", "Purr", "Submarine"]

    /// Launched by the local desktop app (RA_SERVER_URL injected) → one program on
    /// loopback, so we skip pairing and connect tokenless; the API authenticates the local user.
    static var isEmbedded: Bool {
        ProcessInfo.processInfo.environment["RA_SERVER_URL"] != nil
    }

    /// URL scheme of the host desktop app (packaged builds only). When set, the
    /// notch deep-links into the app instead of opening a browser tab.
    static var deepLinkScheme: String? {
        ProcessInfo.processInfo.environment["RA_DEEPLINK_SCHEME"]
    }

    /// Long-lived machine token (ramt_…) obtained by pairing.
    static var machineToken: String? {
        get { Keychain.read() }
        set {
            if let newValue, !newValue.isEmpty {
                Keychain.save(newValue)
            } else {
                Keychain.delete()
            }
        }
    }
}

extension Notification.Name {
    /// Posted when the user changes `AppSettings.anchor`; the app rebuilds the window.
    static let notchAnchorChanged = Notification.Name("notchAnchorChanged")
}
