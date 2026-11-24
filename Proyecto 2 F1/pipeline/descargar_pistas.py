# Descarga el trazado de cada circuito desde OpenF1.
# Toma la última carrera de cada circuito, la vuelta más rápida limpia del ganador,
# y guarda sus puntos (x, y) en la tabla "pistas".
import sqlite3
import time
from pathlib import Path
from urllib.parse import quote

import pandas as pd
import requests

BASE = "https://api.openf1.org/v1"
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"


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


con = sqlite3.connect(RUTA_DB)

# Circuitos que ya están guardados (así se puede repetir el script sin empezar de cero).
try:
    hechos = set(pd.read_sql("SELECT DISTINCT circuit_short_name AS c FROM pistas", con)["c"])
except Exception:
    hechos = set()

carreras = pd.read_sql(
    "SELECT session_key, circuit_short_name, date_start FROM carreras ORDER BY date_start", con
)
ultima = carreras.groupby("circuit_short_name").tail(1)  # la carrera más reciente de cada circuito
print(f"{len(ultima)} circuitos, {len(hechos)} ya descargados\n")

fallidos = []
for _, c in ultima.iterrows():
    nombre = c["circuit_short_name"]
    sk = int(c["session_key"])
    if nombre in hechos:
        continue

    # Piloto ganador de esa carrera.
    g = pd.read_sql(
        "SELECT driver_number FROM estrategias WHERE session_key = ? AND pos_final = 1", con, params=(sk,)
    )
    if g.empty:
        print(f"{nombre}: sin ganador, salto")
        fallidos.append(nombre)
        continue
    piloto = int(g.iloc[0]["driver_number"])

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
    if v.empty:
        print(f"{nombre}: sin vuelta limpia, salto")
        fallidos.append(nombre)
        continue
    vuelta = v.sort_values("lap_duration").iloc[0]

    inicio = pd.Timestamp(vuelta["date_start"])
    fin = inicio + pd.Timedelta(seconds=float(vuelta["lap_duration"]))
    url = (
        f"{BASE}/location?session_key={sk}&driver_number={piloto}"
        f"&date>={quote(inicio.isoformat())}&date<={quote(fin.isoformat())}"
    )
    datos = pedir(url)
    if not datos:
        print(f"{nombre}: OpenF1 no trae posiciones, salto")
        fallidos.append(nombre)
        continue

    df = pd.DataFrame(datos)[["x", "y"]]
    df = df[(df["x"] != 0) | (df["y"] != 0)].reset_index(drop=True)
    df.insert(0, "idx", range(len(df)))
    df.insert(0, "vuelta", int(vuelta["lap_number"]))
    df.insert(0, "driver_number", piloto)
    df.insert(0, "session_key", sk)
    df.insert(0, "circuit_short_name", nombre)
    df.to_sql("pistas", con, if_exists="append", index=False)
    print(f"{nombre}: {len(df)} puntos (carrera {sk}, piloto {piloto}, vuelta {int(vuelta['lap_number'])})")
    time.sleep(0.6)

con.commit()

total = pd.read_sql("SELECT circuit_short_name, COUNT(*) AS puntos FROM pistas GROUP BY 1", con)
print(f"\nPistas guardadas: {len(total)} de {len(ultima)}")
if fallidos:
    print("Sin trazado:", ", ".join(fallidos))
con.close()