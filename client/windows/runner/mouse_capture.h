#ifndef RUNNER_MOUSE_CAPTURE_H_
#define RUNNER_MOUSE_CAPTURE_H_

#include <flutter/binary_messenger.h>
#include <flutter/method_channel.h>
#include <flutter/encodable_value.h>
#include <windows.h>

#include <memory>

// First-person mouse look for the Windows runner (docs/flutter-client-plan.md
// S3). Flutter has no pointer lock, so the runner does it: while captured the
// cursor is hidden and pinned to the window centre with ClipCursor, and the
// mouse's raw motion (WM_INPUT, unaffected by pointer acceleration) is summed
// and pushed to Dart at ~125 Hz over the `block_survival/mouse` method channel.
//
// Dart -> runner:  capture() / release() / isSupported()
// runner -> Dart:  delta(dx, dy) batches; released() when focus is lost
class MouseCapture {
 public:
  MouseCapture(flutter::BinaryMessenger* messenger, HWND window);
  ~MouseCapture();

  // Window messages the capture cares about; true when consumed.
  bool HandleMessage(UINT message, WPARAM wparam, LPARAM lparam);

 private:
  void Capture();
  void Release(bool notify);
  void Recentre();
  void Flush();

  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel_;
  HWND window_;
  bool captured_ = false;
  bool cursor_hidden_ = false;
  long pending_dx_ = 0;
  long pending_dy_ = 0;
  static constexpr UINT_PTR kFlushTimer = 0x4D4F5553;  // 'MOUS'
};

#endif  // RUNNER_MOUSE_CAPTURE_H_
