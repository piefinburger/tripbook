"use client";
// Visual template picker (SPEC-WYSIWYG-EDITOR D6).
// Pure-CSS thumbnail diagrams for all 15 templates.

const TEMPLATES = [
  { id: "full-bleed",      label: "Full bleed",     photos: 1 },
  { id: "hero-left",       label: "Hero left",      photos: 2 },
  { id: "hero-right",      label: "Hero right",     photos: 2 },
  { id: "hero-top",        label: "Hero top",       photos: 2 },
  { id: "two-equal",       label: "Two equal",      photos: 2 },
  { id: "three-banner",    label: "Banner",         photos: 3 },
  { id: "three-sidebar",   label: "Sidebar",        photos: 3 },
  { id: "panoramic-strip", label: "Strip",          photos: 3 },
  { id: "four-grid",       label: "4 grid",         photos: 4 },
  { id: "four-asymmetric", label: "4 asymmetric",   photos: 4 },
  { id: "five-mosaic",     label: "Mosaic",         photos: 5 },
  { id: "six-grid",        label: "6 grid",         photos: 6 },
  { id: "photo-text",      label: "Photo + text",   photos: 1 },
  { id: "text-photo",      label: "Text + photo",   photos: 1 },
  { id: "text-only",       label: "Text only",      photos: 0 },
];

export default function TemplatePicker({ current, onChange }) {
  return (
    <div className="tpl-picker">
      {TEMPLATES.map(t => (
        <button
          key={t.id}
          className={`tpl-thumb ${t.id === current ? "tpl-thumb-active" : ""}`}
          onClick={() => onChange(t.id)}
          title={`${t.label} (${t.photos} photo${t.photos === 1 ? "" : "s"})`}
        >
          <TplDiagram id={t.id} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function Box({ style }) {
  return <div style={{ background: "rgba(20,52,59,0.25)", borderRadius: 2, ...style }} />;
}

function Lines() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 0" }}>
      {[75, 90, 60].map((w, i) => (
        <div key={i} style={{ height: 2, width: `${w}%`, background: "rgba(20,52,59,0.25)", borderRadius: 1 }} />
      ))}
    </div>
  );
}

function TplDiagram({ id }) {
  const s = { display: "flex", width: 48, height: 48, gap: 2, padding: 2, boxSizing: "border-box" };

  switch (id) {
    case "full-bleed":
      return <div style={{ ...s }}><Box style={{ flex: 1 }} /></div>;

    case "hero-left":
      return <div style={{ ...s }}><Box style={{ flex: 7 }} /><Box style={{ flex: 3 }} /></div>;

    case "hero-right":
      return <div style={{ ...s }}><Box style={{ flex: 3 }} /><Box style={{ flex: 7 }} /></div>;

    case "hero-top":
      return <div style={{ ...s, flexDirection: "column" }}><Box style={{ flex: 13 }} /><Box style={{ flex: 7 }} /></div>;

    case "two-equal":
      return <div style={{ ...s }}><Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} /></div>;

    case "three-banner":
      return (
        <div style={{ ...s, flexDirection: "column" }}>
          <Box style={{ flex: 3 }} />
          <div style={{ flex: 2, display: "flex", gap: 2 }}>
            <Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} />
          </div>
        </div>
      );

    case "three-sidebar":
      return (
        <div style={{ ...s }}>
          <Box style={{ flex: 3 }} />
          <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            <Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} />
          </div>
        </div>
      );

    case "panoramic-strip":
      return (
        <div style={{ ...s, flexDirection: "column" }}>
          <Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} />
        </div>
      );

    case "four-grid":
      return (
        <div style={{ ...s, flexWrap: "wrap" }}>
          {[0,1,2,3].map(i => <Box key={i} style={{ width: "calc(50% - 1px)", height: "calc(50% - 1px)" }} />)}
        </div>
      );

    case "four-asymmetric":
      return (
        <div style={{ ...s, flexDirection: "column" }}>
          <div style={{ flex: 3, display: "flex", gap: 2 }}>
            <Box style={{ flex: 3 }} /><Box style={{ flex: 2 }} />
          </div>
          <div style={{ flex: 2, display: "flex", gap: 2 }}>
            <Box style={{ flex: 3 }} /><Box style={{ flex: 2 }} />
          </div>
        </div>
      );

    case "five-mosaic":
      return (
        <div style={{ ...s }}>
          <Box style={{ flex: 3 }} />
          <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ flex: 1, display: "flex", gap: 2 }}>
              <Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} />
            </div>
            <div style={{ flex: 1, display: "flex", gap: 2 }}>
              <Box style={{ flex: 1 }} /><Box style={{ flex: 1 }} />
            </div>
          </div>
        </div>
      );

    case "six-grid":
      return (
        <div style={{ ...s, flexWrap: "wrap" }}>
          {[0,1,2,3,4,5].map(i => <Box key={i} style={{ width: "calc(33.3% - 1.5px)", height: "calc(50% - 1px)" }} />)}
        </div>
      );

    case "photo-text":
      return (
        <div style={{ ...s, flexDirection: "column" }}>
          <Box style={{ flex: 3 }} />
          <div style={{ flex: 2, padding: "2px 0" }}><Lines /></div>
        </div>
      );

    case "text-photo":
      return (
        <div style={{ ...s }}>
          <div style={{ flex: 9, padding: "0 2px" }}><Lines /></div>
          <Box style={{ flex: 11 }} />
        </div>
      );

    case "text-only":
      return <div style={{ ...s, alignItems: "center" }}><Lines /></div>;

    default:
      return <div style={{ ...s }}><Box style={{ flex: 1 }} /></div>;
  }
}
