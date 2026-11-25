#!/usr/bin/env python3
"""Fetch live Viaggiatreno departures & arrivals for EasyTreno stations."""

import datetime
import json
import sys
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

STATIONS = {
    "S01061": "Vigevano",
    "S01630": "Milano S. Cristoforo",
    "S01632": "Milano Scalo Romana",
    "S01059": "Albairate-Vermezzo",
}

BASE_URL = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; EasyTreno/1.0)"}


def format_vt_date(dt: datetime.datetime) -> str:
    # Viaggiatreno requires English weekday/month abbreviations + GMT offset
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    tz_off = dt.strftime("%z") or "+0100"
    return (
        f"{days[dt.weekday()]} {months[dt.month - 1]} {dt.day:02d} {dt.year} "
        f"{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d} GMT{tz_off}"
    )


def fetch_board(kind: str, station_code: str, dt_str: str) -> dict:
    url = f"{BASE_URL}/{kind}/{station_code}/{urllib.parse.quote(dt_str)}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
            if not raw:
                return {}
            data = json.loads(raw)
    except Exception as exc:
        print(f"Warn: failed {kind}/{station_code}: {exc}", file=sys.stderr)
        return {}

    result = {}
    if not isinstance(data, list):
        return result

    is_arr = kind == "arrivi"
    for item in data:
        num = str(item.get("numeroTreno") or "").strip()
        if not num:
            continue
        eff_key = "binarioEffettivoArrivoDescrizione" if is_arr else "binarioEffettivoPartenzaDescrizione"
        prog_key = "binarioProgrammatoArrivoDescrizione" if is_arr else "binarioProgrammatoPartenzaDescrizione"
        bin_eff = (item.get(eff_key) or "").strip() or None
        bin_prog = (item.get(prog_key) or "").strip() or None
        ritardo = item.get("ritardo")
        if not isinstance(ritardo, int):
            ritardo = None

        provv = item.get("provvedimento")
        cancelled = provv == 1 or item.get("tipoTreno") == "ST"

        result[num] = {
            "d": ritardo,  # delay in minutes (int or null)
            "b": bin_eff or bin_prog,  # platform number string or null
            "be": bool(bin_eff),  # True if actual/confirmed live platform
            "c": cancelled,  # True if cancelled
            "np": bool(item.get("nonPartito")),
            "in": bool(item.get("inStazione")),
        }
    return result


def main() -> None:
    now_rome = datetime.datetime.now(ZoneInfo("Europe/Rome"))
    dt_str = format_vt_date(now_rome)

    payload = {
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "romeTime": now_rome.strftime("%H:%M"),
        "stations": {},
    }

    for code in STATIONS:
        payload["stations"][code] = {
            "partenze": fetch_board("partenze", code, dt_str),
            "arrivi": fetch_board("arrivi", code, dt_str),
        }

    out_path = sys.argv[1] if len(sys.argv) > 1 else "live.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {out_path} at {payload['romeTime']} ({len(payload['stations'])} stations)")


if __name__ == "__main__":
    main()
