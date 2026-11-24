# Reemplaza el trazado de un circuito en la tabla pistas usando la vuelta con mejor cobertura de datos.
# Uso: python pipeline\mejorar_pista.py "Mexico City"
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import json
from pathlib import Path

import numpy as np
import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
BASE = "https://api.openf1.org/v1/location"
FRECUENCIA = 3.7        # muestras por segundo (aprox.)
PILOTOS_POR_CARRERA = 3

circuitos = sys.argv[1:] or ["Mexico City"]
con = sqlite3.connect(RUTA_DB)

carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)


def pedir(sk, dn, t0, t1, intentos=8):
    url = (
        f"{BASE}?session_key={sk}&driver_number={dn}"
        f"&date>={urllib.parse.quote(t0, safe='')}&date<{urllib.parse.quote(t1, safe='')}"
    )
    for i in range(intentos):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return []
            if e.code == 429:
                time.sleep(2 * (i + 1))
                continue
            raise
        except Exception:
            time.sleep(2 * (i + 1))
    return []


def largo_km(xy):
    cerrado = np.vstack([xy, xy[:1]])
    return float(np.sqrt((np.diff(cerrado, axis=0) ** 2).sum(axis=1)).sum() / 10 / 1000)


for circ in circuitos:
    print(f"\n=== {circ} ===")
    v = pd.read_sql(
        "SELECT session_key, driver_number, lap_number, date_start, lap_duration, is_pit_out_lap FROM vueltas", con
    )
    v = v.merge(carreras[carreras["circuit_short_name"] == circ][["session_key", "year"]], on="session_key")
    v["lap_duration"] = pd.to_numeric(v["lap_duration"], errors="coerce")
    v["lap_number"] = pd.to_numeric(v["lap_number"], errors="coerce")
    v["salida"] = v["is_pit_out_lap"].astype(str).str.lower().isin(["true", "1", "1.0"])
    v = v[(~v["salida"]) & v["lap_duration"].notna() & (v["lap_number"] > 1)]
    v = v.sort_values("lap_duration")
    mejor = v.groupby(["session_key", "driver_number"]).head(1)
    cand = mejor.groupby("session_key").head(PILOTOS_POR_CARRERA)

    resultados = []
    for r in cand.itertuples():
        t0 = pd.to_datetime(r.date_start, utc=True, format="ISO8601")
        t1 = t0 + pd.Timedelta(seconds=float(r.lap_duration) + 1)
        datos = pedir(int(r.session_key), int(r.driver_number), t0.isoformat(), t1.isoformat())
        time.sleep(0.4)
        if not datos:
            continue
        d = pd.DataFrame(datos)
        d = d[(d["x"] != 0) | (d["y"] != 0)].sort_values("date")
        if len(d) < 50:
            continue
        xy = d[["x", "y"]].to_numpy(float)
        cobertura = len(d) / (float(r.lap_duration) * FRECUENCIA)
        resultados.append(
            {
                "session_key": int(r.session_key),
                "driver_number": int(r.driver_number),
                "vuelta": int(r.lap_number),
                "year": int(r.year),
                "puntos": len(d),
                "cobertura": round(cobertura, 2),
                "largo_km": round(largo_km(xy), 2),
                "xy": xy,
            }
        )

    if not resultados:
        print("Sin datos disponibles.")
        continue
    tabla = pd.DataFrame([{k: v for k, v in x.items() if k != "xy"} for x in resultados])
    print(tabla.sort_values("cobertura", ascending=False).to_string(index=False))

    elegido = max(resultados, key=lambda x: (x["cobertura"], x["largo_km"]))
    print(f"\nElegida: año {elegido['year']}, piloto {elegido['driver_number']}, vuelta {elegido['vuelta']} "
          f"-> cobertura {elegido['cobertura']}, largo {elegido['largo_km']} km")

    con.execute("DELETE FROM pistas WHERE circuit_short_name = ?", (circ,))
    filas = [
        (circ, elegido["session_key"], elegido["driver_number"], elegido["vuelta"], i, float(x), float(y))
        for i, (x, y) in enumerate(elegido["xy"])
    ]
    con.executemany(
        "INSERT INTO pistas (circuit_short_name, session_key, driver_number, vuelta, idx, x, y) VALUES (?,?,?,?,?,?,?)",
        filas,
    )
    con.commit()
    print(f"Trazado reemplazado ({len(filas)} puntos).")

con.close()