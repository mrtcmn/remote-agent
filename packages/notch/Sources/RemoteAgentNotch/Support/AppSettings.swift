//
//  AppSettings.swift
//  UserDefaults-backed settings; the machine token lives in the Keychain.
//

import Foundation

enum AppSettings {
    private static let defaults = UserDefaults.standard

    /// Base URL of the remote-agent API (http/https).
    static var serverURL: String {
        get { defaults.string(forKey: "serverURL") ?? "http://localhost:5100" }
        set { defaults.set(newValue, forKey: "serverURL") }
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
