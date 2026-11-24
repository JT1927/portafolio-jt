# Clasifica cada parada según el reglamento deportivo de la FIA (Sección B, 2026):
#  - B6.3.6: en carrera seca hay que usar al menos 2 especificaciones distintas de neumático seco
#    (salvo que se usen intermedios o lluvia). Eso obliga a 1 parada como mínimo.
#  - Reglas especiales: Mónaco 2025 (mínimo 2 paradas) y Lusail 2023 y 2025 (límite de vueltas por set).
# Antes de clasificar, limpia los stints de OpenF1:
#  1. separa los stints vacíos (largo 0): se conservan solo si el compuesto cambia respecto al siguiente
#     (cambio bajo bandera roja en la vuelta 1 o salida desde boxes con otro compuesto); si no, se borran
#  2. quita duplicados (mismo piloto y misma vuelta de inicio)
#  3. fusiona stints del mismo juego de neumáticos (mismo compuesto y edad inicial continua)
# Cada parada queda como:
#  - clima: cambio que involucra intermedios o lluvia
#  - obligatoria: la exige el reglamento (se asignan primero las hechas en bandera verde)
#  - libre: parada en bandera verde más allá del mínimo = estrategia real
#  - reactiva: bajo Safety Car, VSC, bandera roja o en la vuelta 1
# El contexto se decide por la HORA de la parada. Requiere haber corrido antes corregir_estado.py.
import math
import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
MOJADO = {"INTERMEDIATE", "WET"}
TOL_EDAD = 1  # tolerancia (en vueltas) al comparar la edad del neumático entre stints

con = sqlite3.connect(RUTA_DB)

carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)

rv = pd.read_sql("SELECT session_key, vuelta, estado FROM replay_vueltas", con)
total_vueltas = rv.groupby("session_key")["vuelta"].max()
estados_vuelta = {
    (int(r.session_key), int(r.vuelta)): r.estado
    for r in rv.itertuples()
    if r.estado in ("SC", "VSC", "ROJA")
}

vb = pd.read_sql("SELECT session_key, tipo, inicio, fin FROM ventanas_bandera", con)
vb["inicio"] = pd.to_datetime(vb["inicio"], utc=True, format="ISO8601")
vb["fin"] = pd.to_datetime(vb["fin"], utc=True, format="ISO8601")
ventanas = {
    int(sk): list(zip(g["tipo"], g["inicio"], g["fin"])) for sk, g in vb.groupby("session_key")
}

laps = pd.read_sql("SELECT session_key, driver_number, lap_number, date_start FROM vueltas", con)
laps["lap_number"] = pd.to_numeric(laps["lap_number"], errors="coerce")
laps["inicio"] = pd.to_datetime(laps["date_start"], utc=True, format="ISO8601", errors="coerce")
laps = laps.dropna(subset=["lap_number", "inicio"])
inicio_vuelta = {
    (int(s), int(d), int(n)): t
    for s, d, n, t in zip(laps["session_key"], laps["driver_number"], laps["lap_number"], laps["inicio"])
}

# ---------- 0. Limpieza de stints ----------
stints_crudos = pd.read_sql(
    "SELECT session_key, driver_number, stint_number, lap_start, lap_end, compound, tyre_age_at_start FROM stints",
    con,
)
for col in ["stint_number", "lap_start", "lap_end", "tyre_age_at_start"]:
    stints_crudos[col] = pd.to_numeric(stints_crudos[col], errors="coerce")


def es_vacio(f):
    return pd.notna(f["lap_start"]) and pd.notna(f["lap_end"]) and f["lap_end"] < f["lap_start"]


def limpiar_stints(df):
    salida = []
    cuenta = {"vacios_borrados": 0, "vacios_conservados": 0, "duplicados": 0, "fusionados": 0}
    for (sk, dn), g in df.groupby(["session_key", "driver_number"]):
        filas = g.sort_values(["lap_start", "stint_number"]).to_dict("records")
        vacios = [f for f in filas if es_vacio(f)]
        reales = [f for f in filas if not es_vacio(f)]

        sin_dup = []
        for f in reales:
            if sin_dup and f["lap_start"] == sin_dup[-1]["lap_start"]:
                cuenta["duplicados"] += 1
                fin_nuevo = f["lap_end"] if pd.notna(f["lap_end"]) else 0
                fin_viejo = sin_dup[-1]["lap_end"] if pd.notna(sin_dup[-1]["lap_end"]) else 0
                if fin_nuevo > fin_viejo:
                    sin_dup[-1] = f
                continue
            sin_dup.append(f)

        fusionados = []
        for f in sin_dup:
            if fusionados:
                a = fusionados[-1]
                if (
                    a["compound"] == f["compound"]
                    and pd.notna(a["tyre_age_at_start"])
                    and pd.notna(f["tyre_age_at_start"])
                    and pd.notna(a["lap_start"])
                    and pd.notna(a["lap_end"])
                ):
                    esperado = a["tyre_age_at_start"] + (a["lap_end"] - a["lap_start"] + 1)
                    if abs(f["tyre_age_at_start"] - esperado) <= TOL_EDAD:
                        a["lap_end"] = f["lap_end"]
                        cuenta["fusionados"] += 1
                        continue
            fusionados.append(dict(f))

        # Stints vacíos: se conservan solo si el compuesto cambia respecto al stint que sigue
        for v in vacios:
            pos = next((i for i, f in enumerate(fusionados) if f["lap_start"] >= v["lap_start"]), None)
            if pos is not None and fusionados[pos]["compound"] != v["compound"]:
                fusionados.insert(pos, dict(v))
                cuenta["vacios_conservados"] += 1
            else:
                cuenta["vacios_borrados"] += 1

        for i, f in enumerate(fusionados, 1):
            f["stint_number"] = i
            salida.append(f)
    return pd.DataFrame(salida), cuenta


stints_limpios, cuenta = limpiar_stints(stints_crudos)
stints_limpios.to_sql("stints_limpios", con, if_exists="replace", index=False)
print(f"Stints crudos: {len(stints_crudos)} -> limpios: {len(stints_limpios)}")
print(
    f"  vacíos borrados: {cuenta['vacios_borrados']} | vacíos conservados (cambio de compuesto): "
    f"{cuenta['vacios_conservados']} | duplicados quitados: {cuenta['duplicados']} | fusionados: {cuenta['fusionados']}"
)

# ---------- 1. Reglas por carrera ----------
LIMITE_VUELTAS = {("Lusail", 2023): 18, ("Lusail", 2025): 25}

reglas = []
for c in carreras.itertuples():
    total = int(total_vueltas.get(c.session_key, 0))
    minimas, especial, limite = 1, False, None
    nota = "Regla general: 2 especificaciones secas (B6.3.6)"

    if c.circuit_short_name == "Monte Carlo" and c.year == 2025:
        minimas, especial = 2, True
        nota = "Mónaco 2025: mínimo 3 sets de neumáticos (2 paradas), también con lluvia"

    limite = LIMITE_VUELTAS.get((c.circuit_short_name, c.year))
    if limite and total:
        minimas = max(minimas, math.ceil(total / limite) - 1)
        especial = True
        nota = f"Límite de {limite} vueltas por set de neumáticos"

    reglas.append(
        {
            "session_key": int(c.session_key),
            "circuit_short_name": c.circuit_short_name,
            "year": int(c.year),
            "total_vueltas": total,
            "paradas_minimas": minimas,
            "regla_especial": int(especial),
            "limite_vueltas_set": limite,
            "nota": nota,
        }
    )
reglas_df = pd.DataFrame(reglas)
reglas_dict = {int(r["session_key"]): r for r in reglas}

# ---------- 2. Paradas de cada piloto ----------
stints = stints_limpios[stints_limpios["session_key"].isin(reglas_dict)]


def contexto(sk, dn, vuelta):
    if vuelta <= 1:
        return "vuelta1"
    hora = inicio_vuelta.get((sk, dn, vuelta + 1))
    if hora is None:
        return estados_vuelta.get((sk, vuelta), "verde")
    tipos = {tipo for tipo, ini, fin in ventanas.get(sk, []) if ini <= hora <= fin}
    for tipo in ("ROJA", "SC", "VSC"):
        if tipo in tipos:
            return tipo
    return "verde"


filas_paradas = []
filas_resumen = []

for (sk, dn), g in stints.groupby(["session_key", "driver_number"]):
    sk, dn = int(sk), int(dn)
    g = g.sort_values("stint_number").reset_index(drop=True)
    r = reglas_dict[sk]

    compuestos = set(g["compound"].dropna())
    usa_mojado = bool(compuestos & MOJADO)
    secos = compuestos - MOJADO
    n_min = r["paradas_minimas"] if (r["regla_especial"] or not usa_mojado) else 0

    paradas = []
    for i in range(len(g) - 1):
        vuelta = g.loc[i, "lap_end"]
        if pd.isna(vuelta):
            vuelta = g.loc[i + 1, "lap_start"] - 1
        if pd.isna(vuelta):
            continue
        vuelta = int(vuelta)
        clima = (g.loc[i, "compound"] in MOJADO) or (g.loc[i + 1, "compound"] in MOJADO)
        paradas.append(
            {
                "session_key": sk,
                "driver_number": dn,
                "parada_n": i + 1,
                "vuelta": vuelta,
                "compuesto_sale": g.loc[i, "compound"],
                "compuesto_entra": g.loc[i + 1, "compound"],
                "contexto": contexto(sk, dn, vuelta),
                "cambio_clima": int(clima),
            }
        )

    for p in paradas:
        if p["cambio_clima"]:
            p["rol"] = "clima"

    secas = [p for p in paradas if not p["cambio_clima"]]
    verdes = [p for p in secas if p["contexto"] == "verde"]
    reactivas = [p for p in secas if p["contexto"] != "verde"]

    oblig_verdes = min(len(verdes), n_min)
    for k, p in enumerate(verdes):
        p["rol"] = "obligatoria" if k < oblig_verdes else "libre"
    faltan = n_min - oblig_verdes
    for k, p in enumerate(reactivas):
        p["rol"] = "obligatoria" if k < faltan else "reactiva"

    filas_paradas.extend(paradas)
    filas_resumen.append(
        {
            "session_key": sk,
            "driver_number": dn,
            "usa_mojado": int(usa_mojado),
            "n_compuestos_secos": len(secos),
            "paradas_minimas": n_min,
            "paradas_total": len(paradas),
            "paradas_clima": sum(p["rol"] == "clima" for p in paradas),
            "paradas_obligatorias": sum(p["rol"] == "obligatoria" for p in paradas),
            "paradas_libres": sum(p["rol"] == "libre" for p in paradas),
            "paradas_reactivas": sum(p["rol"] == "reactiva" for p in paradas),
            "cumple_regla": int(usa_mojado or len(secos) >= 2),
        }
    )

paradas_df = pd.DataFrame(filas_paradas)
resumen = pd.DataFrame(filas_resumen)

reglas_df.to_sql("reglas_carrera", con, if_exists="replace", index=False)
paradas_df.to_sql("paradas", con, if_exists="replace", index=False)
resumen.to_sql("paradas_resumen", con, if_exists="replace", index=False)

# ---------- 3. Validaciones ----------
pd.set_option("display.width", 160)
est = pd.read_sql("SELECT session_key, driver_number, dnf, dns FROM estrategias", con)
res = resumen.merge(carreras[["session_key", "circuit_short_name", "year"]], on="session_key").merge(
    est, on=["session_key", "driver_number"], how="left"
)

print(f"\nParadas clasificadas: {len(paradas_df)} en {len(resumen)} pilotos-carrera")
print("\nRol de las paradas:")
print((paradas_df["rol"].value_counts(normalize=True) * 100).round(1).astype(str) + " %")
print("\nContexto de las paradas:")
print((paradas_df["contexto"].value_counts(normalize=True) * 100).round(1).astype(str) + " %")

print("\nPor año (paradas por piloto):")
columnas = ["paradas_total", "paradas_clima", "paradas_obligatorias", "paradas_libres", "paradas_reactivas"]
print(res.groupby("year")[columnas].mean().round(2))

por_carrera = res.groupby(["year", "circuit_short_name"]).agg(
    paradas=("paradas_total", "mean"),
    clima=("paradas_clima", "mean"),
    libres=("paradas_libres", "mean"),
    reactivas=("paradas_reactivas", "mean"),
    pilotos=("driver_number", "count"),
)
print("\nCarreras con más paradas por piloto (top 10):")
print(por_carrera.sort_values("paradas", ascending=False).head(10).round(2))

print("\nMónaco y Lusail:")
print(por_carrera.loc[por_carrera.index.get_level_values(1).isin(["Monte Carlo", "Lusail"])].round(2))

incumplen = res[(res["cumple_regla"] == 0) & (res["dnf"] == 0) & (res["dns"] == 0)]
print(f"\nPilotos que terminaron con un solo compuesto seco y sin lluvia: {len(incumplen)}")
if len(incumplen):
    print(incumplen[["year", "circuit_short_name", "driver_number", "n_compuestos_secos"]].to_string(index=False))

# Stints cortos (1-2 vueltas) que siguen apareciendo después de limpiar
largo = stints_limpios["lap_end"] - stints_limpios["lap_start"] + 1
quedan = stints_limpios[(largo >= 1) & (largo <= 2)].merge(
    carreras[["session_key", "circuit_short_name", "year"]], on="session_key"
)
print(f"\nStints de 1 a 2 vueltas que quedan: {len(quedan)} de {len(stints_limpios)}")
print(quedan.groupby(["year", "circuit_short_name"]).size().sort_values(ascending=False).head(8))

con.close()