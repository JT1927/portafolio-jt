# Diagnóstico de paradas sospechosas: stints cortos/duplicados y distribución de paradas por vuelta.
import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
CASOS = [("Montreal", 2025), ("Monte Carlo", 2026), ("Lusail", 2024)]

pd.set_option("display.width", 160)
pd.set_option("display.max_rows", 200)

con = sqlite3.connect(RUTA_DB)
carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)

stints = pd.read_sql(
    "SELECT session_key, driver_number, stint_number, lap_start, lap_end, compound FROM stints", con
)
for c in ["stint_number", "lap_start", "lap_end"]:
    stints[c] = pd.to_numeric(stints[c], errors="coerce")
stints["largo"] = stints["lap_end"] - stints["lap_start"] + 1
paradas = pd.read_sql("SELECT * FROM paradas", con)
vb = pd.read_sql("SELECT * FROM ventanas_bandera", con)

# 1. Stints de 3 vueltas o menos por carrera (posibles fragmentos)
cortos = stints[stints["largo"] <= 3].groupby("session_key").size().rename("stints_cortos")
tot = stints.groupby(["session_key", "driver_number"]).size().groupby("session_key").size().rename("pilotos")
r = carreras.join(cortos, on="session_key").join(tot, on="session_key").fillna({"stints_cortos": 0})
r["cortos_por_piloto"] = (r["stints_cortos"] / r["pilotos"]).round(2)
print("Carreras con más stints cortos (<=3 vueltas) por piloto:")
print(r.sort_values("cortos_por_piloto", ascending=False).head(10)[["year", "circuit_short_name", "stints_cortos", "pilotos", "cortos_por_piloto"]].to_string(index=False))

# 2. Stints duplicados (mismo piloto, misma vuelta de inicio)
dup = stints.duplicated(["session_key", "driver_number", "lap_start"], keep=False)
print(f"\nStints con lap_start repetido para el mismo piloto: {int(dup.sum())}")
if dup.any():
    print(stints[dup].merge(carreras[["session_key", "circuit_short_name", "year"]], on="session_key")
          .groupby(["year", "circuit_short_name"]).size().sort_values(ascending=False).head(10))

# 3. Detalle por caso
for circuito, anio in CASOS:
    fila = carreras[(carreras["circuit_short_name"] == circuito) & (carreras["year"] == anio)]
    if fila.empty:
        continue
    sk = int(fila.iloc[0]["session_key"])
    print(f"\n==================== {circuito} {anio} ====================")
    print("Ventanas de bandera:")
    print(vb[vb["session_key"] == sk][["tipo", "inicio", "fin"]].to_string(index=False))
    p = paradas[paradas["session_key"] == sk]
    print("\nParadas por vuelta y contexto:")
    print(p.groupby(["vuelta", "contexto"]).size().reset_index(name="n").to_string(index=False))
    top = p.groupby("driver_number").size().sort_values(ascending=False).head(3).index
    for dn in top:
        print(f"\nStints del piloto {dn}:")
        print(stints[(stints["session_key"] == sk) & (stints["driver_number"] == dn)]
              .sort_values("stint_number")[["stint_number", "lap_start", "lap_end", "largo", "compound"]]
              .to_string(index=False))

con.close()