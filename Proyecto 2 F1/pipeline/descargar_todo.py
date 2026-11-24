import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

BASE = "https://api.openf1.org/v1"
ANIOS = [2023, 2024, 2025, 2026]

# La base de datos queda en la carpeta data/ del proyecto.
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"

TABLAS = ["stints", "pits", "control", "drivers", "resultado",
          "clima", "clasificacion", "carreras"]


def get(endpoint, **params):
    # Pido los datos a la API. Si me pasé del límite (429), espero y reintento.
    for _ in range(5):
        respuesta = requests.get(f"{BASE}/{endpoint}", params=params, timeout=30)
        time.sleep(0.5)

        # 404 significa que no hay datos: devuelvo una tabla vacía.
        if respuesta.status_code == 404:
            return pd.DataFrame()

        if respuesta.status_code == 429:
            print("  Límite de llamadas, espero 20 segundos...")
            time.sleep(20)
            continue

        respuesta.raise_for_status()
        return pd.DataFrame(respuesta.json())

    raise RuntimeError(f"No pude descargar {endpoint} {params}")


def guardar(df, tabla, conexion):
    # Si la tabla viene vacía, no hay nada que guardar.
    if df.empty:
        return

    # SQLite no acepta listas ni diccionarios dentro de una celda: los paso a texto.
    for col in df.columns:
        if df[col].apply(lambda x: isinstance(x, (list, dict))).any():
            df[col] = df[col].astype(str)

    df.to_sql(tabla, conexion, if_exists="append", index=False)


def limpiar_carrera(conexion, session_key):
    # Si una carrera quedó a medias en un intento anterior, borro sus filas
    # antes de volver a descargarla, para no duplicar datos.
    for tabla in TABLAS:
        try:
            conexion.execute(f"DELETE FROM {tabla} WHERE session_key = ?", (session_key,))
        except sqlite3.OperationalError:
            pass  # la tabla todavía no existe, no hay nada que borrar


def main():
    RUTA_DB.parent.mkdir(exist_ok=True)
    conexion = sqlite3.connect(RUTA_DB)
    ahora = datetime.now(timezone.utc)

    # Veo qué carreras ya están completas para no repetirlas.
    try:
        hechas = set(pd.read_sql("SELECT session_key FROM carreras", conexion)["session_key"].astype(int))
    except Exception:
        hechas = set()

    for anio in ANIOS:
        print(f"\n=== {anio} ===")
        sesiones = get("sessions", year=anio)
        if sesiones.empty:
            print("  Sin sesiones")
            continue

        carreras = sesiones[sesiones["session_name"] == "Race"]

        # Para cada fin de semana (meeting_key) guardo el número de su clasificación.
        clasifs = (sesiones[sesiones["session_name"] == "Qualifying"]
                   .set_index("meeting_key")["session_key"])

        for _, c in carreras.iterrows():
            sk = int(c["session_key"])
            fin = pd.to_datetime(c["date_end"], utc=True)

            # Salto las carreras que aún no se corren y las que ya descargué.
            if fin > ahora or sk in hechas:
                continue

            print(f"  {c['circuit_short_name']} ({sk})")
            limpiar_carrera(conexion, sk)

            tablas = {
                "stints": get("stints", session_key=sk),
                "pits": get("pit", session_key=sk),
                "control": get("race_control", session_key=sk),
                "drivers": get("drivers", session_key=sk),
                "resultado": get("session_result", session_key=sk),
                "clima": get("weather", session_key=sk),
            }

            # La clasificación me sirve como parrilla de largada.
            mk = c["meeting_key"]
            if mk in clasifs.index:
                clasif = get("session_result", session_key=int(clasifs[mk]))
                clasif = clasif.rename(columns={"session_key": "session_key_clasif"})
                clasif["session_key"] = sk  # la ligo a la carrera
                tablas["clasificacion"] = clasif

            # Carrera ya terminada pero sin datos publicados todavía (OpenF1 devuelve 404 o vacío):
            # no la marco como completa, así se reintenta en la próxima actualización.
            if tablas["stints"].empty or tablas["resultado"].empty:
                print("    Sin datos todavía en OpenF1, la dejo para la próxima actualización")
                conexion.commit()
                continue

            for nombre, df in tablas.items():
                guardar(df, nombre, conexion)

            # Esta tabla se guarda al final: es la marca de "carrera completa".
            meta = pd.DataFrame([{
                "session_key": sk,
                "meeting_key": int(mk),
                "year": anio,
                "circuit_short_name": c["circuit_short_name"],
                "country_name": c["country_name"],
                "location": c["location"],
                "date_start": c["date_start"],
            }])
            guardar(meta, "carreras", conexion)
            conexion.commit()

    # Resumen: cuántas filas quedaron en cada tabla.
    print("\n=== Resumen ===")
    for tabla in TABLAS:
        try:
            n = conexion.execute(f"SELECT COUNT(*) FROM {tabla}").fetchone()[0]
            print(f"  {tabla}: {n} filas")
        except sqlite3.OperationalError:
            print(f"  {tabla}: no existe")

    conexion.close()


if __name__ == "__main__":
    main()