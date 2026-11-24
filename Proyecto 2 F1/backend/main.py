import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
OPENF1 = "https://api.openf1.org/v1"

app = FastAPI(title="API Estrategias F1")

# Dejo que el frontend de React (Vite, puerto 5173) pueda pedirle datos a esta API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Guardo en memoria las telemetrías ya pedidas, para no repetir llamadas a OpenF1.
cache_telemetria = {}


def consultar(sql, parametros=()):
    # Abro la base, hago la consulta y devuelvo una lista de diccionarios.
    con = sqlite3.connect(RUTA_DB)
    con.row_factory = sqlite3.Row
    try:
        filas = con.execute(sql, parametros).fetchall()
    finally:
        con.close()
    return [dict(f) for f in filas]


@app.get("/carreras")
def listar_carreras(year: int | None = None):
    # Solo las carreras que tienen datos de estrategia.
    sql = ("SELECT session_key, year, circuit_short_name, country_name, date_start "
           "FROM carreras WHERE session_key IN (SELECT DISTINCT session_key FROM estrategias)")
    parametros = ()
    if year is not None:
        sql += " AND year = ?"
        parametros = (year,)
    sql += " ORDER BY date_start"
    return consultar(sql, parametros)


ABREVIATURA = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "I", "WET": "W"}
ROLES = ["obligatoria", "libre", "reactiva", "clima"]


def nombre_estrategia(paradas, secuencia):
    # El nombre sale de la secuencia real y de la cantidad de paradas clasificadas: "2 paradas (M-H-S)".
    base = "Sin paradas" if paradas == 0 else "1 parada" if paradas == 1 else f"{paradas} paradas"
    return f"{base} ({secuencia})" if secuencia else base


@app.get("/carreras/{session_key}/estrategias")
def estrategias_de_carrera(session_key: int):
    # Un registro por piloto. La estrategia se nombra con la secuencia real de neumáticos
    # (stints limpios) y la cantidad de paradas de la tabla paradas, con su desglose por rol.
    pilotos = consultar(
        "SELECT e.driver_number, e.full_name, e.team_name, e.pos_largada, e.pos_final, "
        "e.dnf, e.secuencia, e.paradas, e.mojada "
        "FROM estrategias e WHERE e.session_key = ? ORDER BY e.pos_final IS NULL, e.pos_final",
        (session_key,))

    if not pilotos:
        raise HTTPException(status_code=404, detail="Carrera no encontrada")

    # Línea de tiempo de neumáticos: stints ya limpios (sin duplicados ni fragmentos del mismo juego).
    stints = consultar(
        "SELECT driver_number, stint_number, compound, lap_start, lap_end "
        "FROM stints_limpios WHERE session_key = ? ORDER BY driver_number, stint_number",
        (session_key,))

    por_piloto = {}
    for s in stints:
        por_piloto.setdefault(s["driver_number"], []).append({
            "stint": s["stint_number"],
            "neumatico": s["compound"],
            "vuelta_inicio": s["lap_start"],
            "vuelta_fin": s["lap_end"],
        })

    paradas = {}
    for p in consultar(
            "SELECT driver_number, parada_n, vuelta, compuesto_sale, compuesto_entra, contexto, rol "
            "FROM paradas WHERE session_key = ? ORDER BY driver_number, parada_n", (session_key,)):
        paradas.setdefault(p["driver_number"], []).append(p)

    for p in pilotos:
        lista = por_piloto.get(p["driver_number"], [])
        detalle = paradas.get(p["driver_number"], [])
        if lista:
            p["secuencia"] = "-".join(ABREVIATURA.get(s["neumatico"], "?") for s in lista)
            p["paradas"] = len(detalle)
        p["stints"] = lista
        p["paradas_detalle"] = detalle
        p["desglose"] = {r: sum(1 for d in detalle if d["rol"] == r) for r in ROLES}
        p["estrategia"] = nombre_estrategia(p["paradas"], p["secuencia"])

    return pilotos


@app.get("/carreras/{session_key}/eventos")
def eventos_de_carrera(session_key: int):
    # Safety Car, VSC y banderas rojas, en orden de aparición.
    return consultar(
        "SELECT lap_number AS vuelta, category AS categoria, flag AS bandera, message AS mensaje "
        "FROM control WHERE session_key = ? AND (category = 'SafetyCar' OR flag = 'RED') "
        "ORDER BY date", (session_key,))


@app.get("/carreras/{session_key}/control")
def control_de_carrera(session_key: int):
    # Mensajes de Race Control en orden de aparición (el replay los muestra según la vuelta).
    return consultar(
        "SELECT date AS fecha, lap_number AS vuelta, category AS categoria, flag AS bandera, "
        "scope AS ambito, message AS mensaje "
        "FROM control WHERE session_key = ? ORDER BY date", (session_key,))


@app.get("/carreras/{session_key}/replay")
def replay_de_carrera(session_key: int):
    # Información de cada vuelta: hora, clima y estado de la pista.
    vueltas = consultar(
        "SELECT vuelta, t, estado, lluvia, temp_pista, temp_aire, humedad, viento "
        "FROM replay_vueltas WHERE session_key = ? ORDER BY vuelta", (session_key,))

    if not vueltas:
        raise HTTPException(status_code=404, detail="Esta carrera no tiene replay")

    # Leaderboard de cada vuelta, ordenado por posición.
    filas = consultar(
        "SELECT vuelta, driver_number, posicion, fuera, neumatico, edad, en_pits "
        "FROM replay_pilotos WHERE session_key = ? ORDER BY vuelta, posicion", (session_key,))

    leaderboard = {}
    for f in filas:
        leaderboard.setdefault(str(f["vuelta"]), []).append({
            "driver_number": f["driver_number"],
            "posicion": f["posicion"],
            "fuera": f["fuera"],
            "neumatico": f["neumatico"],
            "edad": f["edad"],
            "en_pits": f["en_pits"],
        })

    # Datos de cada piloto, incluido su resultado oficial.
    pilotos = consultar(
        "SELECT DISTINCT d.driver_number, d.full_name, d.name_acronym, d.team_name, "
        "r.position AS pos_final, r.dnf "
        "FROM drivers d LEFT JOIN resultado r "
        "ON r.session_key = d.session_key AND r.driver_number = d.driver_number "
        "WHERE d.session_key = ?", (session_key,))

    return {
        "vueltas": vueltas,
        "leaderboard": leaderboard,
        "pilotos": {str(p["driver_number"]): p for p in pilotos},
    }


@app.get("/telemetria")
def telemetria(session_key: int, driver_number: int, vuelta: int):
    clave = (session_key, driver_number, vuelta)
    if clave in cache_telemetria:
        return cache_telemetria[clave]

    # Busco cuándo empezó y cuánto duró esa vuelta.
    filas = consultar(
        "SELECT date_start, lap_duration FROM vueltas "
        "WHERE session_key = ? AND driver_number = ? AND lap_number = ?",
        (session_key, driver_number, vuelta))

    if not filas or filas[0]["date_start"] is None or filas[0]["lap_duration"] is None:
        raise HTTPException(status_code=404, detail="Esa vuelta no tiene tiempos")

    inicio = datetime.fromisoformat(filas[0]["date_start"])
    fin = inicio + timedelta(seconds=float(filas[0]["lap_duration"]))

    # Le pido a OpenF1 la telemetría solo de esa ventana de tiempo.
    url = (f"{OPENF1}/car_data?session_key={session_key}&driver_number={driver_number}"
           f"&date>={quote(inicio.isoformat())}&date<={quote(fin.isoformat())}")
    try:
        respuesta = requests.get(url, timeout=30)
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="No pude conectar con OpenF1")

    if respuesta.status_code == 429:
        raise HTTPException(status_code=429, detail="OpenF1 pide esperar unos segundos")
    if respuesta.status_code == 404:
        datos = []
    elif respuesta.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OpenF1 respondió {respuesta.status_code}")
    else:
        datos = respuesta.json()

    resultado = {
        "t": [round((datetime.fromisoformat(d["date"]) - inicio).total_seconds(), 2) for d in datos],
        "velocidad": [d.get("speed") for d in datos],
        "acelerador": [d.get("throttle") for d in datos],
        "freno": [d.get("brake") for d in datos],
        "marcha": [d.get("n_gear") for d in datos],
        "drs": [d.get("drs") for d in datos],
        "duracion": float(filas[0]["lap_duration"]),
    }

    # Solo guardo en memoria si trajo datos (así se reintenta si vino vacío).
    if datos:
        cache_telemetria[clave] = resultado
    return resultado



from mapa import router as router_mapa
app.include_router(router_mapa)


from analisis import router as router_analisis
app.include_router(router_analisis)

from resumen import router as router_resumen
app.include_router(router_resumen)
