//
//  NotchGeometry.swift
//  Adapted from vibe-notch (https://github.com/farouqaldori/vibe-notch), Apache-2.0.
//
//  Pure geometry calculations for the panel, for both anchors.
//

import CoreGraphics
import Foundation

/// Where the panel lives on the screen.
enum NotchAnchor: String, Sendable, CaseIterable {
    /// Hangs from the menu bar, centred on the camera housing.
    case notch
    /// Floats in the free space at the right of the Dock.
    case dock
}

struct NotchGeometry: Sendable {
    let anchor: NotchAnchor
    /// Size of the collapsed pill. In `.notch` mode this is the camera housing.
    let pillSize: CGSize
    let screenRect: CGRect
    /// Frame of the overlay window, in screen coordinates.
    let windowFrame: CGRect
    /// Height of the Dock band at the bottom of the screen. 0 if the Dock hides
    /// or sits on a side.
    let dockHeight: CGFloat

    /// Gap between the panel and the right edge of the screen, in `.dock` mode.
    static let dockMargin: CGFloat = 16

    var windowHeight: CGFloat { windowFrame.height }

    /// Distance from the bottom edge of the screen to the bottom of the panel.
    /// The panel centres in the Dock band, or keeps a small margin.
    var dockBottomInset: CGFloat {
        dockHeight > pillSize.height ? (dockHeight - pillSize.height) / 2 : Self.dockMargin
    }

    /// The collapsed pill in screen coordinates.
    var collapsedScreenRect: CGRect {
        switch anchor {
        case .notch:
            return CGRect(
                x: screenRect.midX - pillSize.width / 2,
                y: screenRect.maxY - pillSize.height,
                width: pillSize.width,
                height: pillSize.height
            )
        case .dock:
            return CGRect(
                x: screenRect.maxX - Self.dockMargin - pillSize.width,
                y: screenRect.minY + dockBottomInset,
                width: pillSize.width,
                height: pillSize.height
            )
        }
    }

    /// The opened panel rect in screen coordinates for a given size.
    func openedScreenRect(for size: CGSize) -> CGRect {
        switch anchor {
        case .notch:
            // Match the actual rendered panel size (tuned to match visual output)
            let width = size.width - 6
            let height = size.height - 30
            return CGRect(
                x: screenRect.midX - width / 2,
                y: screenRect.maxY - height,
                width: width,
                height: height
            )
        case .dock:
            // Right edge stays put; the panel grows up from the Dock.
            return CGRect(
                x: screenRect.maxX - Self.dockMargin - size.width,
                y: screenRect.minY + dockBottomInset,
                width: size.width,
                height: size.height
            )
        }
    }

    /// The area that accepts mouse events while the panel is open. It is a
    /// little larger than the drawn panel.
    func openedHitScreenRect(for size: CGSize) -> CGRect {
        switch anchor {
        case .notch:
            let width = size.width + 52  // account for corner radius padding
            return CGRect(
                x: screenRect.midX - width / 2,
                y: screenRect.maxY - size.height,
                width: width,
                height: size.height
            )
        case .dock:
            return openedScreenRect(for: size).insetBy(dx: -8, dy: -8)
        }
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
