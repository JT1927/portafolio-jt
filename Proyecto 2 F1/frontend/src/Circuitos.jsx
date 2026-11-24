import { useMemo, useRef, useState } from "react";
import { BotonPNG, CabeceraTV, Esqueleto, PistaMini, Segmentado, Tip } from "./comun";
import { ROLES, dec, media, useApi, usePistas, useTip } from "./datos";

const ORDENES = [
  ["libres", "Más paradas libres"],
  ["reactivas", "Más reactivas"],
  ["degradacion", "Más degradación"],
  ["largo", "Largo de pista"],
  ["az", "A–Z"],
];

export default function Circuitos() {
  const { datos, error } = useApi("/analisis");
  const pistas = usePistas();
  const [orden, setOrden] = useState("libres");
  const { tip, props } = useTip();
  const ref = useRef(null);

  const filas = useMemo(() => {
    if (!datos) return [];
    const porCircuito = new Map();
    for (const p of datos.pilotos) {
      if (!porCircuito.has(p.circuito)) porCircuito.set(p.circuito, []);
      porCircuito.get(p.circuito).push(p);
    }
    return datos.circuitos.map((c) => {
      const arr = porCircuito.get(c.circuit_short_name) ?? [];
      const f = { nombre: c.circuit_short_name, carreras: c.carreras, largo: c.longitud_km, pit: c.tiempo_pit_lane_s, deg: c.degradacion_s_por_vuelta };
      ROLES.forEach((r) => {
        f[r.id] = media(arr.map((p) => p[r.id] || 0));
      });
      f.total = ROLES.reduce((a, r) => a + f[r.id], 0);
      return f;
    });
  }, [datos]);

  const ordenadas = useMemo(() => {
    const por = {
      libres: (a, b) => b.paradas_libres - a.paradas_libres,
      reactivas: (a, b) => b.paradas_reactivas - a.paradas_reactivas,
      degradacion: (a, b) => (b.deg ?? -Infinity) - (a.deg ?? -Infinity),
      largo: (a, b) => (b.largo ?? 0) - (a.largo ?? 0),
      az: (a, b) => a.nombre.localeCompare(b.nombre),
    }[orden];
    return [...filas].sort(por);
  }, [filas, orden]);

  if (error) return <p className="error-caja">No pude cargar los datos: {error}</p>;
  if (!datos) {
    return (
      <section className="pagina">
        <CabeceraTV etiqueta="Circuitos" titulo="Cada pista tiene su estrategia" />
        <Esqueleto filas={6} grande />
      </section>
    );
  }

  const maxTotal = Math.max(0.01, ...filas.map((f) => f.total));

  return (
    <section className="pagina">
      <CabeceraTV etiqueta="Circuitos" titulo="Cada pista tiene su estrategia">
        Paradas por piloto en cada uno de los {filas.length} circuitos, separadas por tipo. Las obligatorias las fija el reglamento; lo que cambia de pista en pista son las libres y las reactivas.
      </CabeceraTV>

      <div className="tarjeta">
        <div className="tarjeta-cab">
          <Segmentado etiqueta="Ordenar circuitos por" valor={orden} onChange={setOrden} opciones={ORDENES} />
          <BotonPNG objetivo={ref} nombre="circuitos" />
        </div>
        <div className="leyenda-gr">
          {ROLES.map((r) => <span key={r.id}><i style={{ background: r.color }} />{r.nombre}</span>)}
        </div>
      </div>

      <div className="circuitos-grilla" ref={ref}>
        {ordenadas.map((f) => {
          const pocas = f.carreras != null && f.carreras < 2;
          return (
            <article className="circ-tarjeta" key={f.nombre}>
              <div className="circ-cab">
                <div>
                  <h3>{f.nombre}</h3>
                  <small className={pocas ? "poco" : ""}>
                    {f.carreras} {f.carreras === 1 ? "carrera" : "carreras"}{pocas ? " · pocos datos" : ""}
                  </small>
                </div>
                <PistaMini pista={pistas?.[f.nombre]} etiqueta={f.nombre} ancho={110} alto={66} />
              </div>
              <div
                className="circ-barra" role="img"
                aria-label={`${f.nombre}: ${ROLES.map((r) => `${r.nombre} ${dec(f[r.id])}`).join(", ")} paradas por piloto`}
              >
                {ROLES.map((r) => (
                  <div
                    key={r.id} style={{ width: `${(f[r.id] / maxTotal) * 100}%`, background: r.color }}
                    {...props(<><b>{f.nombre} · {r.nombre}</b><div className="tip-fila"><span>Por piloto</span><span>{dec(f[r.id])}</span></div></>)}
                  />
                ))}
              </div>
              <dl className="circ-datos">
                <div><dt>Paradas</dt><dd>{dec(f.total, 1)}</dd></div>
                <div><dt>Libres</dt><dd>{dec(f.paradas_libres, 1)}</dd></div>
                <div><dt>Largo</dt><dd>{f.largo != null ? `${dec(f.largo, 2)} km` : "–"}</dd></div>
                <div><dt>Pit lane</dt><dd>{f.pit != null ? `${dec(f.pit, 1)} s` : "–"}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
      <Tip tip={tip} />
    </section>
  );
}
