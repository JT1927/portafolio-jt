# Genera de una vez el mapa (posiciones de los autos) de todas las carreras con replay,
# para que en la web aparezcan al instante. Usa la misma función que el backend y
# guarda cada carrera en data/mapa/{session_key}.json. Las que ya están se saltan,
# así que se puede cortar y volver a correr sin perder lo avanzado.
import json
import sqlite3
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "backend"))
from mapa import CARPETA, RUTA_DB, construir_mapa  # noqa: E402

con = sqlite3.connect(RUTA_DB)
carreras = [
    r[0] for r in con.execute("SELECT DISTINCT session_key FROM replay_vueltas ORDER BY session_key")
]
con.close()

pendientes = [k for k in carreras if not (CARPETA / f"{k}.json").exists()]
print(f"{len(carreras)} carreras, {len(pendientes)} sin mapa")

fallidas = []
for i, k in enumerate(pendientes, 1):
    inicio = time.time()
    try:
        datos = construir_mapa(k)
    except Exception as e:  # HTTPException de FastAPI, errores de red, etc.
        detalle = getattr(e, "detail", e)
        print(f"[{i}/{len(pendientes)}] {k}: falló ({detalle})")
        fallidas.append(k)
        continue
    (CARPETA / f"{k}.json").write_text(json.dumps(datos))
    print(f"[{i}/{len(pendientes)}] {k}: {len(datos['pilotos'])} pilotos en {time.time() - inicio:.0f} s")

print("Listo." if not fallidas else f"Fallaron {len(fallidas)}: {fallidas} (vuelve a correr el script)")
