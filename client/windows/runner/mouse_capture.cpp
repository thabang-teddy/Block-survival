#include "mouse_capture.h"

#include <flutter/standard_method_codec.h>

#include <vector>

namespace {

constexpr char kChannelName[] = "block_survival/mouse";
constexpr UINT kFlushIntervalMs = 8;

}  // namespace

MouseCapture::MouseCapture(flutter::BinaryMessenger* messenger, HWND window)
    : window_(window) {
  channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      messenger, kChannelName, &flutter::StandardMethodCodec::GetInstance());
  channel_->SetMethodCallHandler(
      [this](const flutter::MethodCall<flutter::EncodableValue>& call,
             std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>>
                 result) {
        const std::string& method = call.method_name();
        if (method == "isSupported") {
          result->Success(flutter::EncodableValue(true));
        } else if (method == "capture") {
          Capture();
          result->Success(flutter::EncodableValue(captured_));
        } else if (method == "release") {
          Release(false);
          result->Success();
        } else {
          result->NotImplemented();
        }
      });
}

MouseCapture::~MouseCapture() { Release(false); }

void MouseCapture::Capture() {
  if (captured_) return;
  RAWINPUTDEVICE rid{};
  rid.usUsagePage = 0x01;  // generic desktop
  rid.usUsage = 0x02;      // mouse
  rid.dwFlags = 0;         // only while this window has focus, like a game
  rid.hwndTarget = window_;
  if (!RegisterRawInputDevices(&rid, 1, sizeof(rid))) return;
  captured_ = true;
  if (!cursor_hidden_) {
    ShowCursor(FALSE);
    cursor_hidden_ = true;
  }
  Recentre();
  pending_dx_ = pending_dy_ = 0;
  SetTimer(window_, kFlushTimer, kFlushIntervalMs, nullptr);
}

void MouseCapture::Release(bool notify) {
  if (!captured_) return;
  captured_ = false;
  KillTimer(window_, kFlushTimer);
  RAWINPUTDEVICE rid{};
  rid.usUsagePage = 0x01;
  rid.usUsage = 0x02;
  rid.dwFlags = RIDEV_REMOVE;
  rid.hwndTarget = nullptr;
  RegisterRawInputDevices(&rid, 1, sizeof(rid));
  ClipCursor(nullptr);
  if (cursor_hidden_) {
    ShowCursor(TRUE);
    cursor_hidden_ = false;
  }
  if (notify && channel_) {
    channel_->InvokeMethod("released", nullptr);
  }
}

// Pin the (hidden) cursor to the window centre so it never reaches an edge,
// and so a click after release lands where the player expects.
void MouseCapture::Recentre() {
  RECT client{};
  GetClientRect(window_, &client);
  POINT centre{(client.right - client.left) / 2,
               (client.bottom - client.top) / 2};
  ClientToScreen(window_, &centre);
  RECT clip{centre.x, centre.y, centre.x + 1, centre.y + 1};
  ClipCursor(&clip);
  SetCursorPos(centre.x, centre.y);
}

void MouseCapture::Flush() {
  if (pending_dx_ == 0 && pending_dy_ == 0) return;
  flutter::EncodableList args{
      flutter::EncodableValue(static_cast<int32_t>(pending_dx_)),
      flutter::EncodableValue(static_cast<int32_t>(pending_dy_))};
  pending_dx_ = pending_dy_ = 0;
  channel_->InvokeMethod("delta",
                         std::make_unique<flutter::EncodableValue>(args));
}

bool MouseCapture::HandleMessage(UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_INPUT: {
      if (!captured_) return false;
      UINT size = 0;
      GetRawInputData(reinterpret_cast<HRAWINPUT>(lparam), RID_INPUT, nullptr,
                      &size, sizeof(RAWINPUTHEADER));
      if (size == 0) return false;
      std::vector<BYTE> buffer(size);
      if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lparam), RID_INPUT,
                          buffer.data(), &size,
                          sizeof(RAWINPUTHEADER)) != size) {
        return false;
      }
      const RAWINPUT* raw = reinterpret_cast<const RAWINPUT*>(buffer.data());
      if (raw->header.dwType == RIM_TYPEMOUSE &&
          !(raw->data.mouse.usFlags & MOUSE_MOVE_ABSOLUTE)) {
        pending_dx_ += raw->data.mouse.lLastX;
        pending_dy_ += raw->data.mouse.lLastY;
      }
      return false;  // let DefWindowProc clean up the raw input buffer
    }
    case WM_TIMER:
      if (wparam == kFlushTimer) {
        Flush();
        return true;
      }
      return false;
    case WM_KILLFOCUS:
    case WM_CANCELMODE:
      // a hidden cursor over another app is unrecoverable for the player
      Release(true);
      return false;
    case WM_SIZE:
    case WM_MOVE:
      if (captured_) Recentre();
      return false;
    default:
      return false;
  }
}
