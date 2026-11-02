// Window "glass": the macOS vibrancy Electron exposes as BrowserWindow `vibrancy`.
// Electrobun has no such option, so the Bun side calls this through bun:ffi with
// the NSWindow pointer (BrowserWindow.ptr). Built by `bun run build:glass`.
//
// It puts an NSVisualEffectView under everything in the content view and clears
// the window and WKWebView backgrounds, so whatever the page leaves transparent
// shows the blurred desktop. The page decides what that is (html.glass in CSS).

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static NSString *const kGlassId = @"ra-glass";

static void setWebViewsClear(NSView *view, BOOL clear) {
  for (NSView *sub in view.subviews) {
    if ([sub isKindOfClass:[WKWebView class]]) {
      // Private but stable KVC key (Electron, Tauri and others rely on it).
      [sub setValue:@(!clear) forKey:@"drawsBackground"];
      if (@available(macOS 12.0, *)) {
        ((WKWebView *)sub).underPageBackgroundColor = clear ? NSColor.clearColor : nil;
      }
    }
    setWebViewsClear(sub, clear);
  }
}

/// Turns the glass on (enabled != 0) or off. Safe from any thread: AppKit work
/// runs on the main queue. `material` is an NSVisualEffectMaterial value.
void ra_set_glass(void *windowPtr, int enabled, int material) {
  if (!windowPtr) return;
  NSWindow *window = (__bridge NSWindow *)windowPtr;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView *content = window.contentView;
    if (!content) return;

    NSVisualEffectView *glass = nil;
    for (NSView *sub in content.subviews) {
      if ([sub.identifier isEqualToString:kGlassId]) glass = (NSVisualEffectView *)sub;
    }

    if (!enabled) {
      [glass removeFromSuperview];
      window.opaque = YES;
      window.backgroundColor = NSColor.windowBackgroundColor;
      setWebViewsClear(content, NO);
      return;
    }

    if (!glass) {
      glass = [[NSVisualEffectView alloc] initWithFrame:content.bounds];
      glass.identifier = kGlassId;
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      glass.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      // Stay frosted when the window loses focus (Electron's visualEffectState: 'active').
      glass.state = NSVisualEffectStateActive;
      [content addSubview:glass positioned:NSWindowBelow relativeTo:nil];
    }
    glass.material = (NSVisualEffectMaterial)material;

    window.opaque = NO;
    window.backgroundColor = NSColor.clearColor;
    setWebViewsClear(content, YES);
  });
}
