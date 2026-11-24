# Revisa si las posiciones de la vuelta 1 son coherentes con la parrilla.
import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
con = sqlite3.connect(RUTA_DB)
pd.set_option("display.width", 170)

est = pd.read_sql("SELECT session_key, driver_number, pos_largada, year, circuit_short_name FROM estrategias", con)
est["pos_largada"] = pd.to_numeric(est["pos_largada"], errors="coerce")
cla = pd.read_sql("SELECT session_key, driver_number, position AS quali FROM clasificacion", con).drop_duplicates(["session_key", "driver_number"])
drv = pd.read_sql("SELECT session_key, driver_number, name_acronym FROM drivers", con).drop_duplicates(["session_key", "driver_number"])
rp = pd.read_sql("SELECT session_key, vuelta, driver_number, posicion, fuera FROM replay_pilotos WHERE vuelta <= 6", con)
for c in ["vuelta", "posicion", "fuera"]:
    rp[c] = pd.to_numeric(rp[c], errors="coerce")

# --- Las Vegas 2026: parrilla, clasificación y posiciones vuelta a vuelta ---
lv = est[(est["circuit_short_name"] == "Las Vegas") & (est["year"] == 2026)]
sk = int(lv["session_key"].iloc[0])
piv = rp[rp["session_key"] == sk].pivot_table(index="driver_number", columns="vuelta", values="posicion", aggfunc="first")
piv.columns = [f"v{int(c)}" for c in piv.columns]
t = lv.merge(cla, on=["session_key", "driver_number"], how="left").merge(drv, on=["session_key", "driver_number"], how="left")
t = t.merge(piv.reset_index(), on="driver_number", how="left").sort_values("pos_largada")
print("Las Vegas 2026 (pos_largada = parrilla de la base, quali = clasificación, v1..v6 = posición al final de cada vuelta):")
print(t[["name_acronym", "pos_largada", "quali"] + [c for c in t.columns if c.startswith("v") and c[1:].isdigit()]].to_string(index=False))

# --- Global: distancia entre la parrilla y la posición de cada vuelta ---
d = rp.merge(est[["session_key", "driver_number", "pos_largada", "year"]], on=["session_key", "driver_number"])
d = d[(d["fuera"] == 0) & d["posicion"].notna() & d["pos_largada"].notna()]
d["dif"] = (d["posicion"] - d["pos_largada"]).abs()
print("\nDiferencia absoluta media entre la parrilla y la posición en cada vuelta (todas las carreras):")
print(d.groupby("vuelta")["dif"].mean().round(2).to_string())
print("\nVuelta 1: % de pilotos con diferencia >= 6 posiciones, por año:")
v1 = d[d["vuelta"] == 1]
print((v1.assign(g=v1["dif"] >= 6).groupby("year")["g"].mean() * 100).round(1).to_string())

# --- Parrilla de la base vs clasificación ---
x = est.merge(cla, on=["session_key", "driver_number"], how="inner").dropna(subset=["pos_largada", "quali"])
print(f"\nParrilla = clasificación en {(x['pos_largada'] == x['quali']).mean() * 100:.1f} % de los casos ({len(x)} pilotos-carrera)")

con.close()