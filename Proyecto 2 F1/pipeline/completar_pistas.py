# Completa los circuitos que quedaron sin trazado.
# Prueba carreras más antiguas del mismo circuito y varios pilotos, hasta encontrar posiciones.
import sqlite3
import time
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import requests

BASE = "https://api.openf1.org/v1"
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
FALTAN = ["Sakhir", "Jeddah", "Monte Carlo"]


def pedir(url):
    # Pide datos a OpenF1; si hay límite de uso (429), espera y reintenta.
    for _ in range(6):
        r = requests.get(url, timeout=60)
        if r.status_code == 429:
            print("  límite de OpenF1, espero 20 s...")
            time.sleep(20)
            continue
        if r.status_code == 404:
            return []
        r.raise_for_status()
        return r.json()
    return []


def vuelta_limpia(con, sk, piloto):
    # Vuelta más rápida entre la 3 y la 15, sin salida de boxes.
    v = pd.read_sql(
        "SELECT lap_number, date_start, lap_duration, is_pit_out_lap FROM vueltas "
        "WHERE session_key = ? AND driver_number = ?",
        con,
        params=(sk, piloto),
    )
    v["lap_duration"] = pd.to_numeric(v["lap_duration"], errors="coerce")
    v["lap_number"] = pd.to_numeric(v["lap_number"], errors="coerce")
    v = v[(v["lap_number"] >= 3) & (v["lap_number"] <= 15) & v["lap_duration"].notna()]
    v = v[~v["is_pit_out_lap"].astype(str).isin(["True", "1", "true"])]
    return None if v.empty else v.sort_values("lap_duration").iloc[0]


con = sqlite3.connect(RUTA_DB)

for nombre in FALTAN:
    ya = pd.read_sql("SELECT 1 FROM pistas WHERE circuit_short_name = ? LIMIT 1", con, params=(nombre,))
    if not ya.empty:
        continue

    carreras = pd.read_sql(
        "SELECT session_key FROM carreras WHERE circuit_short_name = ? ORDER BY date_start DESC",
        con,
        params=(nombre,),
    )
    print(f"{nombre}: {len(carreras)} carreras para probar")
    listo = False

    for sk in carreras["session_key"]:
        sk = int(sk)
        pilotos = pd.read_sql(
            "SELECT driver_number FROM estrategias WHERE session_key = ? "
            "ORDER BY pos_final IS NULL, pos_final LIMIT 5",
            con,
            params=(sk,),
        )
        for piloto in pilotos["driver_number"]:
            piloto = int(piloto)
            vuelta = vuelta_limpia(con, sk, piloto)
            if vuelta is None:
                continue
            inicio = pd.Timestamp(vuelta["date_start"])
            fin = inicio + pd.Timedelta(seconds=float(vuelta["lap_duration"]))
            url = (
                f"{BASE}/location?session_key={sk}&driver_number={piloto}"
                f"&date>={quote(inicio.isoformat())}&date<={quote(fin.isoformat())}"
            )
            datos = pedir(url)
            time.sleep(0.6)
            if not datos:
                continue

            df = pd.DataFrame(datos)[["x", "y"]]
            df = df[(df["x"] != 0) | (df["y"] != 0)].reset_index(drop=True)
            if len(df) < 100:
                continue
            df.insert(0, "idx", range(len(df)))
            df.insert(0, "vuelta", int(vuelta["lap_number"]))
            df.insert(0, "driver_number", piloto)
            df.insert(0, "session_key", sk)
            df.insert(0, "circuit_short_name", nombre)
            df.to_sql("pistas", con, if_exists="append", index=False)
            print(f"  OK: {len(df)} puntos (carrera {sk}, piloto {piloto}, vuelta {int(vuelta['lap_number'])})")
            listo = True
            break
        if listo:
            break

    if not listo:
        print("  no hubo forma, queda sin trazado")

con.commit()
total = pd.read_sql("SELECT COUNT(DISTINCT circuit_short_name) AS n FROM pistas", con)
print(f"\nPistas guardadas: {int(total.iloc[0]['n'])} de 26")
con.close()