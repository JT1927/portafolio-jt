import { useMemo } from "react";
import "./Inicio.css";
import { Esqueleto, Tip } from "./comun";
import { ROLES, con, dec, pct, useApi, useTip } from "./datos";

const ROL_DE = Object.fromEntries(ROLES.map((r) => [r.rol, r]));

export default function Inicio({ onIr }) {
  const { datos: g, error } = useApi("/resumen/general");
  const { datos: act } = useApi("/actualizado", { cache: false });
  const { tip, props } = useTip();

  const comparacion = useMemo(() => {
    if (!g?.circuitos_roles?.length) return [];
    const cs = g.circuitos_roles;
    const media = (id) => cs.reduce((a, c) => a + c[id], 0) / cs.length;
    const max = (id) => cs.reduce((a, c) => (c[id] > a[id] ? c : a));
    const min = (id) => cs.reduce((a, c) => (c[id] < a[id] ? c : a));
    const filas = [
      { nombre: "Promedio", nota: `${cs.length} circuitos`, base: true, ...Object.fromEntries(ROLES.map((r) => [r.rol, media(r.rol)])) },
    ];
    const vistos = new Set();
    const agregar = (c, nota) => {
      if (vistos.has(c.circuito)) return;
      vistos.add(c.circuito);
      filas.push({ nombre: c.circuito, nota, ...Object.fromEntries(ROLES.map((r) => [r.rol, c[r.rol]])) });
    };
    const masLibres = max("libre");
    const menosLibres = min("libre");
    const masReactivas = max("reactiva");
    agregar(masLibres, `${dec(masLibres.libre, 1)} libres por piloto`);
    agregar(menosLibres, `${dec(menosLibres.libre, 1)} libres por piloto`);
    agregar(masReactivas, `${dec(masReactivas.reactiva, 1)} reactivas por piloto`);
    return filas;
  }, [g]);

  if (error) return <p className="error-caja">No pude cargar el resumen: {error}. ¿Está corriendo el backend?</p>;

  const roles = g?.roles;
  const circ = g?.varianza_libres?.circuito;
  const eq = g?.varianza_libres?.equipo;
  const maxFila = comparacion.length ? Math.max(...comparacion.map((f) => ROLES.reduce((a, r) => a + f[r.rol], 0))) : 1;
  const masLibresCirc = g?.circuitos_roles?.length ? g.circuitos_roles.reduce((a, c) => (c.libre > a.libre ? c : a)) : null;
  const menosLibresCirc = g?.circuitos_roles?.length ? g.circuitos_roles.reduce((a, c) => (c.libre < a.libre ? c : a)) : null;
  const m = g?.mejor_modelo_libres;
  const efecto = g?.efecto_libres_posiciones;

  const hallazgos = g
    ? [
        roles && {
          t: "Casi todo es obligación",
          d: <>El reglamento exige <b>{pct(roles.obligatoria.pct)}</b> de las paradas. La estrategia libre, la que decide cada equipo, es solo el <b>{pct(roles.libre.pct)}</b>.</>,
        },
        circ != null && eq != null && {
          t: "Manda la pista, no el equipo",
          d: <>El circuito explica el <b>{pct(circ)}</b> de la variación en paradas libres; el equipo, <b>{pct(Math.max(0, eq))}</b>.</>,
        },
        masLibresCirc && menosLibresCirc && {
          t: "Pistas muy distintas",
          d: <>En <b>{masLibresCirc.circuito}</b> se hacen {dec(masLibresCirc.libre, 1)} paradas libres por piloto; en <b>{menosLibresCirc.circuito}</b>, {dec(menosLibresCirc.libre, 1)}.</>,
        },
        g.correlacion_degradacion_libres != null && {
          t: "El neumático decide",
          d: <>Entre circuitos, más degradación se asocia a más paradas libres (correlación <b>{dec(g.correlacion_degradacion_libres)}</b>).</>,
        },
        efecto && {
          t: "Parar más no gana posiciones",
          d: <>Una parada libre extra se asocia a <b>{con(efecto.coeficiente)} posiciones</b> (IC 95 %: {dec(efecto.IC95_bajo, 1)} a {dec(efecto.IC95_alto, 1)}). Es asociación, no causa.</>,
        },
      ].filter(Boolean)
    : [];

  return (
    <section className="inicio">
      <header className="in-hero">
        <div className="in-et">Portafolio de ciencia de datos · Proyecto 2</div>
        <h2>
          La <span>pista</span> decide la estrategia más que el equipo
        </h2>
        <p className="in-lead">
          {g ? (
            <>
              Clasifiqué las {g.paradas_total.toLocaleString("es-CL")} paradas de {g.carreras} carreras de Fórmula 1 (2023–2026) según el reglamento de la FIA:
              obligatorias, libres, reactivas y de clima. Solo las libres son estrategia real
              {circ != null && eq != null && (
                <>
                  , y el circuito explica el <b>{pct(circ)}</b> de ellas; el equipo, el <b>{pct(Math.max(0, eq))}</b>
                </>
              )}
              .
            </>
          ) : (
            "Cargando el resumen de las carreras…"
          )}
        </p>
        <div className="in-botones">
          <button className="boton activo" onClick={() => onIr("replay")}>Ver el replay</button>
          <button className="boton" onClick={() => onIr("analisis")}>Explorar el análisis</button>
          <button className="boton" onClick={() => onIr("porque")}>Cómo lo medí</button>
        </div>
        {g ? (
          <dl className="in-datos">
            <div><dt>Carreras</dt><dd>{g.carreras}</dd></div>
            <div><dt>Circuitos</dt><dd>{g.circuitos}</dd></div>
            <div><dt>Paradas clasificadas</dt><dd>{g.paradas_total.toLocaleString("es-CL")}</dd></div>
            {m && (
              <div>
                <dt>Circuito nunca visto</dt>
                <dd>R² {dec(m.r2)}<small>error {dec(m.mae_promedio)} → {dec(m.mae_modelo)} paradas</small></dd>
              </div>
            )}
          </dl>
        ) : (
          <Esqueleto filas={1} />
        )}
      </header>

      {roles && (
        <section className="in-bloque" aria-labelledby="in-roles">
          <h3 className="in-titulo" id="in-roles">Qué tipo de paradas hacen los equipos</h3>
          <div className="in-roles">
            {ROLES.map((r) => (
              <div className="kpi" key={r.rol} style={{ "--kpi-color": r.color }} title={r.ayuda}>
                <span className="et">{r.nombre}</span>
                <b className="num">{pct(roles[r.rol].pct)}</b>
                <span className="sub2">{roles[r.rol].n.toLocaleString("es-CL")} paradas</span>
              </div>
            ))}
          </div>
          <div className="in-barra-total" role="img" aria-label={ROLES.map((r) => `${r.nombre} ${pct(roles[r.rol].pct)}`).join(", ")}>
            {ROLES.map((r) => (
              <div key={r.rol} style={{ width: `${roles[r.rol].pct * 100}%`, background: r.color }}
                {...props(<><b>{r.nombre}</b><div className="tip-fila"><span>Paradas</span><span>{roles[r.rol].n}</span></div><span>{r.ayuda}</span></>)}>
                {roles[r.rol].pct >= 0.08 ? pct(roles[r.rol].pct) : ""}
              </div>
            ))}
          </div>
        </section>
      )}

      {hallazgos.length > 0 && (
        <section className="in-bloque" aria-labelledby="in-hallazgos">
          <h3 className="in-titulo" id="in-hallazgos">Hallazgos</h3>
          <ol className="in-hallazgos">
            {hallazgos.map((h) => (
              <li key={h.t}><b>{h.t}</b><p>{h.d}</p></li>
            ))}
          </ol>
        </section>
      )}

      {comparacion.length > 0 && (
        <section className="in-bloque" aria-labelledby="in-pistas">
          <h3 className="in-titulo" id="in-pistas">Misma parrilla, otra pista, otra estrategia</h3>
          <p className="in-nota">Paradas por piloto y por carrera, separadas por tipo.</p>
          <div className="in-tabla">
            {comparacion.map((f) => (
              <div className={`in-fila ${f.base ? "base" : ""}`} key={f.nombre}>
                <div className="in-fila-nombre">
                  <b>{f.nombre}</b>
                  <span>{f.nota}</span>
                </div>
                <div className="in-barra" role="img" aria-label={`${f.nombre}: ${ROLES.map((r) => `${r.nombre} ${dec(f[r.rol])}`).join(", ")} paradas por piloto`}>
                  {ROLES.map((r) => (
                    <div
                      key={r.rol} style={{ width: `${(f[r.rol] / maxFila) * 100}%`, background: r.color }}
                      {...props(<><b>{f.nombre} · {ROL_DE[r.rol].nombre}</b><div className="tip-fila"><span>Por piloto</span><span>{dec(f[r.rol])}</span></div></>)}
                    >
                      {f[r.rol] / maxFila >= 0.1 ? dec(f[r.rol], 1) : ""}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="in-leyenda">
            {ROLES.map((r) => <span key={r.rol}><i style={{ background: r.color }} />{r.nombre}</span>)}
          </div>
        </section>
      )}
      <Tip tip={tip} />

      <section className="in-bloque" aria-labelledby="in-como">
        <h3 className="in-titulo" id="in-como">Cómo está hecho</h3>
        <ol className="in-pasos">
          <li><b>Datos</b><p>API de OpenF1: stints, paradas, clima, banderas, vueltas y posiciones.</p></li>
          <li><b>SQL</b><p>SQLite con una fila por piloto y carrera, y un solo comando que la actualiza.</p></li>
          <li><b>Clasificación</b><p>Cada parada se etiqueta con el reglamento FIA y las ventanas de bandera de Race Control; después, modelos con validación por circuito.</p></li>
          <li><b>App</b><p>FastAPI de backend y React para el replay y los gráficos.</p></li>
        </ol>
        <p className="in-limites">
          <b>Límites.</b> La parrilla es la clasificación, la degradación usa una corrección de combustible fija, los stints de OpenF1 se fusionan por edad de neumático y hay circuitos con pocas carreras. El replay muestra el orden en pista, que puede diferir del resultado oficial por sanciones posteriores.
        </p>
      </section>

      <footer className="in-pie">
        <span>
          Hecho por Jorge Tapia · Datos: OpenF1
          {act?.ultima && (
            <>
              {" · "}
              <b>Datos hasta: {act.ultima.circuito} {act.ultima.year}</b> ({act.ultima.fecha})
            </>
          )}
        </span>
        <a href="https://github.com/JT1927/portafolio-jt" target="_blank" rel="noreferrer">GitHub · portafolio-jt</a>
      </footer>
    </section>
  );
}
