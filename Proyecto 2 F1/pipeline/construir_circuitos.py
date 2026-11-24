# Construye las características físicas y operativas de cada circuito/carrera.
# Tablas de salida: circuitos_carrera (una fila por carrera) y circuitos (resumen por circuito).
# Requiere haber corrido corregir_estado.py y clasificar_paradas.py (usa ventanas_bandera, stints_limpios, paradas_resumen).
#
# Supuestos (se declaran en el README):
#  - Largo de pista: se mide sobre el trazado de la tabla pistas; x,y se asumen en decímetros (1/10 m).
#  - Tiempo en pit lane: mediana de lane_duration en paradas hechas en bandera verde (no es la pérdida exacta).
#  - Degradación: pendiente (s/vuelta) del tiempo de vuelta contra la edad del neumático, dentro de cada stint,
#    con corrección de combustible fija de FUEL s por vuelta transcurrida. Solo neumáticos secos.
#  - Dificultad de adelantar: la clasificación se usa como proxy de la parrilla (no hay sanciones de parrilla).
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
FUEL = 0.03          # segundos que se aligera el auto por vuelta (supuesto)
MIN_VUELTAS = 8      # vueltas limpias mínimas por stint para estimar degradación
MOJADO = {"INTERMEDIATE", "WET"}

con = sqlite3.connect(RUTA_DB)
pd.set_option("display.width", 170)
pd.set_option("display.max_rows", 200)

carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)

vb = pd.read_sql("SELECT session_key, tipo, inicio, fin FROM ventanas_bandera", con)
vb["inicio"] = pd.to_datetime(vb["inicio"], utc=True, format="ISO8601")
vb["fin"] = pd.to_datetime(vb["fin"], utc=True, format="ISO8601")
ventanas = {int(sk): list(zip(g["inicio"], g["fin"])) for sk, g in vb.groupby("session_key")}

# ---------- 1. Largo de pista ----------
pistas = pd.read_sql("SELECT circuit_short_name, session_key, driver_number, vuelta, idx, x, y FROM pistas", con)
pistas = pistas.dropna(subset=["x", "y"])
longitudes = {}
for circ, g in pistas.groupby("circuit_short_name"):
    clave = g.groupby(["session_key", "driver_number", "vuelta"]).size().idxmax()
    t = g[(g["session_key"] == clave[0]) & (g["driver_number"] == clave[1]) & (g["vuelta"] == clave[2])]
    xy = t.sort_values("idx")[["x", "y"]].to_numpy(float)
    xy = np.vstack([xy, xy[:1]])  # cierra el circuito
    longitudes[circ] = float(np.sqrt((np.diff(xy, axis=0) ** 2).sum(axis=1)).sum() / 10 / 1000)

# ---------- 2. Tiempo en pit lane (paradas en bandera verde) ----------
pits = pd.read_sql("SELECT session_key, driver_number, date, lane_duration, pit_duration FROM pits", con)
pits["fecha"] = pd.to_datetime(pits["date"], utc=True, format="ISO8601", errors="coerce")
lane = pd.to_numeric(pits["lane_duration"], errors="coerce")
pits["t_pit"] = lane.fillna(pd.to_numeric(pits["pit_duration"], errors="coerce"))
pits = pits.dropna(subset=["fecha", "t_pit"])
pits = pits[(pits["t_pit"] > 8) & (pits["t_pit"] < 120)]

pit_lane = {}
for sk, g in pits.groupby("session_key"):
    mascara = pd.Series(False, index=g.index)
    for ini, fin in ventanas.get(int(sk), []):
        mascara |= (g["fecha"] >= ini) & (g["fecha"] <= fin)
    verdes = g.loc[~mascara, "t_pit"]
    pit_lane[int(sk)] = float(verdes.median()) if len(verdes) >= 5 else np.nan

# ---------- 3. Degradación por edad del neumático ----------
lap = pd.read_sql(
    "SELECT session_key, driver_number, lap_number, date_start, lap_duration, is_pit_out_lap FROM vueltas", con
)
lap["lap_number"] = pd.to_numeric(lap["lap_number"], errors="coerce")
lap["lap_duration"] = pd.to_numeric(lap["lap_duration"], errors="coerce")
lap["inicio"] = pd.to_datetime(lap["date_start"], utc=True, format="ISO8601", errors="coerce")
lap["is_pit_out_lap"] = lap["is_pit_out_lap"].astype(str).str.lower().isin(["true", "1", "1.0"])
lap = lap.dropna(subset=["lap_number", "lap_duration", "inicio"])

bandera = pd.Series(False, index=lap.index)
fin_vuelta = lap["inicio"] + pd.to_timedelta(lap["lap_duration"], unit="s")
for sk, idx in lap.groupby("session_key").groups.items():
    for ini, fin in ventanas.get(int(sk), []):
        bandera.loc[idx] |= (lap.loc[idx, "inicio"] <= fin) & (fin_vuelta.loc[idx] >= ini)
lap["bandera"] = bandera
lap_por_piloto = {(int(s), int(d)): g for (s, d), g in lap.groupby(["session_key", "driver_number"])}

stints_l = pd.read_sql("SELECT * FROM stints_limpios", con)
filas_deg = []
for (sk, dn), g in stints_l.groupby(["session_key", "driver_number"]):
    vl = lap_por_piloto.get((int(sk), int(dn)))
    if vl is None:
        continue
    for s in g.itertuples():
        if s.compound in MOJADO or pd.isna(s.compound):
            continue
        if pd.isna(s.lap_start) or pd.isna(s.lap_end) or pd.isna(s.tyre_age_at_start):
            continue
        t = vl[(vl["lap_number"] >= s.lap_start) & (vl["lap_number"] <= s.lap_end)]
        t = t[(t["lap_number"] > 1) & (~t["is_pit_out_lap"]) & (~t["bandera"]) & (t["lap_number"] != s.lap_end)]
        if s.stint_number > 1:
            t = t[t["lap_number"] != s.lap_start]
        if len(t) < MIN_VUELTAS:
            continue
        t = t[t["lap_duration"] <= 1.07 * t["lap_duration"].median()]
        if len(t) < MIN_VUELTAS:
            continue
        edad = (s.tyre_age_at_start + (t["lap_number"] - s.lap_start)).to_numpy(float)
        ajustado = (t["lap_duration"] + FUEL * t["lap_number"]).to_numpy(float)
        pendiente = float(np.polyfit(edad, ajustado, 1)[0])
        filas_deg.append(
            {"session_key": int(sk), "driver_number": int(dn), "compound": s.compound, "pendiente": pendiente, "n": len(t)}
        )

deg = pd.DataFrame(filas_deg)
deg_carrera = deg.groupby("session_key")["pendiente"].median().rename("degradacion_s_por_vuelta")
deg_comp = (
    deg.groupby(["session_key", "compound"])
    .filter(lambda x: len(x) >= 3)
    .groupby(["session_key", "compound"])["pendiente"]
    .median()
    .unstack()
)
deg_comp.columns = [f"deg_{c.lower()}" for c in deg_comp.columns]

# ---------- 4. Dificultad de adelantar (clasificación vs resultado) ----------
res = pd.read_sql("SELECT session_key, driver_number, position, dnf, dns, dsq FROM resultado", con)
cla = pd.read_sql("SELECT session_key, driver_number, position AS grid FROM clasificacion", con)
m = res.merge(cla, on=["session_key", "driver_number"])
for c in ["position", "grid"]:
    m[c] = pd.to_numeric(m[c], errors="coerce")
for c in ["dnf", "dns", "dsq"]:
    m[c] = pd.to_numeric(m[c], errors="coerce").fillna(0)
m = m[(m["dnf"] == 0) & (m["dns"] == 0) & (m["dsq"] == 0)].dropna(subset=["position", "grid"])

filas_pos = []
for sk, g in m.groupby("session_key"):
    if len(g) < 8:
        continue
    filas_pos.append(
        {
            "session_key": int(sk),
            "spearman_grid_final": float(g["grid"].rank().corr(g["position"].rank())),
            "cambio_posiciones_medio": float((g["grid"] - g["position"]).abs().mean()),
        }
    )
pos = pd.DataFrame(filas_pos).set_index("session_key")

# ---------- 5. Clima, banderas y paradas ----------
clima = pd.read_sql("SELECT session_key, rainfall, track_temperature FROM clima", con)
clima["rainfall"] = pd.to_numeric(clima["rainfall"], errors="coerce").fillna(0)
clima["track_temperature"] = pd.to_numeric(clima["track_temperature"], errors="coerce")
cl = clima.groupby("session_key").agg(
    lluvia_pct=("rainfall", lambda x: float((x > 0).mean() * 100)),
    temp_pista_media=("track_temperature", "mean"),
)

rv = pd.read_sql("SELECT session_key, vuelta, estado FROM replay_vueltas", con)
banderas = rv.groupby("session_key")["estado"].apply(lambda x: float((x != "").mean() * 100)).rename("pct_vueltas_bandera")
n_sc = vb[vb["tipo"].isin(["SC", "VSC"])].groupby("session_key").size().rename("n_sc_vsc")
n_roja = vb[vb["tipo"] == "ROJA"].groupby("session_key").size().rename("n_roja")
total = rv.groupby("session_key")["vuelta"].max().rename("total_vueltas")

pr = pd.read_sql("SELECT * FROM paradas_resumen", con)
par = pr.groupby("session_key").agg(
    paradas_por_piloto=("paradas_total", "mean"),
    libres_por_piloto=("paradas_libres", "mean"),
    reactivas_por_piloto=("paradas_reactivas", "mean"),
)

# ---------- 6. Unir ----------
rc = carreras.set_index("session_key")[["circuit_short_name", "year"]]
rc = rc.join(total).join(banderas).join(n_sc).join(n_roja).join(cl).join(par).join(pos).join(deg_carrera).join(deg_comp)
rc["tiempo_pit_lane_s"] = pd.Series(pit_lane)
rc["longitud_km"] = rc["circuit_short_name"].map(longitudes)
rc[["n_sc_vsc", "n_roja"]] = rc[["n_sc_vsc", "n_roja"]].fillna(0)
rc["seca"] = (rc["lluvia_pct"] < 5).astype(int)
rc = rc.reset_index()
rc.to_sql("circuitos_carrera", con, if_exists="replace", index=False)


def med_seca(g, col):
    s = g.loc[g["seca"] == 1, col].dropna()
    if s.empty:
        s = g[col].dropna()
    return float(s.median()) if len(s) else np.nan


filas = []
for circ, g in rc.groupby("circuit_short_name"):
    filas.append(
        {
            "circuit_short_name": circ,
            "carreras": len(g),
            "longitud_km": longitudes.get(circ, np.nan),
            "tiempo_pit_lane_s": float(g["tiempo_pit_lane_s"].median()),
            "degradacion_s_por_vuelta": med_seca(g, "degradacion_s_por_vuelta"),
            "spearman_grid_final": float(g["spearman_grid_final"].median()),
            "cambio_posiciones_medio": float(g["cambio_posiciones_medio"].median()),
            "pct_vueltas_bandera": float(g["pct_vueltas_bandera"].median()),
            "temp_pista_media": float(g["temp_pista_media"].median()),
            "paradas_por_piloto": float(g["paradas_por_piloto"].median()),
            "libres_por_piloto": float(g["libres_por_piloto"].median()),
        }
    )
circ_df = pd.DataFrame(filas)
circ_df.to_sql("circuitos", con, if_exists="replace", index=False)

# ---------- 7. Validación ----------
print(f"circuitos_carrera: {len(rc)} carreras | circuitos: {len(circ_df)}")
print("\nCircuitos (ordenados por largo):")
print(circ_df.sort_values("longitud_km").round(2).to_string(index=False))
print("\nDegradación por compuesto (mediana de carreras, s/vuelta):")
print(rc[[c for c in rc.columns if c.startswith("deg_")]].median().round(3).to_string())
print(f"\nStints usados para degradación: {len(deg)} | carreras con degradación: {deg['session_key'].nunique()}")
print(f"Carreras con tiempo pit lane: {rc['tiempo_pit_lane_s'].notna().sum()} de {len(rc)}")
print(f"Carreras con spearman: {rc['spearman_grid_final'].notna().sum()} de {len(rc)}")

con.close()