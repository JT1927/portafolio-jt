# Actualiza toda la base con un solo comando:  python pipeline/actualizar.py
# Ejecuta los scripts en orden y se detiene si uno falla:
#   descargar_todo -> construir_estrategias -> descargar_replay -> construir_replay -> corregir_estado
#   -> clasificar_paradas -> construir_circuitos -> modelo_por_que -> diagnostico
# Importante: construir_replay sobrescribe replay_vueltas.estado, por eso corregir_estado va siempre después.
# Es idempotente: las descargas saltan lo ya cargado y el resto recalcula sus tablas completas.
# Las carreras que aún no se corren (o que OpenF1 todavía no publica) se omiten sin fallar.
# Opciones:
#   --desde PASO     retoma desde un paso (por ejemplo: --desde clasificar_paradas)
#   --solo-resumen   no ejecuta nada, solo muestra el estado actual de la base
import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

CARPETA = Path(__file__).resolve().parent
RUTA_DB = CARPETA.parent / "data" / "f1.db"
RUTA_ESTADO = CARPETA.parent / "data" / "ultima_actualizacion.json"

PASOS = [
    "descargar_todo",
    "construir_estrategias",
    "descargar_replay",
    "construir_replay",
    "corregir_estado",  # siempre después de construir_replay
    "clasificar_paradas",
    "construir_circuitos",
    "modelo_por_que",
    "diagnostico",
]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def leer_carreras():
    # Carreras cargadas: lista de (session_key, año, circuito, fecha). Vacía si la base aún no existe.
    if not RUTA_DB.exists():
        return []
    con = sqlite3.connect(RUTA_DB)
    try:
        filas = con.execute(
            "SELECT session_key, CAST(SUBSTR(date_start, 1, 4) AS INTEGER), circuit_short_name, date_start "
            "FROM carreras ORDER BY date_start"
        ).fetchall()
    except sqlite3.OperationalError:
        filas = []
    con.close()
    return filas


def estado_previo():
    # Qué carreras había en la corrida anterior (None si es la primera vez).
    try:
        return set(json.loads(RUTA_ESTADO.read_text(encoding="utf-8"))["session_keys"])
    except (OSError, ValueError, KeyError):
        return None


def resumen(antes, previo):
    carreras = leer_carreras()
    base = previo if previo is not None else {c[0] for c in antes}
    nuevas = [c for c in carreras if c[0] not in base]

    print("\n" + "=" * 60)
    print("RESUMEN DE LA ACTUALIZACIÓN")
    print("=" * 60)
    por_anio = {}
    for _, anio, _, _ in carreras:
        por_anio[anio] = por_anio.get(anio, 0) + 1
    print("Carreras cargadas por año: " + " | ".join(f"{a}: {n}" for a, n in sorted(por_anio.items())))
    print(f"Total: {len(carreras)} carreras")
    if carreras:
        ultima = carreras[-1]
        print(f"Última carrera cargada: {ultima[2]} {ultima[1]} ({ultima[3][:10]})")
    if previo is None:
        print("Primera corrida registrada: se compara contra el estado de la base antes de ejecutar.")
    if nuevas:
        print(f"Carreras nuevas ({len(nuevas)}):")
        for c in nuevas:
            print(f"  + {c[2]} {c[1]} ({c[3][:10]})")
    else:
        print("Sin carreras nuevas desde la corrida anterior.")

    RUTA_ESTADO.write_text(
        json.dumps(
            {
                "fecha": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "total": len(carreras),
                "session_keys": [c[0] for c in carreras],
            },
            indent=1,
        ),
        encoding="utf-8",
    )


def main():
    ap = argparse.ArgumentParser(description="Actualiza la base de F1 de punta a punta.")
    ap.add_argument("--desde", choices=PASOS, help="retoma desde este paso")
    ap.add_argument("--solo-resumen", action="store_true", help="solo muestra el estado de la base")
    args = ap.parse_args()

    for paso in PASOS:
        if not (CARPETA / f"{paso}.py").exists():
            sys.exit(f"Falta el script {paso}.py en {CARPETA}")

    antes = leer_carreras()
    previo = estado_previo()

    if not args.solo_resumen:
        pasos = PASOS[PASOS.index(args.desde):] if args.desde else PASOS
        entorno = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        inicio = time.time()
        for i, paso in enumerate(pasos, 1):
            print(f"\n{'-' * 60}\n[{i}/{len(pasos)}] {paso}\n{'-' * 60}", flush=True)
            t0 = time.time()
            r = subprocess.run([sys.executable, str(CARPETA / f"{paso}.py")], cwd=CARPETA, env=entorno)
            if r.returncode != 0:
                sys.exit(f"\nFalló {paso} (código {r.returncode}). Me detengo: los pasos siguientes no se ejecutaron.")
            print(f"  {paso} listo en {time.time() - t0:.0f} s", flush=True)
        print(f"\nTodos los pasos terminaron en {time.time() - inicio:.0f} s.")

    resumen(antes, previo)


if __name__ == "__main__":
    main()
