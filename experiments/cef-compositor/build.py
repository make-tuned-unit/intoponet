#!/usr/bin/env python3
"""Prepare and build the pinned CEF comparator on an external volume."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


HERE = Path(__file__).resolve().parent
REPOSITORY_ROOT = HERE.parents[1]
LOCK_PATH = HERE / "cef.lock.json"
DEFAULT_EXTERNAL_ROOT = Path("/Volumes/PermagentBuilds/IntoponetCEF")


def run(*command: str, cwd: Path | None = None) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def sha1(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_scenario_contract_header(destination: Path) -> None:
    benchmark_root = REPOSITORY_ROOT / "experiments/compositor-benchmark"
    contract = json.loads((benchmark_root / "contract.json").read_text())
    artifacts = {
        "workloadSha256": sha256(benchmark_root / "scenario.html"),
        **{asset: sha256(benchmark_root / asset) for asset in contract["assets"]},
    }
    scenario = json.dumps(
        {"version": contract["version"], "contract": contract, "artifacts": artifacts},
        separators=(",", ":"),
    )
    bounds = contract["initialBounds"]
    settled = contract["settledBounds"]
    header = f'''#ifndef INTOPONET_COMPOSITOR_SCENARIO_CONTRACT_H_
#define INTOPONET_COMPOSITOR_SCENARIO_CONTRACT_H_

struct ScenarioBounds {{ int x; int y; int width; int height; }};
constexpr int kScenarioViewportWidth = {contract["viewport"]["width"]};
constexpr int kScenarioViewportHeight = {contract["viewport"]["height"]};
constexpr int kScenarioTransitionDurationMs = {contract["transitionDurationMs"]};
constexpr int kScenarioInitialWaitMs = {contract["initialWaitMs"]};
constexpr int kScenarioScrollDownWaitMs = {contract["scrollDownWaitMs"]};
constexpr int kScenarioScrollUpWaitMs = {contract["scrollUpWaitMs"]};
constexpr int kScenarioCloseSettleWaitMs = {contract["closeSettleWaitMs"]};
constexpr ScenarioBounds kScenarioInitialBounds = {{{bounds["x"]}, {bounds["y"]}, {bounds["width"]}, {bounds["height"]}}};
constexpr ScenarioBounds kScenarioSettledBounds = {{{settled["x"]}, {settled["y"]}, {settled["width"]}, {settled["height"]}}};
constexpr char kScenarioJson[] = R"INTOPONET_JSON({scenario})INTOPONET_JSON";

#endif  // INTOPONET_COMPOSITOR_SCENARIO_CONTRACT_H_
'''
    destination.write_text(header)


def replace_once(path: Path, before: str, after: str) -> None:
    contents = path.read_text()
    if after in contents:
        return
    if contents.count(before) != 1:
        raise RuntimeError(f"Expected one patch location in {path}")
    path.write_text(contents.replace(before, after))


def prepare_source(source: Path, lock: dict[str, object]) -> None:
    template = lock["cefProjectTemplate"]
    assert isinstance(template, dict)
    repository = str(template["repository"])
    commit = str(template["commit"])

    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        run("git", "clone", repository, str(source))

    actual_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=source, text=True
    ).strip()
    if actual_commit != commit:
        run("git", "fetch", "--depth", "1", "origin", commit, cwd=source)
        run("git", "checkout", "--detach", commit, cwd=source)

    cef_version = str(lock["cefVersion"])
    cmake_path = source / "CMakeLists.txt"
    contents = cmake_path.read_text()
    version_lines = [
        line for line in contents.splitlines() if line.startswith("set(CEF_VERSION ")
    ]
    if len(version_lines) != 1:
        raise RuntimeError("Could not find the CEF version declaration")
    replace_once(
        cmake_path,
        version_lines[0],
        f'set(CEF_VERSION "{cef_version}")',
    )
    replace_once(
        cmake_path,
        """add_subdirectory(${CEF_ROOT}/tests/cefclient)
add_subdirectory(${CEF_ROOT}/tests/cefsimple)
add_subdirectory(${CEF_ROOT}/tests/gtest)
add_subdirectory(${CEF_ROOT}/tests/ceftests)""",
        """# Intoponet builds only its comparator target. The upstream test targets are
# intentionally excluded because they are unrelated to this experiment and may
# require source-distribution-only dependencies such as cef_gmock.""",
    )

    workload_url = (REPOSITORY_ROOT / "experiments/compositor-benchmark/scenario.html").as_uri()
    replace_once(
        source / "examples/minimal/app_browser_minimal.cc",
        'constexpr char kStartupURL[] = "https://www.google.com";',
        f'constexpr char kStartupURL[] = "{workload_url}";',
    )

    native_source = HERE / "native"
    minimal_source = source / "examples/minimal"
    write_scenario_contract_header(minimal_source / "compositor_scenario_contract.h")
    shutil.copy2(native_source / "compositor_host_mac.h", minimal_source)
    compositor_contents = (native_source / "compositor_host_mac.mm").read_text()
    compositor_contents = compositor_contents.replace(
        "@RESULTS_DIR@", str(HERE / "results")
    )
    (minimal_source / "compositor_host_mac.mm").write_text(compositor_contents)

    minimal_cmake = source / "examples/minimal/CMakeLists.txt"
    replace_once(
        minimal_cmake,
        """  client_minimal.h
  main_minimal.cc
  )""",
        """  client_minimal.h
  main_minimal.cc
  )
if(OS_MAC)
  list(APPEND EXAMPLE_SRCS compositor_host_mac.mm)
endif()""",
    )

    app_browser = source / "examples/minimal/app_browser_minimal.cc"
    replace_once(
        app_browser,
        '#include "examples/minimal/client_minimal.h"',
        """#include "examples/minimal/client_minimal.h"
#include "examples/minimal/compositor_host_mac.h" """,
    )
    replace_once(
        app_browser,
        """      command_line->AppendSwitch("use-mock-keychain");
#endif""",
        """      command_line->AppendSwitch("use-mock-keychain");
      command_line->AppendSwitchWithValue("autoplay-policy",
                                          "no-user-gesture-required");
      command_line->AppendSwitch("allow-file-access-from-files");
#endif""",
    )
    replace_once(
        app_browser,
        "shared::CreateBrowser(new Client(), kStartupURL, CefBrowserSettings());",
        """CefWindowInfo window_info;
    window_info.SetAsChild(intoponet::CreateCompositorHost(),
                           intoponet::InitialBrowserBounds());
    window_info.runtime_style = CEF_RUNTIME_STYLE_ALLOY;
    CefBrowserHost::CreateBrowser(window_info, new Client(), kStartupURL,
                                  CefBrowserSettings(), nullptr, nullptr);""",
    )

    client_source = source / "examples/minimal/client_minimal.cc"
    replace_once(
        client_source,
        '#include "examples/minimal/client_minimal.h"',
        """#include "examples/minimal/client_minimal.h"
#include "examples/minimal/compositor_host_mac.h" """,
    )
    replace_once(
        client_source,
        """  // Call the default shared implementation.
  shared::OnTitleChange(browser, title);""",
        """  if (intoponet::HandleBenchmarkTitle(browser, std::string(title))) {
    return;
  }
  shared::OnTitleChange(browser, title);""",
    )
    replace_once(
        client_source,
        """  // Call the default shared implementation.
  shared::OnAfterCreated(browser);""",
        """  shared::OnAfterCreated(browser);
  intoponet::StartCompositorBenchmark(browser);""",
    )


def verify_archive(source: Path, lock: dict[str, object]) -> None:
    archive = lock["archive"]
    assert isinstance(archive, dict)
    archive_path = source / "third_party/cef" / str(archive["name"])
    if not archive_path.is_file():
        raise RuntimeError(f"CEF archive was not downloaded: {archive_path}")
    expected_size = int(archive["sizeBytes"])
    if archive_path.stat().st_size != expected_size:
        raise RuntimeError("CEF archive size does not match cef.lock.json")
    expected_sha1 = str(archive["sha1"])
    actual_sha1 = sha1(archive_path)
    if actual_sha1 != expected_sha1:
        raise RuntimeError(
            f"CEF archive SHA-1 mismatch: expected {expected_sha1}, got {actual_sha1}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--external-root",
        type=Path,
        default=Path(os.environ.get("INTOPONET_CEF_BUILD_ROOT", DEFAULT_EXTERNAL_ROOT)),
    )
    parser.add_argument("--configure-only", action="store_true")
    arguments = parser.parse_args()

    lock = json.loads(LOCK_PATH.read_text())
    external_root = arguments.external_root.resolve()
    source = external_root / "cef-project"
    build = external_root / "build"

    if not external_root.parent.exists():
        raise RuntimeError(f"External volume is not mounted: {external_root.parent}")

    external_root.mkdir(parents=True, exist_ok=True)
    prepare_source(source, lock)

    run(
        "cmake",
        "-S",
        str(source),
        "-B",
        str(build),
        "-G",
        "Xcode",
        "-DPROJECT_ARCH=arm64",
        "-DWITH_EXAMPLES=ON",
        "-DPYTHON_EXECUTABLE=/usr/bin/python3",
    )
    verify_archive(source, lock)

    if not arguments.configure_only:
        run(
            "cmake",
            "--build",
            str(build),
            "--config",
            "Release",
            "--target",
            "minimal",
            "--parallel",
            str(max(1, min(8, os.cpu_count() or 1))),
        )

    app_path = build / "Release/minimal.app"
    print(f"CEF comparator app: {app_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
