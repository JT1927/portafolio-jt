# Portafolio Jt

Portafolio de proyectos de ciencia de datos de **Jorge Tapia Vásquez**: Data Analyst e Ingeniero Civil Industrial, Magíster en Data Science (UAI).

La idea es publicar **un proyecto por semana**, de temas distintos, para mostrar lo aprendido en el Magíster y seguir aprendiendo con cada uno. Los datos vienen de Kaggle.

Stack: Python, SQL, scikit-learn, Power BI.

## Proyectos

| # | Proyecto | Tema | Estado |
|---|----------|------|--------|
| 1 | [Proyecto 1 Spotify](Proyecto%201%20Spotify/) | Modelo predictivo tabular | En curso |
| 2 | Series de tiempo | Pronóstico | Pendiente |
| 3 | NLP en español / Netflix | Texto | Pendiente |
| 4 | Segmentación / clustering | CRM | Pendiente |
| 5 | Dashboard Power BI | Datos públicos de Chile | Pendiente |
| 6-7 | Proyecto end-to-end desplegado | FastAPI + React + AWS | Pendiente |

## Estructura

```
Portafolio Jt/
├── Proyecto 1 Spotify/      # un proyecto por carpeta
├── _Plantilla proyecto/     # copiar para cada proyecto nuevo
├── requirements.txt
└── README.md
```

Cada proyecto sigue la misma estructura: `notebooks/`, `data/`, `src/` y `reports/figures/`, con su propio README (problema, datos, método, resultados, aprendizajes).

## Cómo empezar un proyecto nuevo

En PowerShell, desde la raíz del repo:

```powershell
Copy-Item -Recurse "_Plantilla proyecto" "Proyecto 2 Series de tiempo"
```

Después editar el README del proyecto y partir por el notebook de EDA.

## Entorno

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
