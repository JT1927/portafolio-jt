# Endpoints del mapa de pista:
# - /pista/{circuito}: el trazado (desde la base)
# - /mapa/{session_key}: posiciones de todos los autos durante la carrera completa,
#   descargadas de OpenF1 la primera vez y guardadas en data/mapa/
import json
import sqlite3
import threading
import time
from pathlib import Path
from urllib.parse import quote

import numpy as np
import pandas as pd
import requests
from fastapi import APIRouter, HTTPException

router = APIRouter()

BASE = "https://api.openf1.org/v1"
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
CARPETA = RUTA_DB.parent / "mapa"
CARPETA.mkdir(exist_ok=True)

PASO = 2.0     # segundos entre una posición y la siguiente
BLOQUE = 240   # segundos de carrera que se piden por consulta

candados = {}
candado_general = threading.Lock()


def candado(session_key):
    # Un candado por carrera: si llegan dos pedidos a la vez, el segundo espera al primero.
    with candado_general:
        return candados.setdefault(session_key, threading.Lock())


def leer(sql, params=()):
    con = sqlite3.connect(RUTA_DB)
    try:
        return pd.read_sql(sql, con, params=params)
    finally:
        con.close()


def instante(bruto):
    # El instante puede venir como texto de fecha o como número.
    try:
        v = float(bruto)
        return pd.Timestamp(v, unit="ms" if v > 1e11 else "s", tz="UTC")
    except (TypeError, ValueError):
        t = pd.Timestamp(bruto)
        return t if t.tzinfo is not None else t.tz_localize("UTC")


def pedir(url):
    # Pide datos a OpenF1; si hay límite de uso (429), espera y reintenta.
    for _ in range(8):
        r = requests.get(url, timeout=90)
        if r.status_code == 429:
            time.sleep(5)
            continue
        if r.status_code == 404:
            return []
        r.raise_for_status()
        return r.json()
    raise HTTPException(status_code=429, detail="OpenF1 pide esperar, intenta de nuevo en un momento")


@router.get("/pista/{circuito}")
def pista(circuito: str):
    df = leer("SELECT x, y FROM pistas WHERE circuit_short_name = ? ORDER BY idx", (circuito,))
    if df.empty:
        raise HTTPException(status_code=404, detail="Sin trazado para este circuito")
    return {"x": df["x"].tolist(), "y": df["y"].tolist()}


def construir_mapa(session_key):
    vt = leer(
        "SELECT vuelta, t FROM replay_vueltas WHERE session_key = ? ORDER BY vuelta", (session_key,)
    )
    if vt.empty:
        raise HTTPException(status_code=404, detail="Esta carrera no tiene replay")
    tvs = {int(v): instante(t) for v, t in zip(vt["vuelta"], vt["t"])}

    # La carrera parte cuando empieza la vuelta 1 del primer auto.
    ini = leer(
        "SELECT MIN(date_start) AS d FROM vueltas WHERE session_key = ? AND lap_number = 1",
        (session_key,),
    ).iloc[0]["d"]
    if ini is None or pd.isna(ini):
        t0 = min(tvs.values()) - pd.Timedelta(seconds=100)
    else:
        t0 = instante(ini)
    t0 = t0 - pd.Timedelta(seconds=3)

    fin = max(tvs.values())
    total = (fin - t0).total_seconds()
    grilla = np.arange(0, total + PASO, PASO)

    partes = []
    desde = 0.0
    while desde < total:
        a = t0 + pd.Timedelta(seconds=desde)
        b = t0 + pd.Timedelta(seconds=min(desde + BLOQUE, total) + 1)
        url = (
            f"{BASE}/location?session_key={session_key}"
            f"&date>={quote(a.isoformat())}&date<={quote(b.isoformat())}"
        )
        datos = pedir(url)
        if datos:
            partes.append(pd.DataFrame(datos)[["driver_number", "date", "x", "y"]])
        desde += BLOQUE
        time.sleep(0.4)

    if not partes:
        raise HTTPException(status_code=404, detail="OpenF1 no trae posiciones de esta carrera")

    df = pd.concat(partes).drop_duplicates(["driver_number", "date"])
    df = df[(df["x"] != 0) | (df["y"] != 0)].copy()
    df["seg"] = (pd.to_datetime(df["date"], utc=True, format="ISO8601") - t0).dt.total_seconds()

    # Cada piloto se lleva a una grilla regular de tiempo.
    pilotos = {}
    for num, g in df.groupby("driver_number"):
        g = g.sort_values("seg")
        if len(g) < 50:
            continue
        pilotos[str(int(num))] = {
            "x": np.rint(np.interp(grilla, g["seg"], g["x"])).astype(int).tolist(),
            "y": np.rint(np.interp(grilla, g["seg"], g["y"])).astype(int).tolist(),
        }

    tv = {str(v): round((t - t0).total_seconds(), 2) for v, t in tvs.items()}
    return {"paso": PASO, "n": len(grilla), "tv": tv, "pilotos": pilotos}


@router.get("/mapa/{session_key}")
def mapa(session_key: int):
    archivo = CARPETA / f"{session_key}.json"
    with candado(session_key):
        if archivo.exists():
            return json.loads(archivo.read_text())
        datos = construir_mapa(session_key)
        archivo.write_text(json.dumps(datos))
        return datos