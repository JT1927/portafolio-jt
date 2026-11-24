// Componentes compartidos por todas las pantallas: tooltip, selector accesible, estados de carga/vacío, etc.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ROLES, dec, descargarPNG, pct, trazoPista, useTip } from "./datos";

export function Tip({ tip }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Mide el tooltip y lo mantiene dentro de la ventana.
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    let left = tip.x + 14;
    let top = tip.y + 16;
    if (left + width > window.innerWidth - 8) left = Math.max(8, tip.x - width - 14);
    if (top + height > window.innerHeight - 8) top = Math.max(8, tip.y - height - 12);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div className="tip" role="tooltip" ref={ref} style={{ left: pos.left, top: pos.top }}>
      {tip.contenido}
    </div>,
    document.body
  );
}

// ---------- Selector segmentado accesible (grupo de botones de radio) ----------
export function Segmentado({ opciones, valor, onChange, etiqueta }) {
  const refs = useRef([]);
  const mover = (i, delta) => {
    const n = opciones.length;
    const j = (i + delta + n) % n;
    onChange(opciones[j][0]);
    refs.current[j]?.focus();
  };
  return (
    <div className="segmentado" role="radiogroup" aria-label={etiqueta}>
      {opciones.map(([id, texto], i) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={valor === id}
          tabIndex={valor === id ? 0 : -1}
          ref={(el) => (refs.current[i] = el)}
          onClick={() => onChange(id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              mover(i, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              mover(i, -1);
            }
          }}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

// ---------- Estados de carga y vacío ----------
export function Esqueleto({ filas = 4, grande = false }) {
  return (
    <div className={`esqueleto ${grande ? "grande" : ""}`} role="status" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} style={{ width: `${100 - ((i * 7) % 24)}%` }} />
      ))}
    </div>
  );
}

export function Vacio({ mensaje = "Sin datos para este filtro.", onLimpiar }) {
  return (
    <div className="vacio" role="status">
      <b>{mensaje}</b>
      <span>Prueba con otros filtros o vuelve a ver todo.</span>
      {onLimpiar && (
        <button type="button" className="boton activo suave" onClick={onLimpiar}>
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

export function CabeceraTV({ etiqueta, titulo, children }) {
  return (
    <header className="cab-tv">
      {etiqueta && <div className="cab-tv-et">{etiqueta}</div>}
      <h2>{titulo}</h2>
      {children && <p>{children}</p>}
    </header>
  );
}

export function BotonPNG({ objetivo, nombre }) {
  return (
    <button
      type="button"
      className="btn-png"
      data-sin-png
      onClick={() => descargarPNG(objetivo.current, nombre)}
      aria-label={`Descargar el gráfico ${nombre} como PNG`}
    >
      Descargar PNG
    </button>
  );
}

// ---------- Barras apiladas por rol ----------
// Paradas por piloto según rol, con tooltip propio por tramo.
export function BarrasRoles({ grupos, maxTotal, colorDe }) {
  const { tip, props } = useTip();
  const resumen = (g) => (
    <>
      <b>{g.clave}</b>
      {ROLES.map((r) => (
        <div className="tip-fila" key={r.id}>
          <span><i style={{ background: r.color }} />{r.nombre}</span>
          <span>{dec(g[r.id])}</span>
        </div>
      ))}
      <div className="tip-fila"><span>Total</span><span>{dec(g.total)}</span></div>
      <div className="tip-fila"><span>Pilotos-carrera</span><span>{g.n}</span></div>
    </>
  );
  return (
    <div className="an-barras" role="list" aria-label="Paradas por piloto, separadas por rol">
      {grupos.map((g) => (
        <div
          className="an-fila" role="listitem" key={g.clave} tabIndex={0}
          aria-label={`${g.clave}: ${dec(g.total)} paradas por piloto. ${ROLES.map((r) => `${r.nombre} ${dec(g[r.id])}`).join(", ")}`}
          {...props(resumen(g))}
        >
          <span className="an-fila-et">
            {colorDe && <i className="an-dot" style={{ background: colorDe(g.clave) }} />}
            {g.clave}
          </span>
          <div className="an-pila" aria-hidden="true">
            {ROLES.map((r) => (
              <div
                key={r.id}
                className="an-seg"
                style={{ width: `${(g[r.id] / maxTotal) * 100}%`, background: r.color }}
                {...props(
                  <>
                    <b>{g.clave} · {r.nombre}</b>
                    <div className="tip-fila"><span>Por piloto</span><span>{dec(g[r.id])}</span></div>
                    <div className="tip-fila"><span>Del total</span><span>{pct(g.total ? g[r.id] / g.total : 0)}</span></div>
                  </>
                )}
              />
            ))}
          </div>
          <span className="an-fila-val">{dec(g.total)}</span>
        </div>
      ))}
      <Tip tip={tip} />
    </div>
  );
}

export function PistaMini({ pista, ancho = 120, alto = 72, etiqueta }) {
  const d = useMemo(() => trazoPista(pista, ancho, alto), [pista, ancho, alto]);
  if (!d) return <div className="pista-mini vacia" style={{ width: ancho, height: alto }} aria-hidden="true" />;
  return (
    <svg className="pista-mini" width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta ? `Trazado de ${etiqueta}` : "Trazado de la pista"}>
      <path d={d} fill="none" stroke="#f2f2f8" strokeWidth="5" strokeLinejoin="round" opacity="0.9" />
      <path d={d} fill="none" stroke="#15151e" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

