import time
import requests
import pandas as pd

BASE = "https://api.openf1.org/v1"
CARRERA = 11412       # Interlagos 2026 (la carrera)
FIN_DE_SEMANA = 1299  # el meeting_key de ese Gran Premio


def get(endpoint, **params):
    # Le pido los datos a la API. El endpoint dice qué quiero (stints, pit...)
    # y params son los filtros (por ejemplo, de qué carrera).
    respuesta = requests.get(f"{BASE}/{endpoint}", params=params, timeout=30)

    # Espero medio segundo para no pasarme del límite de llamadas.
    time.sleep(0.5)

    # Si no hay datos (404), devuelvo una tabla vacía y aviso, en vez de romper todo.
    if respuesta.status_code == 404:
        print(f"Sin datos en {endpoint}")
        return pd.DataFrame()

    # Cualquier otro error sí debe detener el código.
    respuesta.raise_for_status()

    # Devuelvo la respuesta convertida en una tabla de pandas.
    return pd.DataFrame(respuesta.json())


# Busco todas las sesiones de ese fin de semana y me quedo con la clasificación.
sesiones = get("sessions", meeting_key=FIN_DE_SEMANA)
clasificacion = sesiones[sesiones["session_name"] == "Qualifying"]["session_key"].iloc[0]

# Descargo las tablas que necesito.
drivers = get("drivers", session_key=CARRERA)
clasif = get("session_result", session_key=clasificacion)

# Pego el nombre y el equipo de cada piloto a la clasificación.
clasif = clasif.merge(
    drivers[["driver_number", "full_name", "team_name"]],
    on="driver_number",
    how="left",
)

# Imprimo la clasificación con nombres y equipos.
print(clasif[["position", "full_name", "team_name"]])