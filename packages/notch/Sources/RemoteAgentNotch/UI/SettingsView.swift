//
//  SettingsView.swift
//  Configuration window: server URL, pairing, popup suppression, sound,
//  launch at login.
//

import AppKit
import ServiceManagement
import SwiftUI

@MainActor
final class SettingsWindowController: NSWindowController {
    static let shared = SettingsWindowController()

    private init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 560),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Remote Agent Notch"
        window.isReleasedWhenClosed = false
        super.init(window: window)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show(store: NotificationStore) {
        window?.contentViewController = NSHostingController(rootView: SettingsView(store: store))
        window?.center()
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}

struct SettingsView: View {
    @ObservedObject var store: NotificationStore

    @State private var serverURL = AppSettings.serverURL
    @State private var pairingToken = ""
    @State private var isPaired = AppSettings.machineToken != nil
    @State private var isPairing = false
    @State private var pairingError: String?
    @State private var suppressWhenActive = AppSettings.suppressWhenDesktopActive
    @State private var sound = AppSettings.notificationSound
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var launchAtLoginError: String?

    var body: some View {
        Form {
            Section("Server") {
                TextField("Server URL", text: $serverURL, prompt: Text("http://localhost:5100"))
                    .autocorrectionDisabled()

                LabeledContent("Status") {
                    HStack(spacing: 6) {
                        Circle().fill(statusColor).frame(width: 8, height: 8)
                        Text(statusLabel)
                    }
                }

                Button("Save & Reconnect") {
                    AppSettings.serverURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
                    store.reconnect()
                }
            }

            Section("Pairing") {
                if isPaired {
                    LabeledContent("Machine") {
                        Label("Paired", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                    }
                    Button("Unpair", role: .destructive) {
                        AppSettings.machineToken = nil
                        isPaired = false
                        store.reconnect()
                    }
                } else {
                    TextField("Pairing token", text: $pairingToken, prompt: Text("rapt_…"))
                        .autocorrectionDisabled()
                    Text("Generate a pairing token in the Remote Agent web UI (Machines → Pair device), then paste it here.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button(isPairing ? "Pairing…" : "Pair") {
                        Task { await pair() }
                    }
                    .disabled(isPairing || pairingToken.trimmingCharacters(in: .whitespaces).isEmpty)

                    if let pairingError {
                        Text(pairingError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }

            Section("Behavior") {
                Toggle("Don't pop up while the Remote Agent app is focused", isOn: $suppressWhenActive)
                    .onChange(of: suppressWhenActive) { _, value in
                        AppSettings.suppressWhenDesktopActive = value
                    }

                Picker("Notification sound", selection: $sound) {
                    ForEach(AppSettings.soundNames, id: \.self) { Text($0) }
                }
                .onChange(of: sound) { _, value in
                    AppSettings.notificationSound = value
                    if value != "None" {
                        NSSound(named: value)?.play()
                    }
                }

                if Bundle.main.bundleIdentifier != nil {
                    Toggle("Launch at login", isOn: $launchAtLogin)
                        .onChange(of: launchAtLogin) { _, value in
                            applyLaunchAtLogin(value)
                        }
                    if let launchAtLoginError {
                        Text(launchAtLoginError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }

            Section {
                Button("Quit Remote Agent Notch", role: .destructive) {
                    NSApp.terminate(nil)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 560)
    }

    private var statusColor: Color {
        switch store.connectionState {
        case .connected: return .green
        case .connecting: return .orange
        case .disconnected: return .red
        }
    }

    private var statusLabel: String {
        switch store.connectionState {
        case .connected: return "Connected"
        case .connecting: return "Connecting…"
        case .disconnected: return isPaired ? "Disconnected — retrying" : "Not paired"
        }
    }

    private func pair() async {
        isPairing = true
        pairingError = nil
        defer { isPairing = false }

        AppSettings.serverURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let token = try await Pairing.pair(
                serverURL: AppSettings.serverURL,
                pairingToken: pairingToken.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            AppSettings.machineToken = token
            isPaired = true
            pairingToken = ""
            store.reconnect()
        } catch {
            pairingError = error.localizedDescription
        }
    }

    private func applyLaunchAtLogin(_ enable: Bool) {
        launchAtLoginError = nil
        do {
            if enable {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            launchAtLoginError = error.localizedDescription
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}
