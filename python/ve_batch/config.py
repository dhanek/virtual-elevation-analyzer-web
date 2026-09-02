"""Build runner configs from keyword arguments.

``build_config`` is a thin, VALIDATING dict builder — it knows the schema's
shape and the obvious local mistakes, and nothing about physics. It
deliberately does not duplicate the TypeScript validator (the runner is
authoritative); it exists so a 400-file batch fails in milliseconds on a typo
rather than ten minutes in.

Unit notes, mirrored from the app:
- ``crr`` is the 22 °C-referenced value; the runner applies the temperature
  correction itself when the parameters enable it.
- ``wind_speed`` is the UNTRANSFERRED 10 m value; ``wind_height_factor`` is
  applied once, inside the runner's physics, never here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .errors import VeConfigError

SCHEMA_VERSION = 1

_MODES = ("standard", "gpsLap", "outAndBack")
_WIND_SOURCES = ("constant", "fit", "compare", "none")

# build_config kwargs that map straight onto AnalysisParameters fields,
# {kwarg: parameter_field}. Anything not listed here and not a known top-level
# kwarg is rejected, so a typo cannot silently vanish.
_PARAMETER_KWARGS = {
    "mass": "system_mass",
    "rho": "rho",
    "eta": "eta",
    "wind_speed": "wind_speed",
    "wind_direction": "wind_direction",
    "wind_height_factor": "wind_height_factor",
    "velodrome": "velodrome",
    "cda_min": "cda_min",
    "cda_max": "cda_max",
    "crr_min": "crr_min",
    "crr_max": "crr_max",
}


def build_config(
    *,
    mode: str = "standard",
    cda: float,
    crr: float,
    laps: Sequence[int] | None = None,
    time_ranges: Sequence[tuple[float, float]] | None = None,
    index_ranges: Sequence[tuple[int, int]] | None = None,
    lap_numbers: Sequence[int] | None = None,
    sections: Sequence[Mapping[str, int]] | None = None,
    trim: tuple[int, int] | None = None,
    trim_by_segment: Mapping[str, tuple[int, int]] | None = None,
    wind_source: str | None = None,
    air_speed_calibration_percent: float | None = None,
    rho_array: Sequence[float] | bool | None = None,
    parameters: Mapping[str, Any] | None = None,
    include_series: bool = False,
    notes: str = "",
    file_name: str | None = None,
    activity_path: str | None = None,
    **parameter_kwargs: Any,
) -> dict:
    """Assemble a runner config dict. Raises ``VeConfigError`` on local mistakes."""
    if mode not in _MODES:
        raise VeConfigError(f"mode must be one of {_MODES}, got {mode!r}")
    if not (isinstance(cda, (int, float)) and cda > 0):
        raise VeConfigError(f"cda must be > 0, got {cda!r}")
    if not (isinstance(crr, (int, float)) and crr > 0):
        raise VeConfigError(f"crr must be > 0, got {crr!r}")
    if wind_source is not None and wind_source not in _WIND_SOURCES:
        raise VeConfigError(f"wind_source must be one of {_WIND_SOURCES}, got {wind_source!r}")

    selection = _build_selection(mode, laps, time_ranges, index_ranges, lap_numbers, sections)

    params: dict[str, Any] = dict(parameters or {})
    for kwarg, value in parameter_kwargs.items():
        field = _PARAMETER_KWARGS.get(kwarg)
        if field is None:
            raise VeConfigError(
                f"unknown keyword {kwarg!r} — known parameter shorthands: "
                f"{sorted(_PARAMETER_KWARGS)}"
            )
        params[field] = value

    inputs: dict[str, Any] = {"cda": cda, "crr": crr}
    if wind_source is not None:
        inputs["windSource"] = wind_source
    if air_speed_calibration_percent is not None:
        inputs["airSpeedCalibrationPercent"] = air_speed_calibration_percent
    if rho_array is not None:
        if rho_array is True:
            raise VeConfigError("rho_array takes a sequence, False (constant rho) or None (auto)")
        inputs["rhoArray"] = list(rho_array) if not isinstance(rho_array, bool) else False

    config: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "mode": mode,
        "selection": selection,
        "inputs": inputs,
    }
    if params:
        config["parameters"] = params
    if activity_path is not None:
        config["activity"] = {"path": activity_path}

    if trim is not None and trim_by_segment is not None:
        raise VeConfigError("pass trim or trim_by_segment, not both")
    if trim is not None:
        start, end = trim
        config["trim"] = {"space": "selection", "start": int(start), "end": int(end)}
    elif trim_by_segment is not None:
        config["trim"] = {
            "space": "segment",
            "bySegmentKey": {
                key: {"start": int(window[0]), "end": int(window[1])}
                for key, window in trim_by_segment.items()
            },
        }

    output: dict[str, Any] = {"csvRow": True}
    if include_series:
        output["includeSeries"] = True
    if notes:
        output["notes"] = notes
    if file_name is not None:
        output["fileName"] = file_name
    config["output"] = output

    return config


def _build_selection(
    mode: str,
    laps: Sequence[int] | None,
    time_ranges: Sequence[tuple[float, float]] | None,
    index_ranges: Sequence[tuple[int, int]] | None,
    lap_numbers: Sequence[int] | None,
    sections: Sequence[Mapping[str, int]] | None,
) -> dict:
    given = {
        "laps": laps,
        "time_ranges": time_ranges,
        "index_ranges": index_ranges,
        "sections": sections,
    }
    provided = [name for name, value in given.items() if value]

    if mode == "standard":
        if provided == ["laps"]:
            return {"laps": [int(lap) for lap in laps or []]}
        if provided == ["time_ranges"]:
            return {
                "timeRanges": [
                    {"start": float(start), "end": float(end)} for start, end in time_ranges or []
                ]
            }
        raise VeConfigError("standard mode needs exactly one of laps= or time_ranges=")
    if mode == "gpsLap":
        if provided != ["index_ranges"]:
            raise VeConfigError("gpsLap mode needs index_ranges= (and nothing else)")
        selection: dict[str, Any] = {
            "indexRanges": [
                {"startIdx": int(start), "endIdx": int(end)} for start, end in index_ranges or []
            ]
        }
        if lap_numbers is not None:
            if len(lap_numbers) != len(index_ranges or []):
                raise VeConfigError("lap_numbers must align 1:1 with index_ranges")
            selection["lapNumbers"] = [int(n) for n in lap_numbers]
        return selection
    # outAndBack
    if provided != ["sections"]:
        raise VeConfigError("outAndBack mode needs sections= (and nothing else)")
    required = (
        "sectionNumber",
        "outboundStartIdx",
        "outboundEndIdx",
        "inboundStartIdx",
        "inboundEndIdx",
    )
    normalised = []
    for section in sections or []:
        missing = [field for field in required if field not in section]
        if missing:
            raise VeConfigError(f"section is missing {missing}")
        normalised.append({field: int(section[field]) for field in required})
    return {"sections": normalised}


def write_config(config: Mapping[str, Any], path: str | Path) -> Path:
    """Write a config as pretty JSON; returns the path."""
    target = Path(path)
    target.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return target


def iter_ndjson(entries: Iterable[Mapping[str, Any]]) -> str:
    """Serialise batch entries (``{"file": ..., "config": ...}``) as NDJSON."""
    return "".join(json.dumps(entry, separators=(",", ":")) + "\n" for entry in entries)
