# Spotify Tracks: Audio Features y búsqueda de artistas similares

Análisis exploratorio de los audio features de canciones de Spotify, más un modelo basado en contenido que encuentra artistas con un sonido similar.

## Dataset

[Spotify Tracks Dataset](https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset) de Kaggle: 114,000 filas y 21 columnas (audio features, popularidad, género, artistas). El CSV no se incluye en el repositorio.

## Preguntas

1. ¿Qué problemas tiene el dato crudo (nulos, duplicados, valores de audio inválidos) y cómo se corrigen?
2. ¿Cómo se distribuyen los audio features y cómo se relacionan entre sí y con la popularidad?
3. ¿Se pueden perfilar los artistas por su sonido promedio y emparejarlos con artistas similares?

## Enfoque

1. **Resumen de los datos:** forma, tipos, conteo de nulos y estadísticas descriptivas.
2. **Limpieza:** eliminar la fila con nulos y la columna de índice `Unnamed: 0`, quitar las canciones repetidas (por `track_id` + `track_genre`, y luego una fila por `track_id`) y quitar las canciones con `tempo` o `time_signature` igual a 0.
3. **Análisis exploratorio:** histograma de popularidad, histogramas de nueve audio features con skewness y cuantiles, y heatmaps de correlación entre la popularidad y los audio features, con y sin `popularity` = 0.
4. **Búsqueda de artistas similares:** separar las colaboraciones en artistas individuales, quedarse con los artistas con al menos 5 canciones, construir un perfil de audio promedio por artista, estandarizarlo y ajustar un modelo de vecinos más cercanos con cosine similarity. Una función de búsqueda devuelve artistas similares con su género principal, similitud y número de canciones, y se listan como los más únicos los artistas cuya coincidencia más cercana es la menos similar.

## Hallazgos clave

- Tras la limpieza quedan 89,578 canciones únicas de 114,000 filas: 1 fila con nulos (que además era la única canción con `duration_ms` = 0), 24,259 valores de `track_id` repetidos y 450 pares `track_id` + `track_genre` repetidos (quedando 89,740 canciones únicas), y 162 canciones con `time_signature` = 0 (157 de ellas también con `tempo` = 0).
- 9,443 canciones limpias (10.5%) tienen `popularity` = 0; las demás puntuaciones alcanzan su máximo en torno a 22, con una segunda joroba más plana cerca de 42.
- Varios audio features tienen un sesgo fuerte: `speechiness` (skewness 4.55), `liveness` (2.07) e `instrumentalness` (1.57) a la derecha, `loudness` (-1.94) a la izquierda.
- La popularidad solo tiene una correlación débil con los audio features (|r| de 0.13 como máximo con todas las canciones; la más fuerte es `instrumentalness` con -0.20 al excluir `popularity` = 0).
- Las correlaciones más fuertes son entre audio features: energy y loudness (0.76), energy y acousticness (-0.74), loudness y acousticness (-0.58), danceability y valence (0.49).
- 6,039 artistas tienen al menos 5 canciones y fueron perfilados. El modelo devuelve vecinos con similitudes de alrededor de 0.92 a 0.99 en los ejemplos (Linkin Park, Rammstein, Norah Jones, BTS), pero los vecinos suelen ser de géneros distintos. Los artistas más únicos (por ejemplo Skinny Puppy y Adam Lambert) tienen una coincidencia más cercana con una similitud de solo 0.747 a 0.819.

**Limitaciones:** la similitud usa solo nueve audio features promediados; la etiqueta de género principal es la más frecuente y puede verse extraña; se excluyen los artistas con menos de 5 canciones; las recomendaciones se comprobaron solo con unos pocos ejemplos, sin evaluación cuantitativa.

## Herramientas

Python, pandas, seaborn, matplotlib, plotly, scikit-learn, Jupyter.

## Cómo ejecutarlo

1. Descargar `dataset.csv` del dataset de Kaggle indicado arriba y colocarlo en `data/`.
2. Instalar las dependencias:

```powershell
pip install pandas seaborn matplotlib plotly scikit-learn jupyterlab
```

3. Abrir y ejecutar `notebooks/Spotify_Eda_Model.ipynb` de arriba hacia abajo. La ruta de los datos (`../data/dataset.csv`) es relativa a la carpeta `notebooks/`.

`notebooks/Spotify_Eda_Model_backup.ipynb` es una copia del notebook original antes de la reestructuración.
