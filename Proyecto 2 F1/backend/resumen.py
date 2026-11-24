# Endpoints de resumen: estado de los datos, KPIs de Inicio y datos del tab "¿Por qué?".
# Todo sale de las tablas nuevas (paradas, paradas_resumen, circuitos, modelo_por_que, importancias_por_que,
# varianza_factores, estrategia_vs_posiciones). Ninguna cifra queda escrita a mano.
import json
import sqlite3
from pathlib import Path

import pandas as pd
from fastapi import APIRouter

router = APIRouter()
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
RUTA_ESTADO = RUTA_DB.parent / "ultima_actualizacion.json"
ROLES = ["obligatoria", "libre", "reactiva", "clima"]


def tabla(sql, parametros=()):
    con = sqlite3.connect(RUTA_DB)
    try:
        return pd.read_sql(sql, con, params=parametros)
    except Exception:
        return pd.DataFrame()
    finally:
        con.close()


def registros(df):
    return json.loads(df.to_json(orient="records"))


def correlacion(a, b):
    if len(a) < 3:
        return None
    r = pd.Series(a).corr(pd.Series(b))
    return None if pd.isna(r) else float(r)


@router.get("/actualizado")
def actualizado():
    # Última carrera cargada y cuántas hay por año. "actualizado_en" es la fecha de la última corrida de actualizar.py.
    df = tabla(
        "SELECT session_key, circuit_short_name, country_name, date_start, "
        "CAST(SUBSTR(date_start, 1, 4) AS INTEGER) AS year FROM carreras ORDER BY date_start"
    )
    if df.empty:
        return {"ultima": None, "total": 0, "por_anio": {}, "actualizado_en": None}
    u = df.iloc[-1]
    try:
        en = json.loads(RUTA_ESTADO.read_text(encoding="utf-8")).get("fecha")
    except (OSError, ValueError):
        en = None
    return {
        "ultima": {
            "session_key": int(u["session_key"]),
            "circuito": u["circuit_short_name"],
            "pais": u["country_name"],
            "year": int(u["year"]),
            "fecha": u["date_start"][:10],
        },
        "total": int(len(df)),
        "por_anio": {str(k): int(v) for k, v in df.groupby("year").size().items()},
        "actualizado_en": en,
    }


@router.get("/resumen/general")
def resumen_general():
    paradas = tabla("SELECT rol FROM paradas")
    total = int(len(paradas))
    roles = {
        r: {"n": int((paradas["rol"] == r).sum()), "pct": float((paradas["rol"] == r).mean()) if total else 0.0}
        for r in ROLES
    }

    cc = tabla("SELECT * FROM circuitos_carrera")
    car = tabla("SELECT session_key, circuit_short_name AS circuito FROM carreras")
    pr = tabla(
        "SELECT session_key, paradas_total, paradas_obligatorias, paradas_libres, paradas_reactivas, paradas_clima "
        "FROM paradas_resumen"
    ).merge(car, on="session_key")

    # Promedio de paradas por piloto y por rol en cada circuito.
    cols = {"paradas_obligatorias": "obligatoria", "paradas_libres": "libre",
            "paradas_reactivas": "reactiva", "paradas_clima": "clima"}
    por_circuito = pr.groupby("circuito")[list(cols) + ["paradas_total"]].mean().reset_index()
    por_circuito = por_circuito.rename(columns={**cols, "paradas_total": "total"})
    por_circuito["carreras"] = por_circuito["circuito"].map(car.groupby("circuito").size())

    var = tabla("SELECT objetivo, factor, R2aj_solo, aporte_unico FROM varianza_factores WHERE objetivo = 'paradas_libres'")
    varianza = {{"año": "year"}.get(f, f): float(v) for f, v in zip(var["factor"], var["R2aj_solo"])}

    mod = tabla("SELECT * FROM modelo_por_que WHERE objetivo = 'libres'")
    mejor = None
    if not mod.empty:
        m = mod.loc[mod["R2_vs_promedio"].idxmax()]
        mejor = {
            "r2": float(m["R2_vs_promedio"]), "mae_modelo": float(m["MAE_modelo"]),
            "mae_promedio": float(m["MAE_promedio"]), "carreras": int(m["carreras"]),
            "modelo": m["modelo"], "variables": m["variables"],
        }

    circ = tabla("SELECT * FROM circuitos")
    deg = circ.dropna(subset=["degradacion_s_por_vuelta", "libres_por_piloto"])
    coef = tabla("SELECT * FROM estrategia_vs_posiciones WHERE variable = 'libres_rel'")

    seca = int((cc["seca"] == 1).sum()) if "seca" in cc else None
    return {
        "carreras": int(len(car)),
        "carreras_secas": seca,
        "circuitos": int(len(circ)),
        "pilotos_carrera": int(len(pr)),
        "paradas_total": total,
        "roles": roles,
        "varianza_libres": varianza,
        "mejor_modelo_libres": mejor,
        "correlacion_degradacion_libres": correlacion(deg["degradacion_s_por_vuelta"], deg["libres_por_piloto"]),
        "efecto_libres_posiciones": registros(coef)[0] if not coef.empty else None,
        "circuitos_roles": registros(por_circuito),
    }


@router.get("/por-que")
def por_que():
    # Modelo nuevo: reemplaza al KMeans / Random Forest de grupos de estrategia.
    return {
        "modelos": registros(tabla("SELECT * FROM modelo_por_que")),
        "importancias": registros(tabla("SELECT * FROM importancias_por_que ORDER BY importancia_rf DESC")),
        "varianza": registros(tabla("SELECT * FROM varianza_factores")),
        "posiciones_coef": registros(tabla("SELECT * FROM estrategia_vs_posiciones")),
        "posiciones_grupos": registros(tabla("SELECT * FROM ganadas_por_estrategia")),
    }


@router.get("/pistas")
def pistas():
    # Todos los trazados de una vez (para las miniaturas del tab Circuitos).
    df = tabla("SELECT circuit_short_name, x, y FROM pistas ORDER BY circuit_short_name, idx")
    return {
        c: {"x": g["x"].tolist(), "y": g["y"].tolist()}
        for c, g in df.groupby("circuit_short_name")
    }
