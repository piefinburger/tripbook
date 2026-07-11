// Server component: renders a layout spec into square book pages.
// `photoUrls` maps photoId -> presigned URL (previews for on-screen preview,
// originals for the print render).
export default function BookPages({ spec, photoUrls, print }) {
  const P = ({ children, className = "" }) => (
    <div className={`bk-page ${className}`}>{children}</div>
  );
  const Img = ({ id, cls }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={cls} src={photoUrls[id]} alt="" />
  );

  return (
    <div className={`bk ${print ? "bk-print" : ""}`}>
      <style>{`
        .bk { font-family: Georgia, "Times New Roman", serif; color: #14343b; }
        .bk-page {
          width: 8.5in; height: 8.5in; overflow: hidden; position: relative;
          background: #fdfcf9; page-break-after: always; break-after: page;
        }
        .bk:not(.bk-print) .bk-page {
          margin: 0 auto 24px; box-shadow: 0 4px 24px rgba(20,52,59,0.2);
          transform-origin: top center;
        }
        @media (max-width: 700px) { .bk:not(.bk-print) .bk-page { zoom: 0.42; } }
        .bk-cover { display: flex; flex-direction: column; justify-content: center;
          align-items: center; text-align: center; padding: 1in; background: #14343b; color: #fdfcf9; }
        .bk-cover h1 { font-size: 44pt; margin: 0 0 12pt; font-weight: 400; }
        .bk-cover p { font-size: 14pt; color: #cfe3ec; letter-spacing: 0.15em;
          text-transform: uppercase; }
        .bk-chapter { display: flex; flex-direction: column; justify-content: flex-end;
          padding: 0.9in; }
        .bk-chapter h2 { font-size: 28pt; margin: 0 0 10pt; font-weight: 400; }
        .bk-chapter .nar { font-size: 12pt; line-height: 1.7; max-width: 5.5in; }
        .bk-chapter::before { content: ""; position: absolute; top: 0.9in; left: 0.9in;
          width: 1.4in; height: 5px; background: #f2b441; }
        .full-bleed img { position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; }
        .full-bleed .cap, .grid-cap {
          position: absolute; left: 0.5in; right: 0.5in; bottom: 0.4in;
          background: rgba(20,52,59,0.82); color: #fdfcf9; padding: 8pt 12pt;
          font-size: 10.5pt; font-style: italic; width: fit-content; max-width: 6in; }
        .two-up, .three-grid { display: grid; gap: 0.18in; padding: 0.45in; height: 100%; }
        .two-up { grid-template-rows: 1fr 1fr; }
        .three-grid { grid-template-rows: 2fr 1fr; grid-template-columns: 1fr 1fr; }
        .three-grid img:first-child { grid-column: 1 / -1; }
        .two-up img, .three-grid img { width: 100%; height: 100%; object-fit: cover;
          border-radius: 4px; }
        .photo-text { display: grid; grid-template-rows: 3fr 2fr; height: 100%; }
        .photo-text img { width: 100%; height: 100%; object-fit: cover; }
        .photo-text .txt, .text-only .txt { padding: 0.6in 0.9in; font-size: 11.5pt;
          line-height: 1.75; }
        .text-only { display: flex; align-items: center; }
        .cap-plain { padding: 0 0.9in 0.4in; font-size: 10pt; font-style: italic;
          color: #4a6a70; }
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
      {(ch.pages || []).map((pg, pi) => {
        const ids = pg.photoIds || [];
        if (pg.template === "full-bleed" && ids[0] != null) return (
          <P key={pi} className="full-bleed">
            <Img id={ids[0]} />
            {pg.caption ? <div className="cap">{pg.caption}</div> : null}
          </P>);
        if (pg.template === "two-up") return (
          <P key={pi}><div className="two-up">
            {ids.slice(0, 2).map(id => <Img key={id} id={id} />)}
          </div>{pg.caption ? <div className="grid-cap">{pg.caption}</div> : null}</P>);
        if (pg.template === "three-grid") return (
          <P key={pi}><div className="three-grid">
            {ids.slice(0, 3).map(id => <Img key={id} id={id} />)}
          </div>{pg.caption ? <div className="grid-cap">{pg.caption}</div> : null}</P>);
        if (pg.template === "photo-text" && ids[0] != null) return (
          <P key={pi} className="photo-text">
            <Img id={ids[0]} />
            <div className="txt">{pg.text || pg.caption}</div>
          </P>);
        if (pg.template === "text-only") return (
          <P key={pi} className="text-only"><div className="txt">{pg.text}</div></P>);
        return null;
      })}
    </>
  );
}
