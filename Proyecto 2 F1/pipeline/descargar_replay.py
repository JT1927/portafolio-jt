import sqlite3
import time
from pathlib import Path

import pandas as pd
import requests

BASE = "https://api.openf1.org/v1"
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"

# Solo guardo las columnas que necesito, para que la base no engorde de más.
COLUMNAS_VUELTAS = ["session_key", "driver_number", "lap_number",
                    "date_start", "lap_duration", "is_pit_out_lap"]
COLUMNAS_POSICION = ["session_key", "driver_number", "date", "position"]


def get(endpoint, **params):
    # Pido los datos a la API. Si me pasé del límite (429), espero y reintento.
    for _ in range(5):
        respuesta = requests.get(f"{BASE}/{endpoint}", params=params, timeout=60)
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


def guardar(df, tabla, columnas, con):
    # Si viene vacía no hay nada que guardar.
    if df.empty:
        return
    # Si falta alguna columna, la creo vacía para que no se rompa.
    for c in columnas:
        if c not in df.columns:
            df[c] = None
    df[columnas].to_sql(tabla, con, if_exists="append", index=False)


def borrar_carrera(con, session_key):
    # Si una carrera quedó a medias, borro sus filas antes de repetirla.
    for tabla in ["vueltas", "posicion"]:
        try:
            con.execute(f"DELETE FROM {tabla} WHERE session_key = ?", (session_key,))
        except sqlite3.OperationalError:
            pass  # la tabla aún no existe


def main():
    con = sqlite3.connect(RUTA_DB)

    carreras = pd.read_sql(
        "SELECT session_key, year, circuit_short_name FROM carreras ORDER BY date_start", con)

    # Veo qué carreras ya terminé para no repetirlas.
    try:
        hechas = set(pd.read_sql("SELECT session_key FROM replay_hechas", con)["session_key"].astype(int))
    except Exception:
        hechas = set()

    for _, c in carreras.iterrows():
        sk = int(c["session_key"])
        if sk in hechas:
            continue

        print(f"{c['year']} - {c['circuit_short_name']} ({sk})")
        borrar_carrera(con, sk)

        vueltas = get("laps", session_key=sk)
        posiciones = get("position", session_key=sk)
        # Sin vueltas todavía (OpenF1 devuelve 404 o vacío): no la marco como hecha y se reintenta después.
        if vueltas.empty or posiciones.empty:
            print("  Sin datos de replay todavía, la dejo para la próxima actualización")
            continue
        guardar(vueltas, "vueltas", COLUMNAS_VUELTAS, con)
        guardar(posiciones, "posicion", COLUMNAS_POSICION, con)

        # Esta marca se guarda al final: significa "carrera completa".
        pd.DataFrame([{"session_key": sk}]).to_sql("replay_hechas", con, if_exists="append", index=False)
        con.commit()

    # Resumen
    print("\n=== Resumen ===")
    for tabla in ["vueltas", "posicion", "replay_hechas"]:
        n = con.execute(f"SELECT COUNT(*) FROM {tabla}").fetchone()[0]
        print(f"  {tabla}: {n} filas")

    con.close()


if __name__ == "__main__":
    main()