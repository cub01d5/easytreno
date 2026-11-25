#!/usr/bin/env python3
"""Fetch live Viaggiatreno departures, arrivals, and per-stop actual passing times for EasyTreno."""

import datetime
import json
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

STATIONS = {
    "S01061": "Vigevano",
    "S01630": "Milano S. Cristoforo",
    "S01632": "Milano Scalo Romana",
    "S01059": "Albairate-Vermezzo",
}

BASE_URL = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; EasyTreno/1.0)"}
ROME_TZ = ZoneInfo("Europe/Rome")


def format_vt_date(dt: datetime.datetime) -> str:
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    tz_off = dt.strftime("%z") or "+0100"
    return (
        f"{days[dt.weekday()]} {months[dt.month - 1]} {dt.day:02d} {dt.year} "
        f"{dt.hour:02d}:{dt.minute:02d}:{dt.second:02d} GMT{tz_off}"
    )


def ms_to_rome_hhmm(ms) -> str | None:
    if not isinstance(ms, (int, float)) or ms <= 0:
        return None
    dt = datetime.datetime.fromtimestamp(ms / 1000.0, tz=ROME_TZ)
    return dt.strftime("%H:%M")


def fetch_json(url: str, timeout: int = 12):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return None
        return json.loads(raw)


def fetch_board(kind: str, station_code: str, dt_str: str) -> tuple[dict, dict]:
    url = f"{BASE_URL}/{kind}/{station_code}/{urllib.parse.quote(dt_str)}"
    try:
        data = fetch_json(url, timeout=12)
    except Exception as exc:
        print(f"Warn: failed {kind}/{station_code}: {exc}", file=sys.stderr)
        return {}, {}

    board = {}
    triples = {}
    if not isinstance(data, list):
        return board, triples

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

        board[num] = {
            "d": ritardo,
            "b": bin_eff or bin_prog,
            "be": bool(bin_eff),
            "c": cancelled,
            "np": bool(item.get("nonPartito")),
            "in": bool(item.get("inStazione")),
        }

        cod_orig = item.get("codOrigine")
        ts = item.get("dataPartenzaTreno")
        if cod_orig and ts:
            triples[num] = (cod_orig, num, ts)

    return board, triples


def fetch_train_stops(triple: tuple[str, str, int]) -> tuple[str, dict | None]:
    orig, num, ts = triple
    url = f"{BASE_URL}/andamentoTreno/{orig}/{num}/{ts}"
    try:
        data = fetch_json(url, timeout=10)
    except Exception:
        return num, None

    if not isinstance(data, dict):
        return num, None

    stops_map = {}
    for f in data.get("fermate") or []:
        stop_id = (f.get("id") or "").strip()
        if not stop_id:
            continue
        actual_type = f.get("actualFermataType")
        part_reale = f.get("partenzaReale")
        arr_reale = f.get("arrivoReale")
        eff = f.get("effettiva")

        actual_ms = part_reale or arr_reale or eff
        passed = bool(actual_ms) and actual_type != 3

        delay = None
        if passed:
            if part_reale and isinstance(f.get("ritardoPartenza"), int):
                delay = f.get("ritardoPartenza")
            elif arr_reale and isinstance(f.get("ritardoArrivo"), int):
                delay = f.get("ritardoArrivo")
            elif isinstance(f.get("ritardo"), int):
                delay = f.get("ritardo")

        if actual_type == 3:
            st = 3  # cancelled stop
        elif passed or actual_type == 1:
            st = 1  # passed (t may be null if halt has no trackside clock)
        else:
            st = 0  # upcoming / not yet passed

        stops_map[stop_id] = {
            "t": ms_to_rome_hhmm(actual_ms) if passed else None,
            "d": delay,
            "st": st,
        }

    ritardo = data.get("ritardo")
    if not isinstance(ritardo, int):
        ritardo = None

    last_st = (data.get("stazioneUltimoRilevamento") or "").strip()
    if last_st == "--":
        last_st = None
    last_time = (data.get("compOraUltimoRilevamento") or "").strip() or None
    if last_time == "--":
        last_time = None
    last_ms = data.get("oraUltimoRilevamento")
    if not isinstance(last_ms, (int, float)) or last_ms <= 0:
        last_ms = None

    cancelled = data.get("provvedimento") == 1 or data.get("tipoTreno") == "ST"

    orig_sched_ms = data.get("orarioPartenza")
    if not isinstance(orig_sched_ms, (int, float)) or orig_sched_ms <= 0:
        orig_sched_ms = None
    orig_name = (data.get("origine") or "").strip() or None

    return num, {
        "r": ritardo,
        "lu": last_st,
        "lo": last_time,
        "lm": int(last_ms) if last_ms else None,
        "os": int(orig_sched_ms) if orig_sched_ms else None,
        "or": orig_name,
        "np": bool(data.get("nonPartito")),
        "c": cancelled,
        "f": stops_map,
    }


def main() -> None:
    now_rome = datetime.datetime.now(ROME_TZ)
    dt_str = format_vt_date(now_rome)

    payload = {
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "romeTime": now_rome.strftime("%H:%M"),
        "stations": {},
        "trains": {},
    }

    board_tasks = [(kind, code) for code in STATIONS for kind in ("partenze", "arrivi")]
    for code in STATIONS:
        payload["stations"][code] = {"partenze": {}, "arrivi": {}}

    all_triples = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(fetch_board, kind, code, dt_str) for kind, code in board_tasks]
        for (kind, code), fut in zip(board_tasks, futures):
            board, triples = fut.result()
            payload["stations"][code][kind] = board
            all_triples.update(triples)

        for num, info in ex.map(fetch_train_stops, all_triples.values()):
            if info:
                payload["trains"][num] = info

    out_path = sys.argv[1] if len(sys.argv) > 1 else "live.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(
        f"Wrote {out_path} at {payload['romeTime']} "
        f"({len(payload['stations'])} stations, {len(payload['trains'])} trains)"
    )


if __name__ == "__main__":
    main()
