# Diagnóstico de carrera: ¿por qué cada piloto ganó o perdió posiciones?
# Para cada par de pilotos que cambia de orden entre dos vueltas se asigna una causa:
#  salida (vuelta 1) | parada_propia | parada_ajena | bandera (SC/VSC/roja) | pista (adelantamiento)
# Un piloto cuenta como "en parada" durante una ventana de vueltas (la vuelta en boxes y las anteriores
# dentro de la ventana), porque la posición cambia una vuelta después. El tamaño de la ventana se elige
# solo: el más corto a partir del cual casi no mejora la cantidad de cambios sin explicación bajo bandera.
# Lo que no se explica con cambios de orden (abandonos de rivales, sanciones posteriores) queda en
# "otros" (pilotos que terminan) o "abandono" (pilotos que se retiran), para que todo cuadre con las
# posiciones ganadas (parrilla - resultado).
# Datos que faltan en la base:
#  - Sin posición final (no clasificados): se estima ordenando por vueltas completadas (final_estimado = 1).
#  - Sin parrilla (largada desde boxes): se ubican al final de la parrilla (grid_estimado = 1).
#  - La parrilla es la clasificación: no incluye sanciones de parrilla ni largadas desde boxes.
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
CAUSAS = ["salida", "parada_propia", "parada_ajena", "pista", "bandera"]
VENTANAS = [0, 1, 2, 3]
MEJORA_MINIMA = 0.15
ETIQ = {
    "salida": "en la salida (incluye sanciones de parrilla y largada desde boxes)",
    "parada_propia": "por sus paradas",
    "parada_ajena": "por paradas de rivales",
    "pista": "en pista",
    "bandera": "bajo bandera (SC/VSC/roja)",
    "otros": "por abandonos de rivales o sanciones",
    "abandono": "por abandonos y ajustes de clasificación",
}

con = sqlite3.connect(RUTA_DB)
pd.set_option("display.width", 170)
pd.set_option("display.max_rows", 100)

est = pd.read_sql(
    "SELECT session_key, driver_number, team_name, pos_largada, pos_final, dnf, dns, n_safety_car, n_vsc, mojada, "
    "year, circuit_short_name FROM estrategias",
    con,
)
for c in ["pos_largada", "pos_final", "dnf", "dns", "n_safety_car", "n_vsc", "mojada", "year"]:
    est[c] = pd.to_numeric(est[c], errors="coerce")
est[["dnf", "dns"]] = est[["dnf", "dns"]].fillna(0)
est["grid_estimado"] = 0
est["final_estimado"] = 0

drv = pd.read_sql("SELECT session_key, driver_number, name_acronym FROM drivers", con).drop_duplicates(
    ["session_key", "driver_number"]
)
est = est.merge(drv, on=["session_key", "driver_number"], how="left")
est["piloto"] = est["name_acronym"].fillna(est["driver_number"].astype(str))

rp = pd.read_sql("SELECT session_key, vuelta, driver_number, posicion, fuera, en_pits FROM replay_pilotos", con)
for c in ["vuelta", "posicion", "fuera", "en_pits"]:
    rp[c] = pd.to_numeric(rp[c], errors="coerce")
rv = pd.read_sql("SELECT session_key, vuelta, estado FROM replay_vueltas", con)
estado_por = {(int(s), int(v)): e for s, v, e in zip(rv["session_key"], rv["vuelta"], rv["estado"])}


def causa(L, sk, pit_gana, pit_pierde):
    if L == 1:
        return "salida", "salida"
    if pit_pierde and not pit_gana:
        return "parada_ajena", "parada_propia"
    if pit_gana and not pit_pierde:
        return "parada_propia", "parada_ajena"
    if pit_gana and pit_pierde:
        return "parada_propia", "parada_propia"
    if estado_por.get((sk, L), "") in ("SC", "VSC", "ROJA"):
        return "bandera", "bandera"
    return "pista", "pista"


def texto(piloto, grid, final, ganadas, dnf, nets):
    if dnf:
        base = f"{piloto} largó {int(grid)}° y abandonó"
    else:
        base = f"{piloto} largó {int(grid)}° y terminó {int(final)}°"
    partes = [f"{v:+d} {ETIQ[c]}" for c, v in sorted(nets.items(), key=lambda kv: -abs(kv[1])) if v != 0]
    if not partes:
        return base + ("." if dnf else " (sin cambios).")
    signo = "" if dnf else f" ({int(ganadas):+d})"
    return f"{base}{signo}: " + ", ".join(partes) + "."


# ---------- Preparar matrices por carrera ----------
prep = []
for sk, g in rp.groupby("session_key"):
    sk = int(sk)
    e = est[est["session_key"] == sk].set_index("driver_number").copy()
    pos = g.pivot_table(index="vuelta", columns="driver_number", values="posicion", aggfunc="first").sort_index()
    fuera = g.pivot_table(index="vuelta", columns="driver_number", values="fuera", aggfunc="first").reindex_like(pos).fillna(1)
    pits = g.pivot_table(index="vuelta", columns="driver_number", values="en_pits", aggfunc="first").reindex_like(pos).fillna(0)

    # Último dato de cada piloto mientras seguía en carrera
    vivo = g[(g["fuera"] == 0) & g["posicion"].notna()].sort_values("vuelta").groupby("driver_number").tail(1).set_index("driver_number")

    # Parrilla: los que no tienen (largada desde boxes) van al final
    en_replay = [d for d in e.index if d in pos.columns and e.loc[d, "dns"] == 0]
    sin_grid = sorted(d for d in en_replay if pd.isna(e.loc[d, "pos_largada"]))
    mx = e["pos_largada"].max()
    if pd.notna(mx):
        for k, d in enumerate(sin_grid, 1):
            e.loc[d, "pos_largada"] = mx + k
            e.loc[d, "grid_estimado"] = 1

    # Posición final: los no clasificados se ordenan por vueltas completadas
    no_clas = [d for d in en_replay if pd.isna(e.loc[d, "pos_final"]) and d in vivo.index]
    no_clas.sort(key=lambda d: (-vivo.loc[d, "vuelta"], vivo.loc[d, "posicion"]))
    base = e["pos_final"].max()
    if pd.notna(base):
        for k, d in enumerate(no_clas, 1):
            e.loc[d, "pos_final"] = base + k
            e.loc[d, "dnf"] = 1
            e.loc[d, "final_estimado"] = 1

    pilotos = [d for d in pos.columns if d in e.index and e.loc[d, "dns"] == 0]
    if len(pilotos) < 8:
        continue
    pos, fuera, pits = pos[pilotos], fuera[pilotos], pits[pilotos]
    n = len(pilotos)
    grid = e.loc[pilotos, "pos_largada"].to_numpy(float)
    P = np.vstack([grid, pos.to_numpy(float)])
    F = np.vstack([np.zeros(n), fuera.to_numpy(float)])
    T = np.vstack([np.zeros(n), pits.to_numpy(float)])
    vueltas = [0] + [int(v) for v in pos.index]
    prep.append((sk, e, pilotos, P, F, T, vueltas))


def calcular(ventana):
    filas = []
    bruto_gan = {c: 0 for c in CAUSAS}
    bruto_per = {c: 0 for c in CAUSAS}
    for sk, e, pilotos, P, F, T, vueltas in prep:
        n = len(pilotos)
        gan = np.zeros((n, len(CAUSAS)), dtype=int)
        per = np.zeros((n, len(CAUSAS)), dtype=int)
        for k in range(1, len(vueltas)):
            prev, cur = P[k - 1], P[k]
            valido = ~np.isnan(prev) & ~np.isnan(cur) & (F[k] == 0) & (F[k - 1] == 0)
            G = (prev[:, None] > prev[None, :]) & (cur[:, None] < cur[None, :]) & valido[:, None] & valido[None, :]
            if not G.any():
                continue
            en_caja = T[max(0, k - ventana): k + 1].max(axis=0) > 0
            for i, j in zip(*np.where(G)):
                ci, cj = causa(vueltas[k], sk, en_caja[i], en_caja[j])
                gan[i, CAUSAS.index(ci)] += 1
                per[j, CAUSAS.index(cj)] += 1
                bruto_gan[ci] += 1
                bruto_per[cj] += 1

        for idx, d in enumerate(pilotos):
            r = e.loc[d]
            if pd.isna(r["pos_largada"]) or pd.isna(r["pos_final"]):
                continue
            netos = {c: int(gan[idx, m] - per[idx, m]) for m, c in enumerate(CAUSAS)}
            oficial = int(r["pos_largada"] - r["pos_final"])
            residuo = oficial - sum(netos.values())
            dnf = int(r["dnf"])
            netos["otros"] = 0 if dnf else residuo
            netos["abandono"] = residuo if dnf else 0
            filas.append(
                {
                    "session_key": sk,
                    "driver_number": int(d),
                    "piloto": r["piloto"],
                    "equipo": r["team_name"],
                    "year": int(r["year"]),
                    "circuito": r["circuit_short_name"],
                    "grid": int(r["pos_largada"]),
                    "final": int(r["pos_final"]),
                    "ganadas": oficial,
                    "dnf": dnf,
                    "grid_estimado": int(r["grid_estimado"]),
                    "final_estimado": int(r["final_estimado"]),
                    "n_sc": r["n_safety_car"],
                    "n_vsc": r["n_vsc"],
                    "mojada": r["mojada"],
                    **netos,
                    "texto": texto(r["piloto"], r["pos_largada"], r["pos_final"], oficial, dnf, netos),
                }
            )
    return pd.DataFrame(filas), bruto_gan, bruto_per


# ---------- Elegir la ventana ----------
resultados = {}
comparacion = []
for v in VENTANAS:
    dg_v, bg, bp = calcular(v)
    resultados[v] = (dg_v, bg, bp)
    comparacion.append(
        {"ventana": v, "cambios_totales": sum(bg.values()), "bandera_sin_explicar": bg["bandera"], "pista": bg["pista"],
         "paradas": bg["parada_propia"] + bg["parada_ajena"]}
    )
comp = pd.DataFrame(comparacion)
print("Comparación de ventanas (vueltas que cuenta un piloto como 'en parada'):")
print(comp.to_string(index=False))

elegida = VENTANAS[-1]
for a, b in zip(VENTANAS[:-1], VENTANAS[1:]):
    ba = comp.loc[comp["ventana"] == a, "bandera_sin_explicar"].iloc[0]
    bb = comp.loc[comp["ventana"] == b, "bandera_sin_explicar"].iloc[0]
    if ba == 0 or (ba - bb) / ba < MEJORA_MINIMA:
        elegida = a
        break
print(f"\nVentana elegida: {elegida} vuelta(s) antes de la vuelta en boxes")

dg, bruto_gan, bruto_per = resultados[elegida]
dg.to_sql("diagnostico", con, if_exists="replace", index=False)

# ---------- Validaciones ----------
total_pilotos = int(pd.read_sql("SELECT COUNT(*) AS n FROM paradas_resumen", con)["n"].iloc[0])
print(f"\nDiagnóstico: {len(dg)} filas piloto-carrera en {dg['session_key'].nunique()} carreras (paradas_resumen tiene {total_pilotos})")
print(f"  con posición final estimada: {int(dg['final_estimado'].sum())} | con parrilla estimada: {int(dg['grid_estimado'].sum())}")

tot = pd.DataFrame({"ganadas_brutas": bruto_gan, "perdidas_brutas": bruto_per})
tot["% de los cambios"] = (100 * (tot["ganadas_brutas"] + tot["perdidas_brutas"]) / tot.to_numpy().sum()).round(1)
print("\nCambios de orden por causa (todas las carreras):")
print(tot)

fin = dg[dg["dnf"] == 0]
print(
    f"\nPilotos que terminan: residuo 'otros' medio absoluto = {fin['otros'].abs().mean():.2f} posiciones; "
    f"con |otros| >= 2: {(fin['otros'].abs() >= 2).mean() * 100:.1f} % de los casos"
)

lv = dg[(dg["circuito"] == "Las Vegas") & (dg["year"] == 2026)].sort_values("final")
if len(lv):
    print("\nLas Vegas 2026:")
    print(lv[["piloto", "equipo", "grid", "final", "ganadas", "dnf"] + CAUSAS + ["otros", "abandono"]].to_string(index=False))

con.close()