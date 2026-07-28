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
        // The window is pinned to the top of the screen, so the panel sits at
        // the top of the window.
        hostingView.hitTestRect = { [weak self] in
            guard let self else { return .zero }
            let vm = self.viewModel
            let geometry = vm.geometry
            let windowHeight = geometry.windowHeight

            switch vm.status {
            case .opened:
                let panelSize = vm.openedSize
                let panelWidth = panelSize.width + 52  // Account for corner radius padding
                let panelHeight = panelSize.height
                let screenWidth = geometry.screenRect.width
                return CGRect(
                    x: (screenWidth - panelWidth) / 2,
                    y: windowHeight - panelHeight,
                    width: panelWidth,
                    height: panelHeight
                )
            case .closed, .popping:
                let notchRect = geometry.deviceNotchRect
                let screenWidth = geometry.screenRect.width
                return CGRect(
                    x: (screenWidth - notchRect.width) / 2 - 10,
                    y: windowHeight - notchRect.height - 5,
                    width: notchRect.width + 20,
                    height: notchRect.height + 10
                )
            }
        }

        self.view = hostingView
    }
}
