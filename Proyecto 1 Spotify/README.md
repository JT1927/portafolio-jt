# Spotify Tracks: Audio Features and Similar-Artist Search

Exploratory analysis of Spotify track audio features, plus a content-based model that finds artists with a similar sound.

## Dataset

[Spotify Tracks Dataset](https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset) from Kaggle: 114,000 rows and 21 columns (audio features, popularity, genre, artists). The CSV is not tracked in the repository.

## Questions

1. Which problems does the raw data have (nulls, duplicates, invalid audio values) and how are they fixed?
2. How are the audio features distributed, and how do they relate to each other and to popularity?
3. Can artists be profiled by their average sound and matched with similar artists?

## Approach

1. **Data overview:** shape, types, null counts and summary statistics.
2. **Cleaning:** drop the row with nulls and the `Unnamed: 0` index column, remove repeated tracks (by `track_id` + `track_genre`, then one row per `track_id`), and remove tracks with `tempo` or `time_signature` equal to 0.
3. **Exploratory analysis:** popularity histogram, histograms of nine audio features with skewness and quantiles, and correlation heatmaps of popularity and audio features, with and without `popularity` = 0.
4. **Similar-artist search:** split collaborations into individual artists, keep artists with at least 5 songs, build an average audio profile per artist, standardize it and fit a cosine nearest-neighbors model. A search function returns similar artists with their primary genre, similarity and song count, and the artists whose closest match is least similar are listed as the most unique.

## Key findings

- After cleaning, 89,578 unique tracks remain out of 114,000 rows: 1 row with nulls (which was also the only track with `duration_ms` = 0), 24,259 repeated `track_id` values and 450 repeated `track_id` + `track_genre` pairs (leaving 89,740 unique tracks), and 162 tracks with `time_signature` = 0 (157 of them also with `tempo` = 0).
- 9,443 cleaned tracks (10.5%) have `popularity` = 0; the other scores peak around 22, with a second, flatter hump near 42.
- Several audio features are strongly skewed: `speechiness` (skewness 4.55), `liveness` (2.07) and `instrumentalness` (1.57) to the right, `loudness` (-1.94) to the left.
- Popularity is only weakly correlated with the audio features (|r| at most 0.13 with all tracks; the strongest is `instrumentalness` at -0.20 once `popularity` = 0 is excluded).
- The strongest correlations are among audio features: energy and loudness (0.76), energy and acousticness (-0.74), loudness and acousticness (-0.58), danceability and valence (0.49).
- 6,039 artists have at least 5 songs and were profiled. The model returns neighbors with similarities of about 0.92 to 0.99 in the examples (Linkin Park, Rammstein, Norah Jones, BTS), but neighbors often come from different genres. The most unique artists (for example Skinny Puppy and Adam Lambert) have a closest match with similarity of only 0.747 to 0.819.

**Limitations:** similarity uses only nine averaged audio features; the primary genre label is the most frequent one and can look odd; artists with fewer than 5 songs are excluded; the recommendations were checked on a few examples only, with no quantitative evaluation.

## Tools

Python, pandas, seaborn, matplotlib, plotly, scikit-learn, Jupyter.

## How to run

1. Download `dataset.csv` from the Kaggle dataset above and place it in `data/`.
2. Install the dependencies:

```powershell
pip install pandas seaborn matplotlib plotly scikit-learn jupyterlab
```

3. Open and run `notebooks/Spotify_Eda_Model.ipynb` from top to bottom. The data path (`../data/dataset.csv`) is relative to the `notebooks/` folder.

`notebooks/Spotify_Eda_Model_backup.ipynb` is a copy of the original notebook before restructuring.
