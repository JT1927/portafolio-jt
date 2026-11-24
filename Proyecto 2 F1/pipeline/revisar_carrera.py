# Muestra los mensajes de Race Control relacionados con Safety Car, banderas y suspensiones
# en las carreras donde el estado quedó "pegado".
import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
CARRERAS = [("Shanghai", 2024), ("Lusail", 2024), ("Silverstone", 2023), ("Kuala Lumpur", 2026)]

pd.set_option("display.width", 220)
pd.set_option("display.max_colwidth", 90)
pd.set_option("display.max_rows", 400)

con = sqlite3.connect(RUTA_DB)
carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)

for circuito, anio in CARRERAS:
    sk = int(
        carreras[(carreras["circuit_short_name"] == circuito) & (carreras["year"] == anio)].iloc[0]["session_key"]
    )
    c = pd.read_sql("SELECT * FROM control WHERE session_key = ?", con, params=(sk,))
    mensaje = c["message"].fillna("")
    filtro = (
        (c["category"] == "SafetyCar")
        | (c["flag"].isin(["RED", "CHEQUERED", "CLEAR"]))
        | ((c["flag"] == "GREEN") & (c["scope"] == "Track"))
        | mensaje.str.contains("RED FLAG|SUSPEND|RESUM|RESTART|SAFETY CAR|VSC|TRACK CLEAR", case=False)
    )
    sel = c[filtro & ~mensaje.str.contains("PIT EXIT OPEN", case=False)].sort_values("date")
    cols = [x for x in ["date", "lap_number", "category", "flag", "scope", "message"] if x in sel.columns]
    print(f"\n===== {circuito} {anio} =====")
    print(sel[cols].to_string(index=False))

con.close()
