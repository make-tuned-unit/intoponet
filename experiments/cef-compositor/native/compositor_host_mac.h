#ifndef INTOPONET_COMPOSITOR_HOST_MAC_H_
#define INTOPONET_COMPOSITOR_HOST_MAC_H_

#include <string>

#include "include/cef_browser.h"
#include "include/internal/cef_types_wrappers.h"

namespace intoponet {

CefWindowHandle CreateCompositorHost();
CefRect InitialBrowserBounds();
void StartCompositorBenchmark(CefRefPtr<CefBrowser> browser);
bool HandleBenchmarkTitle(CefRefPtr<CefBrowser> browser,
                          const std::string& title);

}  // namespace intoponet

#endif  // INTOPONET_COMPOSITOR_HOST_MAC_H_
