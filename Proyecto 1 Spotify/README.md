# Proyecto 1: Spotify, clasificación de género musical

> Semana 1 del portafolio. Modelo predictivo tabular con interpretación.

## Problema
¿Se puede predecir el género de una canción a partir de sus características de audio? Como análisis secundario: ¿cuánto de la popularidad explican esas variables?

## Datos
- **Fuente:** Spotify Tracks Dataset en Kaggle (`maharshipandya/-spotify-tracks-dataset`)
- **Tamaño:** por confirmar al cargarlo (se espera cerca de 114 mil canciones)
- **Variable objetivo:** `track_genre` (principal) y `popularity` (secundaria)
- **Variables clave:** danceability, energy, valence, tempo, loudness, acousticness, etc.

## Plan de la semana (miércoles 28 de octubre al martes 3 de noviembre)
- [ ] Día 1 (mié 28): elegir dataset, definir pregunta y métrica, crear repo
- [ ] Día 2: limpieza y EDA
- [ ] Día 3: baseline y primer modelo
- [ ] Día 4: mejora del modelo e interpretación (SHAP)
- [ ] Día 5: notebook final y README completo
- [ ] Cierre: publicar en GitHub y Kaggle

## Métrica de éxito (borrador)
- Macro-F1 y accuracy por género, comparado contra el baseline de la clase mayoritaria.

## Método
Por completar.

## Resultados
Por completar.

## Aprendizajes
Por completar.

## Cómo reproducirlo
```powershell
pip install -r ..\requirements.txt
jupyter lab notebooks/
```

La carpeta `data/` no se sube al repo. Descargar el dataset desde Kaggle y dejarlo ahí.
