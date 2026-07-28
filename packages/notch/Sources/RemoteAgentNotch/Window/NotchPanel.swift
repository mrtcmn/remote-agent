//
//  NotchPanel.swift
//  Adapted from vibe-notch (https://github.com/farouqaldori/vibe-notch), Apache-2.0.
//
//  Transparent non-activating panel that overlays the notch area, above the
//  menu bar. The window ignores mouse events while closed; global event
//  monitors detect clicks/hovers, and clicks outside the content re-post to
//  whatever is behind.
//

import AppKit

class NotchPanel: NSPanel {
    override init(
        contentRect: NSRect,
        styleMask style: NSWindow.StyleMask,
        backing backingStoreType: NSWindow.BackingStoreType,
        defer flag: Bool
    ) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = true

        isOpaque = false
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        backgroundColor = .clear
        hasShadow = false

        // Prevent window from moving during space switches
        isMovable = false

        collectionBehavior = [
            .fullScreenAuxiliary,
            .stationary,
            .canJoinAllSpaces,
            .ignoresCycle
        ]

        // Above the menu bar
        level = .mainMenu + 3

        allowsToolTipsWhenApplicationIsInactive = true

        // Window ignores ALL mouse events while closed so clicks pass through
        // to the menu bar; toggled by NotchWindowController on open/close.
        ignoresMouseEvents = true

        isReleasedWhenClosed = true
        acceptsMouseMovedEvents = false
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // MARK: - Click-through for areas outside the panel content

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown || event.type == .leftMouseUp ||
           event.type == .rightMouseDown || event.type == .rightMouseUp {
            let locationInWindow = event.locationInWindow

            if let contentView = self.contentView,
               contentView.hitTest(locationInWindow) == nil {
                // No view wants this event — pass it through to windows behind
                let screenLocation = convertPoint(toScreen: locationInWindow)
                ignoresMouseEvents = true

                DispatchQueue.main.async { [weak self] in
                    self?.repostMouseEvent(event, at: screenLocation)
                }
                return
            }
        }

        super.sendEvent(event)
    }

    private func repostMouseEvent(_ event: NSEvent, at screenLocation: NSPoint) {
        guard let screen = NSScreen.main else { return }
        let screenHeight = screen.frame.height
        let cgPoint = CGPoint(x: screenLocation.x, y: screenHeight - screenLocation.y)

        let mouseType: CGEventType
        switch event.type {
        case .leftMouseDown: mouseType = .leftMouseDown
        case .leftMouseUp: mouseType = .leftMouseUp
        case .rightMouseDown: mouseType = .rightMouseDown
        case .rightMouseUp: mouseType = .rightMouseUp
        default: return
        }

        let mouseButton: CGMouseButton = event.type == .rightMouseDown || event.type == .rightMouseUp ? .right : .left

        if let cgEvent = CGEvent(
            mouseEventSource: nil,
            mouseType: mouseType,
            mouseCursorPosition: cgPoint,
            mouseButton: mouseButton
        ) {
            cgEvent.post(tap: .cghidEventTap)
        }
    }
}
