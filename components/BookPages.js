// Server component: renders a layout spec into square book pages.
// `photoUrls` maps photoId -> presigned URL (previews for on-screen preview,
// originals for the print render).
import { slotImgStyle } from "@/lib/photoStyle";

export default function BookPages({ spec, photoUrls, print }) {
  const P = ({ children, className = "" }) => (
    <div className={`bk-page ${className}`}>{children}</div>
  );
  // Img wraps each photo in an overflow:hidden div so transform:scale clips
  // correctly within its grid cell (without the wrapper, scale overflows into
  // adjacent cells since CSS Grid items don't clip by default).
  const Img = ({ id, cls = "", style }) => {
    const imgStyle = slotImgStyle(style);
    // eslint-disable-next-line @next/next/no-img-element
    const img = <img src={photoUrls[id]} alt="" style={imgStyle} />;
    if (style?.scale && style.scale !== 1) {
      return (
        <div className={cls} style={{ overflow: "hidden", width: "100%", height: "100%" }}>
          {img}
        </div>
      );
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cls} src={photoUrls[id]} alt="" style={imgStyle} />;
  };

  return (
    <div className={`bk ${print ? "bk-print" : ""}`}>
      <style>{`
        /* ── base (book-render specific) ── */
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

        /* ── image rules (renderer only — editor uses inline styles on pg-slot img) ── */
        .bk-page img { display: block; width: 100%; height: 100%; object-fit: cover; }

        /* ── caption styles ── */
        .cap-overlay {
          position: absolute; left: 0.5in; right: auto; bottom: 0.4in;
          background: rgba(20,52,59,0.82); color: #fdfcf9; padding: 8pt 12pt;
          font-size: 10.5pt; font-style: italic; max-width: 6in;
        }
        .cap-below {
          padding: 0.15in 0.35in 0; font-size: 10pt; font-style: italic;
          color: #4a6a70; line-height: 1.4; flex-shrink: 0;
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
  const styles = pg.photoStyles || {};
  const ov = pg.layoutOverrides || {};
  // Inline style overrides for per-page grid proportions
  const colStyle = ov.columns ? { gridTemplateColumns: ov.columns } : {};
  const rowStyle = ov.rows ? { gridTemplateRows: ov.rows } : {};
  const ovStyle = { ...colStyle, ...rowStyle };
  // StyledImg: auto-applies photoStyles crop/zoom for this page's photos
  const SI = ({ id, cls }) => <Img id={id} cls={cls} style={styles[id]} />;

  switch (pg.template) {

    // ── single-photo ──────────────────────────────────────────
    case "full-bleed":
      if (!ids[0]) return null;
      return (
        <P className="tpl-full-bleed">
          <SI id={ids[0]} />
          {cap && <div className="cap-overlay">{cap}</div>}
        </P>
      );

    case "photo-text":
      if (!ids[0]) return null;
      return (
        <P className="tpl-photo-text" style={rowStyle}>
          <SI id={ids[0]} />
          <div className="txt-block">{txt}</div>
        </P>
      );

    case "text-photo":
      if (!ids[0]) return null;
      return (
        <P className="tpl-text-photo" style={colStyle}>
          <div className="txt-block">{txt}</div>
          <SI id={ids[0]} />
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
          <div className="tpl-two-equal bk-grid" style={colStyle}>
            {ids.slice(0, 2).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "hero-left":
      return (
        <P>
          <div className="tpl-hero-left bk-grid" style={colStyle}>
            {ids.slice(0, 2).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "hero-right":
      return (
        <P>
          <div className="tpl-hero-right bk-grid" style={colStyle}>
            {ids.slice(0, 2).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "hero-top":
      return (
        <P>
          <div className="tpl-hero-top bk-grid" style={rowStyle}>
            {ids.slice(0, 2).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── three-photo ───────────────────────────────────────────
    case "three-banner":
    case "three-grid": // legacy alias
      return (
        <P>
          <div className="tpl-three-banner bk-grid" style={rowStyle}>
            {ids.slice(0, 3).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "three-sidebar":
      return (
        <P>
          <div className="tpl-three-sidebar bk-grid" style={colStyle}>
            {ids.slice(0, 3).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "panoramic-strip":
      return (
        <P>
          <div className="tpl-panoramic-strip bk-grid" style={rowStyle}>
            {ids.slice(0, 3).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── four-photo ────────────────────────────────────────────
    case "four-grid":
      return (
        <P>
          <div className="tpl-four-grid bk-grid" style={ovStyle}>
            {ids.slice(0, 4).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    case "four-asymmetric":
      return (
        <P>
          <div className="tpl-four-asymmetric bk-grid" style={ovStyle}>
            {ids.slice(0, 4).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    // ── five-photo ────────────────────────────────────────────
    case "five-mosaic":
      return (
        <P>
          <div className={`tpl-five-mosaic`}>
            <SI id={ids[0]} cls="bk-grid" />
            <div className="mosaic-right">
              {ids.slice(1, 5).map(id => <SI key={id} id={id} cls="bk-grid" />)}
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
            {ids.slice(0, 6).map(id => <SI key={id} id={id} />)}
          </div>
          {cap && <div className="cap-below">{cap}</div>}
        </P>
      );

    default:
      return null;
  }
}
