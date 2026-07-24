// Server component: renders a layout spec into square book pages.
// `photoUrls` maps photoId -> presigned URL (previews for on-screen preview,
// originals for the print render).
export default function BookPages({ spec, photoUrls, print }) {
  const P = ({ children, className = "" }) => (
    <div className={`bk-page ${className}`}>{children}</div>
  );
  const Img = ({ id, cls = "" }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={cls} src={photoUrls[id]} alt="" />
  );

  return (
    <div className={`bk ${print ? "bk-print" : ""}`}>
      <style>{`
        /* ── base ── */
        .bk { font-family: Georgia, "Times New Roman", serif; color: #14343b; }
        .bk-page {
          width: 8.5in; height: 8.5in; overflow: hidden; position: relative;
          background: #fdfcf9; page-break-after: always; break-after: page;
          box-sizing: border-box;
        }
        .bk:not(.bk-print) .bk-page {
          margin: 0 auto 24px; box-shadow: 0 4px 24px rgba(20,52,59,0.2);
          transform-origin: top center;
        }
        @media (max-width: 700px) { .bk:not(.bk-print) .bk-page { zoom: 0.42; } }

        /* ── cover ── */
        .bk-cover { display: flex; flex-direction: column; justify-content: center;
          align-items: center; text-align: center; padding: 1in; background: #14343b; color: #fdfcf9; }
        .bk-cover h1 { font-size: 44pt; margin: 0 0 12pt; font-weight: 400; }
        .bk-cover p { font-size: 14pt; color: #cfe3ec; letter-spacing: 0.15em;
          text-transform: uppercase; }

        /* ── chapter opener ── */
        .bk-chapter { display: flex; flex-direction: column; justify-content: flex-end;
          padding: 0.9in; }
        .bk-chapter h2 { font-size: 28pt; margin: 0 0 10pt; font-weight: 400; }
        .bk-chapter .nar { font-size: 12pt; line-height: 1.7; max-width: 5.5in; white-space: pre-wrap; }
        .bk-chapter::before { content: ""; position: absolute; top: 0.9in; left: 0.9in;
          width: 1.4in; height: 5px; background: #f2b441; }

        /* ── shared image rules ── */
        .bk-page img { display: block; width: 100%; height: 100%; object-fit: cover; }
        .bk-grid img { border-radius: 6px; }

        /* ── caption styles ── */
        .cap-overlay {
          position: absolute; left: 0.5in; right: auto; bottom: 0.4in;
          background: rgba(20,52,59,0.82); color: #fdfcf9; padding: 8pt 12pt;
          font-size: 10.5pt; font-style: italic; max-width: 6in;
        }
        .cap-below {
          padding: 0.15in 0.35in 0 ; font-size: 10pt; font-style: italic;
          color: #4a6a70; line-height: 1.4;
          flex-shrink: 0;
        }

        /* ── text block ── */
        .txt-block { padding: 0.5in 0.7in; font-size: 11.5pt; line-height: 1.75;
          white-space: pre-wrap; overflow: hidden; }

        /* ═══════════════════════════════════════════════════
           SINGLE-PHOTO TEMPLATES
           ═══════════════════════════════════════════════════ */

        /* full-bleed: hero image fills entire page */
        .tpl-full-bleed { display: grid; grid-template-rows: 1fr; }
        .tpl-full-bleed img { position: absolute; inset: 0; width: 100%; height: 100%; }

        /* photo-text: photo top ~60%, text below */
        .tpl-photo-text { display: grid; grid-template-rows: 3fr 2fr; }

        /* text-photo: text left ~45%, photo right */
        .tpl-text-photo { display: grid; grid-template-columns: 9fr 11fr; }

        /* text-only: narrative / chapter opener body */
        .tpl-text-only { display: flex; align-items: center; }

        /* ═══════════════════════════════════════════════════
           TWO-PHOTO TEMPLATES
           ═══════════════════════════════════════════════════ */
        .tpl-two-equal,
        .tpl-hero-left,
        .tpl-hero-right,
        .tpl-hero-top {
          display: grid; gap: 0.2in; padding: 0.35in; height: 100%;
          box-sizing: border-box;
        }
        /* two-equal: side by side */
        .tpl-two-equal { grid-template-columns: 1fr 1fr; }
        /* hero-left: left ~70%, right ~30% */
        .tpl-hero-left { grid-template-columns: 7fr 3fr; }
        /* hero-right: right ~70%, left ~30% */
        .tpl-hero-right { grid-template-columns: 3fr 7fr; }
        /* hero-top: top ~65%, bottom ~35% */
        .tpl-hero-top { grid-template-rows: 13fr 7fr; grid-template-columns: 1fr; }

        /* ═══════════════════════════════════════════════════
           THREE-PHOTO TEMPLATES
           ═══════════════════════════════════════════════════ */
        .tpl-three-banner,
        .tpl-three-sidebar,
        .tpl-panoramic-strip {
          display: grid; gap: 0.2in; padding: 0.35in; height: 100%;
          box-sizing: border-box;
        }
        /* three-banner: wide top, two equal below */
        .tpl-three-banner { grid-template-rows: 3fr 2fr; grid-template-columns: 1fr 1fr; }
        .tpl-three-banner img:first-child { grid-column: 1 / -1; }
        /* three-sidebar: large left, two stacked right */
        .tpl-three-sidebar { grid-template-columns: 3fr 2fr; grid-template-rows: 1fr 1fr; }
        .tpl-three-sidebar img:first-child { grid-row: 1 / -1; }
        /* panoramic-strip: three equal horizontal bands */
        .tpl-panoramic-strip { grid-template-rows: 1fr 1fr 1fr; grid-template-columns: 1fr; }

        /* ═══════════════════════════════════════════════════
           FOUR-PHOTO TEMPLATES
           ═══════════════════════════════════════════════════ */
        .tpl-four-grid,
        .tpl-four-asymmetric {
          display: grid; gap: 0.2in; padding: 0.35in; height: 100%;
          box-sizing: border-box;
        }
        /* four-grid: 2×2 equal */
        .tpl-four-grid { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
        /* four-asymmetric: large top-left, three smaller */
        .tpl-four-asymmetric {
          grid-template-columns: 3fr 2fr;
          grid-template-rows: 3fr 2fr;
        }
        .tpl-four-asymmetric img:first-child { grid-row: 1; grid-column: 1; }
        .tpl-four-asymmetric img:nth-child(2) { grid-row: 1; grid-column: 2; }
        .tpl-four-asymmetric img:nth-child(3) { grid-row: 2; grid-column: 1; }
        .tpl-four-asymmetric img:nth-child(4) { grid-row: 2; grid-column: 2; }

        /* ═══════════════════════════════════════════════════
           FIVE-PHOTO TEMPLATE
           ═══════════════════════════════════════════════════ */
        .tpl-five-mosaic {
          display: grid; gap: 0.2in; padding: 0.35in; height: 100%;
          box-sizing: border-box;
          grid-template-columns: 3fr 2fr;
          grid-template-rows: 1fr 1fr;
        }
        .tpl-five-mosaic img:first-child { grid-row: 1 / -1; }
        /* right column: 2×2 sub-grid */
        .tpl-five-mosaic .mosaic-right {
          display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
          gap: 0.2in; grid-row: 1 / -1;
        }
        .tpl-five-mosaic .mosaic-right img { width: 100%; height: 100%; }

        /* ═══════════════════════════════════════════════════
           SIX-PHOTO TEMPLATE
           ═══════════════════════════════════════════════════ */
        .tpl-six-grid {
          display: grid; gap: 0.2in; padding: 0.35in; height: 100%;
          box-sizing: border-box;
          grid-template-columns: 1fr 1fr 1fr;
          grid-template-rows: 1fr 1fr;
        }
      `}</style>

      <P className="bk-cover">
        <h1>{spec.title}</h1>
        <p>{spec.subtitle}</p>
      </P>

      {(spec.chapters || []).map((ch, ci) => (
        <ChapterPages key={ci} ch={ch} Img={Img} P={P} />
      ))}
    </div>
  );
}

function ChapterPages({ ch, Img, P }) {
  return (
    <>
      <P className="bk-chapter">
        <h2>{ch.title}</h2>
        {ch.narrative ? <div className="nar">{ch.narrative}</div> : null}
      </P>
      {(ch.pages || []).map((pg, pi) => <PageRenderer key={pi} pg={pg} Img={Img} P={P} />)}
    </>
  );
}

function PageRenderer({ pg, Img, P }) {
  const ids = pg.photoIds || [];
  const cap = pg.caption || null;
  const txt = pg.text || pg.caption || null;

  switch (pg.template) {

    // ── single-photo ──────────────────────────────────────────
    case "full-bleed":
      if (!ids[0]) return null;
      return (
        <P className="tpl-full-bleed">
          <Img id={ids[0]} />
          {cap && <div className="cap-overlay">{cap}</div>}
        </P>
      );

    case "photo-text":
      if (!ids[0]) return null;
      return (
        <P className="tpl-photo-text">
          <Img id={ids[0]} />
          <div className="txt-block">{txt}</div>
        </P>
      );

    case "text-photo":
      if (!ids[0]) return null;
      return (
        <P className="tpl-text-photo">
          <div className="txt-block">{txt}</div>
          <Img id={ids[0]} />
        </P>
      );

    case "text-only":
      return (
        <P className="tpl-text-only">
          <div className="txt-block">{pg.text}</div>
        </P>
      );

    // ── two-photo ─────────────────────────────────────────────
    case "two-equal":
    case "two-up": // legacy alias
      return (
        <P>
          <div className={`tpl-two-equal bk-grid`}>
            {ids.slice(0, 2).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "hero-left":
      return (
        <P>
          <div className={`tpl-hero-left bk-grid`}>
            {ids.slice(0, 2).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "hero-right":
      return (
        <P>
          <div className={`tpl-hero-right bk-grid`}>
            {ids.slice(0, 2).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "hero-top":
      return (
        <P>
          <div className={`tpl-hero-top bk-grid`}>
            {ids.slice(0, 2).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── three-photo ───────────────────────────────────────────
    case "three-banner":
    case "three-grid": // legacy alias
      return (
        <P>
          <div className={`tpl-three-banner bk-grid`}>
            {ids.slice(0, 3).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "three-sidebar":
      return (
        <P>
          <div className={`tpl-three-sidebar bk-grid`}>
            {ids.slice(0, 3).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "panoramic-strip":
      return (
        <P>
          <div className={`tpl-panoramic-strip bk-grid`}>
            {ids.slice(0, 3).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── four-photo ────────────────────────────────────────────
    case "four-grid":
      return (
        <P>
          <div className={`tpl-four-grid bk-grid`}>
            {ids.slice(0, 4).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "four-asymmetric":
      return (
        <P>
          <div className={`tpl-four-asymmetric bk-grid`}>
            {ids.slice(0, 4).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── five-photo ────────────────────────────────────────────
    case "five-mosaic":
      return (
        <P>
          <div className={`tpl-five-mosaic`}>
            <Img id={ids[0]} cls="bk-grid" />
            <div className="mosaic-right">
              {ids.slice(1, 5).map(id => <Img key={id} id={id} cls="bk-grid" />)}
            </div>
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── six-photo ─────────────────────────────────────────────
    case "six-grid":
      return (
        <P>
          <div className={`tpl-six-grid bk-grid`}>
            {ids.slice(0, 6).map(id => <Img key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    default:
      return null;
  }
}
