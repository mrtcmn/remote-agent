import XCTest
@testable import RemoteAgentNotch

/// 1512x982 built-in display, Dock band 80pt high at the bottom.
private let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
private let openedSize = CGSize(width: 480, height: 400)

private func geometry(dockHeight: CGFloat = 80) -> NotchGeometry {
    NotchGeometry(
        pillSize: CGSize(width: 320, height: 64),
        screenRect: screen,
        windowFrame: CGRect(x: 476, y: 0, width: 560, height: 600),
        dockHeight: dockHeight
    )
}

final class NotchGeometryTests: XCTestCase {
    func testPillSitsOnTheDockCentred() {
        let g = geometry()
        XCTAssertEqual(g.collapsedScreenRect.minY, 80)
        XCTAssertEqual(g.collapsedScreenRect.midX, 756)
        XCTAssertTrue(g.isPointInNotch(CGPoint(x: 756, y: 100)))
        XCTAssertFalse(g.isPointInNotch(CGPoint(x: 1400, y: 100)))
    }

    func testPillSitsOnTheScreenEdgeWhenTheDockHides() {
        XCTAssertEqual(geometry(dockHeight: 0).collapsedScreenRect.minY, 0)
    }

    func testPanelGrowsUpFromTheDockCentred() {
        let g = geometry()
        let opened = g.openedScreenRect(for: openedSize)
        XCTAssertEqual(opened.minY, 80)
        XCTAssertEqual(opened.midX, 756)
        XCTAssertTrue(g.isPointOutsidePanel(CGPoint(x: 100, y: 200), size: openedSize))
    }

    func testPillAndPanelFitInsideTheWindow() {
        let g = geometry()
        let bounds = CGRect(origin: .zero, size: g.windowFrame.size)
        XCTAssertTrue(bounds.contains(g.toWindow(g.collapsedScreenRect)))
        XCTAssertTrue(bounds.contains(g.toWindow(g.openedScreenRect(for: openedSize))))
    }
}
