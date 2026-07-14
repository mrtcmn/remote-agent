//
//  ScreenObserver.swift
//  Debounced observer for screen parameter changes (resolution, displays).
//

import AppKit

final class ScreenObserver {
    private var observer: NSObjectProtocol?
    private var debounce: DispatchWorkItem?

    init(onChange: @escaping @MainActor () -> Void) {
        observer = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.debounce?.cancel()
            let work = DispatchWorkItem {
                Task { @MainActor in onChange() }
            }
            self?.debounce = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
        }
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
