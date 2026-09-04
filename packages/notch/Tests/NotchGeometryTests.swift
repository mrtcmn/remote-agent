import XCTest
@testable import RemoteAgentNotch

/// 1512x982 built-in display, Dock band 80pt high at the bottom.
private let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)

private func geometry(_ anchor: NotchAnchor) -> NotchGeometry {
    switch anchor {
    case .notch:
        return NotchGeometry(
            anchor: .notch,
            pillSize: CGSize(width: 224, height: 38),
            screenRect: screen,
            windowFrame: CGRect(x: 0, y: 382, width: 1512, height: 600),
            dockHeight: 80
        )
    case .dock:
        return NotchGeometry(
            anchor: .dock,
            pillSize: CGSize(width: 132, height: 30),
            screenRect: screen,
            windowFrame: CGRect(x: 952, y: 0, width: 560, height: 600),
            dockHeight: 80
        )
    }
}

final class NotchGeometryTests: XCTestCase {
    func testNotchPillHangsFromTheTopCentre() {
        let g = geometry(.notch)
        XCTAssertEqual(g.collapsedScreenRect, CGRect(x: 644, y: 944, width: 224, height: 38))
        XCTAssertTrue(g.isPointInNotch(CGPoint(x: 756, y: 960)))
        XCTAssertFalse(g.isPointInNotch(CGPoint(x: 756, y: 40)))
    }

    func testDockPillCentresInTheDockBandAtTheRight() {
        let g = geometry(.dock)
        // 16pt from the right edge, centred in the 80pt Dock band.
        XCTAssertEqual(g.collapsedScreenRect, CGRect(x: 1364, y: 25, width: 132, height: 30))
        XCTAssertTrue(g.isPointInNotch(CGPoint(x: 1400, y: 40)))
        XCTAssertFalse(g.isPointInNotch(CGPoint(x: 700, y: 40)))
    }

    func testDockPillKeepsAMarginWhenTheDockHides() {
        let g = NotchGeometry(
            anchor: .dock,
            pillSize: CGSize(width: 132, height: 30),
            screenRect: screen,
            windowFrame: CGRect(x: 952, y: 0, width: 560, height: 600),
            dockHeight: 0
        )
        XCTAssertEqual(g.collapsedScreenRect.minY, 16)
    }

    func testDockPanelGrowsUpAndKeepsTheRightEdge() {
        let g = geometry(.dock)
        let opened = g.openedScreenRect(for: CGSize(width: 480, height: 400))
        XCTAssertEqual(opened, CGRect(x: 1016, y: 25, width: 480, height: 400))
        XCTAssertEqual(opened.maxX, g.collapsedScreenRect.maxX)
        XCTAssertTrue(g.isPointOutsidePanel(CGPoint(x: 400, y: 200), size: CGSize(width: 480, height: 400)))
    }

    func testWindowConversionPutsTheDockPillInsideTheWindow() {
        let g = geometry(.dock)
        let r = g.toWindow(g.collapsedScreenRect)
        XCTAssertEqual(r, CGRect(x: 412, y: 25, width: 132, height: 30))
        XCTAssertTrue(CGRect(origin: .zero, size: g.windowFrame.size).contains(r))
    }
}
