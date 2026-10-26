#include "examples/minimal/compositor_host_mac.h"

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

#include <libproc.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <map>
#include <numeric>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/cef_frame.h"
#include "include/cef_version.h"
#include "include/wrapper/cef_helpers.h"
#include "examples/minimal/compositor_scenario_contract.h"

constexpr char kResultsDirectory[] = "@RESULTS_DIR@";

struct TransitionMetrics {
  double actual_duration_ms = 0;
  double average_update_interval_ms = 0;
  double p95_update_interval_ms = 0;
  int update_count = 0;
  int updates_over_20ms = 0;
};

struct ProcessSample {
  int pid = 0;
  uint64_t resident_bytes = 0;
  uint64_t cpu_nanoseconds = 0;
};

double Percentile(std::vector<double> values, double point) {
  if (values.empty()) {
    return 0;
  }
  std::sort(values.begin(), values.end());
  const size_t index =
      std::min(values.size() - 1, static_cast<size_t>(values.size() * point));
  return values[index];
}

std::vector<int> DescendantPids() {
  std::vector<int> result;
  std::vector<int> pending = {getpid()};
  std::set<int> seen;
  while (!pending.empty()) {
    const int parent = pending.back();
    pending.pop_back();
    if (!seen.insert(parent).second) {
      continue;
    }
    result.push_back(parent);
    int children[256] = {};
    const int bytes =
        proc_listchildpids(parent, children, static_cast<int>(sizeof(children)));
    if (bytes <= 0) {
      continue;
    }
    const int count = bytes / static_cast<int>(sizeof(int));
    for (int index = 0; index < count; ++index) {
      if (children[index] > 0) {
        pending.push_back(children[index]);
      }
    }
  }
  return result;
}

std::vector<ProcessSample> SampleProcesses() {
  std::vector<ProcessSample> samples;
  for (const int pid : DescendantPids()) {
    rusage_info_v4 info = {};
    if (proc_pid_rusage(pid, RUSAGE_INFO_V4,
                        reinterpret_cast<rusage_info_t*>(&info)) != 0) {
      continue;
    }
    samples.push_back(
        {pid, info.ri_resident_size, info.ri_user_time + info.ri_system_time});
  }
  return samples;
}

std::string JsonTransition(const TransitionMetrics& metrics) {
  std::ostringstream output;
  output << "{"
         << "\"requestedDurationMs\":" << kScenarioTransitionDurationMs << ","
         << "\"actualDurationMs\":" << metrics.actual_duration_ms << ","
         << "\"updateCount\":" << metrics.update_count << ","
         << "\"averageUpdateIntervalMs\":"
         << metrics.average_update_interval_ms << ","
         << "\"p95UpdateIntervalMs\":" << metrics.p95_update_interval_ms << ","
         << "\"updatesOver20ms\":" << metrics.updates_over_20ms << "}";
  return output.str();
}

@interface IntoponetFieldView : NSView {
 @private
  NSTimer* animation_timer_;
  double phase_;
}
@end

@implementation IntoponetFieldView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self) {
    phase_ = 0;
    animation_timer_ =
        [NSTimer scheduledTimerWithTimeInterval:1.0 / 60.0
                                        target:self
                                      selector:@selector(advanceField:)
                                      userInfo:nil
                                       repeats:YES];
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (void)advanceField:(NSTimer*)timer {
  phase_ += 0.018;
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  [[NSColor colorWithRed:0.027 green:0.067 blue:0.106 alpha:1] setFill];
  NSRectFill(self.bounds);
  const NSSize size = self.bounds.size;
  for (NSInteger index = 0; index < 8; ++index) {
    const CGFloat x =
        size.width * (0.14 + index * 0.105) + std::sin(phase_ + index) * 32;
    const CGFloat y =
        size.height * (0.3 + (index % 3) * 0.19) + std::cos(phase_ + index) * 26;
    const CGFloat radius = 95 + (index % 4) * 18;
    NSColor* color =
        index % 2
            ? [NSColor colorWithRed:0.314 green:0.851 blue:0.78 alpha:0.24]
            : [NSColor colorWithRed:0.651 green:0.608 blue:0.91 alpha:0.22];
    NSGradient* gradient =
        [[NSGradient alloc] initWithStartingColor:color
                                     endingColor:[color colorWithAlphaComponent:0]];
    [gradient drawFromCenter:NSMakePoint(x, y)
                     radius:0
                   toCenter:NSMakePoint(x, y)
                     radius:radius
                    options:0];
  }
}
@end

@interface IntoponetBenchmarkController : NSObject {
 @private
  CefRefPtr<CefBrowser> browser_;
  NSWindow* window_;
  NSView* browser_container_;
  NSTimer* transition_timer_;
  NSRect transition_from_;
  NSRect transition_to_;
  CFTimeInterval transition_started_;
  CFTimeInterval previous_tick_;
  std::vector<double> transition_intervals_;
  TransitionMetrics opening_;
  TransitionMetrics closing_;
  BOOL opening_phase_;
  CFTimeInterval benchmark_started_;
  std::map<int, uint64_t> initial_cpu_;
}
- (CefWindowHandle)createHost;
- (void)start:(CefRefPtr<CefBrowser>)browser;
- (BOOL)handleTitle:(const std::string&)title;
@end

@implementation IntoponetBenchmarkController
- (CefWindowHandle)createHost {
  const NSRect frame = NSMakeRect(0, 0, kScenarioViewportWidth,
                                  kScenarioViewportHeight);
  window_ = [[NSWindow alloc]
      initWithContentRect:frame
                styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                           NSWindowStyleMaskMiniaturizable)
                  backing:NSBackingStoreBuffered
                    defer:NO];
  [window_ setTitle:@"Intoponet CEF compositor benchmark"];
  [window_ center];

  IntoponetFieldView* field = [[IntoponetFieldView alloc] initWithFrame:frame];
  [field setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
  [window_ setContentView:field];

  browser_container_ = [[NSView alloc]
      initWithFrame:NSMakeRect(kScenarioInitialBounds.x,
                               kScenarioInitialBounds.y,
                               kScenarioInitialBounds.width,
                               kScenarioInitialBounds.height)];
  [browser_container_ setWantsLayer:YES];
  browser_container_.layer.backgroundColor = NSColor.whiteColor.CGColor;
  browser_container_.layer.cornerRadius = 12;
  browser_container_.layer.masksToBounds = YES;
  [field addSubview:browser_container_];
  [window_ makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  return CAST_NSVIEW_TO_CEF_WINDOW_HANDLE(browser_container_);
}

- (void)start:(CefRefPtr<CefBrowser>)browser {
  CEF_REQUIRE_UI_THREAD();
  browser_ = browser;
  benchmark_started_ = CFAbsoluteTimeGetCurrent();
  for (const auto& sample : SampleProcesses()) {
    initial_cpu_[sample.pid] = sample.cpu_nanoseconds;
  }
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW,
                    static_cast<int64_t>(kScenarioInitialWaitMs * NSEC_PER_MSEC)),
      dispatch_get_main_queue(), ^{
        [self beginTransitionTo:NSMakeRect(kScenarioSettledBounds.x,
                                           kScenarioSettledBounds.y,
                                           kScenarioSettledBounds.width,
                                           kScenarioSettledBounds.height)
                        opening:YES];
      });
}

- (void)beginTransitionTo:(NSRect)target opening:(BOOL)opening {
  transition_from_ = browser_container_.frame;
  transition_to_ = target;
  transition_started_ = CFAbsoluteTimeGetCurrent();
  previous_tick_ = transition_started_;
  transition_intervals_.clear();
  opening_phase_ = opening;
  transition_timer_ =
      [NSTimer scheduledTimerWithTimeInterval:1.0 / 60.0
                                      target:self
                                    selector:@selector(advanceTransition:)
                                    userInfo:nil
                                     repeats:YES];
}

- (void)advanceTransition:(NSTimer*)timer {
  const CFTimeInterval now = CFAbsoluteTimeGetCurrent();
  const double elapsed_ms = (now - transition_started_) * 1000.0;
  const double progress =
      std::min(1.0, elapsed_ms / kScenarioTransitionDurationMs);
  const double eased = 1.0 - std::pow(1.0 - progress, 3.0);
  transition_intervals_.push_back((now - previous_tick_) * 1000.0);
  previous_tick_ = now;

  NSRect frame;
  frame.origin.x = transition_from_.origin.x +
                   (transition_to_.origin.x - transition_from_.origin.x) * eased;
  frame.origin.y = transition_from_.origin.y +
                   (transition_to_.origin.y - transition_from_.origin.y) * eased;
  frame.size.width = transition_from_.size.width +
                     (transition_to_.size.width - transition_from_.size.width) *
                         eased;
  frame.size.height =
      transition_from_.size.height +
      (transition_to_.size.height - transition_from_.size.height) * eased;
  [browser_container_ setFrame:frame];
  for (NSView* child in browser_container_.subviews) {
    [child setFrame:browser_container_.bounds];
  }

  if (progress < 1.0) {
    return;
  }
  [transition_timer_ invalidate];
  TransitionMetrics metrics;
  metrics.actual_duration_ms = elapsed_ms;
  metrics.update_count = static_cast<int>(transition_intervals_.size());
  metrics.average_update_interval_ms =
      std::accumulate(transition_intervals_.begin(), transition_intervals_.end(),
                      0.0) /
      std::max<size_t>(1, transition_intervals_.size());
  metrics.p95_update_interval_ms = Percentile(transition_intervals_, 0.95);
  metrics.updates_over_20ms = static_cast<int>(std::count_if(
      transition_intervals_.begin(), transition_intervals_.end(),
      [](double value) { return value > 20.0; }));

  if (opening_phase_) {
    opening_ = metrics;
    [self runInteractionSequence];
  } else {
    closing_ = metrics;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW,
                      static_cast<int64_t>(kScenarioCloseSettleWaitMs *
                                           NSEC_PER_MSEC)),
        dispatch_get_main_queue(), ^{
          const NSInteger refresh_rate =
              NSScreen.mainScreen.maximumFramesPerSecond;
          std::ostringstream script;
          script << "document.title='__INTOPONET_RESULT__'+JSON.stringify("
                 << "window.__INTOPONET_BENCHMARK__.snapshot(" << refresh_rate
                 << "));";
          browser_->GetMainFrame()->ExecuteJavaScript(script.str(), "", 0);
        });
  }
}

- (void)runInteractionSequence {
  browser_->GetMainFrame()->ExecuteJavaScript(
      R"JS(
        (() => {
          const input = document.querySelector('input[name="query"]');
          input.focus();
          input.value += ' — edited';
          document.querySelector('#clip').play().catch(() => {});
          const bounds = document.querySelector('#interaction-button').getBoundingClientRect();
          document.title = `__INTOPONET_BUTTON__${Math.round(bounds.x + bounds.width / 2)},${Math.round(bounds.y + bounds.height / 2)}`;
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        })();
      )JS",
      "", 0);
}

- (void)sendPointerAtX:(int)x y:(int)y {
  CefMouseEvent event;
  event.x = x;
  event.y = y;
  browser_->GetHost()->SendMouseClickEvent(event, MBT_LEFT, false, 1);
  browser_->GetHost()->SendMouseClickEvent(event, MBT_LEFT, true, 1);
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW,
                    static_cast<int64_t>(kScenarioScrollDownWaitMs *
                                         NSEC_PER_MSEC)),
      dispatch_get_main_queue(), ^{
        browser_->GetMainFrame()->ExecuteJavaScript(
            "window.scrollTo({top:0,behavior:'smooth'});", "", 0);
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW,
                        static_cast<int64_t>(kScenarioScrollUpWaitMs *
                                             NSEC_PER_MSEC)),
            dispatch_get_main_queue(), ^{
            [self beginTransitionTo:NSMakeRect(kScenarioInitialBounds.x,
                                               kScenarioInitialBounds.y,
                                               kScenarioInitialBounds.width,
                                               kScenarioInitialBounds.height)
                              opening:NO];
            });
      });
}

- (BOOL)handleTitle:(const std::string&)title {
  constexpr char kButtonPrefix[] = "__INTOPONET_BUTTON__";
  constexpr char kResultPrefix[] = "__INTOPONET_RESULT__";
  if (title.rfind(kButtonPrefix, 0) == 0) {
    int x = 0;
    int y = 0;
    if (sscanf(title.c_str() + sizeof(kButtonPrefix) - 1, "%d,%d", &x, &y) ==
        2) {
      [self sendPointerAtX:x y:y];
    }
    return YES;
  }
  if (title.rfind(kResultPrefix, 0) == 0) {
    [self finishWithWorkload:title.substr(sizeof(kResultPrefix) - 1)];
    return YES;
  }
  return NO;
}

- (void)finishWithWorkload:(const std::string&)workload_json {
  const auto samples = SampleProcesses();
  uint64_t total_resident_bytes = 0;
  uint64_t total_cpu_delta = 0;
  std::ostringstream process_json;
  process_json << "[";
  for (size_t index = 0; index < samples.size(); ++index) {
    const auto& sample = samples[index];
    total_resident_bytes += sample.resident_bytes;
    const auto found = initial_cpu_.find(sample.pid);
    const uint64_t initial =
        found == initial_cpu_.end() ? sample.cpu_nanoseconds : found->second;
    const uint64_t delta = sample.cpu_nanoseconds - initial;
    total_cpu_delta += delta;
    if (index) {
      process_json << ",";
    }
    process_json << "{\"pid\":" << sample.pid
                 << ",\"workingSetKb\":" << sample.resident_bytes / 1024
                 << ",\"cpuDeltaNanoseconds\":" << delta << "}";
  }
  process_json << "]";

  const double elapsed_seconds =
      CFAbsoluteTimeGetCurrent() - benchmark_started_;
  const double cpu_percent =
      elapsed_seconds > 0
          ? (static_cast<double>(total_cpu_delta) / 1e9 / elapsed_seconds) * 100.0
          : 0;
  NSString* timestamp =
      [[[NSISO8601DateFormatter alloc] init] stringFromDate:[NSDate date]];
  std::string timestamp_utf8(timestamp.UTF8String);
  const NSInteger refresh_rate = NSScreen.mainScreen.maximumFramesPerSecond;
  const NSProcessInfo* process_info = NSProcessInfo.processInfo;

  std::ostringstream result;
  result << "{"
         << "\"schemaVersion\":\"engine-compositor-result-v1\","
         << "\"recordedAt\":\"" << timestamp_utf8 << "\","
         << "\"candidate\":\"cef-native-child\","
         << "\"runtime\":{"
         << "\"cef\":\"" << CEF_VERSION << "\","
         << "\"chromium\":\"" << CHROME_VERSION_MAJOR << "."
         << CHROME_VERSION_MINOR << "." << CHROME_VERSION_BUILD << "."
         << CHROME_VERSION_PATCH << "\","
         << "\"platform\":\"darwin\",\"arch\":\"arm64\"},"
         << "\"hardware\":{"
         << "\"logicalCpuCount\":" << process_info.processorCount << ","
         << "\"totalMemoryBytes\":" << process_info.physicalMemory << ","
         << "\"displayFrequencyHz\":" << refresh_rate << ","
         << "\"scaleFactor\":" << NSScreen.mainScreen.backingScaleFactor << "},"
         << "\"viewport\":{\"width\":" << kScenarioViewportWidth
         << ",\"height\":" << kScenarioViewportHeight << "},"
         << "\"scenario\":" << kScenarioJson << ","
         << "\"transition\":{\"opening\":" << JsonTransition(opening_)
         << ",\"closing\":" << JsonTransition(closing_) << "},"
         << "\"workload\":" << workload_json << ","
         << "\"processMetricsAfter\":" << process_json.str() << ","
         << "\"totalWorkingSetKb\":" << total_resident_bytes / 1024 << ","
         << "\"totalCpuPercent\":" << cpu_percent << ","
         << "\"limitations\":["
         << "\"CEF CPU is derived from cumulative process CPU during the run.\","
         << "\"This run does not yet measure IME, screen-reader output, video "
            "decode, permissions, crash recovery, or energy impact.\"]"
         << "}";

  NSString* results_directory =
      [NSString stringWithUTF8String:kResultsDirectory];
  [[NSFileManager defaultManager] createDirectoryAtPath:results_directory
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  std::string filename = timestamp_utf8;
  std::replace(filename.begin(), filename.end(), ':', '-');
  const std::string result_path =
      std::string(kResultsDirectory) + "/cef-" + filename + ".json";
  std::ofstream output(result_path);
  output << result.str() << "\n";
  output.close();
  chmod(result_path.c_str(), 0600);
  const std::string latest_path =
      std::string(kResultsDirectory) + "/latest.json";
  std::ofstream latest(latest_path);
  latest << result.str() << "\n";
  latest.close();
  chmod(latest_path.c_str(), 0600);
  printf("CEF compositor result: %s\n", result_path.c_str());
  fflush(stdout);
  browser_->GetHost()->CloseBrowser(true);
  CefQuitMessageLoop();
  [window_ close];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(0.2 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   [NSApp terminate:nil];
                 });
}
@end

IntoponetBenchmarkController* g_controller = nil;

namespace intoponet {

CefWindowHandle CreateCompositorHost() {
  CEF_REQUIRE_UI_THREAD();
  if (!g_controller) {
    g_controller = [[IntoponetBenchmarkController alloc] init];
  }
  return [g_controller createHost];
}

CefRect InitialBrowserBounds() {
  return CefRect(0, 0, kScenarioInitialBounds.width,
                 kScenarioInitialBounds.height);
}

void StartCompositorBenchmark(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  [g_controller start:browser];
}

bool HandleBenchmarkTitle(CefRefPtr<CefBrowser> browser,
                          const std::string& title) {
  CEF_REQUIRE_UI_THREAD();
  return [g_controller handleTitle:title] == YES;
}

}  // namespace intoponet
