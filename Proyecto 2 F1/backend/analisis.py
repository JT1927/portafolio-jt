# Endpoint del tab Análisis: entrega en un solo JSON los datos para los tableros interactivos.
# El filtrado (año, equipo, circuito) se hace en el navegador.
import json
import sqlite3
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import APIRouter

router = APIRouter()
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"


def _a_json(df):
    return json.loads(df.to_json(orient="records"))


def _tabla(con, nombre):
    try:
        return _a_json(pd.read_sql(f"SELECT * FROM {nombre}", con))
    except Exception:
        return []


@lru_cache(maxsize=1)
def _construir():
    con = sqlite3.connect(RUTA_DB)

    carreras = pd.read_sql("SELECT session_key, circuit_short_name AS circuito, date_start FROM carreras", con)
    carreras["year"] = carreras["date_start"].str[:4].astype(int)
    carreras = carreras.drop(columns="date_start")

    pr = pd.read_sql(
        "SELECT session_key, driver_number, usa_mojado, paradas_total, paradas_clima, paradas_obligatorias, "
        "paradas_libres, paradas_reactivas FROM paradas_resumen",
        con,
    )
    res = pd.read_sql("SELECT session_key, driver_number, position, dnf, dns, dsq FROM resultado", con)
    cla = pd.read_sql("SELECT session_key, driver_number, position AS grid FROM clasificacion", con).drop_duplicates(
        ["session_key", "driver_number"]
    )
    for c in ["position"]:
        res[c] = pd.to_numeric(res[c], errors="coerce")
    cla["grid"] = pd.to_numeric(cla["grid"], errors="coerce")
    for c in ["dnf", "dns", "dsq"]:
        res[c] = pd.to_numeric(res[c], errors="coerce").fillna(0).astype(int)

    d = pr.merge(carreras, on="session_key").merge(res, on=["session_key", "driver_number"], how="left")
    d = d.merge(cla, on=["session_key", "driver_number"], how="left")

    drv = pd.read_sql("SELECT * FROM drivers", con)
    col_equipo = next((c for c in ["team_name", "team"] if c in drv.columns), None)
    cols = ["session_key", "driver_number"] + ([col_equipo] if col_equipo else [])
    col_piloto = next((c for c in ["name_acronym", "last_name", "full_name"] if c in drv.columns), None)
    if col_piloto:
        cols.append(col_piloto)
    if "session_key" in drv.columns and col_equipo:
        eq = drv[cols].drop_duplicates(["session_key", "driver_number"])
        eq = eq.rename(columns={col_equipo: "equipo", **({col_piloto: "piloto"} if col_piloto else {})})
        d = d.merge(eq, on=["session_key", "driver_number"], how="left")
    if "equipo" not in d.columns:
        d["equipo"] = None
    if "piloto" not in d.columns:
        d["piloto"] = d["driver_number"].astype(str)

    rc = pd.read_sql(
        "SELECT session_key, longitud_km, tiempo_pit_lane_s, degradacion_s_por_vuelta, spearman_grid_final, "
        "cambio_posiciones_medio, pct_vueltas_bandera, n_sc_vsc, n_roja, lluvia_pct, temp_pista_media, seca "
        "FROM circuitos_carrera",
        con,
    )
    d = d.merge(rc[["session_key", "seca"]], on="session_key", how="left")

    salida = {
        "pilotos": _a_json(d),
        "carreras": _a_json(rc.merge(carreras, on="session_key")),
        "circuitos": _tabla(con, "circuitos"),
        "modelo": _tabla(con, "modelo_por_que"),
        "importancias": _tabla(con, "importancias_por_que"),
        "varianza": _tabla(con, "varianza_factores"),
        "posiciones_coef": _tabla(con, "estrategia_vs_posiciones"),
        "posiciones_grupos": _tabla(con, "ganadas_por_estrategia"),
        "reglas": _tabla(con, "reglas_carrera"),
    }
    con.close()
    return salida


@router.get("/analisis")
def analisis():
    return _construir()


@router.get("/analisis/recargar")
def recargar():
    _construir.cache_clear()
    return {"ok": True, "pilotos": len(_construir()["pilotos"])}

@lru_cache(maxsize=1)
def _diagnostico():
    con = sqlite3.connect(RUTA_DB)
    df = pd.read_sql("SELECT * FROM diagnostico", con)
    con.close()
    return _a_json(df)


@router.get("/diagnostico")
def diagnostico():
    return _diagnostico()


@router.get("/diagnostico/recargar")
def diagnostico_recargar():
    _diagnostico.cache_clear()
    return {"ok": True, "filas": len(_diagnostico())}