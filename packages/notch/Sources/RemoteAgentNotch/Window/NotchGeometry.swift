//
//  NotchGeometry.swift
//  Adapted from vibe-notch (https://github.com/farouqaldori/vibe-notch), Apache-2.0.
//
//  Pure geometry calculations for the panel. It sits on the top edge of the
//  Dock, centred on the screen.
//

import CoreGraphics
import Foundation

struct NotchGeometry: Sendable {
    /// Size of the collapsed pill.
    let pillSize: CGSize
    let screenRect: CGRect
    /// Frame of the overlay window, in screen coordinates.
    let windowFrame: CGRect
    /// Height of the Dock band at the bottom of the screen. 0 if the Dock hides
    /// or sits on a side, so the panel then sits on the bottom screen edge.
    let dockHeight: CGFloat

    var windowHeight: CGFloat { windowFrame.height }

    /// A rect of `size`, centred on the screen, resting on the Dock.
    private func onDock(_ size: CGSize) -> CGRect {
        CGRect(
            x: screenRect.midX - size.width / 2,
            y: screenRect.minY + dockHeight,
            width: size.width,
            height: size.height
        )
    }

    /// The collapsed pill in screen coordinates.
    var collapsedScreenRect: CGRect { onDock(pillSize) }

    /// The opened panel rect in screen coordinates. It grows up from the Dock.
    func openedScreenRect(for size: CGSize) -> CGRect { onDock(size) }

    /// The area that accepts mouse events while the panel is open. It is a
    /// little larger than the drawn panel.
    func openedHitScreenRect(for size: CGSize) -> CGRect {
        openedScreenRect(for: size).insetBy(dx: -8, dy: -8)
    }

    /// Converts a screen rect to overlay-window coordinates.
    func toWindow(_ rect: CGRect) -> CGRect {
        rect.offsetBy(dx: -windowFrame.minX, dy: -windowFrame.minY)
    }

    /// Check if a point is in the collapsed pill (with padding for easier interaction)
    func isPointInNotch(_ point: CGPoint) -> Bool {
        collapsedScreenRect.insetBy(dx: -10, dy: -5).contains(point)
    }

    /// Check if a point is in the opened panel area
    func isPointInOpenedPanel(_ point: CGPoint, size: CGSize) -> Bool {
        openedScreenRect(for: size).contains(point)
    }

    /// Check if a point is outside the opened panel (for closing)
    func isPointOutsidePanel(_ point: CGPoint, size: CGSize) -> Bool {
        !openedScreenRect(for: size).contains(point)
    }
}
