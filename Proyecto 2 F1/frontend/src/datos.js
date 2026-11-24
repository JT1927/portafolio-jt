// Datos, formatos y utilidades compartidas (sin componentes, para que React Fast Refresh funcione bien).
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export const API = "http://127.0.0.1:8000";

// ---------- Colores ----------
export const COLOR_EQUIPO = {
  Mercedes: "#27f4d2",
  Ferrari: "#e80020",
  McLaren: "#ff8000",
  "Red Bull Racing": "#3671c6",
  "Aston Martin": "#229971",
  Alpine: "#ff87bc",
  Williams: "#64c4ff",
  "Racing Bulls": "#6692ff",
  RB: "#6692ff",
  AlphaTauri: "#5e8faa",
  "Haas F1 Team": "#b6babd",
  Audi: "#f50537",
  "Kick Sauber": "#52e252",
  Sauber: "#52e252",
  "Alfa Romeo": "#c92d4b",
  Cadillac: "#c8c8d0",
};
export const colorEquipo = (equipo) => COLOR_EQUIPO[equipo] || "#7c7c96";

export const NEUMATICOS = {
  SOFT: { color: "var(--neu-soft)", letra: "S", nombre: "Blando" },
  MEDIUM: { color: "var(--neu-medium)", letra: "M", nombre: "Medio" },
  HARD: { color: "var(--neu-hard)", letra: "H", nombre: "Duro" },
  INTERMEDIATE: { color: "var(--neu-inter)", letra: "I", nombre: "Intermedio" },
  WET: { color: "var(--neu-wet)", letra: "W", nombre: "Lluvia" },
};

// Roles de las paradas. "id" es la columna de paradas_resumen y "rol" el valor de la tabla paradas.
export const ROLES = [
  { id: "paradas_obligatorias", rol: "obligatoria", nombre: "Obligatorias", corto: "oblig.", color: "var(--rol-obligatoria)", ayuda: "Las exige el reglamento (2 compuestos secos distintos, B6.3.6; o reglas especiales de Mónaco 2025 y Lusail)." },
  { id: "paradas_libres", rol: "libre", nombre: "Libres", corto: "libres", color: "var(--rol-libre)", ayuda: "En bandera verde y más allá del mínimo: estrategia real." },
  { id: "paradas_reactivas", rol: "reactiva", nombre: "Reactivas", corto: "react.", color: "var(--rol-reactiva)", ayuda: "Bajo Safety Car, VSC, bandera roja o en la vuelta 1." },
  { id: "paradas_clima", rol: "clima", nombre: "Clima", corto: "clima", color: "var(--rol-clima)", ayuda: "Cambios que involucran neumáticos intermedios o de lluvia." },
];
export const ROL_POR_NOMBRE = Object.fromEntries(ROLES.map((r) => [r.rol, r]));

// ---------- Formatos (es-CL: coma decimal) ----------
export const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const dec = (v, n = 2) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(n).replace(".", ","));
export const pct = (v, n = 0) => (v == null || Number.isNaN(v) ? "–" : `${(v * 100).toFixed(n).replace(".", ",")} %`);
export const con = (v, n = 1) => (v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${dec(v, n)}`);

// ---------- Datos ----------
// Pide a la API y guarda la respuesta en memoria: varias pantallas comparten /analisis sin repetir la llamada.
const cacheApi = new Map();
export function useApi(ruta, { cache = true } = {}) {
  const [resp, setResp] = useState({});

  useEffect(() => {
    if (!ruta || (cache && cacheApi.has(ruta))) return;
    let activo = true;
    fetch(`${API}${ruta}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cache) cacheApi.set(ruta, d);
        if (activo) setResp((x) => ({ ...x, [ruta]: { datos: d } }));
      })
      .catch((e) => activo && setResp((x) => ({ ...x, [ruta]: { error: String(e.message || e) } })));
    return () => {
      activo = false;
    };
  }, [ruta, cache]);

  if (!ruta) return { datos: null, error: null };
  if (cache && cacheApi.has(ruta)) return { datos: cacheApi.get(ruta), error: null };
  const r = resp[ruta];
  return { datos: r?.datos ?? null, error: r?.error ?? null };
}

// "Max VERSTAPPEN" -> { nombre: "Max", apellido: "VERSTAPPEN" }
export function separarNombre(completo = "") {
  const partes = completo.split(" ");
  const apellido = partes.filter((t) => t === t.toUpperCase()).join(" ");
  const nombre = partes.filter((t) => t !== t.toUpperCase()).join(" ");
  return { apellido: apellido || completo, nombre };
}

// ---------- Tooltip propio (reemplaza a los title="" nativos) ----------
export function useTip() {
  const [tip, setTip] = useState(null);
  const props = useCallback(
    (contenido) => ({
      onMouseEnter: (e) => setTip({ x: e.clientX, y: e.clientY, contenido }),
      onMouseMove: (e) => setTip({ x: e.clientX, y: e.clientY, contenido }),
      onMouseLeave: () => setTip(null),
      onFocus: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ x: r.left + r.width / 2, y: r.top + r.height / 2, contenido });
      },
      onBlur: () => setTip(null),
    }),
    []
  );
  return { tip, props };
}


// ---------- Medir el ancho de un contenedor (para que los SVG usen píxeles reales) ----------
export function useAncho(ref, inicial = 640) {
  const [ancho, setAncho] = useState(inicial);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const medir = () => setAncho(Math.max(260, Math.floor(ref.current.getBoundingClientRect().width)));
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return ancho;
}

// ---------- Descargar un gráfico como PNG ----------
// Copia los estilos calculados al clon (así se resuelven las variables CSS) y dibuja el HTML/SVG en un canvas.
// Se omiten animaciones y transiciones para que la imagen salga con el estado final.
function copiarEstilos(origen, copia) {
  const cs = getComputedStyle(origen);
  let css = "";
  for (const p of cs) {
    if (p.startsWith("animation") || p.startsWith("transition")) continue;
    css += `${p}:${cs.getPropertyValue(p)};`;
  }
  copia.setAttribute("style", css);
  for (let i = 0; i < origen.children.length; i++) copiarEstilos(origen.children[i], copia.children[i]);
}

export function descargarPNG(nodo, nombre) {
  if (!nodo) return;
  const caja = nodo.getBoundingClientRect();
  const w = Math.ceil(caja.width);
  const h = Math.ceil(caja.height);
  const clon = nodo.cloneNode(true);
  copiarEstilos(nodo, clon);
  clon.querySelectorAll("[data-sin-png]").forEach((e) => e.remove());
  clon.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clon.style.width = `${w}px`;
  clon.style.height = `${h}px`;
  clon.style.margin = "0";
  clon.style.maxHeight = "none";
  clon.style.overflow = "visible";
  clon.style.background = "#1b1b27";
  const xml = new XMLSerializer().serializeToString(clon);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
  const img = new Image();
  img.onload = () => {
    const esc = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * esc;
    canvas.height = h * esc;
    const ctx = canvas.getContext("2d");
    ctx.scale(esc, esc);
    ctx.fillStyle = "#1b1b27";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nombre}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---------- Trazado de pista ----------
// Cálculo del dibujo de un circuito (eje Y invertido) en un rectángulo ancho x alto.
export function trazoPista(pista, ancho, alto, pad = 8) {
  if (!pista?.x?.length) return null;
  const minX = Math.min(...pista.x);
  const maxX = Math.max(...pista.x);
  const minY = Math.min(...pista.y);
  const maxY = Math.max(...pista.y);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const esc = Math.min((ancho - 2 * pad) / dx, (alto - 2 * pad) / dy);
  const offX = (ancho - dx * esc) / 2;
  const offY = (alto - dy * esc) / 2;
  const pts = pista.x.map((x, i) => [offX + (x - minX) * esc, offY + (maxY - pista.y[i]) * esc]);
  return pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("") + "Z";
}

export const usePistas = () => useApi("/pistas").datos;
