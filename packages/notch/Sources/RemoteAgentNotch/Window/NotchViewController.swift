//
//  NotchViewController.swift
//  Adapted from vibe-notch (https://github.com/farouqaldori/vibe-notch), Apache-2.0.
//
//  Hosts the SwiftUI NotchView in AppKit with click-through support.
//

import AppKit
import SwiftUI

/// Custom NSHostingView that only accepts mouse events within the panel bounds.
/// Clicks outside the panel pass through to windows behind.
final class PassThroughHostingView<Content: View>: NSHostingView<Content> {
    var hitTestRect: () -> CGRect = { .zero }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard hitTestRect().contains(point) else {
            return nil  // Pass through to windows behind
        }
        return super.hitTest(point)
    }
}

final class NotchViewController: NSViewController {
    private let viewModel: NotchViewModel
    private let store: NotificationStore
    private var hostingView: PassThroughHostingView<NotchView>!

    init(viewModel: NotchViewModel, store: NotificationStore) {
        self.viewModel = viewModel
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        hostingView = PassThroughHostingView(rootView: NotchView(viewModel: viewModel, store: store))

        // Window coordinates: origin at bottom-left, Y increases upward.
        // NotchGeometry knows where the panel sits for the current anchor.
        hostingView.hitTestRect = { [weak self] in
            guard let self else { return .zero }
            let vm = self.viewModel
            let geometry = vm.geometry

            switch vm.status {
            case .opened:
                return geometry.toWindow(geometry.openedHitScreenRect(for: vm.openedSize))
            case .closed, .popping:
                return geometry.toWindow(geometry.collapsedScreenRect).insetBy(dx: -10, dy: -5)
            }
        }

        self.view = hostingView
    }
}
