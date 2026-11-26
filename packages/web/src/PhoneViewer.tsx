import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { enterAt, loadRecipe, sourceStage, type Paper, type Plot, type Recipe, type Source } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { checkpointLabel, checkpointTime } from "./checkpoints.ts";
import { defaultRecipe } from "./defaults.ts";
import { canDrawPlots, inspectFor, listProjectCards, nudgeSplit, openForViewing, phoneWidth, projectCover, splitAt, viewerLibrary, type ProjectCard, type ViewerLibrary, type ViewerProject } from "./phone.ts";
import type { RasterView } from "./protocol.ts";
import { EMPTY_RUN, Runner, type RunState } from "./runner.ts";
import { decodeFile, sampleSource } from "./sample.ts";
import { SAMPLE_NAME } from "./session.ts";
import { StageView, useBlobUrl } from "./StageView.tsx";
import { Thumb } from "./Strip.tsx";
import { STAGE_NAMES, stripBoxes, thumbRenderSide } from "./strip.ts";
import { defaultLocalStorage, openLibrary, type Checkpoint, type ProjectId } from "./storage/index.ts";

const registry = createRegistry();
/** Strip thumbnails on the phone, in CSS px. */
const PHONE_THUMB = 64;
const NOTE = "Viewing only. To change a recipe, open plotlab on a laptop or another wide screen.";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True on phone-sized screens; follows turning the phone or resizing the window. */
export function usePhoneWidth(): boolean {
  const store = useMemo(() => phoneWidth(window), []);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * The phone viewer (#66, #74): your projects, then one project's plot full screen with a
 * before/after slider, its step strip and its checkpoints. It only reads storage (phone.ts).
 */
export function PhoneViewer() {
  const [lib, setLib] = useState<{ library: ViewerLibrary; example: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProjectId | null>(null);
  useEffect(() => {
    let alive = true;
    openLibrary({ localStorage: defaultLocalStorage() })
      .then(({ library }) => viewerLibrary(library, () => sampleSource(SAMPLE_NAME)))
      .then((l) => alive && setLib(l))
      .catch((e) => alive && setError(`Couldn't read your projects: ${errText(e)}`));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="phone">
      {lib && open ? <ProjectView library={lib.library} id={open} onBack={() => setOpen(null)} /> : <ProjectList lib={lib} error={error} onOpen={setOpen} />}
    </div>
  );
}

function ProjectList(props: { lib: { library: ViewerLibrary; example: boolean } | null; error: string | null; onOpen: (id: ProjectId) => void }) {
  const [cards, setCards] = useState<ProjectCard[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!props.lib) return;
    let alive = true;
    listProjectCards(props.lib.library).then(
      (c) => alive && setCards(c),
      (e) => alive && setFailed(`Couldn't read your projects: ${errText(e)}`),
    );
    return () => {
      alive = false;
    };
  }, [props.lib]);
  return (
    <>
      <header className="phone-top">
        <h1>plotlab</h1>
      </header>
      <p className="phone-note">{NOTE}</p>
      {props.lib?.example && <p className="phone-note">No projects are saved in this browser yet, so here is the sample to look at.</p>}
      {props.error || failed ? (
        <p className="phone-error">{props.error ?? failed}</p>
      ) : !cards ? (
        <p className="phone-wait">Loading your projects…</p>
      ) : (
        <ul className="phone-projects">
          {cards.map((c) => (
            <li key={c.id}>
              <button className="phone-project" onClick={() => props.onOpen(c.id)}>
                <Cover library={props.lib!.library} id={c.id} />
                <span className="phone-project-name">{c.name}</span>
                <span className="phone-project-meta">{c.checkpoints === 1 ? "1 checkpoint" : `${c.checkpoints} checkpoints`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A project's picture in the list: a stored checkpoint picture or the image itself (nothing drawn). */
function Cover(props: { library: ViewerLibrary; id: ProjectId }) {
  const [blob, setBlob] = useState<Blob>();
  useEffect(() => {
    let alive = true;
    void props.library
      .openProject(props.id)
      .then((p) => (p ? projectCover(p) : null))
      .then((c) => alive && c && setBlob(new Blob([c.bytes], { type: c.type })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [props.library, props.id]);
  const url = useBlobUrl(blob);
  return <span className="phone-cover">{url ? <img src={url} alt="" /> : <span className="pic-empty" aria-hidden="true" />}</span>;
}

/** A stored recipe, upgraded (ADR 0002) and fitted to the image; throws if it can't be read. */
const readRecipe = (json: unknown, src: Source): Recipe => enterAt(json === undefined ? defaultRecipe() : loadRecipe(json, registry).recipe, sourceStage(src), registry).recipe;

interface Opened {
  project: ViewerProject;
  /** The decoded image; null when this browser can't draw plots (stored pictures still show). */
  source: Source | null;
  /** The saved recipe ("now"), or null if this build can't read it. */
  current: Recipe | null;
  checkpoints: Checkpoint[];
}

function ProjectView(props: { library: ViewerLibrary; id: ProjectId; onBack: () => void }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Which version is shown: "now" or a checkpoint id. Looking at one changes nothing stored. */
  const [version, setVersion] = useState<string>("now");
  /** The tapped strip box ("source" or a step id); null = the end result. */
  const [picked, setPicked] = useState<string | null>(null);
  const [split, setSplit] = useState(0.5);
  const [full, setFull] = useState(false);
  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const runner = useRef<Runner | null>(null);

  // Open the project and start a worker for it (only now, so the list costs nothing).
  useEffect(() => {
    let alive = true;
    let r: Runner | null = null;
    void (async () => {
      try {
        const v = await openForViewing(props.library, props.id);
        if (!v) throw new Error("it isn't stored any more");
        if (!canDrawPlots()) {
          if (!alive) return;
          setProblem("This browser is too old to draw plots. Saved checkpoint pictures still show below; a newer browser (on iPhone, iOS 16.4 or later) shows the rest.");
          setOpened({ project: v.project, source: null, current: null, checkpoints: v.checkpoints });
          return;
        }
        const source = await decodeFile(new File([v.source.bytes], v.project.name, { type: v.source.type }));
        let current: Recipe | null = null;
        let unreadable: string | null = null;
        try {
          current = readRecipe(v.recipe, source);
        } catch (e) {
          unreadable = `This project's settings can't be read by this version (${errText(e)}).`;
        }
        if (!alive) return;
        if (unreadable) setProblem(unreadable);
        r = new Runner(setRun);
        r.setSource(source, v.project.id);
        runner.current = r;
        setOpened({ project: v.project, source, current, checkpoints: v.checkpoints });
        if (!current && v.checkpoints[0]) setVersion(v.checkpoints[0].id);
      } catch (e) {
        if (alive) setProblem(`Couldn't open this project: ${errText(e)}`);
      }
    })();
    return () => {
      alive = false;
      r?.dispose();
      runner.current = null;
    };
  }, [props.library, props.id]);

  const recipe = useMemo<Recipe | null>(() => {
    if (!opened?.source) return null;
    if (version === "now") return opened.current;
    const cp = opened.checkpoints.find((c) => c.id === version);
    try {
      return cp ? readRecipe(cp.recipe, opened.source) : null;
    } catch {
      return null;
    }
  }, [opened, version]);
  const inspect = recipe ? inspectFor(recipe, picked) : null;
  /** Another version: back to its end result (the tapped step may not be in it). */
  const showVersion = (v: string) => {
    setVersion(v);
    setPicked(null);
  };

  // A new version: a quick low-resolution picture first, then the full one.
  useEffect(() => {
    const r = runner.current;
    if (!r || !recipe) return;
    r.thumbs = thumbRenderSide(PHONE_THUMB, window.devicePixelRatio || 1);
    r.inspect = inspectFor(recipe, picked);
    r.request(recipe, true);
    r.request(recipe, false);
  }, [recipe]);
  // Another step tapped: the same recipe again, now drawing that step (the worker has it cached).
  useEffect(() => {
    const r = runner.current;
    if (!r || !recipe || r.inspect === inspect) return;
    r.inspect = inspect;
    r.request(recipe, false);
  }, [inspect]);

  // Escape leaves full screen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const boxes = recipe ? stripBoxes(recipe, registry, run) : [];
  const shownBox = picked ? boxes.find((b) => b.key === picked) : undefined;
  const inspected = inspect !== null && run.inspected ? run.inspected : null;
  const after = { rasters: inspected ? inspected.rasters : run.rasterLayers, plot: inspected ? inspected.plot : run.plot };
  // Before/after compares against the image as placed on the paper (there's none for an SVG).
  const before = inspect === "source" ? null : run.underlay;
  const caption = !shownBox ? "The result" : shownBox.index < 0 ? "The source image" : `Step ${shownBox.index + 1}: ${shownBox.title} (${STAGE_NAMES[shownBox.output]})`;

  return (
    <>
      <header className="phone-top">
        <button className="phone-back" onClick={props.onBack}>
          ‹ Projects
        </button>
        <h1 className="phone-title">{opened?.project.name ?? "Opening…"}</h1>
      </header>
      {problem && <p className="phone-error">{problem}</p>}
      {recipe && (
        <section className={full ? "phone-stage full" : "phone-stage"} aria-label="Plot">
          <div className="phone-stage-bar">
            <span className="phone-caption">
              {caption}
              {run.busy && <span className="phone-busy"> · drawing…</span>}
            </span>
            {picked && (
              <button className="phone-result" onClick={() => setPicked(null)}>
                Show result
              </button>
            )}
            <button className="phone-full" onClick={() => setFull((f) => !f)}>
              {full ? "Close" : "Full screen"}
            </button>
          </div>
          {run.error && <p className="phone-error">{run.error.message}</p>}
          <Compare paper={recipe.paper} before={before} after={after} split={split} onSplit={setSplit} />
        </section>
      )}
      {recipe && (
        <section className="phone-section" aria-label="Steps">
          <h2>Steps</h2>
          <p className="phone-hint">Tap a step to see what it makes. Swipe for more.</p>
          <div className="phone-strip">
            {boxes.map((b) => (
              <button key={b.key} className={b.key === picked ? "phone-box sel" : "phone-box"} aria-pressed={b.key === picked} onClick={() => setPicked((k) => (k === b.key ? null : b.key))}>
                <span className="pic">
                  <Thumb png={run.thumbs[b.key]} />
                </span>
                <span className="phone-box-name">{b.index < 0 ? "Source" : `${b.index + 1}. ${b.title}`}</span>
                <span className="phone-box-stage">{b.index < 0 ? "Image" : STAGE_NAMES[b.output]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {opened && (
        <section className="phone-section" aria-label="Checkpoints">
          <h2>Checkpoints</h2>
          {opened.checkpoints.length === 0 ? (
            <p className="phone-hint">No checkpoints saved for this project yet.</p>
          ) : (
            <p className="phone-hint">Tap one to see that version.</p>
          )}
          <div className="phone-checkpoints">
            {opened.current && (
              <button className={version === "now" ? "phone-ckpt sel" : "phone-ckpt"} aria-pressed={version === "now"} onClick={() => showVersion("now")}>
                <span className="phone-ckpt-pic phone-ckpt-now">Now</span>
                <span className="phone-ckpt-name">Latest settings</span>
              </button>
            )}
            {opened.checkpoints.map((cp) => (
              <button key={cp.id} className={version === cp.id ? "phone-ckpt sel" : "phone-ckpt"} aria-pressed={version === cp.id} onClick={() => showVersion(cp.id)}>
                <CheckpointPicture project={opened.project} id={cp.id} />
                <span className="phone-ckpt-name">{checkpointLabel(cp)}</span>
                {cp.name && <span className="phone-ckpt-when">{checkpointTime(cp.createdAt)}</span>}
              </button>
            ))}
          </div>
          {opened.source && version !== "now" && !recipe && <p className="phone-error">This checkpoint's settings can't be read by this version.</p>}
          {opened.checkpoints.find((c) => c.id === version)?.note && <p className="phone-ckpt-note">{opened.checkpoints.find((c) => c.id === version)!.note}</p>}
        </section>
      )}
      <p className="phone-note">{NOTE}</p>
    </>
  );
}

/** A checkpoint's stored picture (drawn on the laptop when it was saved); nothing is drawn here. */
function CheckpointPicture(props: { project: ViewerProject; id: string }) {
  const [blob, setBlob] = useState<Blob>();
  useEffect(() => {
    let alive = true;
    void props.project
      .getThumbnail(props.id)
      .then((b) => alive && b && setBlob(new Blob([b], { type: "image/png" })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [props.project, props.id]);
  const url = useBlobUrl(blob);
  return <span className="phone-ckpt-pic">{url ? <img src={url} alt="" /> : <span className="pic-empty" aria-hidden="true" />}</span>;
}

/**
 * The plot with a before/after slider: the image on the left of the line, the plot on the
 * right. Drag (finger or mouse) or tap anywhere on it to move the line; arrow keys work too.
 */
function Compare(props: { paper: Paper; before: RasterView | null; after: { rasters: RasterView[]; plot: Plot | null }; split: number; onSplit: (s: number) => void }) {
  const { paper, before, split } = props;
  const dragging = useRef(false);
  const ratio = (paper.widthMm + 10) / (paper.heightMm + 10);
  const view = <StageView paper={paper} rasters={props.after.rasters} plot={props.after.plot} showTravel={false} underlay={null} hidden={new Set()} empty="Drawing…" />;
  if (!before) {
    return (
      <div className="compare" style={{ aspectRatio: String(ratio), ["--ratio" as string]: ratio }}>
        <div className="compare-layer">{view}</div>
      </div>
    );
  }
  const move = (e: PointerEvent<HTMLDivElement>) => props.onSplit(splitAt(e.clientX, e.currentTarget.getBoundingClientRect()));
  const pct = Math.round(split * 100);
  return (
    <div
      className="compare"
      style={{ aspectRatio: String(ratio), ["--ratio" as string]: ratio }}
      role="slider"
      tabIndex={0}
      aria-label="Before and after"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}% shows the image before`}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => dragging.current && move(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        const next = nudgeSplit(split, e.key);
        if (next === null) return;
        e.preventDefault();
        props.onSplit(next);
      }}
    >
      <div className="compare-layer">
        <StageView paper={paper} rasters={[before]} plot={null} showTravel={false} underlay={null} hidden={new Set()} />
      </div>
      <div className="compare-layer compare-after" style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>
        {view}
      </div>
      <div className="compare-line" style={{ left: `${split * 100}%` }} aria-hidden="true">
        <span className="compare-grip">‹ ›</span>
      </div>
      <span className="compare-tag before" aria-hidden="true">
        Before
      </span>
      <span className="compare-tag after" aria-hidden="true">
        After
      </span>
    </div>
  );
}
