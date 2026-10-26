#!/usr/bin/env python3
"""Validate matched compositor-v1 captures and print a neutral comparison."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


HERE = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def comparable_pair(electron_path: Path, cef_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    contract = read_json(HERE / "contract.json")
    electron = read_json(electron_path)
    cef = read_json(cef_path)
    expected_artifacts = {
        "workloadSha256": sha256(HERE / "scenario.html"),
        **{asset: sha256(HERE / asset) for asset in contract["assets"]},
    }

    for label, result, candidate in (
        ("Electron", electron, "electron-webcontentsview"),
        ("CEF", cef, "cef-native-child"),
    ):
        require(result.get("schemaVersion") == "engine-compositor-result-v1",
                f"{label}: unsupported result schema")
        require(result.get("candidate") == candidate,
                f"{label}: expected candidate {candidate!r}")
        scenario = result.get("scenario")
        require(isinstance(scenario, dict), f"{label}: missing scenario metadata")
        require(scenario.get("version") == contract["version"],
                f"{label}: scenario version differs from current contract")
        require(scenario.get("contract") == contract,
                f"{label}: captured contract differs from contract.json")
        require(scenario.get("artifacts") == expected_artifacts,
                f"{label}: workload or media asset hash differs from current files")
        require(result.get("viewport") == contract["viewport"],
                f"{label}: viewport differs from the shared contract")
        workload = result.get("workload")
        require(isinstance(workload, dict), f"{label}: missing workload metrics")
        require(workload.get("version") == contract["version"],
                f"{label}: workload metrics report a different version")
        for metric in ("averageFps", "p95FrameMs", "framesOver120PercentBudget",
                       "webglReady", "videoReady", "videoError"):
            require(metric in workload, f"{label}: missing workload metric {metric}")

    require(electron["runtime"].get("chromium") == cef["runtime"].get("chromium"),
            "Chromium versions differ")
    for key in ("platform", "arch"):
        require(electron["runtime"].get(key) == cef["runtime"].get(key),
                f"runtime {key} differs")
    for key in ("logicalCpuCount", "totalMemoryBytes", "displayFrequencyHz", "scaleFactor"):
        require(electron["hardware"].get(key) == cef["hardware"].get(key),
                f"hardware {key} differs")
    return electron, cef


def working_set_kb(result: dict[str, Any]) -> int:
    if isinstance(result.get("totalWorkingSetKb"), (int, float)):
        return int(result["totalWorkingSetKb"])
    processes = result.get("processMetricsAfter", [])
    return sum(int(process.get("workingSetKb", 0)) for process in processes
               if isinstance(process, dict))


def report(electron: dict[str, Any], cef: dict[str, Any]) -> dict[str, Any]:
    ework = electron["workload"]
    cwork = cef["workload"]
    electron_metrics = {
        "averageFps": ework["averageFps"],
        "p95FrameMs": ework["p95FrameMs"],
        "framesOver120PercentBudget": ework["framesOver120PercentBudget"],
        "workingSetKb": working_set_kb(electron),
    }
    cef_metrics = {
        "averageFps": cwork["averageFps"],
        "p95FrameMs": cwork["p95FrameMs"],
        "framesOver120PercentBudget": cwork["framesOver120PercentBudget"],
        "workingSetKb": working_set_kb(cef),
    }
    return {
        "comparisonSchema": "engine-compositor-comparison-v1",
        "comparable": True,
        "scenarioVersion": electron["scenario"]["version"],
        "hardware": electron["hardware"],
        "chromium": electron["runtime"]["chromium"],
        "results": {
            "electron": {
                "recordedAt": electron["recordedAt"],
                **electron_metrics,
                "webglReady": ework["webglReady"],
                "videoReady": ework["videoReady"],
                "videoError": ework["videoError"],
            },
            "cef": {
                "recordedAt": cef["recordedAt"],
                **cef_metrics,
                "webglReady": cwork["webglReady"],
                "videoReady": cwork["videoReady"],
                "videoError": cwork["videoError"],
            },
        },
        "deltaCefMinusElectron": {
            key: cef_metrics[key] - electron_metrics[key]
            for key in electron_metrics
        },
        "limitations": [
            "This check establishes matched inputs and reports observations; it does not select an engine.",
            "Display refresh, power source, window focus, thermal state, and surrounding system load still require operator review.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("electron_result", type=Path)
    parser.add_argument("cef_result", type=Path)
    parser.add_argument("--output", type=Path, help="write comparison JSON instead of stdout")
    args = parser.parse_args()
    try:
        electron, cef = comparable_pair(args.electron_result, args.cef_result)
        payload = json.dumps(report(electron, cef), indent=2) + "\n"
        if args.output:
            args.output.write_text(payload)
        else:
            print(payload, end="")
        return 0
    except (OSError, ValueError, json.JSONDecodeError, KeyError, TypeError) as error:
        print(f"not comparable: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
