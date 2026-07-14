//
//  FrontmostDetector.swift
//  Suppression check: is the Remote Agent desktop app the active window?
//  (Modeled on vibe-notch's TerminalVisibilityDetector, Apache-2.0.)
//

import AppKit

enum FrontmostDetector {
    /// True when popups should be suppressed because the Remote Agent desktop
    /// app is frontmost (and the user enabled suppression).
    static func isRemoteAgentActive() -> Bool {
        guard AppSettings.suppressWhenDesktopActive else { return false }
        return NSWorkspace.shared.frontmostApplication?.bundleIdentifier == AppSettings.desktopBundleId
    }
}
